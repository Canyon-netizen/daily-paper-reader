"""PR-5 Concept Backlinks — 概念聚合 + 反向链接构建。

扫描 docs/papers/**/*-{slug}.md 中 frontmatter.concepts 字段
(仅 wiki_compiled: true 的),聚合成 wiki/concepts/<slug>.md:

  ## 出处
  ## 反向链接
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

from src.concept_slug import wiki_slug


# --- YAML front matter parsing (无外部依赖,容忍简陋格式) ---

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _parse_front_matter(text: str) -> Tuple[Dict[str, Any], str]:
    """轻量 frontmatter 解析;只支持概念字段用到的 scalar / list / dict of dicts."""
    if not text:
        return {}, ""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    block = m.group(1)
    body = text[m.end():]
    try:
        import yaml  # type: ignore
        parsed = yaml.safe_load(block) or {}
    except Exception:
        parsed = _fallback_yaml(block)
    if not isinstance(parsed, dict):
        parsed = {}
    return parsed, body


def _fallback_yaml(block: str) -> Dict[str, Any]:
    """极简 fallback:key: value 行 + 顶层 list 形态(只够定位 wiki_compiled/concepts)。"""
    out: Dict[str, Any] = {}
    lines = block.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not m:
            i += 1
            continue
        key, value = m.group(1), m.group(2).strip()
        if value == "":
            # 可能是嵌套 list / dict
            nested, consumed = _consume_block(lines, i + 1)
            out[key] = nested
            i += consumed + 1
        else:
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                if inner:
                    out[key] = [v.strip().strip('"').strip("'") for v in inner.split(",")]
                else:
                    out[key] = []
            elif value.lower() in ("true", "false"):
                out[key] = value.lower() == "true"
            else:
                out[key] = value.strip('"').strip("'")
            i += 1
    return out


def _consume_block(lines: List[str], start: int) -> Tuple[Any, int]:
    """从 start 起收集一个缩进 list / dict 块,返回 (parsed, lines_consumed)。"""
    items: List[Any] = []
    mapping: Dict[str, Any] = {}
    i = start
    while i < len(lines):
        line = lines[i]
        if not line.startswith(("  ", "\t")):
            break
        stripped = line.lstrip(" \t")
        if stripped.startswith("- "):
            item = stripped[2:].strip()
            if ":" in item:
                # inline dict within list 形态
                k, v = item.split(":", 1)
                items.append({k.strip(): _coerce_scalar(v.strip())})
            else:
                items.append(_coerce_scalar(item))
            i += 1
        else:
            mm = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", stripped)
            if mm:
                k, v = mm.group(1), mm.group(2).strip()
                mapping[k] = _coerce_scalar(v)
            i += 1
    if items and not mapping:
        return items, i - start
    if mapping:
        return mapping, i - start
    return {}, i - start


def _coerce_scalar(v: str) -> Any:
    if v == "":
        return ""
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [x.strip().strip('"').strip("'") for x in inner.split(",")]
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    try:
        return float(v)
    except ValueError:
        return v.strip('"').strip("'")


# --- 扫描与索引 ---

def scan_papers_with_wiki_compiled(
    docs_dir: str = "docs/papers",
) -> List[Dict[str, Any]]:
    """扫 frontmatter 含 wiki_compiled: true 的 md。

    返回 [{paper_id, slug, title, concepts}, ...]
    """
    out: List[Dict[str, Any]] = []
    if not docs_dir or not os.path.isdir(docs_dir):
        return out
    for root, _, files in os.walk(docs_dir):
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read()
            except OSError:
                continue
            meta, _ = _parse_front_matter(text)
            if not meta.get("wiki_compiled"):
                continue
            concepts = meta.get("concepts")
            if not isinstance(concepts, list) or not concepts:
                continue
            paper_id = str(meta.get("paper_id") or "")
            if not paper_id:
                # fallback: paper_id 反推自文件名 <arxiv-id>-<slug>.md
                stem = os.path.splitext(name)[0]
                paper_id = f"papers/{stem}"
            title = str(meta.get("title") or meta.get("title_en") or "")
            cleaned = []
            for c in concepts:
                if isinstance(c, dict) and c.get("slug"):
                    cleaned.append({
                        "slug": str(c["slug"]),
                        "display_name": str(c.get("display_name") or c.get("name") or c["slug"]),
                        "category": str(c.get("category") or "other"),
                        "novelty": c.get("novelty", 0.0),
                        "centrality": c.get("centrality", 0.0),
                    })
            if not cleaned:
                continue
            stem = os.path.splitext(name)[0]
            out.append({
                "paper_id": paper_id,
                "slug": stem,
                "title": title,
                "concepts": cleaned,
                "md_path": path,
            })
    return out


def rebuild(
    archive_dir: str = "wiki",
    docs_dir: str = "docs/papers",
    *,
    min_appearances: int = 2,
) -> Dict[str, List[Dict[str, Any]]]:
    """聚合 concepts → 写 wiki/concepts/<slug>.md + wiki/concepts/_graph.json。

    返回 {slug: [paper_records]} 映射(便于测试)。
    出现次数 < min_appearances 的 concept 不建独立 md,但仍计入返回结果 + graph。

    graph.json 形态(对齐 Polaris `services/graph.py::build_graph` 简化版):
        {
          "nodes": [
            {"id": <slug>, "label": <display_name>, "category": <cat>,
             "weight": <paper_count>, "kind": "concept"}
            ... + 论文节点 {"id": <paper_id>, "label": <title>, "kind": "paper"}
          ],
          "edges": [
            {"source": <paper_id>, "target": <slug>, "kind": "mentions"}
          ]
        }
    """
    papers = scan_papers_with_wiki_compiled(docs_dir)
    concept_to_papers: Dict[str, List[Dict[str, Any]]] = {}
    for paper in papers:
        for c in paper["concepts"]:
            concept_to_papers.setdefault(c["slug"], []).append({
                "paper_id": paper["paper_id"],
                "slug": paper["slug"],
                "title": paper["title"],
                # PR-5 v2: 把 concept 自己的 display_name / category / centrality 透传,
                # _write_concept_index 用这些字段写 _index.json —— 旧版只用 paper.title,
                # 导致概念卡片显示"StarBench: A Turn-Based..."而不是"Vision-Language Model"。
                "display_name": c.get("display_name") or c["slug"],
                "category": c.get("category"),
                "centrality": c.get("centrality", 0.0),
            })

    archive_path = os.path.join(archive_dir, "concepts")
    if min_appearances >= 1:
        os.makedirs(archive_path, exist_ok=True)

    for slug, paper_records in concept_to_papers.items():
        if len(paper_records) < min_appearances:
            continue
        md_path = os.path.join(archive_path, f"{slug}.md")
        _upsert_concept_page(md_path, slug, paper_records)

    # PR-5 v2: 写 _graph.json + _index.json (对齐 plan §14 PR 5)
    _write_concept_graph(archive_path, concept_to_papers)
    _write_concept_index(archive_path, concept_to_papers, min_appearances)

    return concept_to_papers


def _write_concept_graph(
    archive_path: str,
    concept_to_papers: Dict[str, List[Dict[str, Any]]],
) -> None:
    """写 wiki/concepts/_graph.json(plan §14 PR 5 原话未实现,本次补)。

    简化版 graph(对齐 Polaris graph.py:不引入 pgvector,只用节点 + 边静态 JSON):
      - concept 节点:权重 = 关联论文数
      - paper 节点: 包含 paper_id + title
      - mentions 边: paper → concept
    """
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    seen_papers: set = set()

    for slug, paper_records in concept_to_papers.items():
        # concept 节点
        first = paper_records[0] if paper_records else {}
        # PR-5 v2: 用 concept 自己的 display_name 做 label,不是 paper.title
        nodes.append({
            "id": slug,
            "label": first.get("display_name") or slug,
            "category": first.get("category") or "other",
            "weight": len(paper_records),
            "kind": "concept",
        })
        for p in paper_records:
            pid = p["paper_id"]
            # paper 节点(去重)
            if pid not in seen_papers:
                seen_papers.add(pid)
                nodes.append({
                    "id": pid,
                    "label": p.get("title") or pid,
                    "kind": "paper",
                })
            # mentions 边
            edges.append({
                "source": pid,
                "target": slug,
                "kind": "mentions",
            })

    payload = {"nodes": nodes, "edges": edges}
    path = os.path.join(archive_path, "_graph.json")
    import json as _json
    with open(path, "w", encoding="utf-8") as f:
        _json.dump(payload, f, ensure_ascii=False, indent=2)


def _write_concept_index(
    archive_path: str,
    concept_to_papers: Dict[str, List[Dict[str, Any]]],
    min_appearances: int,
) -> None:
    """写 wiki/concepts/_index.json(浏览器端 /concepts 页 grid 渲染用)。"""
    import json as _json
    rows: List[Dict[str, Any]] = []
    for slug, paper_records in concept_to_papers.items():
        if len(paper_records) < min_appearances:
            continue
        first = paper_records[0]
        rows.append({
            "slug": slug,
            # PR-5 v2: 用 concept 自己的 display_name (透传自 paper frontmatter),
            # 不是 paper title —— 否则 grid 卡片显示 paper 标题而不是概念名。
            "display_name": first.get("display_name") or slug,
            "category": first.get("category") or "other",
            "paper_count": len(paper_records),
        })
    path = os.path.join(archive_path, "_index.json")
    with open(path, "w", encoding="utf-8") as f:
        _json.dump(rows, f, ensure_ascii=False, indent=2)


def _upsert_concept_page(
    md_path: str,
    slug: str,
    papers: List[Dict[str, Any]],
) -> None:
    """新建或更新 wiki/concepts/<slug>.md。"""
    if not os.path.exists(md_path):
        # 新建:简单 frontmatter + 出处段 + 反向链接段
        first = papers[0]
        # PR-5 v2: 用 concept 的 display_name(透传自 paper frontmatter),不是 paper.title
        display_name = first.get("display_name") or slug
        body = _render_concept_md(slug, display_name, papers)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(body)
    else:
        # 更新:替换 ## 出处 / ## 反向链接 块
        with open(md_path, "r", encoding="utf-8") as f:
            text = f.read()
        updated = _replace_block(text, "出处", _render_origin_section(papers))
        updated = _replace_block(updated, "反向链接", _render_reverse_links_section(papers))
        if updated != text:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(updated)


def _render_concept_md(slug: str, display_name: str, papers: List[Dict[str, Any]]) -> str:
    origin = _render_origin_section(papers)
    reverse = _render_reverse_links_section(papers)
    # Stage 8 后置校验 —— 抛错让上层 rebuild 失败可观察,而不是悄悄写出坏数据。
    _validate_concept_labels(slug, display_name, papers)
    # Stage 8 fix:用 yaml.safe_dump 写 frontmatter,不用 f-string —— 实测 121/221
    # 个 wiki/concepts/*.md 的 frontmatter 因为 display_name 含未引号化 `: `
    # 而 yaml.safe_load 抛 ScannerError。这条路修复后整个 .md 都能被 yaml 解析,
    # 后续 Obsidian / VSCode / Astro 都受益。
    import yaml  # type: ignore
    fm = yaml.safe_dump(
        {
            "concept_id": slug,
            "display_name": display_name,
            "category": (papers[0].get("category") or "other"),
        },
        allow_unicode=True,
        sort_keys=False,
    )
    return (
        f"---\n"
        f"{fm}"
        f"---\n\n"
        f"# {display_name}\n\n"
        f"{origin}\n\n"
        f"{reverse}\n"
    )


def _first_h1_title(md: str) -> Optional[str]:
    """Stage 8:粗略 H1 标题提取;_render_concept_md 写出来前必须先过这关。"""
    if not md:
        return None
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip()
    return None


def _validate_concept_labels(slug: str, display_name: str, papers: List[Dict[str, Any]]) -> None:
    """Stage 8 fail-loud 后置校验:产出 frontmatter 前再核一次。
    触发条件(任一):display_name > 40 字符;display_name 与某论文标题相同
    (则网格展示的就是论文标题而非概念名,已知 bug 修复)。
    """
    if len(display_name) > 40:
        raise ValueError(
            f"concept {slug!r} display_name 太长 ({len(display_name)} 字符): "
            f"{display_name[:60]!r}..."
        )
    title_set = {(p.get("title") or "").strip().lower() for p in papers if p.get("title")}
    if title_set and display_name.strip().lower() in title_set:
        raise ValueError(
            f"concept {slug!r} display_name 与某论文标题相同: {display_name!r}。"
            f"这是 PR-5 v2 修过的污染 bug,重建触发请检查 extractor 或 paper frontmatter。"
        )


def _render_origin_section(papers: List[Dict[str, Any]]) -> str:
    lines = ["## 出处", ""]
    for p in papers:
        lines.append(f"- [[{p['paper_id']}]] — {p.get('title') or p.get('slug') or p['paper_id']}")
    return "\n".join(lines)


def _render_reverse_links_section(papers: List[Dict[str, Any]]) -> str:
    ids = sorted({str(p["paper_id"]) for p in papers})
    lines = ["## 反向链接", ""]
    if ids:
        lines.append("(自动生成)")
        for pid in ids:
            lines.append(f"- [[{pid}]]")
    else:
        lines.append("（无）")
    return "\n".join(lines)


_HEADING_KEY = "__HEADING__"


def _replace_block(text: str, heading: str, new_section: str) -> str:
    """替换 ## {heading} ... 直到下一个 ## heading 或文件末尾。"""
    marker = f"## {heading}"
    idx = text.find(marker)
    if idx == -1:
        # 追加
        sep = "\n\n" if not text.endswith("\n") else "\n"
        return text + sep + new_section + "\n"
    # 找下一个 "## "
    rest_start = idx + len(marker)
    next_heading = re.search(r"^## ", text[rest_start:], re.MULTILINE)
    end = rest_start + next_heading.start() if next_heading else len(text)
    before = text[:idx].rstrip() + "\n\n"
    after = text[end:].lstrip("\n")
    rebuilt = before + new_section + ("\n\n" + after if after else "\n")
    return rebuilt
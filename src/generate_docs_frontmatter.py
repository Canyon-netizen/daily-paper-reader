"""Step 6 — frontmatter & meta extraction helpers.

从 6.generate_docs.py 抽出,纯字符串解析/stdlib, 不依赖 LLM 客户端
也不依赖 fitz / requests — 这两个被 import 期副作用影响。主文件通过
`from src.generate_docs_frontmatter import *` 重新导出, 任何 import
6.generate_docs.py 的下游 (conference_sidebar.py 动态加载) 自动得到
同名访问。
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List


def _extract_md_section(md_text: str, heading: str) -> str:
    """
    从 Markdown 文本中提取 `## {heading}` 小节内容（直到下一个二级标题）。
    """
    if not md_text:
        return ""
    marker = f"## {heading}\n"
    start = md_text.find(marker)
    if start == -1:
        return ""
    after = md_text[start + len(marker) :]
    # 下一个二级标题
    m = re.search(r"\n##\s+", after)
    return (after if not m else after[: m.start()]).strip()

def _parse_simple_yaml_list(raw: str) -> List[str]:
    items: List[str] = []
    inner = raw.strip()[1:-1].strip()
    if not inner:
        return items
    current = ""
    in_quote = False
    quote_char = ""
    escape = False
    for ch in inner:
        if escape:
            current += ch
            escape = False
            continue
        if ch == "\\":
            current += ch
            escape = True
            continue
        if ch in ("'", '"') and not in_quote:
            in_quote = True
            quote_char = ch
            current += ch
            continue
        if in_quote and ch == quote_char:
            in_quote = False
            quote_char = ""
            current += ch
            continue
        if (ch == ",") and not in_quote:
            val = current.strip()
            if val:
                items.append(val)
            current = ""
            continue
        current += ch
    last = current.strip()
    if last:
        items.append(last)

    return [re.sub(r'^["\']|["\']$', "", it).replace("\\\\", "\\").replace('\\"', '"').replace("\\'", "'") for it in items]

def _parse_front_matter(md_text: str) -> Dict[str, Any]:
    """
    简易解析 Markdown 文件中的 YAML front matter，优先提取 metadata。

    支持 folded quoted scalars:一行以单/双引号起头但没在同行闭合时,
    会继续读后续的「以空白起头 + 闭合引号」续行,合并成一个字符串
    (YAML 行为:folded scalar 用空格连接)。例::

        title: 'LatentSkill: From In-Context Textual Skills to
          LLM Agents'

    → title = "LatentSkill: From In-Context Textual Skills to LLM Agents"
    """
    text = (md_text or "").lstrip()
    if not text.startswith("---"):
        return {}
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    block = text[3:end]
    meta: Dict[str, Any] = {}
    lines = block.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        i += 1
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            continue
        key, raw = stripped.split(":", 1)
        key = key.strip()
        if not key:
            continue
        raw = raw.strip()
        if not raw:
            meta[key] = ""
            continue

        # folded quoted scalar:同行未闭合,继续读缩进续行直到引号闭合
        if raw[0] in ('"', "'") and not (len(raw) >= 2 and raw[-1] == raw[0]):
            quote = raw[0]
            buf = [raw[1:]]
            closed = False
            while i < len(lines):
                cont = lines[i]
                i += 1
                # 续行必须以空白起头(folded 的标准折叠)
                if not (cont and cont[0] in (" ", "\t")):
                    # 退回一行,外层 while 会再处理它
                    i -= 1
                    break
                cont_stripped = cont.strip()
                if cont_stripped.endswith(quote):
                    buf.append(cont_stripped[:-1])
                    closed = True
                    break
                buf.append(cont_stripped)
            raw = " ".join(part.strip() for part in buf if part is not None)
            if closed:
                # 闭合的 quoted scalar → 走统一解引号流程
                val: Any = raw.replace("\\n", "\n").replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")
                meta[key] = val
                continue

        val = raw
        lowered = raw.lower()
        if lowered in ("null", "~", "none"):
            val = ""
        elif raw.startswith("[") and raw.endswith("]"):
            try:
                val = json.loads(raw)
                if not isinstance(val, list):
                    raise ValueError
            except Exception:
                val = _parse_simple_yaml_list(raw)
        elif raw.startswith("{") and raw.endswith("}"):
            # 4-dim categories 行:{venue: ["..."], task: [...], ...} — 直接 JSON-load。
            # 单行 flow-style(由 src/taxonomy.py::categories_to_yaml_inline / src/6.generate_docs.py 写入),
            # json.loads 即得 dict。
            try:
                parsed_dict = json.loads(raw)
                if isinstance(parsed_dict, dict):
                    val = parsed_dict
                else:
                    val = raw
            except Exception:
                val = raw
        else:
            if (raw[0] in ('"', "'") and raw[-1] == raw[0]) or (
                raw[0] == '"' and raw[-1] == '"' and len(raw) >= 2
            ):
                raw = raw[1:-1]
            val = raw.replace("\\n", "\n").replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")

        meta[key] = val
    return meta

def _parse_generated_md_to_meta(
    md_path: str,
    paper_id: str,
    section: str,
    selection_source: str = "",
    paper_abstract: str = "",
) -> Dict[str, Any]:
    """
    从 Step6 已生成的论文 Markdown 中提取可导出的元信息（不引入额外 LLM 调用）。
    """
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        text = ""

    lines = (text or "").splitlines()
    fm_meta: Dict[str, Any] = _parse_front_matter(text)

    legacy_meta: Dict[str, str] = {}
    for line in lines:
        m = re.match(r"^\*\*([^*]+)\*\*:\s*(.*?)(?:\s*\\\s*)?$", line.strip())
        if not m:
            continue
        k = (m.group(1) or "").strip().lower()
        legacy_meta[k] = (m.group(2) or "").strip()

    # 标题：优先 front matter title，次选正文 H1，其次旧式 meta 行
    title_en = (str(fm_meta.get("title") or "").strip() if fm_meta else "")
    if not title_en:
        h1s: List[str] = []
        for line in lines:
            m = re.match(r"^#\s+(.*)$", line)
            if not m:
                break
            h1s.append((m.group(1) or "").strip())
            if len(h1s) >= 1:
                break
        if h1s:
            title_en = h1s[0]
    if not title_en:
        title_en = legacy_meta.get("title", "")

    # 4-dim categories:优先从 frontmatter 抽 venue/task/method/type (各 dim string[]);
    # 标签(tags)那里只读历史 string[] (kind:label) 兼容路径。
    categories: Dict[str, List[str]] = {"venue": [], "task": [], "method": [], "type": []}
    raw_cats = fm_meta.get("categories")
    if isinstance(raw_cats, dict):
        for dim in ("venue", "task", "method", "type"):
            items = raw_cats.get(dim)
            if isinstance(items, list):
                cleaned = [str(i).strip() for i in items if str(i).strip()]
                categories[dim] = cleaned

    # tags：优先 front matter tags，次选旧式 HTML
    tags_typed: List[Dict[str, str]] = []
    # 本批过渡:若 frontmatter 已经有 categories,tags_typed 就按 categories
    # 拍平为 "dim:label" tokens 输出,保持 downstream 消费者语义。
    if any(categories[d] for d in categories):
        for dim in ("venue", "task", "method", "type"):
            for label in categories[dim]:
                tags_typed.append({"kind": dim, "label": label})
    else:
        raw_tags = fm_meta.get("tags") if "tags" in fm_meta else fm_meta.get("Tags")
        if isinstance(raw_tags, list):
            tag_items = [str(i).strip() for i in raw_tags if str(i).strip()]
        elif isinstance(raw_tags, str):
            candidate = raw_tags.strip()
            if candidate.startswith("[") and candidate.endswith("]"):
                tag_items = _parse_simple_yaml_list(candidate)
            else:
                tag_items = [t.strip() for t in re.split(r",|，", candidate) if t.strip()]
        else:
            tag_items = []

        if tag_items:
            for t in tag_items:
                if ":" in t:
                    kind, label = t.split(":", 1)
                    tags_typed.append({"kind": (kind or "paper").strip(), "label": (label or "").strip()})
                else:
                    tags_typed.append({"kind": "paper", "label": t})
        else:
            # 兼容旧式 markdown 的 HTML tag span
            tags_html = str(fm_meta.get("tags") or legacy_meta.get("tags") or "")
            for m in re.finditer(
                r'<span\s+class="tag-label\s+([^"]+)"[^>]*>(.*?)</span>',
                tags_html,
                flags=re.IGNORECASE | re.DOTALL,
            ):
                cls = m.group(1) or ""
                label = re.sub(r"<[^>]+>", "", (m.group(2) or "")).strip()
                if not label:
                    continue
                kind = "paper"
                if "tag-green" in cls:
                    kind = "keyword"
                elif "tag-blue" in cls:
                    kind = "query"
                tags_typed.append({"kind": kind, "label": label})

    parsed_abstract_en = _extract_md_section(text, "Abstract")
    abstract_en = str(paper_abstract or "").strip()
    if not abstract_en:
        abstract_en = parsed_abstract_en
    if not abstract_en and "## Abstract" in text:
        # 兜底：md 有 Abstract 标题但抽取文本为空
        abstract_en = parsed_abstract_en
    if not abstract_en:
        abstract_en = "arXiv did not provide an abstract for this paper."

    # 作者：front matter authors 优先，次选旧式 meta 行
    raw_authors = fm_meta.get("authors") if "authors" in fm_meta else fm_meta.get("Authors")
    if isinstance(raw_authors, list):
        authors_line = ", ".join(str(i).strip() for i in raw_authors if str(i).strip())
    elif isinstance(raw_authors, str):
        authors_line = ", ".join(a.strip() for a in re.split(r",|，", raw_authors) if a.strip())
    else:
        authors_line = legacy_meta.get("authors", "")

    # 日期、PDF、分数、Evidence、TLDR：front matter 优先，次选旧式 meta
    def _fallback_meta(*names: str) -> str:
        for name in names:
            if name in fm_meta and fm_meta[name] is not None:
                return str(fm_meta[name]).strip()
            legacy = legacy_meta.get(name.lower())
            if legacy:
                return legacy
        return ""

    date_value = _fallback_meta("date", "Date")
    pdf_value = _fallback_meta("pdf", "PDF")
    score_value = _fallback_meta("score", "Score")
    evidence_value = _fallback_meta("evidence", "Evidence")
    tldr_value = _fallback_meta("tldr", "TLDR")
    paper_source_value = str(fm_meta.get("source") or fm_meta.get("Source") or "").strip()
    src_value = str(selection_source or "").strip()
    if not src_value and "selection_source" in fm_meta:
        src_value = str(fm_meta.get("selection_source") or "").strip()

    # tags：输出为更“短”的一行形式（字符串），避免 JSON pretty-print 时每个 tag 独占一行
    tags_compact: List[str] = []
    for t in tags_typed:
        kind = (t.get("kind") or "").strip() or "paper"
        label = (t.get("label") or "").strip()
        if not label:
            continue
        tags_compact.append(f"{kind}:{label}")

    return {
        "paper_id": paper_id,
        "section": section,
        "title_en": title_en,
        "authors": authors_line,
        "date": str(date_value or "").strip(),
        "pdf": str(pdf_value or "").strip(),
        "score": str(score_value or "").strip(),
        "evidence": str(evidence_value or "").strip(),
        "tldr": str(tldr_value or "").strip(),
        "tags": ", ".join(tags_compact),
        # 4-dim categories — 同步塞到 meta 里。venue/task/method/type 各自 string[];
        # 下游消费侧(supabase / /papers/[arxiv] 等)按 dim 单独读。
        "categories": categories,
        "abstract_en": abstract_en,
        "source": paper_source_value,
        "selection_source": src_value,
    }


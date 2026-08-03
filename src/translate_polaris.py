# -*- coding: utf-8 -*-
"""
Translate each paper's body to Polaris-style Chinese interpretation.

For each docs/papers/**/*.md (excluding READMEs etc.), call LLM to produce
a 5-section Chinese article (TL;DR / 研究背景与动机 / 方法 / 实验与结果 /
讨论与可借鉴点), 800-1500 chars. Append as a new section to the paper file
between frontmatter and the existing ## 摘要 section. Sets wiki_compiled: true
+ wiki_compiled_at in frontmatter.

Model: MiniMax-M2.7-highspeed (~5s/call). Concurrency 16-32.

Usage:
  python -m src.translate_polaris --dry-run           # count, no LLM call
  python -m src.translate_polaris --limit 5 --concurrency 4   # smoke
  python -m src.translate_polaris --concurrency 16    # all 464 papers
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_PAPERS = REPO_ROOT / "docs" / "papers"

LIBRARIAN_PROMPT = (
    "你是 Librarian，负责把一篇论文写成一篇深入浅出的中文解读文章（markdown，正文优先引用全文）。"
    "像优秀的技术博客那样行文：用连贯的多段落叙述展开，段落之间自然衔接、有承接的逻辑线，"
    "不要写成要点提纲；除必要的公式或代码外尽量少用列表。\n"
    "结构骨架（保留二级标题层级，小标题措辞可按论文内容微调）：\n"
    "## TL;DR\n两三句话说清这篇论文做了什么、结果如何。\n"
    "## 研究背景与动机\n这个问题为什么重要、已有方法卡在哪里、这篇论文的切入点是什么。\n"
    "## 方法\n核心思路是怎么来的，关键设计逐步展开讲透（为什么这样设计、和直觉做法差在哪）。\n"
    "## 实验与结果\n实验设置、主要数字与对比、这些结果说明了什么。\n"
    "## 讨论与可借鉴点\n局限、未解决的问题，以及对当前研究方向的启发。\n"
    "写作要求：\n"
    "- 篇幅充分展开（通常 800–1500 字）；有全文时要利用正文细节，不要只复述摘要；\n"
    "- 数学符号与公式用 LaTeX：行内 $...$，重要公式独立一行用 $$...$$；\n"
    "概念双链 [[概念名]]（严格遵守，宁缺毋滥）：\n"
    "- 全文最多标 5–8 个，只标**跨论文复现**的通用概念——方法范式、模型架构、研究问题、\n"
    "  评测指标这类读者在同领域别的论文里也会遇到、值得单独立词条的术语；\n"
    "- 这篇论文自己起的名字一律不要标：它提出的方法缩写、系统名、模型代号，以及它自建的\n"
    "  benchmark 名、数据集名。除非该名字已是领域通用术语（如 Transformer、ImageNet、MMLU），\n"
    "  否则就在正文里正常写出来，不要加双链；\n"
    "- 标注放在正文叙述里该概念首次出现处，不要在文末单独罗列「相关概念」清单。\n"
    "严禁：<think>块、prose 引言、英文输出、markdown 代码块包裹整篇、\n"
    "只输出一个章节、或在每节末尾加「待补」「待完善」。\n"
    "直接输出 5 个二级标题及其内容，从「## TL;DR」开始。"
)


def iter_paper_md_files():
    out = []
    for p in DOCS_PAPERS.rglob("*.md"):
        if p.name in ("README.md", "path-spec.md", "zotero-usage.md"):
            continue
        if p.name.startswith("_"):
            continue
        out.append(p)
    return out


def parse_frontmatter(md: str):
    if not md.startswith("---"):
        return ({}, md)
    end = md.find("\n---", 4)
    if end < 0:
        return ({}, md)
    block = md[4:end]
    body = md[end + 4:]
    try:
        data = yaml.safe_load(block) or {}
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    return (data, body)


def write_frontmatter_and_body(md_path: Path, front: dict, body: str):
    yaml_str = yaml.safe_dump(front, allow_unicode=True, sort_keys=False)
    md_path.write_text(f"---\n{yaml_str}---{body}", encoding="utf-8")


def extract_inputs(front: dict, body: str) -> tuple[str, str, str]:
    """Return (title_zh_or_en, abstract_zh, fulltext_or_empty)."""
    title = (front.get("title_zh") or front.get("title") or "").strip()
    abstract = (front.get("abstract") or front.get("tldr") or "").strip()
    # Body in .md may already include 摘要 / Abstract sections; we pass everything
    # after the frontmatter.
    fulltext = body.strip()
    if len(fulltext) > 8000:
        fulltext = fulltext[:8000]
    return (title, abstract, fulltext)


def _strip_think(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    return text.strip()


def call_librarian(url: str, key: str, model: str, title: str, abstract: str, fulltext: str) -> str:
    user_lines = [
        f"标题: {title}",
        "",
        "## 摘要",
        abstract or "(无摘要)",
    ]
    if fulltext:
        user_lines.append("\n## 论文正文(截断)")
        user_lines.append(fulltext)
    user_msg = "\n".join(user_lines)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": LIBRARIAN_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
        "max_tokens": 4000,
    }
    req = urllib.request.Request(
        f"{url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        content = _strip_think(content)
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, KeyError, TimeoutError) as e:
        return f"__LLM_ERR__{type(e).__name__}: {e}"
    # try parse JSON
    try:
        # response_format guarantees JSON object; tolerate list too
        try:
            obj = json.loads(content)
        except Exception:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                obj = json.loads(content[start:end + 1])
            else:
                obj = None
        if isinstance(obj, dict):
            # expected: {"article": "..."}
            for k in ("article", "markdown", "content", "text", "body"):
                v = obj.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()
            # any string field
            for v in obj.values():
                if isinstance(v, str) and len(v.strip()) > 200:
                    return v.strip()
        if isinstance(obj, list) and obj:
            v = obj[0]
            if isinstance(v, str):
                return v
            if isinstance(v, dict):
                for vv in v.values():
                    if isinstance(vv, str) and len(vv.strip()) > 200:
                        return vv.strip()
    except Exception:
        pass
    # not JSON; maybe raw markdown
    if content.startswith("## "):
        return content
    return f"__LLM_PARSE_FAIL__: first 200 chars: {content[:200]}"


def _validate_article(text: str) -> bool:
    """Returns True if article has all 5 section headers and >= 400 chars."""
    if text.startswith("__LLM_"):
        return False
    required = ["## TL;DR", "## 研究背景与动机", "## 方法", "## 实验与结果", "## 讨论与可借鉴点"]
    return all(h in text for h in required) and len(text) >= 400


def _insert_into_body(body: str, article: str) -> str:
    """Insert compiled article right after frontmatter and before 摘要/Abstract."""
    head = ""
    rest = body
    # Find first heading (## ...) or first non-empty line
    lines = body.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("#"):
            insert_at = i
            break
    if insert_at == 0:
        # No heading yet — insert after leading blank lines
        for i, line in enumerate(lines):
            if line.strip():
                insert_at = i
                break
    # Insert compiled article with a clear marker
    block = "\n\n" + article.strip() + "\n\n"
    new_lines = lines[:insert_at] + [block] + lines[insert_at:]
    return "".join(new_lines)


def translate_one(md_path: Path, url: str, key: str, model: str) -> tuple[Path, str, str]:
    """Returns (path, status, article_or_err). status in ('ok','skip','err')."""
    text = md_path.read_text(encoding="utf-8")
    front, body = parse_frontmatter(text)
    if front.get("wiki_compiled") is True and not front.get("_force_recompile"):
        return (md_path, "skip", "already compiled")
    title, abstract, fulltext = extract_inputs(front, body)
    if not title and not abstract:
        return (md_path, "err", "no title/abstract")
    article = call_librarian(url, key, model, title, abstract, fulltext)
    if not _validate_article(article):
        return (md_path, "err", article[:200])
    new_body = _insert_into_body(body, article)
    front["wiki_compiled"] = True
    front["wiki_compiled_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    front.pop("_force_recompile", None)
    write_frontmatter_and_body(md_path, front, new_body)
    return (md_path, "ok", f"{len(article)} chars")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=0, help="Process at most N papers (0=all)")
    p.add_argument("--concurrency", type=int, default=16)
    p.add_argument("--force", action="store_true", help="Re-compile even if wiki_compiled:true")
    p.add_argument("--only-no-score", action="store_true", help="Skip papers without score field")
    args = p.parse_args()

    files = iter_paper_md_files()
    todo: list[Path] = []
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
            front, _ = parse_frontmatter(text)
        except Exception:
            continue
        if args.only_no_score and "score" not in front:
            todo.append(f)
            continue
        if args.force:
            front["_force_recompile"] = True
        if front.get("wiki_compiled") is True and not args.force:
            continue
        todo.append(f)
    if args.limit:
        todo = todo[: args.limit]

    print(f"[translate] {len(files)} total / {len(todo)} to translate (concurrency={args.concurrency})")

    if args.dry_run:
        for f in todo[:10]:
            print(" -", f.relative_to(REPO_ROOT))
        return 0

    with open(REPO_ROOT / ".env", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url = os.environ["LLM_BASE_URL"]
    key = os.environ["LLM_API_KEY"]
    model = os.environ.get("LLM_MODEL", "MiniMax-M2.7-highspeed")

    ok = err = skip = 0
    t0 = time.time()
    err_samples: list[str] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(translate_one, f, url, key, model): f for f in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            path, status, info = fut.result()
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                err += 1
                if len(err_samples) < 5:
                    err_samples.append(f"{path.name}: {info[:120]}")
            if i % 20 == 0 or i == len(todo):
                elapsed = time.time() - t0
                rate = i / max(0.1, elapsed)
                eta = (len(todo) - i) / max(0.1, rate)
                print(f"[translate] {i}/{len(todo)} ok={ok} err={err} skip={skip} | {rate:.1f}/s ETA {eta/60:.1f}min", file=sys.stderr)
    print(f"\n[translate] done in {time.time()-t0:.1f}s: ok={ok} err={err} skip={skip}")
    for s in err_samples:
        print(" err:", s)
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
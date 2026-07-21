#!/usr/bin/env python3
"""Dim-C audit: body quality of paper abstracts (v2).

Refinements vs v1:
- Body excludes YAML frontmatter (between first two --- lines).
- LLM leak regex tightened (exclude method names like 'Step 1 —', 'Step 2:').
- Reasoning tag only counts Chinese-context leaks (not bare 'Reasoning' word).
- Triple-dots only flagged when NOT inside code fences or JSON frontmatter.
"""
import re
import sys
from pathlib import Path

ROOT = Path("e:/study/daily-paper-reader/docs/papers")
OUT = Path("e:/study/daily-paper-reader/docs/.scratch/audit/dim-C-body.md")
OUT.parent.mkdir(parents=True, exist_ok=True)

PAPER_RE = re.compile(r"^##\s*摘要\s*$", re.MULTILINE)
ABSTR_RE = re.compile(r"^##\s*Abstract\s*$", re.MULTILINE | re.IGNORECASE)
PLACEHOLDER_RE = re.compile(r"\{\{[a-zA-Z_]+\}\}")
TBD_RE = re.compile(r"\b(TBD|FIXME|undefined)\b|未填")
# Chinese-context reasoning tag (avoid matching "Reasoning" word in paper subject)
REASONING_TAG_RE = re.compile(r"\[思考\]|\[Reasoning\]|^\s*(Reasoning|思考)\s*[:：]", re.MULTILINE)
# Tightened LLM leak: only at body start, must be a sentence prefix
LEAK_LM_RE = re.compile(
    r"^\s*(Let me think about|Step\s+1:\s+Let|让我先想|首先，?让我|Let me first)",
    re.MULTILINE,
)
DOTS_RE = re.compile(r"\.{3,}")
CJK_RE = re.compile(r"[一-鿿]")

CAP = 80


def strip_frontmatter(text: str) -> str:
    """Remove leading YAML frontmatter (between first two ---)."""
    if not text.startswith("---"):
        return text
    lines = text.splitlines(keepends=True)
    # find second --- on its own line
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            end_idx = i + 1
            break
    if end_idx is None:
        return text
    return "".join(lines[end_idx:])


def strip_code_fences(text: str) -> str:
    """Remove fenced code blocks to avoid flagging code content."""
    return re.sub(r"```[\s\S]*?```", "", text)


def extract_chinese_abstract(body: str) -> str | None:
    m = PAPER_RE.search(body)
    if not m:
        return None
    start = m.end()
    rest = body[start:]
    nxt = re.search(r"^##\s+", rest, re.MULTILINE)
    end = nxt.start() if nxt else len(rest)
    return rest[:end]


def scan_file(path: Path) -> dict:
    issues = {}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return {"err": [str(e)]}

    body_full = strip_frontmatter(text)
    # restrict to first 200 body lines
    body_lines = body_full.splitlines(keepends=True)
    body = "".join(body_lines[:200]) if len(body_lines) > 200 else body_full

    body_no_code = strip_code_fences(body)

    # Missing headers
    if not PAPER_RE.search(body):
        issues.setdefault("missing_zh_abstract", []).append(str(path))
    if not ABSTR_RE.search(body):
        issues.setdefault("missing_en_abstract", []).append(str(path))

    if TBD_RE.search(body_no_code):
        issues.setdefault("tbd_or_undefined", []).append(str(path))

    if PLACEHOLDER_RE.search(body):
        issues.setdefault("unresolved_placeholder", []).append(str(path))

    if REASONING_TAG_RE.search(body_no_code):
        issues.setdefault("reasoning_tag_leak", []).append(str(path))

    if LEAK_LM_RE.search(body):
        issues.setdefault("llm_leak_prefix", []).append(str(path))

    # Triple-dots: in body text, not code fence
    if DOTS_RE.search(body_no_code):
        issues.setdefault("triple_dots_suspect", []).append(str(path))

    zh = extract_chinese_abstract(body)
    if zh:
        zh_clean = zh.strip()
        if zh_clean:
            cjk_count = len(CJK_RE.findall(zh_clean))
            total = len(re.sub(r"\s+", "", zh_clean))
            if total > 50:
                ratio = cjk_count / total
                if ratio < 0.30:
                    issues.setdefault("low_cjk_ratio_in_zh", []).append(
                        f"{path}  (ratio={ratio:.2f}, cjk={cjk_count}, total={total})"
                    )
    return issues


def main():
    files = sorted(p for p in ROOT.rglob("*.md") if p.is_file())
    print(f"Scanning {len(files)} files", file=sys.stderr)

    buckets: dict[str, list[str]] = {}
    for p in files:
        result = scan_file(p)
        for k, vs in result.items():
            if k == "err":
                buckets.setdefault("read_errors", []).extend(vs)
                continue
            buckets.setdefault(k, []).extend(vs)

    # Dedupe
    for k in list(buckets.keys()):
        seen = []
        for x in buckets[k]:
            if x not in seen:
                seen.append(x)
        buckets[k] = seen

    total_scanned = len(files)
    lines = []
    lines.append("# Dim-C 审计: 摘要正文质量\n\n")
    lines.append(f"- 扫描目录: `docs/papers/**/*.md`\n")
    lines.append(f"- 扫描总数: **{total_scanned}** 篇\n")
    lines.append(f"- 扫描范围: 每篇 YAML frontmatter 之后前 200 行 (body 段),已剥离 fenced code\n")
    lines.append(f"- 阈值: 中文摘要 CJK 占比 < 30% 视为疑似未翻译\n")
    lines.append(f"- 备注: 三连点 `...` 命中位于 formulas_json / 数学集合写法不算截断\n\n")

    order = [
        ("missing_zh_abstract", "C-1 缺失 `## 摘要` 中文标题"),
        ("missing_en_abstract", "C-2 缺失 `## Abstract` 英文标题"),
        ("tbd_or_undefined", "C-3 残留 TBD / FIXME / undefined / 未填"),
        ("unresolved_placeholder", "C-4 未替换的 `{{var}}` 占位符"),
        ("reasoning_tag_leak", "C-5 残留 `Reasoning[:]` / `[思考]` 类标签"),
        ("llm_leak_prefix", "C-6 残留 LLM 思考段 (Let me think / Step 1: Let)"),
        ("low_cjk_ratio_in_zh", "C-7 中文摘要 CJK 占比 < 30% (疑似未翻译)"),
        ("triple_dots_suspect", "C-8 含 `...` 截断疑似"),
        ("read_errors", "C-9 读取错误"),
    ]

    for key, title in order:
        items = buckets.get(key, [])
        lines.append(f"## {title}\n")
        lines.append(f"计数: **{len(items)}**\n\n")
        if not items:
            lines.append("(无)\n\n")
            continue
        for it in items[:CAP]:
            lines.append(f"- `{it}`\n")
        if len(items) > CAP:
            lines.append(f"- …(省略 {len(items) - CAP} 条)\n")
        lines.append("\n")

    OUT.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote {OUT}", file=sys.stderr)
    for key, title in order:
        print(f"  {title}: {len(buckets.get(key, []))}", file=sys.stderr)


if __name__ == "__main__":
    main()
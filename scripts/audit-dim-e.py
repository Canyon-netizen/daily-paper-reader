#!/usr/bin/env python3
"""Audit Dim E: metadata consistency + dedup + non-paper pollution for docs/papers/."""
from __future__ import annotations
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path("docs/papers")
OUT = Path("docs/.scratch/audit/dim-E-meta.md")
OUT.parent.mkdir(parents=True, exist_ok=True)

# Regex patterns for accepted naming
RE_ARXIV_DATE_DIR = re.compile(r"^docs/papers/\d{4}/\d{2}/\d{2}/(\d{4}\.\d{4,5}v\d+)(?:-.*)?\.md$")
RE_BIORXIV_DATE_DIR = re.compile(r"^docs/papers/\d{4}/\d{2}/\d{2}/(biorxiv-.*)\.md$")

# Frontmatter scanner: very lenient, just split header section
FM_BOUNDARY = re.compile(r"^---\s*$", re.MULTILINE)

CJK_RE = re.compile(r"[　-〿一-鿿㐀-䶿豈-﫿]")

ARXIV_PDF_RE = re.compile(r"arxiv\.org/(?:pdf|abs)/(\d{4}\.\d{4,5})(v\d+)?")

def strip_quotes(v: str) -> str:
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    return v

def parse_frontmatter(path: Path) -> tuple[dict, str]:
    """Return (dict, raw_frontmatter_text). Handles simple YAML scalars & lists."""
    text = path.read_text(encoding="utf-8", errors="replace")
    # Find first --- and second ---
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.DOTALL)
    if not m:
        return {}, ""
    fm_raw = m.group(1)
    # Simple parser for top-level scalar keys (stop at first indented or nested key like 'categories:')
    result: dict[str, str] = {}
    current_key = None
    current_val_parts: list[str] = []
    for line in fm_raw.splitlines():
        # If indented continuation
        if current_key and (line.startswith(" ") or line.startswith("\t")):
            current_val_parts.append(line.strip())
            continue
        # Flush prior
        if current_key:
            result[current_key] = " ".join(current_val_parts).strip()
            current_key = None
            current_val_parts = []
        m2 = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m2:
            current_key = m2.group(1)
            val = m2.group(2).strip()
            current_val_parts = [val] if val else []
        # else: skip (e.g., comments, blank)
    if current_key:
        result[current_key] = " ".join(current_val_parts).strip()
    # Strip surrounding quotes
    for k, v in list(result.items()):
        result[k] = strip_quotes(v)
    return result, fm_raw

def is_paper_filename(rel: str) -> bool:
    return bool(RE_ARXIV_DATE_DIR.match(rel) or RE_BIORXIV_DATE_DIR.match(rel))

def canonical_id_from_filename(rel: str) -> tuple[str, str] | None:
    m = RE_ARXIV_DATE_DIR.match(rel)
    if m:
        return ("arxiv", m.group(1))  # includes vN
    m = RE_BIORXIV_DATE_DIR.match(rel)
    if m:
        return ("biorxiv", m.group(1))
    return None

def cjk_count(s: str) -> int:
    return len(CJK_RE.findall(s or ""))

def tldr_len(s: str) -> int:
    # Count CJK chars as 1 each, latin chars as 1 each — simple char count
    return len((s or "").strip())

def main() -> None:
    md_files = sorted(p for p in ROOT.rglob("*.md") if p.name != "papers.meta.json")
    total = len(md_files)

    # Buckets
    issues: list[str] = []
    pdf_id_mismatch: list[tuple[str, str, str]] = []  # (rel, file_id, pdf_id)
    no_title: list[str] = []
    no_title_zh: list[str] = []
    title_has_cjk: list[tuple[str, str]] = []  # rel, title
    title_zh_low_cjk: list[tuple[str, str, int]] = []  # rel, title_zh, count
    authors_null: list[tuple[str, str]] = []
    tldr_too_short: list[tuple[str, int]] = []
    tldr_too_long: list[tuple[str, int]] = []
    no_tldr: list[str] = []
    no_pdf: list[str] = []
    non_paper_md: list[str] = []

    # Maps for dedup
    title_map: dict[str, list[str]] = defaultdict(list)
    title_zh_map: dict[str, list[str]] = defaultdict(list)

    for p in md_files:
        rel = p.as_posix()
        # Naming conformity
        if not is_paper_filename(rel):
            non_paper_md.append(rel)
            # still continue to record metadata if parseable, but tag as non-paper

        canon = canonical_id_from_filename(rel)

        fm, _ = parse_frontmatter(p)
        title = fm.get("title", "").strip()
        title_zh = fm.get("title_zh", "").strip()
        authors = fm.get("authors", "").strip()
        pdf = fm.get("pdf", "").strip()
        tldr = fm.get("tldr", "").strip()
        date = fm.get("date", "").strip()

        # Track for dedup
        if title:
            title_map[title].append(rel)
        if title_zh:
            title_zh_map[title_zh].append(rel)

        # title presence
        if not title:
            no_title.append(rel)
        else:
            tcjk = cjk_count(title)
            if tcjk > 4:  # long CJK string in title
                title_has_cjk.append((rel, title[:80]))

        # title_zh presence + CJK >= 4
        if not title_zh:
            no_title_zh.append(rel)
        else:
            zcjk = cjk_count(title_zh)
            if zcjk < 4:
                title_zh_low_cjk.append((rel, title_zh[:80], zcjk))

        # authors
        if not authors or authors.lower() in ("null", "unknown", "n/a", "none"):
            authors_null.append((rel, authors))

        # pdf
        if not pdf:
            no_pdf.append(rel)
        else:
            m = ARXIV_PDF_RE.search(pdf)
            if canon and canon[0] == "arxiv" and m:
                file_id = canon[1]  # e.g. 2606.06087v1
                pdf_num = m.group(1)
                pdf_v = m.group(2) or ""  # "v1" or ""
                fm_match = re.match(r"(\d{4}\.\d{4,5})(v\d+)?", file_id)
                if fm_match:
                    fm_num, fm_v = fm_match.groups()
                    fm_v = fm_v or ""
                    if pdf_num != fm_num:
                        pdf_id_mismatch.append((rel, file_id, pdf_num + (pdf_v or "")))
                    elif pdf_v and fm_v and pdf_v != fm_v:
                        pdf_id_mismatch.append((rel, file_id, f"{pdf_num}{pdf_v} (version differs, file is {fm_v})"))

        # tldr
        if not tldr:
            no_tldr.append(rel)
        else:
            L = tldr_len(tldr)
            if L < 30:
                tldr_too_short.append((rel, L))
            elif L > 800:
                tldr_too_long.append((rel, L))

    # Duplicate groups
    dup_title = {t: paths for t, paths in title_map.items() if len(paths) >= 2}
    dup_title_zh = {t: paths for t, paths in title_zh_map.items() if len(paths) >= 2}

    # Tag groups where same canonical arxiv id (allowing v1 vs v2) — these are expected
    def canonical_id(path: str) -> str:
        m = RE_ARXIV_DATE_DIR.match(path)
        if m:
            num = m.group(1)
            base, _, _ = num.partition("v")
            return f"arxiv:{base}"
        m = RE_BIORXIV_DATE_DIR.match(path)
        if m:
            return f"biorxiv:{m.group(1).rsplit('-v', 1)[0]}"
        return path

    def filter_expected_dup(d: dict[str, list[str]]) -> dict[str, list[str]]:
        out = {}
        for t, paths in d.items():
            canon_ids = {canonical_id(p) for p in paths}
            if len(canon_ids) == 1 and len(paths) >= 2:
                # All same canonical (v1/v2 of same arxiv) — expected
                out[t] = ("expected-version-dup", paths)
            elif len(canon_ids) >= 2:
                out[t] = ("cross-id-dup", paths)
            else:
                out[t] = ("unknown", paths)
        return out

    dup_title_tagged = filter_expected_dup(dup_title)
    dup_title_zh_tagged = filter_expected_dup(dup_title_zh)

    # Write report
    lines: list[str] = []
    lines.append("# E. 元数据一致性 + 重复/污染 审计\n")
    lines.append(f"- 仓库: `docs/papers/`\n- 总 markdown 数: **{total}** (排除 `papers.meta.json`)\n")
    lines.append(f"- 生成时间: {os.popen('date -u +%Y-%m-%dT%H:%M:%SZ').read().strip()}\n")
    lines.append("\n## E.1 命名格式合规\n")
    if not non_paper_md:
        lines.append("- 无非论文 `.md` 误入 docs/papers(全部匹配 `YY/MM/DD/<id>.md` 或 `YY/MM/DD/biorxiv-...md`)。\n")
    else:
        lines.append(f"- 非论文命名格式: **{len(non_paper_md)}** 条\n")
        for p in non_paper_md:
            lines.append(f"  - `{p}`\n")

    lines.append("\n## E.2 `pdf:` 字段 arxiv id 与文件名不一致\n")
    if not pdf_id_mismatch:
        lines.append("- 无 pdf-id 不一致。\n")
    else:
        lines.append(f"- **{len(pdf_id_mismatch)}** 条\n")
        lines.append("| 文件 | 文件名 id | pdf 内 id |\n|---|---|---|\n")
        for rel, fid, pid in pdf_id_mismatch:
            lines.append(f"| `{rel}` | `{fid}` | `{pid}` |\n")

    lines.append("\n## E.3 `title:` 缺失或含长串 CJK\n")
    if no_title:
        lines.append(f"- 缺失 title: **{len(no_title)}** 条\n")
        for p in no_title:
            lines.append(f"  - `{p}`\n")
    else:
        lines.append("- 无缺失 title。\n")
    lines.append("")
    if title_has_cjk:
        lines.append(f"- title 含 >4 连续 CJK 字符: **{len(title_has_cjk)}** 条\n")
        for rel, t in title_has_cjk:
            lines.append(f"  - `{rel}` → `{t}`\n")
    else:
        lines.append("- title CJK 检查通过。\n")

    lines.append("\n## E.4 `title_zh:` 缺失或 CJK < 4\n")
    if no_title_zh:
        lines.append(f"- 缺失 title_zh: **{len(no_title_zh)}** 条\n")
        for p in no_title_zh:
            lines.append(f"  - `{p}`\n")
    else:
        lines.append("- 无缺失 title_zh。\n")
    lines.append("")
    if title_zh_low_cjk:
        lines.append(f"- title_zh CJK < 4: **{len(title_zh_low_cjk)}** 条\n")
        lines.append("| 文件 | title_zh | CJK 数 |\n|---|---|---|\n")
        for rel, t, n in title_zh_low_cjk:
            lines.append(f"| `{rel}` | `{t}` | {n} |\n")
    else:
        lines.append("- title_zh CJK 检查通过。\n")

    lines.append("\n## E.5 `authors:` 缺失或 null\n")
    if authors_null:
        lines.append(f"- **{len(authors_null)}** 条\n")
        for rel, a in authors_null:
            lines.append(f"  - `{rel}` → `{a!r}`\n")
    else:
        lines.append("- 无 authors 空/null。\n")

    lines.append("\n## E.6 `tldr:` 长度\n")
    if no_tldr:
        lines.append(f"- 缺失 tldr: **{len(no_tldr)}** 条\n")
        for p in no_tldr:
            lines.append(f"  - `{p}`\n")
    else:
        lines.append("- 无缺失 tldr。\n")
    lines.append("")
    if tldr_too_short:
        lines.append(f"- tldr < 30 字: **{len(tldr_too_short)}** 条\n")
        for rel, L in tldr_too_short:
            lines.append(f"  - `{rel}` ({L})\n")
    else:
        lines.append("- 无 tldr 过短。\n")
    lines.append("")
    if tldr_too_long:
        lines.append(f"- tldr > 800 字: **{len(tldr_too_long)}** 条\n")
        for rel, L in tldr_too_long:
            lines.append(f"  - `{rel}` ({L})\n")
    else:
        lines.append("- 无 tldr 超长。\n")

    lines.append("\n## E.7 跨笔记重复 `title`\n")
    if not dup_title_tagged:
        lines.append("- 无 title 重复。\n")
    else:
        lines.append(f"- 重复 title 组: **{len(dup_title_tagged)}** 组(共 {sum(len(v[1]) for v in dup_title_tagged.values())} 篇)\n")
        for t, (tag, paths) in sorted(dup_title_tagged.items(), key=lambda x: -len(x[1][1])):
            lines.append(f"  - **[{tag}]** ({len(paths)} 篇) title=`{t}`\n")
            for p in sorted(paths):
                lines.append(f"    - `{p}`\n")

    lines.append("\n## E.8 跨笔记重复 `title_zh`\n")
    if not dup_title_zh_tagged:
        lines.append("- 无 title_zh 重复。\n")
    else:
        lines.append(f"- 重复 title_zh 组: **{len(dup_title_zh_tagged)}** 组(共 {sum(len(v[1]) for v in dup_title_zh_tagged.values())} 篇)\n")
        for t, (tag, paths) in sorted(dup_title_zh_tagged.items(), key=lambda x: -len(x[1][1])):
            lines.append(f"  - **[{tag}]** ({len(paths)} 篇) title_zh=`{t}`\n")
            for p in sorted(paths):
                lines.append(f"    - `{p}`\n")

    # Final summary table
    lines.append("\n## E.9 统计汇总\n")
    lines.append("| 维度 | 计数 |\n|---|---|\n")
    lines.append(f"| total | {total} |\n")
    lines.append(f"| pdf_id_mismatch | {len(pdf_id_mismatch)} |\n")
    lines.append(f"| no_title | {len(no_title)} |\n")
    lines.append(f"| title_has_cjk(>4 连续) | {len(title_has_cjk)} |\n")
    lines.append(f"| no_title_zh | {len(no_title_zh)} |\n")
    lines.append(f"| title_zh_low_cjk(<4) | {len(title_zh_low_cjk)} |\n")
    lines.append(f"| authors_null_or_unknown | {len(authors_null)} |\n")
    lines.append(f"| no_tldr | {len(no_tldr)} |\n")
    lines.append(f"| tldr_too_short(<30) | {len(tldr_too_short)} |\n")
    lines.append(f"| tldr_too_long(>800) | {len(tldr_too_long)} |\n")
    lines.append(f"| dup_title_groups | {len(dup_title_tagged)} |\n")
    lines.append(f"| dup_title_zh_groups | {len(dup_title_zh_tagged)} |\n")
    lines.append(f"| non_paper_md | {len(non_paper_md)} |\n")

    OUT.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote {OUT}")

    # Also print to stdout one-liner summary
    summary = {
        "total": total,
        "pdf_id_mismatch": len(pdf_id_mismatch),
        "no_title": len(no_title),
        "title_has_cjk": len(title_has_cjk),
        "no_title_zh": len(no_title_zh),
        "title_zh_low_cjk": len(title_zh_low_cjk),
        "authors_null_or_unknown": len(authors_null),
        "no_tldr": len(no_tldr),
        "tldr_too_short": len(tldr_too_short),
        "tldr_too_long": len(tldr_too_long),
        "dup_title_groups": len(dup_title_tagged),
        "dup_title_zh_groups": len(dup_title_zh_tagged),
        "non_paper_md": len(non_paper_md),
        "dup_title_cross_id_groups": sum(1 for tag, _ in dup_title_tagged.values() if tag == "cross-id-dup"),
        "dup_title_zh_cross_id_groups": sum(1 for tag, _ in dup_title_zh_tagged.values() if tag == "cross-id-dup"),
        "dup_title_version_groups": sum(1 for tag, _ in dup_title_tagged.values() if tag == "expected-version-dup"),
        "dup_title_zh_version_groups": sum(1 for tag, _ in dup_title_zh_tagged.values() if tag == "expected-version-dup"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
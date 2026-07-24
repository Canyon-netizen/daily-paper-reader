#!/usr/bin/env python3
"""
一次性回填:对 docs/papers/ 中没有 figures_json 字段的 arxiv 论文
首次抽图(走 eprint → PaperCropper → PyMuPDF 自动 fallback),
然后用 docs/assets/figures/arxiv/<id>/meta.json 的 figures 列表
回填到对应 .md 的 figures_json frontmatter 字段。

类似 backfill_eprint_figures.py + sync_figures_json_to_md.py,
但目标不一样:
  - backfill_eprint_figures.py:已经有 figures 目录、想从 PyMuPDF 升级到 eprint
  - sync_figures_json_to_md.py:已经有 meta.json、想把 figures_json 同步到 md
  - 本脚本:既没有 figures 目录也没有 figures_json,需要从零抽图再同步

用法:  python3 src/backfill_missing_figures.py
       或:  python3 src/backfill_missing_figures.py --dry-run
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

from src.paper_figures import ensure_paper_figures  # noqa: E402

DOCS_DIR = os.path.join(ROOT, "docs")
PAPERS_DIR = os.path.join(DOCS_DIR, "papers")
FIG_ROOT = os.path.join(DOCS_DIR, "assets", "figures", "arxiv")

ARXIV_ID_RE = re.compile(r"^(\d{4}\.\d{4,5})(v\d+)?-")
BIORXIV_PREFIX_RE = re.compile(r"^biorxiv-")
FRONTMATTER_RE = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$")
FIG_JSON_RE = re.compile(r"^figures_json:\s.*$", re.MULTILINE)
PDF_RE = re.compile(r'^pdf:\s*"?([^"\n]+?)"?\s*$', re.MULTILINE)
SOURCE_RE = re.compile(r'^source:\s*"?([a-z]+?)"?\s*$', re.MULTILINE)


def list_missing_papers() -> list[tuple[str, str, str, str]]:
    """返回 (md_path, asset_key, source_key, pdf_url) 列表。
    资产目录布局: docs/assets/figures/<source_key>/<asset_key>/fig-*.webp
    arxiv: asset_key = arxiv id(YYMM.NNNNN[vN])
    biorxiv: asset_key = 整个 biorxiv-{...} id(去掉 .md 扩展名)

    docs/papers/ 现在按 <YYYY>/<MM/> 子目录分桶,递归收 .md。
    """
    out: list[tuple[str, str, str, str]] = []
    for root, _dirs, files in os.walk(PAPERS_DIR):
        for name in sorted(files):
            if not name.endswith(".md") or name.startswith("_"):
                continue
            md_path = os.path.join(root, name)
            with open(md_path, "r", encoding="utf-8") as f:
                content = f.read()
            if "figures_json:" in content:
                continue
            # arxiv
            m = ARXIV_ID_RE.match(name)
            if m:
                asset_key = m.group(1) + (m.group(2) or "")
                source_key = "arxiv"
            elif BIORXIV_PREFIX_RE.match(name):
                asset_key = name[: -len(".md")]
                source_key = "biorxiv"
            else:
                print(f"[WARN] {name}: 不是已知来源,跳过")
                continue
            pdf_match = PDF_RE.search(content)
            if not pdf_match:
                print(f"[WARN] {name}: no pdf url, skip")
                continue
            pdf_url = pdf_match.group(1).strip()
            out.append((md_path, asset_key, source_key, pdf_url))
    return out


def sync_md(md_path: str, figs: list[dict]) -> None:
    """把 figs 写回 md 的 figures_json frontmatter 字段(整段重建,避免 escape 不一致)。"""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    new_value = json.dumps(figs, ensure_ascii=False)
    escaped = new_value.replace("'", "''")
    new_line = f"figures_json: '{escaped}'"

    if FIG_JSON_RE.search(content):
        new_content = FIG_JSON_RE.sub(new_line, content, count=1)
    else:
        new_content, n = re.subn(
            r"(\n---\n)",
            f"\n{new_line}\\1",
            content,
            count=1,
        )
        if n == 0:
            raise RuntimeError(f"{md_path}: no frontmatter close")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(new_content)


def main() -> int:
    parser = argparse.ArgumentParser(description="首次抽图 + 同步 figures_json")
    parser.add_argument("--dry-run", action="store_true", help="只看不动")
    args = parser.parse_args()

    targets = list_missing_papers()
    print(f"[INFO] 候选 {len(targets)} 篇论文没有 figures_json")

    ok, fail, no_figs = 0, 0, 0
    for i, (md_path, asset_key, source_key, pdf_url) in enumerate(targets, 1):
        print(f"\n[{i}/{len(targets)}] {asset_key}  [{source_key}]  {os.path.basename(md_path)}")
        if args.dry_run:
            print(f"  [DRY-RUN] pdf={pdf_url}")
            continue
        try:
            figs = ensure_paper_figures(
                pdf_url=pdf_url,
                docs_dir=DOCS_DIR,
                source_key=source_key,
                asset_key=asset_key,
            )
        except Exception as e:
            print(f"  [ERROR] {e}")
            fail += 1
            continue

        if not figs:
            print(f"  [NO-FIGS] 抽不到图,跳过 md 同步")
            no_figs += 1
            continue

        try:
            sync_md(md_path, figs)
        except Exception as e:
            print(f"  [ERROR] sync md 失败: {e}")
            fail += 1
            continue

        print(f"  [OK] {len(figs)} 张图,figures_json 已写回 md")
        ok += 1

    print(f"\n[SUMMARY] 候选 {len(targets)}:ok={ok} no_figs={no_figs} fail={fail}")
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
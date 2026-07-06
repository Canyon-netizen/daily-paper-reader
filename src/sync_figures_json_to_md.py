#!/usr/bin/env python3
"""
一次性同步脚本:把 docs/assets/figures/arxiv/<id>/meta.json 的 figures 列表
回填到 docs/<period>/<id>-*.md 的 figures_json frontmatter 字段。

为什么需要:
  backfill_eprint_figures.py 重抽了 webp 文件 + meta.json,但 .md 的 frontmatter
  figures_json 还是旧值(只有 1 张),所以 docs 网站上还是只显示 1 张图。
  本脚本扫描所有 markdown,把 frontmatter 的 figures_json 字段替换成最新 meta.json
  的列表。

用法:  python3 src/sync_figures_json_to_md.py
       或:  python3 src/sync_figures_json_to_md.py --dry-run
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DOCS_DIR = os.path.join(ROOT, "docs")
ASSETS_DIR = os.path.join(DOCS_DIR, "assets", "figures", "arxiv")


def find_md_for_arxiv(arxiv_id: str) -> str | None:
    """在 docs 下找包含此 arxiv id 的 .md,返回第一个匹配路径。"""
    pattern = re.compile(rf"\b{re.escape(arxiv_id)}\b")
    for root, _dirs, files in os.walk(DOCS_DIR):
        # 跳过 assets 等
        rel = os.path.relpath(root, DOCS_DIR)
        if rel.startswith("assets") or rel.startswith("_"):
            continue
        for f in files:
            if not f.endswith(".md") or f.startswith("_"):
                continue
            if pattern.search(f):
                return os.path.join(root, f)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="同步 figures_json 到 .md frontmatter")
    parser.add_argument("--dry-run", action="store_true", help="只看不动")
    args = parser.parse_args()

    if not os.path.isdir(ASSETS_DIR):
        print(f"[ERROR] {ASSETS_DIR} 不存在")
        return 1

    updated = 0
    skipped = 0
    no_md = 0

    for aid in sorted(os.listdir(ASSETS_DIR)):
        meta_path = os.path.join(ASSETS_DIR, aid, "meta.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue

        figs = meta.get("figures", [])
        if not figs:
            continue

        md_path = find_md_for_arxiv(aid)
        if not md_path:
            no_md += 1
            continue

        with open(md_path, "r", encoding="utf-8") as f:
            content = f.read()

        # 新值:JSON 字符串(双引号转义)
        new_value = json.dumps(figs, ensure_ascii=False)
        # Python repr 后整个放 YAML 单引号字符串(避免双引号转义问题)
        # 与 daily pipeline 写法对齐:把双引号转义为 \"
        # 最安全:用 YAML 单引号块(单引号不解析转义,字面保存)
        # 但 Python yaml 写时不会自动加引号,所以我们直接生成标准 escaped 字符串

        # YAML 单引号写法:整个字符串用 ' 包,内部 ' 重复一次
        escaped_for_yaml_single = new_value.replace("'", "''")
        new_yaml_line = f"figures_json: '{escaped_for_yaml_single}'"

        # 替换现有 figures_json 行
        pattern = re.compile(r"^figures_json:\s.*$", re.MULTILINE)
        if pattern.search(content):
            new_content, n = pattern.subn(new_yaml_line, content, count=1)
            if n == 0:
                skipped += 1
                continue
            if new_content == content:
                skipped += 1
                continue
        else:
            # 插入到 frontmatter 闭合 --- 前
            new_content, n = re.subn(
                r"(\n---\n)",
                f"\n{new_yaml_line}\\1",
                content,
                count=1,
            )
            if n == 0:
                skipped += 1
                continue

        if args.dry_run:
            print(f"[DRY-RUN] {os.path.basename(md_path)}: {len(figs)} 张图")
        else:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"[OK] {os.path.basename(md_path)}: {len(figs)} 张图")
        updated += 1

    print(f"\n[SUMMARY] updated={updated} skipped={skipped} no_md={no_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
#!/usr/bin/env python3
"""
一次性回填脚本:对所有"meta.json 显示是 PyMuPDF 抽出且图很少"的论文,
重新走 arXiv e-print 源码包抽图,补全 figure。

用法:  python3 src/backfill_eprint_figures.py
       或:  python3 src/backfill_eprint_figures.py --min-figs 5  (调整阈值)

背景:
  之前 daily pipeline 走 PyMuPDF-images 兜底,对 TikZ/PGFplots 矢量图论文
  (控制论/数学/理论类)只能抽到 1 张或 0 张。新增了 fetch_arxiv_source_figures
  走 arXiv e-print 源码包,这种论文能拿到 5-30 张原图。

  本脚本只对 meta.json 里 extractor == "pymupdf-images" 且图数量 < 阈值的
  论文重新抽,避免给图已经齐全的论文做无意义重抽。

注意:
  - 会修改 docs/assets/figures/arxiv/<id>/ 下的 webp 文件 + meta.json
  - 不会修改 .md 的 frontmatter(那个不在本脚本范围)
  - 中途网络/解压失败会让单篇失败但不阻塞其他论文
"""
import argparse
import glob
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "src"))

from paper_figures import fetch_arxiv_source_figures  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="回填: 用 arXiv e-print 重抽老论文 figure")
    parser.add_argument(
        "--min-figs",
        type=int,
        default=5,
        help="当前图数量低于这个阈值才重抽(默认 5,避免给齐全论文重跑)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只看不动",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="最多重抽的论文数(0 = 全部,默认 0)",
    )
    args = parser.parse_args()

    arxiv_root = os.path.join(ROOT, "docs", "assets", "figures", "arxiv")
    if not os.path.isdir(arxiv_root):
        print(f"[ERROR] {arxiv_root} 不存在")
        return 1

    # 扫所有论文 id
    arxiv_ids = sorted(os.listdir(arxiv_root))
    print(f"[INFO] 发现 {len(arxiv_ids)} 个 arxiv 论文目录")

    # 1) 过滤:只处理 PyMuPDF 抽的 + 图数量少的
    targets: list[str] = []
    skipped = 0
    for aid in arxiv_ids:
        meta_path = os.path.join(arxiv_root, aid, "meta.json")
        if not os.path.exists(meta_path):
            skipped += 1
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        extractor = meta.get("extractor", "")
        figs = meta.get("figures", [])
        if extractor != "pymupdf-images":
            # 已经是 e-print / PaperCropper 抽的,跳过
            skipped += 1
            continue
        if len(figs) >= args.min_figs:
            skipped += 1
            continue
        targets.append(aid)

    print(f"[INFO] 候选 {len(targets)} 篇(跳过 {skipped} 篇已齐全或非 PyMuPDF 源)")
    if args.limit:
        targets = targets[: args.limit]
        print(f"[INFO] --limit {args.limit} 截断,本次处理 {len(targets)} 篇")

    if args.dry_run:
        print(f"[DRY-RUN] 会处理: {targets[:20]}{'...' if len(targets) > 20 else ''}")
        return 0

    # 2) 逐个重抽
    ok_count = 0
    fail_count = 0
    no_change_count = 0
    for i, aid in enumerate(targets, 1):
        print(f"\n[{i}/{len(targets)}] {aid}")
        try:
            old_count = len(
                glob.glob(os.path.join(arxiv_root, aid, "fig-*.webp"))
            )
            # 删旧图(只删 fig-*.webp,meta.json 让函数自己写,tables 不动)
            for old_fp in glob.glob(os.path.join(arxiv_root, aid, "fig-*.webp")):
                os.remove(old_fp)
            old_meta = os.path.join(arxiv_root, aid, "meta.json")
            if os.path.exists(old_meta):
                os.remove(old_meta)

            figs = fetch_arxiv_source_figures(
                arxiv_id=aid,
                docs_dir=os.path.join(ROOT, "docs"),
                asset_key=aid,
            )
            new_count = len(figs)
            if new_count > 0:
                ok_count += 1
                change = f"{old_count} → {new_count}"
                print(f"  [OK] {change} 张")
                if new_count == old_count:
                    no_change_count += 1
            else:
                fail_count += 1
                print(f"  [FAIL] e-print 没抽到图,原 {old_count} 张已删,需要恢复!")
                # 不删除失败:已经删了旧图,让用户决定要不要从 git 恢复
        except Exception as e:
            fail_count += 1
            print(f"  [ERROR] {e}")

    print(f"\n[SUMMARY] 处理 {len(targets)} 篇:成功 {ok_count},失败 {fail_count}")
    if no_change_count:
        print(f"  其中 {no_change_count} 篇新图数与旧图数相同(PyMuPDF 兜底时已抽到部分)")
    return 0 if fail_count == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
#!/usr/bin/env python3
"""
一次性回填脚本:为已有论文生成方法辩论(metho_pros_cons)分析。

用法:
  python -m src.maintain.backfill_method_debate --limit 50 --dry-run
  python -m src.maintain.backfill_method_debate --source-dir docs/papers

功能:
  - 扫描 docs/papers/ 下的 .md 文件
  - 跳过已有 method_pros_cons 字段的论文
  - 加载论文文本(优先本地 .txt, 兜底 ar5iv)
  - 调用 generate_method_debate 生成分析
  - 写入 frontmatter
"""
from __future__ import annotations

import argparse
import glob
import json
import logging
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, ROOT)

from src.method_debate import generate_method_debate, load_paper_text
from src.generate_docs_frontmatter import _parse_front_matter

logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def process_paper(md_path: str, dry_run: bool = False) -> bool:
    """
    Process a single paper .md file.

    Returns:
        True if processed successfully, False otherwise.
    """
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        logger.warning(f"[SKIP] 读取失败 {md_path}: {e}")
        return False

    # Parse frontmatter
    fm = _parse_front_matter(content)

    # Skip if already has method_pros_cons
    if fm.get("method_pros_cons"):
        logger.debug(f"[SKIP] 已有 method_pros_cons: {md_path}")
        return False

    # Skip if within 30 days cache
    generated_at = fm.get("method_debate_generated_at")
    if generated_at:
        try:
            from datetime import datetime, timezone, timedelta

            gen_date = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if (now - gen_date).days < 30:
                logger.debug(f"[SKIP] 30天内缓存有效: {md_path}")
                return False
        except Exception:
            pass

    # Get title and abstract
    title = fm.get("title", "")
    abstract = fm.get("abstract", "")

    if not title:
        # Try to extract from content
        lines = content.split("\n")
        for line in lines:
            if line.startswith("# "):
                title = line[2:].strip()
                break

    if not abstract:
        # Try to extract abstract from content
        import re

        abstract_match = re.search(r"##\s*Abstract\s*\n(.*?)(?=\n##|\Z)", content, re.DOTALL | re.IGNORECASE)
        if abstract_match:
            abstract = abstract_match.group(1).strip()[:2000]  # Limit length

    if not title:
        logger.warning(f"[SKIP] 无标题: {md_path}")
        return False

    # Extract paper_id from path
    # e.g., docs/papers/2026/08/01/2607.21971v1-xxx.md -> 2607.21971v1
    filename = os.path.basename(md_path)
    paper_id = filename.split("-")[0]

    # Try to load paper text
    paper_text = load_paper_text(paper_id, docs_dir=os.path.join(ROOT, "docs/papers"))

    if not paper_text:
        logger.info(f"[INFO] 无本地 .txt, 仅用摘要: {paper_id}")

    if dry_run:
        logger.info(f"[DRYRUN] 跳过 LLM 调用与写入: {title[:50]}")
        return True

    # Generate method debate
    logger.info(f"[PROCESS] 生成中: {title[:50]}...")
    result = generate_method_debate(title, abstract, paper_text)

    if not result:
        logger.warning(f"[FAIL] 生成失败: {title[:50]}")
        return False

    # Write result to frontmatter
    try:
        # Re-read and update
        with open(md_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        # Find frontmatter boundaries
        start_idx = None
        end_idx = None
        for i, line in enumerate(lines):
            if i == 0 and line.strip() == "---":
                start_idx = 1
            elif start_idx is not None and line.strip() == "---":
                end_idx = i
                break

        if start_idx is None or end_idx is None:
            logger.warning(f"[SKIP] 无有效 frontmatter: {md_path}")
            return False

        # Build new frontmatter fields
        new_fields = []
        new_fields.append("")
        new_fields.append(f"method_pros_cons: {json.dumps(result.get('method_pros_cons', {}), ensure_ascii=False)}")
        new_fields.append(f"method_comparison: \"{result.get('method_comparison', '')}\"")
        new_fields.append(f"method_debate_generated_at: \"{result.get('method_debate_generated_at', '')}\"")
        new_fields.append(f"method_debate_model: \"{result.get('method_debate_model', '')}\"")

        # Insert before closing ---
        new_lines = lines[:end_idx] + [line + "\n" for line in new_fields] + lines[end_idx:]

        with open(md_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

        logger.info(f"[OK] 已写入: {md_path}")
        return True

    except Exception as e:
        logger.error(f"[ERROR] 写入失败 {md_path}: {e}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="回填论文方法辩论分析")
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="最多处理的论文数(默认 50, 0=全部)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只看不动",
    )
    parser.add_argument(
        "--source-dir",
        type=str,
        default="docs/papers",
        help="论文目录(默认 docs/papers)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="并发 worker 数(默认 4, MiniMax 429 风险随 worker 数上升)",
    )
    args = parser.parse_args()

    docs_dir = os.path.join(ROOT, args.source_dir)
    if not os.path.isdir(docs_dir):
        logger.error(f"[ERROR] 目录不存在: {docs_dir}")
        return 1

    # Find all .md files
    pattern = os.path.join(docs_dir, "**", "*.md")
    md_files = sorted(glob.glob(pattern, recursive=True))
    logger.info(f"[INFO] 发现 {len(md_files)} 个论文文件, workers={args.workers}")

    # Process — with thread pool
    from concurrent.futures import ThreadPoolExecutor, as_completed
    sleep_sec = float(os.environ.get("DPR_BACKFILL_SLEEP", "0.5"))

    def _process_with_delay(md_path: str):
        time.sleep(sleep_sec)  # Stagger worker starts
        return process_paper(md_path, dry_run=args.dry_run)

    processed = 0
    success = 0
    failed = 0
    work = md_files if args.limit == 0 else md_files[: args.limit]
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(_process_with_delay, p): p for p in work}
        for fut in as_completed(futures):
            processed += 1
            try:
                ok = fut.result()
                if ok:
                    success += 1
                else:
                    failed += 1
            except Exception as e:
                failed += 1
                logger.warning(f"[FAIL] {os.path.basename(futures[fut])[:60]}: {type(e).__name__}: {e}")

    logger.info(f"[DONE] 处理 {processed} 篇, 成功 {success} 篇, 失败 {failed} 篇")
    return 0


if __name__ == "__main__":
    sys.exit(main())

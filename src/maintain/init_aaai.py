#!/usr/bin/env python
"""Init script for AAAI — fetches proceedings and syncs to Supabase.

Refactored in PR-3 to use the shared scaffolding in `init_factory`. Public
CLI surface is preserved; existing GitHub Actions / cron jobs keep working.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

try:
    import torch
except ModuleNotFoundError:
    torch = None

from src.maintain.init_factory import (
    add_embed_args,
    build_sync_cmd,
    resolve_embed_device,
    resolve_raw_path,
    run_step,
    python_executable,
)

TODAY_STR = datetime.now(timezone.utc).strftime("%Y%m%d")


def main() -> None:
    parser = argparse.ArgumentParser(description="抓取近三年 AAAI 官方 proceedings 并同步到 Supabase。")
    parser.add_argument("--year-end", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--year-count", type=int, default=3)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--date", type=str, default="")
    parser.add_argument("--raw-input", type=str, default="")
    parser.add_argument("--skip-fetch", action="store_true")
    add_embed_args(parser)
    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    year_start = int(args.year_end) - int(args.year_count) + 1
    year_end = int(args.year_end)
    date_str = TODAY_STR
    os.environ["DPR_RUN_DATE"] = date_str
    print(f"[INFO] DPR_RUN_DATE={date_str}", flush=True)
    resolve_embed_device(args, torch_module=torch)

    raw_filename = f"aaai-papers-{year_start}-{year_end}.json"
    raw_path = resolve_raw_path(
        raw_input=args.raw_input,
        project_root=project_root,
        date_str=date_str,
        default_filename=raw_filename,
    )

    if not args.skip_fetch:
        fetch_cmd = [
            python_executable(),
            os.path.join(os.path.dirname(__file__), "fetchers", "fetch_aaai_ojs.py"),
            "--year-end", str(int(args.year_end)),
            "--year-count", str(max(int(args.year_count or 1), 1)),
            "--workers", str(max(int(args.workers or 1), 1)),
            "--output", raw_path,
        ]
        run_step("Step 1 - fetch AAAI proceedings", fetch_cmd)
    else:
        print(f"[INFO] Step 1 已跳过，复用原始文件：{raw_path}", flush=True)

    run_step("Step 2 - sync AAAI papers to Supabase", build_sync_cmd(
        backend_key="aaai",
        date_str=date_str,
        raw_path=raw_path,
        args=args,
        papers_table="aaai_papers",
    ))


if __name__ == "__main__":
    main()
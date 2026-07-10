#!/usr/bin/env python

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

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
from src.maintain.common import format_years_token, resolve_target_years

LONG_RANGE_DAYS_THRESHOLD = 7
TODAY_STR = datetime.now(timezone.utc).strftime("%Y%m%d")


def build_run_date_token(days: int) -> str:
    safe_days = max(int(days), 1)
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=safe_days - 1)
    return f"{start_date:%Y%m%d}-{end_date:%Y%m%d}"


def resolve_date_token(date_arg: str, days: int) -> str:
    manual = str(date_arg or "").strip()
    if manual:
        return manual
    if int(days or 1) > LONG_RANGE_DAYS_THRESHOLD:
        return build_run_date_token(days)
    return TODAY_STR


def main() -> None:
    parser = argparse.ArgumentParser(description="...")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--chunk-days", type=int, default=7)
    parser.add_argument("--date", type=str, default="")
    parser.add_argument("--raw-input", type=str, default="")
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--ignore-seen", action="store_true", default=False)
    parser.add_argument("--use-seen", dest="ignore_seen", action="store_false")
    add_embed_args(parser)
    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    date_str = resolve_date_token(args.date, int(args.days or 1))
    os.environ["DPR_RUN_DATE"] = date_str
    print(f"[INFO] DPR_RUN_DATE={date_str}", flush=True)
    resolve_embed_device(args, torch_module=torch)

    raw_path = resolve_raw_path(
        raw_input=args.raw_input,
        project_root=project_root,
        date_str=date_str,
        default_filename=f"chemrxiv_papers_{date_str}.json",
    )

    if not args.skip_fetch:
        fetch_cmd = [
            python_executable(),
            os.path.join(os.path.dirname(__file__), "fetchers", "fetch_chemrxiv.py"),
            "--days", str(max(int(args.days or 1), 1)),
            "--output", raw_path,
        ]
        if args.ignore_seen:
            fetch_cmd.append("--ignore-seen")
        run_step("Step 1 - fetch ChemRxiv", fetch_cmd)
    else:
        print(f"[INFO] Step 1 已跳过，复用原始文件：{raw_path}", flush=True)

    run_step("Step 2 - sync ChemRxiv to Supabase", build_sync_cmd(
        backend_key="chemrxiv",
        date_str=date_str,
        raw_path=raw_path,
        args=args,
    ))


if __name__ == "__main__":
    main()

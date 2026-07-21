"""LLM usage 聚合 — 按 (date, stage, model) 聚合 JSONL。

对齐 Polaris `usage_report(date × stage × model)` (plan §7)。

API：
- `aggregate(jsonl_path)` — 读 JSONL，返 `{ (date, stage, model): {tokens_in, tokens_out, calls, cost_usd} }`。
- CLI：`python -m src.llm_usage_report <jsonl_path>` — 打印对齐 Polaris 的表格。
"""

from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from typing import Any, Dict, Iterable


def read_jsonl(path: str) -> Iterable[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    out: list[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def aggregate(jsonl_path: str) -> Dict[tuple, Dict[str, Any]]:
    """按 (date, stage, model) 聚合。

    每条记录必含 `ts` (ISO 字符串)、`stage`、`model`、`tokens_in`、`tokens_out`。
    `cost_usd` 缺省按 0.0 处理。
    """
    by_key: Dict[tuple, Dict[str, Any]] = defaultdict(
        lambda: {"tokens_in": 0, "tokens_out": 0, "calls": 0, "cost_usd": 0.0}
    )
    for line in read_jsonl(jsonl_path):
        ts = line.get("ts") or ""
        date = ts[:10] if ts else "unknown"
        stage = line.get("stage") or "unknown"
        model = line.get("model") or "unknown"
        key = (date, stage, model)
        bucket = by_key[key]
        bucket["tokens_in"] += int(line.get("tokens_in", 0))
        bucket["tokens_out"] += int(line.get("tokens_out", 0))
        bucket["calls"] += 1
        bucket["cost_usd"] += float(line.get("cost_usd", 0.0) or 0.0)
    return dict(by_key)


def _print_table(jsonl_path: str) -> None:
    if not os.path.exists(jsonl_path):
        print(f"[ERROR] 文件不存在: {jsonl_path}")
        raise SystemExit(1)
    rows = aggregate(jsonl_path)
    if not rows:
        print(f"[INFO] 空 JSONL: {jsonl_path}")
        return
    # 按 (date, stage, model) 排序
    keys_sorted = sorted(rows.keys())
    header = ("date", "stage", "model", "calls", "tokens_in", "tokens_out", "cost_usd")
    print("\t".join(header))
    for key in keys_sorted:
        date, stage, model = key
        b = rows[key]
        print(
            "\t".join(
                [
                    date,
                    stage,
                    model,
                    str(b["calls"]),
                    str(b["tokens_in"]),
                    str(b["tokens_out"]),
                    f"{b['cost_usd']:.4f}",
                ]
            )
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="聚合 LLM usage JSONL（按 date × stage × model）")
    parser.add_argument("jsonl_path", help="archive/llm_usage_<YYYY-MM>.jsonl 路径")
    args = parser.parse_args(argv)
    _print_table(args.jsonl_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
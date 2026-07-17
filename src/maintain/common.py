from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from typing import List, Optional


MAINTAIN_DIR = os.path.dirname(__file__)
SRC_DIR = os.path.abspath(os.path.join(MAINTAIN_DIR, ".."))
ROOT_DIR = os.path.abspath(os.path.join(SRC_DIR, ".."))
TODAY_STR = datetime.now(timezone.utc).strftime("%Y%m%d")


def log(message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {message}", flush=True)


def _norm(value: object) -> str:
    return str(value or "").strip()


def run_step(label: str, args: List[str]) -> None:
    log(f"{label}: {' '.join(args)}")
    # 子脚本是 package-mode (`from src.X import ...`),script-mode 启动时
    # sys.path[0]=<script-dir>=src/, 找不到 src 包。把 cwd 强制 ROOT_DIR 并把
    # ROOT_DIR 注入 PYTHONPATH,让 `from src.X` 在子进程里能解析。
    env = {**os.environ, "PYTHONPATH": ROOT_DIR}
    subprocess.run(args, check=True, env=env, cwd=ROOT_DIR)


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


def count_raw_rows(path: str) -> int:
    safe_path = _norm(path)
    if not safe_path or not os.path.exists(safe_path):
        return 0
    with open(safe_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise RuntimeError(f"raw json must be list: {safe_path}")
    return len(data)


def default_raw_path(prefix: str, run_date: str) -> str:
    safe_prefix = _norm(prefix) or "papers"
    safe_date = _norm(run_date) or TODAY_STR
    return os.path.join(ROOT_DIR, "archive", safe_date, "raw", f"{safe_prefix}_{safe_date}.json")


def parse_year_list(value: object) -> List[int]:
    text = _norm(value)
    if not text:
        return []
    years: List[int] = []
    seen = set()
    for item in re.split(r"[,\s;]+", text):
        token = _norm(item)
        if not token:
            continue
        try:
            year = int(token)
        except Exception as exc:
            raise ValueError(f"invalid year: {token}") from exc
        if year <= 0:
            raise ValueError(f"invalid year: {token}")
        if year in seen:
            continue
        seen.add(year)
        years.append(year)
    return years


def resolve_target_years(*, years: object, year_end: int, year_count: int) -> List[int]:
    explicit_years = parse_year_list(years)
    if explicit_years:
        return explicit_years
    safe_count = max(int(year_count or 1), 1)
    end_year = int(year_end)
    start_year = end_year - safe_count + 1
    return list(range(start_year, end_year + 1))


def format_years_token(years: List[int]) -> str:
    safe_years = [str(int(year)) for year in years if int(year) > 0]
    return "-".join(safe_years) if safe_years else "years"


def cleanup_backend(*, backend_key: str, retention_days: int, skip_cleanup: bool) -> None:
    if skip_cleanup:
        log(f"[Maintain] skip cleanup backend={backend_key}")
        return
    service_key = _norm(os.getenv("SUPABASE_SERVICE_KEY"))
    if not service_key:
        log(f"[Maintain] missing SUPABASE_SERVICE_KEY, skip cleanup backend={backend_key}")
        return
    run_step(
        "Cleanup old papers",
        [
            sys.executable,
            os.path.join(MAINTAIN_DIR, "cleanup.py"),
            "--backend-key",
            _norm(backend_key),
            "--retention-days",
            str(max(int(retention_days or 1), 1)),
        ],
    )


# --- seen-state + last-crawl-at IO shared by 4 fetchers ---
#
# Before this module had them, each fetcher (fetch_arxiv / fetch_chemrxiv /
# fetch_biorxiv_family / fetch_openreview) had its own 4-function block,
# ~30 行每个 fetcher。biorxiv 的版本已经参数化, 其余 3 个 fetcher 是字节级
# 相同但用模块级 CRAWL_STATE_FILE / SEEN_IDS_FILE 闭包。抽这里之后调用点
# 改成 `load_seen_state(SEEN_IDS_FILE)` 即可。

def _parse_iso_datetime(value: object) -> Optional[datetime]:
    """Coerce ISO-8601 字符串到 UTC datetime. 返回 None 若失败或空。"""
    if value is None:
        return None
    text = _norm(value)
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def load_last_crawl_at(crawl_state_file: str) -> Optional[datetime]:
    if not crawl_state_file or not os.path.exists(crawl_state_file):
        return None
    try:
        with open(crawl_state_file, "r", encoding="utf-8") as f:
            payload = json.load(f) or {}
    except Exception:
        return None
    raw = _norm(payload.get("last_crawl_at"))
    return _parse_iso_datetime(raw)


def save_last_crawl_at(crawl_state_file: str, at_time: datetime) -> None:
    parent = os.path.dirname(os.path.abspath(crawl_state_file))
    if parent:
        os.makedirs(parent, exist_ok=True)
    payload = {"last_crawl_at": at_time.astimezone(timezone.utc).isoformat()}
    with open(crawl_state_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def load_seen_state(seen_ids_file: str) -> tuple:
    """Read ``{ids: [...], updated_at, latest_published_at}`` JSON. 返回空
    ``(set(), None)`` 若文件不存在或解析失败。"""
    if not seen_ids_file or not os.path.exists(seen_ids_file):
        return set(), None
    try:
        with open(seen_ids_file, "r", encoding="utf-8") as f:
            payload = json.load(f) or {}
    except Exception:
        return set(), None

    raw_ids = payload.get("ids") or []
    if not isinstance(raw_ids, list):
        raw_ids = []
    seen_ids = {str(item).strip() for item in raw_ids if str(item).strip()}

    latest_dt = _parse_iso_datetime(payload.get("latest_published_at"))
    return seen_ids, latest_dt


def save_seen_state(
    seen_ids_file: str,
    seen_ids,
    latest_published_at: Optional[datetime],
) -> None:
    parent = os.path.dirname(os.path.abspath(seen_ids_file))
    if parent:
        os.makedirs(parent, exist_ok=True)
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "latest_published_at": latest_published_at.astimezone(timezone.utc).isoformat()
        if latest_published_at
        else "",
        "ids": sorted(seen_ids),
    }
    with open(seen_ids_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

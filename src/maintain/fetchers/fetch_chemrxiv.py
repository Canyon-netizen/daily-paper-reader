#!/usr/bin/env python

from __future__ import annotations

import argparse
import bz2
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests
from bs4 import BeautifulSoup

from src.source_config import load_config_with_source_migration
from src.maintain.common import (
    load_last_crawl_at as _load_last_crawl_at_path,
    load_seen_state as _load_seen_state_path,
    save_last_crawl_at as _save_last_crawl_at_path,
    save_seen_state as _save_seen_state_path,
)


SCRIPT_DIR = os.path.dirname(__file__)
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
CONFIG_FILE = os.path.join(ROOT_DIR, "config.yaml")
CRAWL_STATE_FILE = os.path.join(ROOT_DIR, "archive", "chemrxiv_crawl_state.json")
SEEN_IDS_FILE = os.path.join(ROOT_DIR, "archive", "chemrxiv_seen.json")
DATE_TOKEN_RE = re.compile(r"^\d{8}$")
RANGE_TOKEN_RE = re.compile(r"^\d{8}-\d{8}$")
CHEMRXIV_DASHBOARD_DATA_URL = (
    "https://raw.githubusercontent.com/chemrxiv-dashboard/"
    "chemrxiv-dashboard.github.io/master/data/allchemrxiv_data.json.bz2"
)


def log(message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    try:
        print(f"[{ts}] {message}", flush=True)
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass


def group_start(title: str) -> None:
    print(f"::group::{title}", flush=True)


def group_end() -> None:
    print("::endgroup::", flush=True)


def _norm(value: Any) -> str:
    return str(value or "").strip()


def _strip_html(value: Any) -> str:
    text = _norm(value)
    if not text:
        return ""
    if "<" not in text and ">" not in text:
        return text
    return BeautifulSoup(text, "html.parser").get_text(" ", strip=True)


def load_config() -> dict:
    try:
        return load_config_with_source_migration(CONFIG_FILE, write_back=False)
    except Exception as exc:
        log(f"[WARN] 读取 config.yaml 失败：{exc}")
        return {}


def resolve_days_window(default_days: int) -> int:
    config = load_config()
    paper_setting = (config or {}).get("arxiv_paper_setting") or {}
    try:
        days = int(paper_setting.get("days_window") or default_days)
    except Exception:
        days = default_days
    return max(days, 1)


def get_run_date_token(end_date: datetime) -> str:
    token = str(os.getenv("DPR_RUN_DATE") or "").strip()
    if DATE_TOKEN_RE.match(token) or RANGE_TOKEN_RE.match(token):
        return token
    return end_date.strftime("%Y%m%d")


# load_last_crawl_at / save_last_crawl_at / load_seen_state / save_seen_state
# 已在 src.maintain.common 实现 — 顶部 import 的 4 个 _xxx_path 函数是参数化版。
# 这里不再就地重复定义, 改用位于文件顶部的薄 wrapper 调用它们(保持在 fetcher
# 原有"无参版本 + 模块级 const"调用风格)。

def load_last_crawl_at() -> datetime | None:
    return _load_last_crawl_at_path(CRAWL_STATE_FILE)

def save_last_crawl_at(at_time: datetime) -> None:
    _save_last_crawl_at_path(CRAWL_STATE_FILE, at_time)

def load_seen_state() -> tuple[set[str], datetime | None]:
    return _load_seen_state_path(SEEN_IDS_FILE)

def save_seen_state(seen_ids: set[str], latest_published_at: datetime | None) -> None:
    _save_seen_state_path(SEEN_IDS_FILE, seen_ids, latest_published_at)

def _parse_iso_datetime(value: Any) -> datetime | None:
    text = _norm(value)
    if not text:
        return None
    for candidate in (text.replace("Z", "+00:00"), text):
        try:
            dt = datetime.fromisoformat(candidate)
        except Exception:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    return None


def parse_authors(raw_authors: Any) -> List[str]:
    if not isinstance(raw_authors, list):
        return []
    out: List[str] = []
    seen = set()
    for item in raw_authors:
        if not isinstance(item, dict):
            continue
        name = " ".join(
            part for part in (_norm(item.get("firstName")), _norm(item.get("lastName"))) if part
        ).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def parse_categories(raw_categories: Any, raw_subject: Any) -> List[str]:
    out: List[str] = []
    seen = set()
    if isinstance(raw_categories, list):
        for item in raw_categories:
            if isinstance(item, dict):
                name = _norm(item.get("name"))
            else:
                name = _norm(item)
            if not name or name in seen:
                continue
            seen.add(name)
            out.append(name)
    subject = _norm(raw_subject)
    if subject and subject not in seen:
        out.append(subject)
    return out


def _strip_version_from_doi(doi: str) -> str:
    return re.sub(r"\.v\d+$", "", _norm(doi), flags=re.IGNORECASE)


def normalize_chemrxiv_record(raw: Dict[str, Any]) -> Dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    item_id = _norm(raw.get("id"))
    doi = _norm(raw.get("doi"))
    if not item_id or not doi:
        return None
    title = _norm(raw.get("title"))
    if not title:
        return None
    categories = parse_categories(raw.get("categories"), raw.get("subject"))
    published_dt = _parse_iso_datetime(raw.get("publishedDate")) or _parse_iso_datetime(raw.get("approvedDate"))
    published = published_dt.isoformat() if published_dt else None
    version = _norm(raw.get("version"))
    article_url = f"https://chemrxiv.org/engage/chemrxiv/article-details/{item_id}"
    asset = raw.get("asset") if isinstance(raw.get("asset"), dict) else {}
    original_asset = asset.get("original") if isinstance(asset.get("original"), dict) else {}
    pdf_url = _norm(original_asset.get("url"))
    return {
        "id": f"chemrxiv-{item_id}",
        "source": "chemrxiv",
        "source_paper_id": item_id,
        "doi": doi,
        "version": version or None,
        "title": title,
        "abstract": _strip_html(raw.get("abstract")),
        "authors": parse_authors(raw.get("authors")),
        "primary_category": categories[0] if categories else (_norm(raw.get("subject")) or None),
        "categories": categories,
        "published": published,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "link": article_url,
        "pdf_url": pdf_url or None,
        "abs_url": article_url,
        "chemrxiv_status": _norm(raw.get("status")),
        "is_latest_version": bool(raw.get("isLatestVersion", False)),
        "base_doi": _strip_version_from_doi(doi),
    }


def fetch_chemrxiv_dataset(*, timeout: int = 120, retries: int = 3) -> Dict[str, Dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(1, max(int(retries or 1), 1) + 1):
        try:
            resp = requests.get(CHEMRXIV_DASHBOARD_DATA_URL, timeout=max(int(timeout or 1), 1))
            resp.raise_for_status()
            payload = json.loads(bz2.decompress(resp.content))
            if not isinstance(payload, dict):
                raise RuntimeError("ChemRxiv dashboard payload 不是 dict")
            return payload
        except Exception as exc:
            last_error = exc
            if attempt >= max(int(retries or 1), 1):
                break
            log(f"[ChemRxiv] dataset retry {attempt}/{retries} error={exc}")
            time.sleep(float(attempt))
    if last_error is not None:
        raise last_error
    raise RuntimeError("ChemRxiv dataset 下载失败")


def fetch_chemrxiv_metadata(
    *,
    days: int | None = None,
    output_file: str | None = None,
    ignore_seen: bool = False,
) -> None:
    end_date = datetime.now(timezone.utc)
    if days is None:
        days = resolve_days_window(1)
    days = max(int(days or 1), 1)

    if ignore_seen:
        seen_ids, latest_published_at = set(), None
        start_date = end_date - timedelta(days=days)
        source_desc = f"days_window={days} (ignore_seen)"
    else:
        seen_ids, latest_published_at = load_seen_state()
        if latest_published_at:
            start_date = latest_published_at
            source_desc = "latest_published_at"
        else:
            last_crawl_at = load_last_crawl_at()
            if last_crawl_at:
                start_date = last_crawl_at
                source_desc = "last_crawl_at"
            else:
                start_date = end_date - timedelta(days=days)
                source_desc = f"days_window={days}"

    start_date = max(start_date, end_date - timedelta(days=days))
    if start_date >= end_date:
        start_date = end_date - timedelta(minutes=1)

    group_start("Step 1 - fetch ChemRxiv")
    log(
        "🌍 [ChemRxiv Ingest] Window: "
        f"{start_date.strftime('%Y%m%d%H%M')} TO {end_date.strftime('%Y%m%d%H%M')} "
        f"({source_desc})"
    )
    dataset = fetch_chemrxiv_dataset()

    unique_papers: Dict[str, Dict[str, Any]] = {}
    max_published_new: datetime | None = None
    for raw in dataset.values():
        normalized = normalize_chemrxiv_record(raw)
        if not normalized:
            continue
        published_dt = _parse_iso_datetime(normalized.get("published"))
        if not published_dt:
            continue
        if published_dt < start_date or published_dt >= end_date:
            continue
        pid = _norm(normalized.get("id"))
        if not pid or pid in seen_ids:
            continue
        seen_ids.add(pid)
        if pid not in unique_papers:
            unique_papers[pid] = normalized
        if max_published_new is None or published_dt > max_published_new:
            max_published_new = published_dt

    total_count = len(unique_papers)
    log(f"✅ All Done. Total unique ChemRxiv papers fetched: {total_count}")

    if total_count > 0:
        if not output_file:
            run_token = get_run_date_token(end_date)
            archive_dir = os.path.join(ROOT_DIR, "archive", run_token)
            raw_dir = os.path.join(archive_dir, "raw")
            output_file = os.path.join(raw_dir, f"chemrxiv_papers_{run_token}.json")
        os.makedirs(os.path.dirname(output_file) if os.path.dirname(output_file) else ".", exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(list(unique_papers.values()), f, ensure_ascii=False, indent=2)
        log(f"💾 File saved to: {output_file}")
    else:
        log("⚠️ No ChemRxiv papers found. Check your date range or upstream dataset.")

    if max_published_new:
        save_seen_state(seen_ids, max_published_new)
    else:
        save_seen_state(seen_ids, latest_published_at)
    save_last_crawl_at(end_date)
    group_end()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="抓取 ChemRxiv 论文元数据（基于公开 dashboard 数据镜像）。")
    parser.add_argument("--days", type=int, default=None, help="抓取窗口天数。")
    parser.add_argument("--output", type=str, default=None, help="输出 JSON 文件路径。")
    parser.add_argument("--ignore-seen", action="store_true", help="忽略已见状态，严格按 days_window 回溯。")
    args = parser.parse_args()

    fetch_chemrxiv_metadata(
        days=args.days,
        output_file=args.output,
        ignore_seen=bool(args.ignore_seen),
    )

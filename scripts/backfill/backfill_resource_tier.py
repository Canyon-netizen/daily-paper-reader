"""Backfill resource_tier — 离线批量为存量论文写回算力档位。

不调 LLM,纯函数推断。

策略:
  1. 优先用 deep_extract.compute_requirements(如有)
  2. 否则拼接论文 frontmatter 文本字段(tldr / motivation / method / result /
     conclusion / context / abstract)做兜底关键词 / 数字解析

跑法:
  python -m scripts.backfill.backfill_resource_tier [--dry-run] [--limit N]
                                                    [--skip-existing]
                                                    [--text-only]

回滚: git checkout docs/papers/
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))


def _bootstrap_local_env() -> None:
    """本地跑需要 .env → LLM_* 映射(本脚本不调 LLM,只在 strict 模式下校验)。"""
    from src.local_env import load_local_env

    load_local_env()


_bootstrap_local_env()

from src.generate_docs_md_io import upsert_front_matter_field_to_path  # noqa: E402
from src.source_config import load_config_with_source_migration  # noqa: E402
from scripts.backfill._resource_tier_rules import infer_resource_tier, infer_data_scale  # noqa: E402


_FM_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)
_PAPER_ID_RE = re.compile(r"^(?P<id>\d{4}\.\d{4,5}v\d+)-(?P<slug>.+)\.md$")

# 兜底文本字段顺序(优先级:技术细节 > 摘要 > TLDR)
_TEXT_FIELDS = ("method", "result", "motivation", "conclusion", "tldr", "abstract", "context")


def _walk_md(docs_dir: Path):
    """yield (md_path, paper_id) 元组。"""
    for md in sorted(docs_dir.rglob("*.md")):
        m = _PAPER_ID_RE.match(md.name)
        if not m:
            continue
        yield md, m.group("id")


def _parse_frontmatter(md_path: Path) -> dict | None:
    """读 frontmatter(PyYAML)。整段读以便兜底文本用。"""
    try:
        with md_path.open(encoding="utf-8") as f:
            head = f.read(32_000)
    except OSError:
        return None
    fm_match = _FM_RE.match(head)
    if not fm_match:
        return None
    fm_text = fm_match.group(1)
    try:
        import yaml
        data = yaml.safe_load(fm_text) or {}
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _collect_text_signals(fm: dict) -> str:
    """把论文的若干 frontmatter 文本字段拼成兜底推断文本。"""
    parts: list[str] = []
    for key in _TEXT_FIELDS:
        v = fm.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(v)
    return " ".join(parts)


def main():
    ap = argparse.ArgumentParser(description="Backfill resource_tier from deep_extract + frontmatter text")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 篇 (debug 用)")
    ap.add_argument("--dry-run", action="store_true", help="不写 frontmatter,只统计")
    ap.add_argument("--skip-existing", action="store_true", default=True,
                    help="跳过已有 resource_tier 字段的论文(默认开启)")
    ap.add_argument("--text-only", action="store_true",
                    help="即使有 deep_extract 也只用兜底文本(debug 用,默认关闭)")
    args = ap.parse_args()

    config = load_config_with_source_migration("config.yaml", write_back=False) or {}
    docs_dir = Path(config.get("arxiv_paper_setting", {}).get("docs_dir", "docs")) / "papers"
    if not docs_dir.is_absolute():
        docs_dir = REPO_ROOT / docs_dir
    if not docs_dir.exists():
        print(f"[backfill] docs dir not found: {docs_dir}", flush=True)
        sys.exit(1)

    papers = list(_walk_md(docs_dir))
    if args.limit > 0:
        papers = papers[: args.limit]
    print(
        f"[backfill] docs={docs_dir}, papers={len(papers)}, "
        f"dry_run={args.dry_run}, text_only={args.text_only}",
        flush=True,
    )

    # 过滤 + 拼兜底文本
    todo: list[tuple[Path, str, Optional[dict], str]] = []
    skipped_done = 0
    skipped_no_data = 0
    for md, paper_id in papers:
        fm = _parse_frontmatter(md)
        if fm is None:
            skipped_no_data += 1
            continue
        if args.skip_existing and "resource_tier" in fm:
            skipped_done += 1
            continue
        deep = fm.get("deep_extract") if isinstance(fm.get("deep_extract"), dict) else None
        text_signals = _collect_text_signals(fm)
        # 完全没数据可推:deep_extract 缺失 AND text_signals 空 → 跳过
        if not args.text_only and deep is None and not text_signals:
            skipped_no_data += 1
            continue
        if args.text_only:
            deep = None
        todo.append((md, paper_id, deep, text_signals))

    print(
        f"[backfill] todo={len(todo)}, skipped_done={skipped_done}, "
        f"skipped_no_data={skipped_no_data}",
        flush=True,
    )

    # 统计 tier 分布
    tier_count: dict[str, int] = {}
    scale_count: dict[str, int] = {}
    source_count: dict[str, int] = {"deep": 0, "text": 0}

    def _stats(de: Optional[dict], text: str) -> tuple[str, str]:
        t = infer_resource_tier(de, text)
        s = infer_data_scale(de, text)
        return t, s

    if args.dry_run:
        for _md, _pid, de, text in todo:
            t, s = _stats(de, text)
            tier_count[t] = tier_count.get(t, 0) + 1
            scale_count[s] = scale_count.get(s, 0) + 1
            source_count["deep" if de is not None else "text"] += 1
        print(f"[backfill] DRY-RUN 来源: deep={source_count['deep']} text={source_count['text']}",
              flush=True)
        print("[backfill] DRY-RUN tier 分布:", flush=True)
        for k in sorted(tier_count.keys(), key=lambda x: -tier_count[x]):
            print(f"  {k:12s} {tier_count[k]:4d}", flush=True)
        print("[backfill] DRY-RUN data_scale 分布:", flush=True)
        for k in sorted(scale_count.keys(), key=lambda x: -scale_count[x]):
            print(f"  {k:12s} {scale_count[k]:4d}", flush=True)
        print("[backfill] dry-run done (no writes)", flush=True)
        return

    ok = 0
    fail = 0
    for i, (md, paper_id, de, text) in enumerate(todo, 1):
        try:
            tier, scale = _stats(de, text)
            tier_count[tier] = tier_count.get(tier, 0) + 1
            scale_count[scale] = scale_count.get(scale, 0) + 1
            source_count["deep" if de is not None else "text"] += 1

            changed1 = upsert_front_matter_field_to_path(str(md), "resource_tier", tier)
            changed2 = upsert_front_matter_field_to_path(str(md), "data_scale", scale)
            if changed1 or changed2:
                ok += 1
        except Exception as e:
            fail += 1
            print(f"[backfill] {paper_id} failed: {e}", flush=True)

        if i % 50 == 0:
            print(f"[backfill] {i}/{len(todo)} ok={ok} fail={fail}", flush=True)

    print(
        f"[backfill] done: ok={ok} fail={fail} | "
        f"deep={source_count['deep']} text={source_count['text']}",
        flush=True,
    )
    print("[backfill] tier 分布:", flush=True)
    for k in sorted(tier_count.keys(), key=lambda x: -tier_count[x]):
        print(f"  {k:12s} {tier_count[k]:4d}", flush=True)
    print("[backfill] data_scale 分布:", flush=True)
    for k in sorted(scale_count.keys(), key=lambda x: -scale_count[x]):
        print(f"  {k:12s} {scale_count[k]:4d}", flush=True)


if __name__ == "__main__":
    main()
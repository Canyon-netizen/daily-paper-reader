"""PR-5 Concept Backlinks — backfill 已收录的 323 篇论文。

不动 Step 6 主流程,只跑:
  1) 对 docs/papers/**/*-{slug}.md 每篇调 LLM 抽概念 (extract_concepts)
  2) upsert frontmatter: wiki_compiled / wiki_compiled_at / concepts
  3) concept_index.rebuild() 写 wiki/concepts/*.md + _index.json + _graph.json
  4) copy wiki/ → public/wiki/ 给 Astro 静态服务

跑法: python -m scripts.backfill_concepts [--limit N] [--dry-run]

回滚: git checkout docs/papers/  + rm -rf wiki/ public/wiki/
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


def _bootstrap_local_env() -> None:
    """本地跑(GH Actions 已有 LLM_MODEL)需要从 .env 短名 → LLM_* 映射。

    .env 短名是 api / url / model(token / id 是 Gist 用的)。
    不在 GH Actions 路径上跑时,LLM_MODEL 不存在会让 router 抛 ValueError,
    extract_concepts 内部 try/except 吞掉返 [] —— backfill 静默空跑,根因难查。

    本函数:
      1. 调 src.local_env.load_local_env() 读 .env 进 os.environ(短名)
      2. 短名 → LLM_* 映射(只在 LLM_* 未设时)
      3. 缺 LLM_MODEL 时 fail-fast 退出(不再静默返 0 概念)
    """
    from src.local_env import load_local_env

    load_local_env()
    # 短名 → LLM_* 标准名(对齐 .github/scripts/load_gist.py:60-66 逻辑)
    if "LLM_MODEL" not in os.environ and "model" in os.environ:
        provider = os.environ.get("provider") or "minimax"
        os.environ["LLM_MODEL"] = (
            f"{provider}/{os.environ['model']}" if "/" not in os.environ["model"]
            else os.environ["model"]
        )
    # PR-3 router.call() 读 LLM_* 标准名,但 provider-specific client(_create_client)
    # 优先读 MINIMAX_API_KEY / DEEPSEEK_API_KEY 等(provider-specific > 标准名)。
    # 双写避免漏掉:MINIMAX_API_KEY 在 _create_client minimax 分支直接读,
    # 不带 LLM_API_KEY fallback(llm.py:955)。
    if "api" in os.environ:
        if "MINIMAX_API_KEY" not in os.environ:
            os.environ["MINIMAX_API_KEY"] = os.environ["api"]
        if "LLM_API_KEY" not in os.environ:
            os.environ["LLM_API_KEY"] = os.environ["api"]
    if "url" in os.environ and "LLM_BASE_URL" not in os.environ:
        os.environ["LLM_BASE_URL"] = os.environ["url"]

    missing = [k for k in ("LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL") if not os.environ.get(k)]
    if missing:
        print(
            f"[backfill] FAIL-FAST: 缺 LLM 环境变量 {missing}. "
            f"GH Actions 上由 .github/scripts/load_gist.py 从 Gist 写入;"
            f"本地跑需要 .env 里有 api= + url= + model= (短名会被自动映射成 LLM_*),"
            f"或者 export LLM_MODEL='provider/model' LLM_API_KEY='...' LLM_BASE_URL='...'",
            flush=True,
        )
        sys.exit(2)


_bootstrap_local_env()

from src.concept_extractor import extract_concepts  # noqa: E402
from src.concept_index import rebuild as rebuild_concepts  # noqa: E402
from src.generate_docs_md_io import (  # noqa: E402
    upsert_front_matter_field_to_path,
)
from src.source_config import load_config_with_source_migration  # noqa: E402


def _walk_md(docs_dir: Path):
    """yield (md_path, paper_id, slug, title) 元组。
    paper_id + slug 从文件名解析:<id>v<n>-<slug>.md
    title 从 frontmatter.title 读,失败则用 slug.
    """
    import re

    pat = re.compile(r"^(?P<id>\d{4}\.\d{4,5}v\d+)-(?P<slug>.+)\.md$")
    for md in sorted(docs_dir.rglob("*.md")):
        m = pat.search(md.name)
        if not m:
            continue
        paper_id = m.group("id")
        slug = m.group("slug")
        title = slug.replace("-", " ").title()
        try:
            with md.open(encoding="utf-8") as f:
                head = f.read(8000)
        except OSError:
            continue
        import re as _re

        fm_match = _re.search(r"^---\n(.*?)\n---", head, _re.DOTALL)
        if fm_match:
            for line in fm_match.group(1).splitlines():
                if line.startswith("title:"):
                    title = line.split(":", 1)[1].strip().strip("'\"")
                    break
        yield md, paper_id, slug, title


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 篇 (debug 用)")
    ap.add_argument("--dry-run", action="store_true", help="不写 frontmatter,只统计")
    ap.add_argument("--skip-extract", action="store_true", help="不抽概念,只 rebuild")
    args = ap.parse_args()

    config = load_config_with_source_migration("config.yaml", write_back=False) or {}
    if not (config.get("concepts") or {}).get("enabled"):
        print("[backfill] concepts.enabled=false in config, abort", flush=True)
        sys.exit(1)

    docs_dir = Path(config.get("arxiv_paper_setting", {}).get("docs_dir", "docs")) / "papers"
    if not docs_dir.is_absolute():
        docs_dir = REPO_ROOT / docs_dir
    if not docs_dir.exists():
        print(f"[backfill] docs dir not found: {docs_dir}", flush=True)
        sys.exit(1)

    papers = list(_walk_md(docs_dir))
    if args.limit > 0:
        papers = papers[: args.limit]
    print(f"[backfill] docs={docs_dir}, papers={len(papers)}, dry_run={args.dry_run}", flush=True)

    # 1) 跳过已 wiki_compiled + concepts 非空 的(支持增量)。
    # 反例:早期 buggy 跑出来的 wiki_compiled=true 但 concepts=[] 必须重抽。
    todo = []
    skipped_done = 0
    skipped_ghost = 0
    for md, paper_id, slug, title in papers:
        try:
            with md.open(encoding="utf-8") as f:
                head = f.read(8000)
        except OSError:
            continue
        if "wiki_compiled: true" in head:
            # 判定 ghost:concepts: [] 或缺失 → 重抽
            import re as _re
            cm = _re.search(
                r"^concepts:\s*\[(.+?)\]\s*$", head, _re.DOTALL | _re.MULTILINE,
            )
            has_real_concepts = bool(cm and cm.group(1).strip())
            if has_real_concepts:
                skipped_done += 1
                continue
            skipped_ghost += 1
        todo.append((md, paper_id, slug, title))
    print(
        f"[backfill] todo={len(todo)}, skipped_done={skipped_done}, "
        f"skipped_ghost(wiki_compiled=true 但 concepts=[])= {skipped_ghost}",
        flush=True,
    )

    if not args.dry_run and not args.skip_extract:
        from datetime import datetime, timezone
        import time as _time
        ok = 0
        fail = 0
        for i, (md, paper_id, slug, title) in enumerate(todo, 1):
            try:
                with md.open(encoding="utf-8") as f:
                    md_text = f.read()
                concepts = extract_concepts(md_text, config)
                upsert_front_matter_field_to_path(md, "wiki_compiled", True)
                upsert_front_matter_field_to_path(
                    md, "wiki_compiled_at", datetime.now(timezone.utc).isoformat()
                )
                upsert_front_matter_field_to_path(md, "concepts", concepts)
                ok += 1
            except Exception as e:
                fail += 1
                print(f"[backfill] {paper_id} failed: {e}", flush=True)
            if i % 20 == 0:
                print(f"[backfill] {i}/{len(todo)} ok={ok} fail={fail}", flush=True)
            # MiniMax rate limit 保护：每 call 后睡 3 秒，避免 429
            _time.sleep(3.0)
        print(f"[backfill] extract done: ok={ok} fail={fail}", flush=True)

    # 2) rebuild wiki/concepts/
    min_appearances = int((config.get("concepts") or {}).get("min_appearances", 2))
    print(f"[backfill] rebuilding wiki/concepts/ (min_appearances={min_appearances})", flush=True)
    rebuild_concepts(
        archive_dir=str(REPO_ROOT / "wiki"),
        docs_dir=str(docs_dir),
        min_appearances=min_appearances,
    )

    # 3) copy to public/wiki/
    src = REPO_ROOT / "wiki"
    dst = REPO_ROOT / "public" / "wiki"
    if src.exists():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        cnt = sum(1 for _ in dst.rglob("*"))
        print(f"[backfill] copied {src} -> {dst} ({cnt} entries)", flush=True)

    # 4) print summary
    idx_path = REPO_ROOT / "wiki" / "concepts" / "_index.json"
    if idx_path.exists():
        import json
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        items = idx if isinstance(idx, list) else idx.get("concepts", [])
        print(f"[backfill] _index.json entries: {len(items)}", flush=True)
    print("[backfill] done", flush=True)


if __name__ == "__main__":
    main()
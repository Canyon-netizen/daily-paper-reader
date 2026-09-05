"""Backfill Deep Extract — 为已收录的论文批量生成深度抽取结果。

不动 Step 6 主流程,只跑:
  1) 对 docs/papers/**/*-{slug}.md 每篇调 LLM 生成 deep_extract
  2) upsert frontmatter: deep_extract JSON 字段

跑法: python -m scripts.backfill.backfill_deep_extract [--limit N] [--dry-run]

回滚: git checkout docs/papers/
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))


def _bootstrap_local_env() -> None:
    """本地跑需要从 .env 短名 → LLM_* 映射."""
    from src.local_env import load_local_env

    load_local_env()
    if "LLM_MODEL" not in os.environ and "model" in os.environ:
        provider = os.environ.get("provider") or "minimax"
        os.environ["LLM_MODEL"] = (
            f"{provider}/{os.environ['model']}" if "/" not in os.environ["model"]
            else os.environ["model"]
        )
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
            f"本地跑需要 .env 里有 api= + url= + model= (短名会被自动映射成 LLM_*),"
            f"或者 export LLM_MODEL='provider/model' LLM_API_KEY='...' LLM_BASE_URL='...'",
            flush=True,
        )
        sys.exit(2)


_bootstrap_local_env()

from src.paper_deep_extract import generate_deep_extract  # noqa: E402
from src.generate_docs_md_io import (  # noqa: E402
    upsert_front_matter_field_to_path,
)
from src.source_config import load_config_with_source_migration  # noqa: E402


def _walk_md(docs_dir: Path):
    """yield (md_path, paper_id, slug, title, abstract) 元组."""
    import re

    pat = re.compile(r"^(?P<id>\d{4}\.\d{4,5}v\d+)-(?P<slug>.+)\.md$")
    for md in sorted(docs_dir.rglob("*.md")):
        m = pat.search(md.name)
        if not m:
            continue
        paper_id = m.group("id")
        slug = m.group("slug")
        title = slug.replace("-", " ").title()
        abstract = ""
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
                elif line.startswith("abstract:"):
                    # Handle multiline abstract
                    abstract_lines = []
                    remaining_lines = fm_match.group(1).splitlines()
                    idx = fm_match.group(1).splitlines().index(line)
                    for al in remaining_lines[idx + 1 :]:
                        if al.startswith(" ") or al.startswith("\t"):
                            abstract_lines.append(al.strip())
                        else:
                            break
                    abstract = " ".join(abstract_lines).strip().strip("'\"")
        yield md, paper_id, slug, title, abstract


def _load_paper_text(paper_id: str, docs_dir: Path) -> str:
    """Load paper .txt file if exists."""
    import glob

    base_id = paper_id.split("v")[0] if "v" in paper_id else paper_id

    search_patterns = [
        docs_dir / "**" / base_id / "*.txt",
        docs_dir / "**" / f"{base_id}*.txt",
    ]

    for pattern in search_patterns:
        matches = glob.glob(str(pattern), recursive=True)
        if matches:
            try:
                with open(matches[0], "r", encoding="utf-8") as f:
                    return f.read()
            except Exception:
                continue

    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 篇 (debug 用)")
    ap.add_argument("--dry-run", action="store_true", help="不写 frontmatter,只统计")
    ap.add_argument("--skip-existing", action="store_true", default=True, help="跳过已有 deep_extract 的论文(默认开启)")
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
    print(f"[backfill] docs={docs_dir}, papers={len(papers)}, dry_run={args.dry_run}", flush=True)

    # Filter papers with/without existing deep_extract
    todo = []
    skipped_done = 0
    for md, paper_id, slug, title, abstract in papers:
        try:
            with md.open(encoding="utf-8") as f:
                head = f.read(8000)
        except OSError:
            continue

        import re as _re

        has_deep_extract = "deep_extract:" in head and "replicability_score:" in head
        if has_deep_extract and args.skip_existing:
            skipped_done += 1
            continue

        todo.append((md, paper_id, slug, title, abstract))

    print(
        f"[backfill] todo={len(todo)}, skipped_done={skipped_done}",
        flush=True,
    )

    if not args.dry_run:
        from datetime import datetime, timezone
        import time as _time

        ok = 0
        fail = 0
        for i, (md, paper_id, slug, title, abstract) in enumerate(todo, 1):
            # Load paper text
            paper_text = _load_paper_text(paper_id, docs_dir)

            try:
                result = generate_deep_extract(
                    title=title,
                    abstract=abstract,
                    paper_text=paper_text if paper_text else None,
                )

                if result is None:
                    fail += 1
                    print(f"[backfill] {paper_id} failed: LLM returned None", flush=True)
                    continue

                # Upsert deep_extract JSON to frontmatter
                import yaml

                # Build the deep_extract field as YAML
                de_yaml = yaml.dump(result, allow_unicode=True, default_flow_style=False)
                # Indent for nested frontmatter
                de_yaml_indented = "\n".join("  " + line for line in de_yaml.splitlines())

                # Read current frontmatter
                with md.open(encoding="utf-8") as f:
                    content = f.read()

                # Check if deep_extract already exists
                if "deep_extract:" in content:
                    # Replace existing
                    import re as _re

                    # Find and replace the deep_extract block
                    pattern = r"(^---\n.*?)^deep_extract:.*?(?=^---|\Z)"
                    match = _re.search(pattern, content, _re.MULTILINE | _re.DOTALL)
                    if match:
                        # Replace the deep_extract section
                        new_content = content[: match.start()] + content[match.end() :]
                        # Find the closing ---
                        close_match = _re.search(r"^---\n", new_content[match.start() :], _re.MULTILINE)
                    else:
                        new_content = content
                else:
                    new_content = content

                # Insert deep_extract before the closing ---
                if "deep_extract:" not in new_content:
                    # Find position before closing ---
                    import re as _re2

                    m = _re2.search(r"^(---\n)", new_content, _re.MULTILINE)
                    if m:
                        insert_pos = m.start()
                        new_content = (
                            new_content[:insert_pos]
                            + "deep_extract:\n"
                            + de_yaml_indented
                            + "\n"
                            + new_content[insert_pos:]
                        )

                with md.open("w", encoding="utf-8") as f:
                    f.write(new_content)

                ok += 1

            except Exception as e:
                fail += 1
                print(f"[backfill] {paper_id} failed: {e}", flush=True)

            if i % 10 == 0:
                print(f"[backfill] {i}/{len(todo)} ok={ok} fail={fail}", flush=True)

            # Rate limit protection: sleep after each call
            _time.sleep(3.0)

        print(f"[backfill] extract done: ok={ok} fail={fail}", flush=True)

    print("[backfill] done", flush=True)


if __name__ == "__main__":
    main()

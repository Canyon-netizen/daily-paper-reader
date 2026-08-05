# -*- coding: utf-8 -*-
"""
Parallel translate script using asyncio + semaphore.
Replaces the slow `ThreadPoolExecutor` approach when the API rate-limits.

Usage: python -m src.translate_parallel data/_chunk_0.json [data/_chunk_1.json ...]
"""
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_PAPERS = REPO_ROOT / "docs" / "papers"

# Import helpers from the existing script
sys.path.insert(0, str(REPO_ROOT / "src"))
import translate_polaris as tp  # noqa: E402


async def translate_one_async(sem: asyncio.Semaphore, md_path: Path, url: str, key: str, model: str) -> tuple[Path, str, str]:
    async with sem:
        # Run the blocking LLM call in a thread so the event loop stays free
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _translate_sync, md_path, url, key, model)
        return result


def _translate_sync(md_path: Path, url: str, key: str, model: str) -> tuple[Path, str, str]:
    """Synchronous translate_one — run via run_in_executor."""
    text = md_path.read_text(encoding="utf-8")
    front, body = tp.parse_frontmatter(text)
    title = (front.get("title_zh") or front.get("title") or "").strip()
    abstract = (front.get("tldr") or front.get("abstract") or "").strip()
    fulltext = body.strip()[:8000]
    if not title and not abstract:
        return (md_path, "err", "no title/abstract")
    article = tp.call_librarian(url, key, model, title, abstract, fulltext)
    if not tp._validate_article(article):
        return (md_path, "err", article[:200])
    new_body = tp._insert_into_body(body, article)
    front["wiki_compiled"] = True
    front["wiki_compiled_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    tp.write_frontmatter_and_body(md_path, front, new_body)
    return (md_path, "ok", f"{len(article)} chars")


async def main_async(file_names: list[str], concurrency: int = 8):
    url = os.environ["LLM_BASE_URL"]
    key = os.environ["LLM_API_KEY"]
    model = os.environ.get("LLM_MODEL", "MiniMax-M2.7-highspeed")

    # resolve paths
    md_paths = []
    for n in file_names:
        # Find first match by name in docs/papers
        matches = list(DOCS_PAPERS.rglob(n))
        if not matches:
            print(f"WARN: {n} not found")
            continue
        md_paths.append(matches[0])

    sem = asyncio.Semaphore(concurrency)
    tasks = [translate_one_async(sem, p, url, key, model) for p in md_paths]
    print(f"[translate-parallel] {len(tasks)} papers, concurrency={concurrency}")
    ok = err = 0
    for fut in asyncio.as_completed(tasks):
        path, status, info = await fut
        if status == "ok":
            ok += 1
        else:
            err += 1
            print(f"  err: {path.name}: {info[:120]}")
        if (ok + err) % 10 == 0 or (ok + err) == len(tasks):
            print(f"[translate-parallel] {ok + err}/{len(tasks)} ok={ok} err={err}")
    print(f"[translate-parallel] done: ok={ok} err={err}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m src.translate_parallel <chunk.json> [chunk2.json ...]")
        sys.exit(1)

    all_names = []
    for arg in sys.argv[1:]:
        with open(arg) as f:
            names = json.load(f)
        all_names.extend(names)

    asyncio.run(main_async(all_names))
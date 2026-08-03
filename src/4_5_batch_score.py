# -*- coding: utf-8 -*-
"""
Score all papers 0-1 via LLM, write to frontmatter.
Usage:
  python -m src.4_5_batch_score              # LLM mode (needs LLM_API_KEY/BASE_URL/MODEL)
  python -m src.4_5_batch_score --heuristic  # no-LLM fallback (heuristic placeholders)
  python -m src.4_5_batch_score --threshold 0.3  # change cutoff (default 0.8)
  python -m src.4_5_batch_score --yes-delete  # actually delete (DANGEROUS)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_PAPERS = REPO_ROOT / "docs" / "papers"
DATA_DIR = REPO_ROOT / "data"


def iter_paper_md_files():
    out = []
    for p in DOCS_PAPERS.rglob("*.md"):
        name = p.name
        if name in ("README.md", "path-spec.md", "zotero-usage.md"):
            continue
        if name.startswith("_"):
            continue
        out.append(p)
    return out


def parse_frontmatter(md):
    if not md.startswith("---"):
        return ({}, md)
    end = md.find("\n---", 4)
    if end < 0:
        return ({}, md)
    block = md[4:end]
    body = md[end + 4:]
    try:
        data = yaml.safe_load(block) or {}
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    return (data, body)


def write_frontmatter(md_path, score):
    text = md_path.read_text(encoding="utf-8")
    data, body = parse_frontmatter(text)
    data["score"] = round(score, 3)
    yaml_str = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    md_path.write_text(f"---\n{yaml_str}---{body}", encoding="utf-8")


def heuristic_score(front):
    score = 0.50
    venue = (front.get("venue") or "").lower()
    if any(v in venue for v in ("icml", "iclr", "neurips", "aaai", "acl", "emnlp", "cvpr", "iccv")):
        score += 0.20
    cats = front.get("categories") or {}
    tasks = cats.get("task") or []
    boost = min(0.10, 0.05 * len([t for t in tasks if t in ("rl", "agent", "mas", "llm-agent", "robotics")]))
    score += boost
    date = str(front.get("date") or "")
    if date.startswith("2026-") or date.startswith("2025-"):
        score += 0.10
    return min(1.0, max(0.0, score))


SYSTEM_PROMPT = (
    "You are a research assistant. Score each arXiv paper 0-1 for relevance to this user interest: "
    "deep learning, AI agents, reinforcement learning, NLP, robotics, computer vision. "
    "0.0 = unrelated, 1.0 = core match. "
    "Respond with a JSON object only, no extra text, no <think> blocks, of the form: "
    "{\"scores\": [{\"i\": 1, \"s\": 0.7}, ...]} (one per paper, in order)."
)


def _strip_think(text: str) -> str:
    """Strip <think>...</think> blocks M3 reasoning model emits."""
    import re
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # also strip any leading/trailing non-json prose
    return text.strip()


def llm_score_one_batch(url, api_key, model, items):
    """Send one batch to LLM, return {path: score}. {} on failure."""
    user_lines = []
    for i, (_, front) in enumerate(items, start=1):
        title = (front.get("title_zh") or front.get("title") or "").strip()
        tldr = (front.get("tldr") or front.get("abstract") or front.get("evidence") or "").strip()[:300]
        user_lines.append(f"{i}. {title}\n   {tldr}")
    user_msg = (
        f"Below are {len(items)} arXiv papers. Score each 0-1 per system instructions. "
        f"Output a JSON object: {{\"scores\": [{{\"i\": 1, \"s\": 0.7}}, ...]}}. "
        f"No prose, no <think> blocks.\n\n"
        + "\n".join(user_lines)
    )
    try:
        import urllib.request
        req = urllib.request.Request(
            f"{url.rstrip('/')}/chat/completions",
            data=json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        content = _strip_think(content)
        # Find first { ... } block
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            content = content[start:end + 1]
        payload = json.loads(content)
        if isinstance(payload, list):
            arr = payload
        else:
            arr = payload.get("scores") or payload.get("results") or []
        out = {}
        for it in arr:
            try:
                idx = int(it.get("i"))
                s_raw = it.get("s")
                if s_raw is None:
                    continue  # LLM skipped this paper
                s = float(s_raw)
                out[items[idx - 1][0]] = max(0.0, min(1.0, s))
            except Exception:
                continue
        return out
    except Exception as e:
        print(f"[batch] LLM call failed: {type(e).__name__}: {e}", file=sys.stderr)
        return {}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--heuristic", action="store_true")
    p.add_argument("--threshold", type=float, default=0.8)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes-delete", action="store_true")
    p.add_argument("--batch-size", type=int, default=20)
    p.add_argument("--concurrency", type=int, default=10)
    args = p.parse_args()

    files = iter_paper_md_files()
    print(f"[batch-score] {len(files)} paper md files")

    items = []
    for f in files:
        front, _ = parse_frontmatter(f.read_text(encoding="utf-8"))
        items.append((f, front))

    scores = {}
    if args.heuristic or not os.environ.get("LLM_API_KEY"):
        print("[batch-score] heuristic mode")
        for p_, front in items:
            scores[p_] = heuristic_score(front)
    else:
        url = os.environ["LLM_BASE_URL"]
        api_key = os.environ["LLM_API_KEY"]
        model = os.environ.get("LLM_MODEL", "MiniMax-M2.7-highspeed")
        # url may already include /v1; llm_score_one_batch appends /chat/completions
        BATCH = args.batch_size
        print(f"[batch-score] LLM: {url} model={model} batch={BATCH} conc={args.concurrency}")
        import concurrent.futures
        batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = {pool.submit(llm_score_one_batch, url, api_key, model, b): b for b in batches}
            for fut in concurrent.futures.as_completed(futures):
                batch = futures[fut]
                try:
                    res = fut.result()
                except Exception as e:
                    print(f"[batch] raised: {e}", file=sys.stderr)
                    res = {}
                if not res:
                    for p_, _ in batch:
                        scores.setdefault(p_, 0.5)
                else:
                    scores.update(res)
                print(f"[batch] progress {len(scores)}/{len(items)}", file=sys.stderr)

    if not args.dry_run:
        for p_, s in scores.items():
            write_frontmatter(p_, s)
    print(f"[batch-score] wrote {len(scores)} scores")

    keep, kill = [], []
    for p_, s in sorted(scores.items(), key=lambda x: -x[1]):
        text = p_.read_text(encoding="utf-8")
        front, _ = parse_frontmatter(text)
        title = (front.get("title_zh") or front.get("title") or "").strip()[:60]
        arxiv = (front.get("pdf") or "").split("/")[-1] or p_.stem
        if s >= args.threshold:
            keep.append((arxiv, title, s))
        else:
            kill.append((arxiv, title, s))

    print(f"\n=== >= {args.threshold} KEEP: {len(keep)} ===")
    for a, t, s in keep[:60]:
        print(f"  keep {s:.2f} {a}  {t}")
    if len(keep) > 60:
        print(f"  ... {len(keep) - 60} more")
    print(f"\n=== < {args.threshold} KILL candidates: {len(kill)} ===")
    for a, t, s in kill[:60]:
        print(f"  kill {s:.2f} {a}  {t}")
    if len(kill) > 60:
        print(f"  ... {len(kill) - 60} more")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cand_path = DATA_DIR / "delete-candidates.txt"
    with open(cand_path, "w", encoding="utf-8") as f:
        f.write(f"# delete-candidates -- score < {args.threshold}\n")
        f.write(f"# generated: {'heuristic' if args.heuristic else 'LLM'}\n")
        f.write(f"# total: {len(kill)} papers\n\n")
        for a, t, s in kill:
            f.write(f"{s:.3f}\t{a}\t{t}\n")
    print(f"\n[batch-score] candidate list: {cand_path}")

    if args.yes_delete:
        deleted = 0
        for p_, s in scores.items():
            if s < args.threshold and p_.parent != DOCS_PAPERS:
                p_.unlink()
                deleted += 1
        print(f"[batch-score] DELETED {deleted} files (< {args.threshold})")
    else:
        print(f"\n[!] pass --yes-delete to actually delete. 0 files removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

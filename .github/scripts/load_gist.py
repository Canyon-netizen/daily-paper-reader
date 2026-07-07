#!/usr/bin/env python3
"""Load LLM / Supabase / etc. secrets from a GitHub Gist into $GITHUB_ENV.

Shared by all 7 GitHub Actions workflows (daily-paper-reader, conference-retrieval,
maintain-{arxiv,biorxiv,chemrxiv,medrxiv,supabase}, maintain-version-refresh).
The script replaces the per-workflow inline `python3 - <<'PY' ... PY` heredoc that
previously lived in `Load secrets from Gist` step.

Features:
  * Reads DPR_GIST_ID / DPR_GIST_TOKEN from env, fetches the Gist via REST.
  * Writes the raw Gist response to /tmp/dpr-gist.json so downstream
    `src/main.py:apply_topics_from_gist_env()` can fall back to it when
    env encoding fails.
  * Flattens legacy `llm.{apiKey, baseUrl, model}` + top-level `provider` into
    `LLM_API_KEY / LLM_BASE_URL / LLM_MODEL` (with `provider/model` join) so the
    old Gist format keeps working.
  * Writes each `key=value` line to $GITHUB_ENV so subsequent steps inherit.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


GIST_RAW_PATH = "/tmp/dpr-gist.json"


def fetch_gist(token: str, gist_id: str) -> dict[str, Any]:
    req = urllib.request.Request(
        f"https://api.github.com/gists/{gist_id}",
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "dpr-load-gist/1.0",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def flatten_legacy_llm_section(payload: dict[str, Any]) -> None:
    """Pop `llm.{apiKey, baseUrl, model}` from legacy Gist payloads and expose
    them as `LLM_API_KEY / LLM_BASE_URL / LLM_MODEL`. If `LLM_MODEL` already
    exists at the top level (new Gist format), leave it alone.

    Also handles the `provider/model` join when the legacy `llm.model` is just
    `MiniMax-M3` and the top-level `provider` is `minimax`.
    """
    llm = payload.pop("llm", None)
    if not isinstance(llm, dict):
        return
    if "apiKey" in llm and "LLM_API_KEY" not in payload:
        payload["LLM_API_KEY"] = llm["apiKey"]
    if "baseUrl" in llm and "LLM_BASE_URL" not in payload:
        payload["LLM_BASE_URL"] = llm["baseUrl"]
    if "model" in llm and "LLM_MODEL" not in payload:
        model = llm["model"]
        provider = payload.get("provider", "")
        if provider and "/" not in str(model):
            payload["LLM_MODEL"] = f"{provider}/{model}"
        else:
            payload["LLM_MODEL"] = str(model)


def write_env_lines(payload: dict[str, Any], env_file: str | None) -> None:
    for key, value in payload.items():
        line = f"{key}={value}"
        print(line)
        if env_file:
            with open(env_file, "a", encoding="utf-8") as fp:
                fp.write(line + "\n")


def main() -> int:
    token = os.environ.get("DPR_GIST_TOKEN", "").strip()
    gist_id = os.environ.get("DPR_GIST_ID", "").strip()
    if not token or not gist_id:
        print("::error::DPR_GIST_TOKEN / DPR_GIST_ID missing", file=sys.stderr)
        return 1

    try:
        data = fetch_gist(token, gist_id)
    except urllib.error.HTTPError as exc:
        print(f"::error::Gist fetch HTTP {exc.code}: {exc.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"::error::Gist fetch network error: {exc.reason}", file=sys.stderr)
        return 1

    # Persist raw Gist response so src/main.py:apply_topics_from_gist_env()
    # can read it as a fallback when env encoding fails (multi-line topics etc.).
    with open(GIST_RAW_PATH, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)

    files = data.get("files") or {}
    target = next(
        (
            f["content"]
            for f in files.values()
            if isinstance(f, dict) and f.get("filename", "").endswith(".json")
        ),
        None,
    )
    if not target:
        print("::error::no .json file in gist", file=sys.stderr)
        return 1

    payload = json.loads(target)
    flatten_legacy_llm_section(payload)
    write_env_lines(payload, os.environ.get("GITHUB_ENV"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
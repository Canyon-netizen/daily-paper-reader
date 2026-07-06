# Daily Paper Reader · tests/

This directory holds the Python test suite. It's split into
~50 single-file pytest cases that grew up alongside the
docsify front-end and now exercise the [`src/`](../src/)
pipeline after the 2026-07 Astro rewrite.

## How to run

```bash
# From repo root, with .venv activated (the simplest entry):
scripts/run-pipeline.sh -m pytest tests/ -q

# Or, once pytest is on PATH inside an activated venv:
pytest tests/ -q
```

`pytest.ini` already sets `pythonpath = .` so `from src.X
import …` resolves without extra setup. The wrapper script
is preferred because it handles venv activation automatically.

## Layout

Until PR #12 lands its first cut, every file lives at the
top of this folder. We deliberately do **not** split into
subdirectories yet — many of the .github/workflows/*.yml use
`pytest tests/ -q` as a smoke test and assume a flat layout.
Restructure would be a follow-up PR once the team has a few
weeks of CI signal on the existing shape.

Approximate groups by filename prefix:

| Prefix | What it covers |
|---|---|
| `test_main_*` / `test_local_*` | `src/main.py`, `src/local_debug_server.py`, `src/local_env.py` |
| `test_skip_fetch` | `src/main.py` `should_skip_fetch` decision (avoids redundant Supabase re-fetches) |
| `test_conference_*` | `src/conference_*.py` (retrieval, sidebar, pipeline, workflow & UI plumbing) |
| `test_init_supabase_*` | `src/maintain/init_*.py` (DB seeding for each multi-source backend) |
| `test_fetch_*` | `src/maintain/fetchers/*` and a few ACL/AAAI helpers |
| `test_maintain_*`, `test_cleanup_supabase_old_papers` | `src/maintain/{cleanup,common}.py` (cross-source cleanup + Supabase pruning) |
| `test_bm25_boolean`, `test_query_boolean`, `test_query_*` | `src/query_boolean.py`, `src/2.1` + `src/2.2` retrieval paths |
| `test_rrf_query_key` | `src/2.3.retrieval_papers_rrf.py` (RRF key isolation across sources) |
| `test_rank_*`, `test_model_loader_remote` | `src/3.rank_papers.py` (reranker pooling + remote defaults + `src/model_loader.py`) |
| `test_llm_*` | `src/4.llm_refine_papers.py`, `src/llm.py`, LLM config helpers |
| `test_select_*` | `src/5.select_papers.py` source attribution |
| `test_generate_docs_meta_parse` | `src/6.generate_docs.py` (frontmatter / meta.json round-trip) |
| `test_sync_*` | `src/maintain/sync.py`, Supabase backend key resolution, sync streaming |
| `test_paper_figures` | `src/paper_figures.py` PDF figure extraction |
| `test_source_config`, `test_subscription_plan`, `test_user_config_overlay` | `src/source_config.py`, `src/subscription_plan.py` (incl. PR #7 user-overlay helpers) |
| `test_statement_timeout` | SQL RPC timeouts (cross-cuts the maintain / Supabase layer) |

A few tests are environment-dependent (live Supabase /
`zwwen.online` reranker endpoints) and fail under
`pytest tests/ -q` when those services are unreachable.
That baseline is "16 failed, 175 passed" in the current
offline sandbox and is **expected**; the failures are not
introduced by recent PRs.

## What is intentionally absent

- No `node_modules`-style frontend unit tests. The legacy
  `tests/test_*.js` files were removed in PR #4 because they
  required the now-deleted `app/*.js` modules. If the team
  wants JS test coverage in future, wire up `bun test` or
  vitest with the Astro client as the target.
- No `tests/fixtures/` shared directory. If multiple tests
  start needing the same sample arxiv metadata, add one
  (`tests/fixtures/sample_arxiv.json`).
- No `pyproject.toml`. The repo has no `setup.py` /
  `pip install -e .` workflow; `scripts/bootstrap_local.sh`
  + `requirements*.txt` already give venv users everything
  they need. Migrate to pyproject only when packaging becomes
  a goal.

## Cross-references

- Plan: `.claude/plans/compressed-napping-hoare.md` (PR #12
  block in §2)
- Pipeline entry: `src/main.py` (run via
  [`scripts/run-pipeline.sh`](../scripts/run-pipeline.sh))
- Path spec: [`docs/path-spec.md`](../docs/path-spec.md)
- Dev conventions: top-level `🛠️ 开发约定` in
  [`README.md`](../README.md)

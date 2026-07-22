"""Debug: 跑 1 篇,打 LLM raw 响应 + 解析后 + 过滤后 三段,看哪一步把概念都丢了。"""
import sys
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.backfill_concepts import _bootstrap_local_env  # noqa: E402
_bootstrap_local_env()

from src.concept_extractor import (
    build_concept_prompt, CONCEPT_EXTRACT_SYSTEM_PROMPT,
    _parse_json_safely, _coerce_concepts, postprocess_concepts,
    load_blacklist, load_aliases,
)
from src.source_config import load_config_with_source_migration
from src.llm_router import get_llm_router

config = load_config_with_source_migration("config.yaml", write_back=False) or {}
md_path = Path("docs/papers/2025/10/21/2510.18483v1-starbench-rpg.md")
md_text = md_path.read_text(encoding="utf-8")

router = get_llm_router(config)
prompt = build_concept_prompt(md_text)
messages = [
    {"role": "system", "content": CONCEPT_EXTRACT_SYSTEM_PROMPT},
    {"role": "user", "content": prompt},
]

print("== calling LLM stage=concept.extract ==", flush=True)
import traceback as _tb
try:
    resp = router.call(
        "concept.extract", messages=messages, response_format={"type": "json_object"},
    )
    print(f"== resp type={type(resp).__name__} keys={list(resp.keys()) if isinstance(resp, dict) else 'N/A'} ==", flush=True)
    print(f"== resp repr (first 300) = {repr(resp)[:300]} ==", flush=True)
    raw = resp["choices"][0]["message"]["content"]
    print(f"== RAW len={len(raw)} ==", flush=True)
    print(raw[:2000], flush=True)
    print("== ...end raw (truncated)... ==", flush=True)
    print(f"== RAW tail ==", flush=True)
    print(raw[-500:] if len(raw) > 500 else "", flush=True)
except Exception as e:
    print(f"== LLM call failed: {type(e).__name__}: {e} ==", flush=True)
    _tb.print_exc()
    sys.exit(1)

parsed = _parse_json_safely(raw)
print(f"== parsed type={type(parsed).__name__} ==", flush=True)
print(parsed, flush=True)

raw_list = _coerce_concepts(parsed)
print(f"== coerced {len(raw_list)} raw ==", flush=True)
for c in raw_list:
    print(f"   - {c}", flush=True)

cfg = (config or {}).get("concepts") or {}
blacklist = load_blacklist(cfg)
aliases = load_aliases(cfg)
print(f"== blacklist size={len(blacklist)} aliases size={len(aliases)} ==", flush=True)

result = postprocess_concepts(raw_list, blacklist=blacklist, aliases=aliases, max_concepts=7)
print(f"== final {len(result)} ==", flush=True)
for c in result:
    print(f"   - {c}", flush=True)
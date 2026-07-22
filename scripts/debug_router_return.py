"""Debug: 看 router.call() 实际返回什么形态。"""
import sys
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.backfill_concepts import _bootstrap_local_env
_bootstrap_local_env()

from src.llm_router import get_llm_router
from src.source_config import load_config_with_source_migration

config = load_config_with_source_migration("config.yaml", write_back=False) or {}
router = get_llm_router(config)

resp = router.call(
    "concept.extract",
    messages=[{"role": "user", "content": "say hi in JSON: {\"concepts\": []}"}],
    response_format={"type": "json_object"},
)
print("type:", type(resp).__name__, flush=True)
print("has choices:", isinstance(resp, dict) and "choices" in resp, flush=True)
print("repr:", repr(resp)[:500], flush=True)
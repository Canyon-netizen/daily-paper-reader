"""Unit tests for .github/scripts/load_gist.py — flatten + env write logic.

Run from repo root:
    PYTHONPATH=.github/scripts python -m pytest tests/test_load_gist.py -v
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

# Load the script as a module (it's at .github/scripts/load_gist.py, not on sys.path).
SCRIPT_PATH = Path(__file__).resolve().parents[1] / ".github" / "scripts" / "load_gist.py"
spec = importlib.util.spec_from_file_location("load_gist", SCRIPT_PATH)
assert spec and spec.loader, f"could not load {SCRIPT_PATH}"
load_gist = importlib.util.module_from_spec(spec)
sys.modules["load_gist"] = load_gist
spec.loader.exec_module(load_gist)


# ---------------------------------------------------------------------------
# flatten_legacy_llm_section
# ---------------------------------------------------------------------------

class TestFlattenLegacyLlmSection:
    def test_legacy_format_with_provider(self):
        """The actual user case: nested `llm` + top-level `provider`."""
        payload = {
            "categories": ["cs.AI"],
            "llm": {"apiKey": "sk-xxx", "baseUrl": "https://api.x", "model": "M3"},
            "provider": "minimax",
            "topics": [],
        }
        load_gist.flatten_legacy_llm_section(payload)
        assert payload["LLM_API_KEY"] == "sk-xxx"
        assert payload["LLM_BASE_URL"] == "https://api.x"
        assert payload["LLM_MODEL"] == "minimax/M3"
        # Original `llm` is popped (not lingering in env output).
        assert "llm" not in payload

    def test_legacy_format_without_provider(self):
        """If `provider` is missing, model is used as-is (might be invalid downstream)."""
        payload = {"llm": {"apiKey": "k", "model": "M3"}}
        load_gist.flatten_legacy_llm_section(payload)
        assert payload["LLM_MODEL"] == "M3"

    def test_model_already_qualified_not_re_prefixed(self):
        """If `llm.model` already contains `/`, don't add provider prefix."""
        payload = {"llm": {"model": "minimax/M3"}, "provider": "minimax"}
        load_gist.flatten_legacy_llm_section(payload)
        assert payload["LLM_MODEL"] == "minimax/M3"

    def test_new_format_passthrough(self):
        """New Gist format: top-level `LLM_MODEL` already set → don't overwrite."""
        payload = {"LLM_MODEL": "minimax/M3", "LLM_API_KEY": "sk-new"}
        load_gist.flatten_legacy_llm_section(payload)
        assert payload["LLM_MODEL"] == "minimax/M3"
        assert payload["LLM_API_KEY"] == "sk-new"

    def test_no_llm_section_is_noop(self):
        payload = {"LLM_MODEL": "minimax/M3", "topics": []}
        load_gist.flatten_legacy_llm_section(payload)
        assert payload == {"LLM_MODEL": "minimax/M3", "topics": []}

    def test_llm_not_dict_is_skipped(self):
        """Defensive: if `llm` is somehow a string/list, don't crash."""
        payload = {"llm": "garbage"}
        load_gist.flatten_legacy_llm_section(payload)
        assert "LLM_MODEL" not in payload
        assert "LLM_API_KEY" not in payload

    def test_partial_llm_section(self):
        """Only apiKey + model, no baseUrl."""
        payload = {"llm": {"apiKey": "k", "model": "M3"}, "provider": "minimax"}
        load_gist.flatten_legacy_llm_section(payload)
        assert payload["LLM_API_KEY"] == "k"
        assert "LLM_BASE_URL" not in payload
        assert payload["LLM_MODEL"] == "minimax/M3"


# ---------------------------------------------------------------------------
# write_env_lines
# ---------------------------------------------------------------------------

class TestWriteEnvLines:
    def test_writes_lines_to_file(self, tmp_path):
        env_file = tmp_path / "github_env"
        payload = {"LLM_MODEL": "minimax/M3", "LLM_API_KEY": "sk-x"}
        load_gist.write_env_lines(payload, str(env_file))
        content = env_file.read_text(encoding="utf-8")
        assert content == "LLM_MODEL=minimax/M3\nLLM_API_KEY=sk-x\n"

    def test_no_env_file_just_prints(self, capsys):
        """Should not crash when env_file is None."""
        load_gist.write_env_lines({"LLM_MODEL": "m"}, None)
        captured = capsys.readouterr()
        assert "LLM_MODEL=m" in captured.out


# ---------------------------------------------------------------------------
# filter_payload_for_env — 前端 paper-hide.ts / settings-page.ts 写入的
# hiddenPapers 字段不应进 CI $GITHUB_ENV。
# ---------------------------------------------------------------------------

class TestFilterPayloadForEnv:
    def test_strips_hidden_papers(self):
        """The main case: payload 含 hiddenPapers 时被 pop。"""
        payload = {
            "LLM_MODEL": "minimax/M3",
            "LLM_API_KEY": "sk-x",
            "hiddenPapers": ["2401.01234", "2405.05678v1"],
        }
        load_gist.filter_payload_for_env(payload)
        assert "hiddenPapers" not in payload
        # 其他字段保留
        assert payload["LLM_API_KEY"] == "sk-x"
        assert payload["LLM_MODEL"] == "minimax/M3"

    def test_no_hidden_papers_is_noop(self):
        """payload 不含 hiddenPapers 时,filter 不应破坏其他字段。"""
        payload = {"LLM_MODEL": "m", "topics": []}
        load_gist.filter_payload_for_env(payload)
        assert payload == {"LLM_MODEL": "m", "topics": []}

    def test_empty_array_still_pops(self):
        """hiddenPapers = [] (空数组) 也应被 pop —— 显式设过 [] 和字段不存在语义不同,
        但对 env 来说都是不应该出现的字段。"""
        payload = {"LLM_MODEL": "m", "hiddenPapers": []}
        load_gist.filter_payload_for_env(payload)
        assert "hiddenPapers" not in payload

    def test_non_array_hidden_papers_pops_anyway(self):
        """Defensive: 即使前端误传了字符串/null,也应 pop,而不是写到 env。"""
        payload = {"hiddenPapers": "garbage", "LLM_MODEL": "m"}
        load_gist.filter_payload_for_env(payload)
        assert "hiddenPapers" not in payload
        assert payload["LLM_MODEL"] == "m"
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
        assert "LLM_MODEL=" in captured.out
        # 值不能出现在 stdout(防止 secret 走公开 Actions 日志)
        assert "LLM_MODEL=m\n" not in captured.out
        assert "m" not in [line.split("=", 1)[1] for line in captured.out.splitlines() if line.startswith("LLM_MODEL=")]

    def test_secret_keys_emitted_as_add_mask(self, capsys):
        """含 SECRET/API_KEY/PASSWORD/SERVICE_KEY/TOKEN/PRIVATE_KEY 子串的 key
        必须先 ::add-mask:: 再写 env,且值不进 stdout。"""
        payload = {
            "LLM_API_KEY": "sk-real-secret-xyz",
            "SUPABASE_SERVICE_KEY": "sbp_another_secret",
            "RERANK_API_KEY": "rk-yet-another",
            "OPENREVIEW_PASSWORD": "pw-1234",
            "LLM_BASE_URL": "https://example.com",  # 非 secret
        }
        load_gist.write_env_lines(payload, None)
        captured = capsys.readouterr()
        # 4 个 secret 必须 emit ::add-mask::
        for v in ("sk-real-secret-xyz", "sbp_another_secret", "rk-yet-another", "pw-1234"):
            assert f"::add-mask::{v}" in captured.out, f"missing ::add-mask:: for {v}"
        # secret 的真实 value 只能以 ::add-mask::<v> 形式出现一次,绝不能裸出现第二次
        for v in ("sk-real-secret-xyz", "sbp_another_secret", "rk-yet-another", "pw-1234"):
            assert captured.out.count(v) == 1, f"value {v} appears more than once (leak)"
        # stdout 必须能看到 key 名,便于诊断 Gist 加载了哪些字段
        assert "LLM_API_KEY" in captured.out
        assert "SUPABASE_SERVICE_KEY" in captured.out
        assert "OPENREVIEW_PASSWORD" in captured.out
        # 但 LLM_BASE_URL 的真实值也不能再裸出现(为安全一致,我们统一不打印 value)
        assert "https://example.com" not in captured.out
        assert "<set" in captured.out  # 长度占位符

    def test_env_file_still_gets_full_values(self, tmp_path):
        """虽然 stdout 看不到 secret,但 $GITHUB_ENV 文件里值必须完整 — 否则后续步骤读不到。"""
        env_file = tmp_path / "github_env"
        payload = {"LLM_API_KEY": "sk-real-secret-xyz"}
        load_gist.write_env_lines(payload, str(env_file))
        content = env_file.read_text(encoding="utf-8")
        assert content == "LLM_API_KEY=sk-real-secret-xyz\n"


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

    def test_user_library_passthrough_after_cancel(self):
        """2026-07-31 取消 Gist 同步后,filter_payload_for_env 不再 pop userLibrary /
        schemaVersion —— 因为本就不存在那条同步路径了。这条测试钉死当前行为,
        让任何"重新启用 Gist 同步"的尝试都会触发 assertion 失败,提醒 reviewer
        同时恢复 pop + 改 'in' 为 'not in'。"""
        payload = {"userLibrary": {"papers": {}}, "schemaVersion": 1, "LLM_MODEL": "m"}
        load_gist.filter_payload_for_env(payload)
        assert "userLibrary" in payload, (
            "如果重新引入 Gist 同步,记得同步恢复 filter_payload_for_env 的 "
            "userLibrary/schemaVersion pop,并把断言改成 'not in payload'。"
        )
        assert "schemaVersion" in payload
        assert "hiddenPapers" not in payload

    def test_strips_user_library_doc(self):
        """★ 旧版本,2026-07-31 取消 Gist 同步后**期望失败**。
        保留这条让未来"重新启用 Gist 同步"的尝试者意识到:需要同时恢复 pop。
        现版本下这条会 fail,见 test_user_library_passthrough_after_cancel。"""
        user_lib_doc = {
            "schemaVersion": 1,
            "papers": {
                "2607.00001": {"updatedAt": 100, "note": "very long note"},
                "2607.00002": {"updatedAt": 200, "starred": True},
            },
        }
        payload = {
            "LLM_MODEL": "m",
            "userLibrary": user_lib_doc,
            "schemaVersion": 1,
        }
        load_gist.filter_payload_for_env(payload)
        # 当前版本下 userLibrary 透传 —— 旧期望已不成立,改成 passthrough 案例。
        # 这一段注释保留作为历史语境;assert 改成正确方向。
        assert "userLibrary" in payload
        assert "hiddenPapers" not in payload
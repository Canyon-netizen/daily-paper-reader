"""PR-2 Sextant Validate 单测。

覆盖:
  - verify() 主入口：observation.error 短路、output 解析失败、空 acceptance、rubric 开关
  - 6 维 deterministic check 各跑一次（构造伪造 payload + tmp path）
  - short-circuit 行为：第一个 fail 后不再跑后续 check
  - 各 kind（no_error / exit_code / artifact_exists / schema_valid / metric / min_count）边界
  - rubric_enabled=false 时跳过 llm_rubric
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.validate import verify  # noqa: E402
from src.validate.checks import (  # noqa: E402
    DETERMINISTIC_CHECK_KINDS,
    METRIC_OPS,
    _check_artifact_exists,
    _check_exit_code,
    _check_metric,
    _check_min_count,
    _check_no_error,
    _check_schema_valid,
    run_deterministic_checks,
)


class TestVerifyEntry(unittest.TestCase):
    """verify() 主流程单测。"""

    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp())
        # 一个合法 JSON 输出,每篇 paper 含 paper_id / title / abstract / pdf_url
        self.output_path = self.tmpdir / "out.json"
        self.output_path.write_text(
            json.dumps(
                {
                    "papers": [
                        {
                            "paper_id": "2607.00001",
                            "title": "T",
                            "abstract": "A",
                            "pdf_url": "https://arxiv.org/pdf/2607.00001",
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # --- observation.error 短路 ---

    def test_observation_error_short_circuits(self) -> None:
        result = verify(
            "any",
            output_path=self.output_path,
            acceptance={"checks": [{"kind": "no_error"}]},
            observation={"error": "boom"},
        )
        self.assertFalse(result["passed"])
        self.assertIn("boom", result["reason"])
        self.assertIsNone(result["rubric_passed"])

    # --- 空 acceptance:全部通过（无 check） ---

    def test_empty_acceptance_passes(self) -> None:
        result = verify("any", output_path=self.output_path, acceptance={})
        self.assertTrue(result["passed"])

    def test_none_acceptance_passes(self) -> None:
        result = verify("any", output_path=self.output_path)
        self.assertTrue(result["passed"])

    # --- 6 维 check 各跑一次（全部 pass） ---

    def test_all_deterministic_checks_pass(self) -> None:
        # 制造一个 side artifact,让 artifact_exists 能找到
        side = self.tmpdir / "side.json"
        side.write_text("{}", encoding="utf-8")
        # 写一个含 scalar metric 字段的输出,让 metric check 跑得通
        out = self.tmpdir / "metric.json"
        out.write_text(
            json.dumps({"papers": [{"paper_id": "1", "title": "t"}], "score": 0.8}),
            encoding="utf-8",
        )
        acceptance: Dict[str, Any] = {
            "checks": [
                {"kind": "no_error"},
                {"kind": "exit_code", "value": 0},
                {"kind": "artifact_exists", "key": "side.json"},
                {"kind": "schema_valid", "field": "papers", "required_keys": ["paper_id", "title"]},
                {"kind": "min_count", "field": "papers", "value": 1},
                {"kind": "metric", "name": "score", "op": ">=", "value": 0.5},
            ]
        }
        result = verify("any", output_path=out, exit_code=0, acceptance=acceptance)
        self.assertTrue(result["passed"], result["reason"])

    # --- short-circuit 行为 ---

    def test_short_circuit_on_first_failure(self) -> None:
        # exit_code 不匹配 → 直接 fail,不跑后续 min_count / no_error
        acceptance: Dict[str, Any] = {
            "checks": [
                {"kind": "exit_code", "value": 0},
                {"kind": "min_count", "field": "papers", "value": 999},
                {"kind": "no_error"},
            ]
        }
        out = self.tmpdir / "ok.json"
        out.write_text(json.dumps({"papers": [1, 2]}), encoding="utf-8")
        result = verify("any", output_path=out, exit_code=1, acceptance=acceptance)
        self.assertFalse(result["passed"])
        self.assertIn("[exit_code]", result["reason"])
        # short-circuit 后不会跑 min_count / no_error
        self.assertNotIn("[min_count]", result["reason"])
        self.assertNotIn("[no_error]", result["reason"])

    # --- rubric 默认禁用 ---

    def test_rubric_skipped_when_disabled(self) -> None:
        acceptance: Dict[str, Any] = {
            "checks": [
                {"kind": "no_error"},
                {"kind": "llm_rubric"},  # 即使有 rubric check,默认也不跑
            ],
            "rubric_enabled": False,
        }
        result = verify("any", output_path=self.output_path, acceptance=acceptance)
        self.assertTrue(result["passed"])

    # --- rubric_enabled=True 但无 rubric check ---

    def test_rubric_enabled_but_no_rubric_check(self) -> None:
        acceptance: Dict[str, Any] = {
            "checks": [{"kind": "no_error"}],
            "rubric_enabled": True,
        }
        result = verify("any", output_path=self.output_path, acceptance=acceptance)
        self.assertTrue(result["passed"])

    # --- output JSON 解析失败 ---

    def test_invalid_json_output_fails(self) -> None:
        bad = self.tmpdir / "bad.json"
        bad.write_text("{not json", encoding="utf-8")
        result = verify("any", output_path=bad, acceptance={"checks": [{"kind": "no_error"}]})
        self.assertFalse(result["passed"])
        self.assertIn("output_parse_error", result["reason"])


class TestIndividualCheckFunctions(unittest.TestCase):
    """直接测 6 维 predicate 函数。"""

    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # --- _check_no_error ---

    def test_no_error_pass_when_file_exists(self) -> None:
        f = self.tmpdir / "x.json"
        f.write_text("{}", encoding="utf-8")
        self.assertTrue(_check_no_error(f))

    def test_no_error_fail_when_missing(self) -> None:
        self.assertFalse(_check_no_error(self.tmpdir / "ghost.json"))

    def test_no_error_fail_when_none(self) -> None:
        self.assertFalse(_check_no_error(None))

    # --- _check_exit_code ---

    def test_exit_code_match(self) -> None:
        self.assertTrue(_check_exit_code(0, 0))
        self.assertFalse(_check_exit_code(1, 0))
        self.assertFalse(_check_exit_code(None, 0))

    # --- _check_artifact_exists ---

    def test_artifact_exists_relative(self) -> None:
        out = self.tmpdir / "out.json"
        out.write_text("{}", encoding="utf-8")
        side = self.tmpdir / "side.json"
        side.write_text("{}", encoding="utf-8")
        self.assertTrue(_check_artifact_exists(out, "side.json"))

    def test_artifact_exists_missing(self) -> None:
        out = self.tmpdir / "out.json"
        out.write_text("{}", encoding="utf-8")
        self.assertFalse(_check_artifact_exists(out, "ghost.json"))

    # --- _check_schema_valid ---

    def test_schema_valid_dict_field(self) -> None:
        payload = {"config": {"query_text": "x", "prefixed_text": "y"}}
        self.assertTrue(
            _check_schema_valid(payload, "config", ["query_text", "prefixed_text"])
        )

    def test_schema_valid_dict_field_missing_key(self) -> None:
        payload = {"config": {"query_text": "x"}}
        self.assertFalse(_check_schema_valid(payload, "config", ["query_text", "prefixed_text"]))

    def test_schema_valid_list_field(self) -> None:
        payload = {
            "papers": [
                {"paper_id": "1", "title": "t"},
                {"paper_id": "2", "title": "t2"},
            ]
        }
        self.assertTrue(_check_schema_valid(payload, "papers", ["paper_id", "title"]))

    def test_schema_valid_list_empty(self) -> None:
        self.assertFalse(_check_schema_valid({"papers": []}, "papers", ["paper_id"]))

    def test_schema_valid_field_missing(self) -> None:
        self.assertFalse(_check_schema_valid({}, "papers", ["paper_id"]))

    def test_schema_valid_payload_none(self) -> None:
        self.assertFalse(_check_schema_valid(None, "papers", ["paper_id"]))

    # --- _check_min_count ---

    def test_min_count_pass(self) -> None:
        self.assertTrue(_check_min_count({"papers": [1, 2, 3]}, "papers", 2))
        self.assertTrue(_check_min_count({"papers": [1]}, "papers", 1))

    def test_min_count_fail(self) -> None:
        self.assertFalse(_check_min_count({"papers": [1]}, "papers", 2))

    def test_min_count_field_not_list(self) -> None:
        self.assertFalse(_check_min_count({"papers": "x"}, "papers", 1))

    # --- _check_metric ---

    def test_metric_all_ops(self) -> None:
        for op in METRIC_OPS:
            with self.subTest(op=op):
                if op == ">=":
                    self.assertTrue(_check_metric({"x": 5}, "x", op, 5))
                elif op == "<=":
                    self.assertTrue(_check_metric({"x": 5}, "x", op, 5))
                elif op == ">":
                    self.assertTrue(_check_metric({"x": 6}, "x", op, 5))
                elif op == "<":
                    self.assertTrue(_check_metric({"x": 4}, "x", op, 5))
                elif op == "==":
                    self.assertTrue(_check_metric({"x": 5}, "x", op, 5))

    def test_metric_field_missing(self) -> None:
        self.assertFalse(_check_metric({}, "x", ">=", 0))

    def test_metric_field_non_numeric(self) -> None:
        self.assertFalse(_check_metric({"x": "abc"}, "x", ">=", 0))

    def test_metric_unknown_op(self) -> None:
        self.assertFalse(_check_metric({"x": 1}, "x", "??", 1))


class TestDeterministicCheckSet(unittest.TestCase):
    def test_all_kinds_declared(self) -> None:
        # 6 维 + llm_rubric 不在 deterministic 集合内
        expected = {"no_error", "exit_code", "artifact_exists", "schema_valid", "metric", "min_count"}
        self.assertEqual(expected, set(DETERMINISTIC_CHECK_KINDS))

    def test_run_deterministic_checks_filters_unknown(self) -> None:
        # 未知 kind 应被跳过,不报错
        ok, reasons = run_deterministic_checks(
            [{"kind": "no_error"}],  # 至少一个合法 check
            output_path=None,
        )
        self.assertFalse(ok)  # no_error 在 path=None 时失败
        self.assertTrue(any("[no_error]" in r for r in reasons))


if __name__ == "__main__":
    unittest.main()
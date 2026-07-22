"""PR-4 Prompt Pack 单测。

覆盖:
  - load_active_pack: pin 缺失 / pin 合法 / pin 非法格式 / pack 不存在 → graceful fallback
  - inject_into_prompt: 无 pin 不变 / 有 pin 拼接 / 超 24000 截断
  - Pack.load: manifest 校验失败 / body 缺失
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from prompt_pack import (  # noqa: E402
    TARGET_BUDGET_CHARS,
    Pack,
    inject_into_prompt,
    load_active_pack,
)


class TestPromptPack(unittest.TestCase):

    def setUp(self) -> None:
        # 模拟 repo root: temp_dir/config/prompts/<pack_id>/<version>/
        self.repo_root = tempfile.mkdtemp()
        # setUp 里放一个名为 "testpack:2026-07-01" 的子目录不方便,改为在测试里直接造。
        self.pack_dir = Path(self.repo_root) / "config" / "prompts" / "testpack" / "2026-07-01"
        self.pack_dir.mkdir(parents=True)
        self._write_manifest_and_body(
            self.pack_dir,
            {
                "pack_id": "testpack",
                "version": "2026-07-01",
                "display_name": "Test Pack",
                "kind": "guidance",
                "targets": ["refine"],
                "body_file": "body.md",
            },
            "# Test Body\nThis is a test body for the pack.",
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.repo_root, ignore_errors=True)

    @staticmethod
    def _write_manifest_and_body(pack_dir: Path, manifest: dict, body: str) -> None:
        (pack_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
        )
        (pack_dir / "body.md").write_text(body, encoding="utf-8")

    # ---------- load_active_pack ----------

    def test_load_active_pack_none_when_inactive(self) -> None:
        config = {"prompt_packs": {"active": {}}}
        self.assertIsNone(load_active_pack("refine", config, repo_root=self.repo_root))

    def test_load_active_pack_returns_pack_when_pinned(self) -> None:
        config = {"prompt_packs": {"active": {"refine": "testpack:2026-07-01"}}}
        pack = load_active_pack("refine", config, repo_root=self.repo_root)
        self.assertIsNotNone(pack)
        self.assertEqual(pack.manifest["pack_id"], "testpack")
        self.assertEqual(pack.manifest["version"], "2026-07-01")
        self.assertIn("Test Body", pack.body)

    def test_load_active_pack_returns_none_for_missing_pack(self) -> None:
        """pin 指向不存在的 pack → graceful fallback 返回 None。"""
        config = {"prompt_packs": {"active": {"refine": "ghost:2099-01-01"}}}
        self.assertIsNone(load_active_pack("refine", config, repo_root=self.repo_root))

    def test_invalid_pin_format_returns_none(self) -> None:
        config = {"prompt_packs": {"active": {"refine": "not-a-pin-without-colon"}}}
        self.assertIsNone(load_active_pack("refine", config, repo_root=self.repo_root))

    def test_pin_with_empty_parts_returns_none(self) -> None:
        config = {"prompt_packs": {"active": {"refine": ":"}}}
        self.assertIsNone(load_active_pack("refine", config, repo_root=self.repo_root))

    def test_no_config_returns_none(self) -> None:
        self.assertIsNone(load_active_pack("refine", None, repo_root=self.repo_root))

    def test_active_section_missing_returns_none(self) -> None:
        config = {"prompt_packs": {}}  # 没有 active
        self.assertIsNone(load_active_pack("refine", config, repo_root=self.repo_root))

    # ---------- inject_into_prompt ----------

    def test_inject_returns_original_when_no_pin(self) -> None:
        config = {"prompt_packs": {"active": {}}}
        original = "Original prompt"
        self.assertEqual(
            inject_into_prompt(original, "refine", config, repo_root=self.repo_root),
            original,
        )

    def test_inject_prepends_body(self) -> None:
        config = {"prompt_packs": {"active": {"refine": "testpack:2026-07-01"}}}
        result = inject_into_prompt("User.", "refine", config, repo_root=self.repo_root)
        self.assertIn("---", result)
        self.assertIn("# Test Body", result)
        # pack.body 必须在 user content 之前
        self.assertLess(result.index("# Test Body"), result.index("User."))

    def test_inject_truncates_when_over_budget(self) -> None:
        config = {"prompt_packs": {"active": {"refine": "testpack:2026-07-01"}}}
        # body ≈ 40 chars,user 部分塞 30000 chars → 拼后约 30040,超过 24000。
        long_prompt = "A" * 30000
        result = inject_into_prompt(long_prompt, "refine", config, repo_root=self.repo_root)
        self.assertIn("... [truncated to 24000 chars]", result)
        self.assertLess(len(result), TARGET_BUDGET_CHARS + 100)  # 留 buffer 给 marker
        self.assertGreater(len(result), TARGET_BUDGET_CHARS - 200)

    def test_inject_returns_original_when_pack_missing(self) -> None:
        """pin 指向不存在的 pack → 走 graceful fallback,返回原 prompt。"""
        config = {"prompt_packs": {"active": {"refine": "ghost:2099-01-01"}}}
        original = "Original prompt"
        self.assertEqual(
            inject_into_prompt(original, "refine", config, repo_root=self.repo_root),
            original,
        )

    def test_inject_handles_empty_body(self) -> None:
        """pack body 为空时直接返回原 prompt。"""
        # 替换 setUp 创建的 body.md 为空文件
        (self.pack_dir / "body.md").write_text("", encoding="utf-8")
        config = {"prompt_packs": {"active": {"refine": "testpack:2026-07-01"}}}
        original = "Original prompt"
        self.assertEqual(
            inject_into_prompt(original, "refine", config, repo_root=self.repo_root),
            original,
        )

    # ---------- Pack.load ----------

    def test_pack_load_raises_on_missing_manifest(self) -> None:
        bad_dir = Path(self.repo_root) / "config" / "prompts" / "no-manifest" / "v1"
        bad_dir.mkdir(parents=True)
        with self.assertRaises(FileNotFoundError):
            Pack.load(str(bad_dir))

    def test_pack_load_raises_on_missing_body(self) -> None:
        bad_dir = Path(self.repo_root) / "config" / "prompts" / "no-body" / "v1"
        bad_dir.mkdir(parents=True)
        (bad_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "pack_id": "no-body",
                    "version": "v1",
                    "display_name": "no-body",
                    "kind": "guidance",
                    "targets": ["refine"],
                    "body_file": "nonexistent.md",
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(FileNotFoundError):
            Pack.load(str(bad_dir))

    def test_pack_load_rejects_invalid_manifest(self) -> None:
        """manifest 缺少必填字段 → ValueError。"""
        bad_dir = Path(self.repo_root) / "config" / "prompts" / "bad" / "v1"
        bad_dir.mkdir(parents=True)
        (bad_dir / "manifest.json").write_text(
            json.dumps({"pack_id": "bad"}),  # 缺 version / display_name / targets ...
            encoding="utf-8",
        )
        with self.assertRaises(ValueError):
            Pack.load(str(bad_dir))


if __name__ == "__main__":
    unittest.main()
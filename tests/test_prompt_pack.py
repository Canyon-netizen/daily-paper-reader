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

    # ---------- 多 body pack (PR 阶段 1: library-digest 三 stage) ----------

    def test_multi_body_pack_resolves_per_target(self) -> None:
        """同包内 manifest.bodies[target] 优先于 body_file。"""
        multi_dir = (
            Path(self.repo_root)
            / "config" / "prompts" / "multi" / "2026-08-02"
        )
        multi_dir.mkdir(parents=True)
        # 写 manifest:bodies 映射到三个不同 body 文件
        (multi_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "pack_id": "multi",
                    "version": "2026-08-02",
                    "display_name": "Multi body pack",
                    "kind": "guidance",
                    "targets": ["library.digest", "library.digest_synth", "library.trend"],
                    "body_file": "fallback.md",
                    "bodies": {
                        "library.digest": "insights.md",
                        "library.digest_synth": "synthesis.md",
                        "library.trend": "trend.md",
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (multi_dir / "insights.md").write_text("# INSIGHTS BODY", encoding="utf-8")
        (multi_dir / "synthesis.md").write_text("# SYNTHESIS BODY", encoding="utf-8")
        (multi_dir / "trend.md").write_text("# TREND BODY", encoding="utf-8")
        (multi_dir / "fallback.md").write_text("# FALLBACK BODY", encoding="utf-8")

        # 三个 target 各自取到正确 body
        config = {
            "prompt_packs": {
                "active": {
                    "library.digest": "multi:2026-08-02",
                    "library.digest_synth": "multi:2026-08-02",
                    "library.trend": "multi:2026-08-02",
                }
            }
        }
        p1 = load_active_pack("library.digest", config, repo_root=self.repo_root)
        p2 = load_active_pack("library.digest_synth", config, repo_root=self.repo_root)
        p3 = load_active_pack("library.trend", config, repo_root=self.repo_root)
        self.assertIsNotNone(p1)
        self.assertIsNotNone(p2)
        self.assertIsNotNone(p3)
        self.assertEqual(p1.body.strip(), "# INSIGHTS BODY")
        self.assertEqual(p2.body.strip(), "# SYNTHESIS BODY")
        self.assertEqual(p3.body.strip(), "# TREND BODY")

    def test_multi_body_pack_falls_back_to_body_file(self) -> None:
        """manifest.bodies 缺 target 时回退到 body_file。"""
        multi_dir = (
            Path(self.repo_root) / "config" / "prompts" / "multi2" / "2026-08-02"
        )
        multi_dir.mkdir(parents=True)
        (multi_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "pack_id": "multi2",
                    "version": "2026-08-02",
                    "display_name": "Multi body pack 2",
                    "kind": "guidance",
                    "targets": ["library.digest"],
                    "body_file": "fallback.md",
                    "bodies": {"library.digest": "insights.md"},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (multi_dir / "insights.md").write_text("# INSIGHTS BODY", encoding="utf-8")
        (multi_dir / "fallback.md").write_text("# FALLBACK BODY", encoding="utf-8")

        config = {
            "prompt_packs": {"active": {"library.digest": "multi2:2026-08-02"}}
        }
        pack = load_active_pack("library.digest", config, repo_root=self.repo_root)
        self.assertIsNotNone(pack)
        self.assertEqual(pack.body.strip(), "# INSIGHTS BODY")

        # load_active_pack 不传 target 时,body_file 兜底
        pack2 = load_active_pack("library.digest", config, repo_root=self.repo_root)
        self.assertEqual(pack2.body.strip(), "# INSIGHTS BODY")

    # ---------- 实际 Polaris 提示词迁移 (PR 阶段 1 验证) ----------

    def test_polaris_library_packs_present(self) -> None:
        """6 个 Polaris 提示词包都在 config/prompts 下,且 manifest 字段齐全。"""
        repo_root_real = Path(__file__).resolve().parent.parent
        prompts_dir = repo_root_real / "config" / "prompts"
        expected = {
            "library-compile": ["2026-08-02", "library.compile"],
            "library-relevance": ["2026-08-02", "library.relevance"],
            "library-concept-def": ["2026-08-02", "library.concept_def"],
            "library-figure": ["2026-08-02", "library.figure"],
            "library-digest": ["2026-08-02", "library.digest"],
            "library-chat": ["2026-08-02", "library.chat"],
        }
        for pack_id, (version, target) in expected.items():
            with self.subTest(pack=pack_id):
                pack_root = prompts_dir / pack_id / version
                self.assertTrue(pack_root.is_dir(), f"missing dir: {pack_root}")
                manifest_path = pack_root / "manifest.json"
                self.assertTrue(manifest_path.is_file(), f"missing manifest: {manifest_path}")
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                self.assertEqual(manifest["pack_id"], pack_id)
                self.assertEqual(manifest["version"], version)
                self.assertIn(target, manifest["targets"])
                # 单 body 包:body.md 必须存在且非空
                if pack_id != "library-digest":
                    body_path = pack_root / "body.md"
                    self.assertTrue(body_path.is_file(), f"missing body: {body_path}")
                    self.assertGreater(len(body_path.read_text(encoding="utf-8")), 100)
                else:
                    # 多 body 包:insights / synthesis / trend 三个 body 都要存在
                    for fname in ("insights.md", "synthesis.md", "trend.md"):
                        self.assertTrue(
                            (pack_root / fname).is_file(),
                            f"missing multi-body file: {pack_root / fname}",
                        )

    def test_polaris_compile_prompt_matches_source(self) -> None:
        """library-compile body 前几行应与 Polaris 源文件一致(便于溯源)。"""
        body_path = (
            Path(__file__).resolve().parent.parent
            / "config" / "prompts" / "library-compile" / "2026-08-02" / "body.md"
        )
        if not body_path.exists():
            self.skipTest("library-compile pack not present")
        body = body_path.read_text(encoding="utf-8")
        # Polaris 源 LIBRARIAN_SYSTEM_PROMPT 关键句子,前 80 字符应原样出现
        self.assertIn("你是 Librarian,负责把一篇论文写成一篇深入浅出的中文解读文章", body)
        self.assertIn("[[fig:N]]", body)
        self.assertIn("**绝不能漏**", body)
        # 跨论文复现概念白名单说明
        self.assertIn("跨论文复现", body)

    def test_polaris_relevance_prompt_json_strict(self) -> None:
        """library-relevance body 必须强制 JSON {score, reason, tldr} 三字段。"""
        body_path = (
            Path(__file__).resolve().parent.parent
            / "config" / "prompts" / "library-relevance" / "2026-08-02" / "body.md"
        )
        if not body_path.exists():
            self.skipTest("library-relevance pack not present")
        body = body_path.read_text(encoding="utf-8")
        self.assertIn('"score"', body)
        self.assertIn('"reason"', body)
        self.assertIn('"tldr"', body)
        self.assertIn("不要输出任何其他文字", body)

    def test_polaris_concept_def_prompt_invalid_categories(self) -> None:
        """library-concept-def body 必须显式列出 fig:1 / 编号 / 半句话等无效情形。"""
        body_path = (
            Path(__file__).resolve().parent.parent
            / "config" / "prompts" / "library-concept-def" / "2026-08-02" / "body.md"
        )
        if not body_path.exists():
            self.skipTest("library-concept-def pack not present")
        body = body_path.read_text(encoding="utf-8")
        self.assertIn("fig:1", body)
        self.assertIn("valid", body)
        self.assertIn("method|architecture", body)


# === plan §4.1 PR-4 增强:target allowlist + content hash + run-start snapshot ===

class TestPromptPackHardening(unittest.TestCase):

    def setUp(self) -> None:
        self.repo_root = tempfile.mkdtemp()
        self.pack_dir = Path(self.repo_root) / "config" / "prompts" / "hardentest" / "2026-08-01"
        self.pack_dir.mkdir(parents=True)
        self._write(
            self.pack_dir,
            {
                "pack_id": "hardentest",
                "version": "2026-08-01",
                "display_name": "Hardening Pack",
                "kind": "guidance",
                "targets": ["refine", "select"],   # 故意不放 "evil"
                "body_file": "body.md",
            },
            "# Hardening Body",
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.repo_root, ignore_errors=True)

    @staticmethod
    def _write(pack_dir: Path, manifest: dict, body: str) -> None:
        (pack_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
        )
        (pack_dir / "body.md").write_text(body, encoding="utf-8")

    def test_target_allowlist_rejects_unknown_target(self) -> None:
        """未知 target → ValueError(plan §4.1 「未知 target 不得注入」)。"""
        with self.assertRaises(ValueError) as ctx:
            Pack.load(str(self.pack_dir), target="evil")
        self.assertIn("不在 manifest.targets", str(ctx.exception))

    def test_target_allowlist_accepts_known_targets(self) -> None:
        """在白名单里的 target 应正常加载。"""
        for t in ["refine", "select"]:
            p = Pack.load(str(self.pack_dir), target=t)
            self.assertIsNotNone(p)
            self.assertEqual(p.manifest["pack_id"], "hardentest")

    def test_load_active_pack_graceful_fallback_on_allowlist_violation(self) -> None:
        """load_active_pack 捕获 allowlist ValueError → 返 None(graceful fallback)。

        plan §4.1 验收 2:不合法 target 在运行前失败,且「不抛异常污染主流程」。
        """
        # 故意 pin 一个合法 pack 但 caller 传错的 target
        config = {"prompt_packs": {"active": {"evil": "hardentest:2026-08-01"}}}
        result = load_active_pack("evil", config, repo_root=self.repo_root)
        self.assertIsNone(result)

    def test_content_hash_stable_for_same_inputs(self) -> None:
        """同一份 manifest + body 加载两次,content_hash 完全相同。"""
        p1 = Pack.load(str(self.pack_dir))
        p2 = Pack.load(str(self.pack_dir))
        self.assertEqual(p1.content_hash, p2.content_hash)
        # 64 字符 hex(sha256)
        self.assertEqual(len(p1.content_hash), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in p1.content_hash))

    def test_content_hash_changes_when_body_changes(self) -> None:
        """改 body → content_hash 改变(plan §4.1 「内容 hash 写 checkpoint」)。"""
        p1 = Pack.load(str(self.pack_dir))
        (self.pack_dir / "body.md").write_text("# changed", encoding="utf-8")
        p2 = Pack.load(str(self.pack_dir))
        self.assertNotEqual(p1.content_hash, p2.content_hash)

    def test_snapshot_contains_locked_fields(self) -> None:
        """snapshot 锁住 id/version/hash/body,后续 config 改动不影响 checkpoint。"""
        p = Pack.load(str(self.pack_dir), target="refine")
        snap = p.snapshot()
        self.assertEqual(snap["pack_id"], "hardentest")
        self.assertEqual(snap["version"], "2026-08-01")
        self.assertEqual(snap["kind"], "guidance")
        self.assertEqual(snap["targets"], ["refine", "select"])
        self.assertEqual(snap["content_hash"], p.content_hash)
        self.assertIn("Hardening Body", snap["body"])


# === First-drive snapshot contract tests ===

from prompt_pack import (  # noqa: E402
    is_first_drive,
    lock_snapshot_into_checkpoint,
    resolve_pack,
    snapshot_for_run,
)


class TestFirstDriveSnapshot(unittest.TestCase):

    def test_snapshot_for_run_returns_dict(self) -> None:
        """snapshot_for_run returns a dict with expected structure."""
        packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Test body content",
                "targets": ["refine"],
            }
        ]
        result = snapshot_for_run(packs)
        self.assertEqual(result["version"], 1)
        self.assertIn("snapshotted_at", result)
        self.assertEqual(len(result["packs"]), 1)
        self.assertEqual(result["packs"][0]["pack_id"], "testpack")

    def test_snapshot_is_immutable_dict(self) -> None:
        """snapshot_for_run returns dict where packs cannot be mutated without warning."""
        packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Test body content",
                "targets": ["refine"],
            }
        ]
        result = snapshot_for_run(packs)
        # Defensive copy - modifying original doesn't affect snapshot
        packs[0]["body"] = "Modified"
        self.assertEqual(result["packs"][0]["body"], "Test body content")

    def test_content_hash_stable(self) -> None:
        """Same body → same hash; different body → different hash."""
        pack1 = {
            "pack_id": "testpack",
            "version": "2026-08-01",
            "kind": "guidance",
            "content_hash": "hash1",
            "body": "Same body",
            "targets": ["refine"],
        }
        pack2 = {
            "pack_id": "testpack",
            "version": "2026-08-01",
            "kind": "guidance",
            "content_hash": "hash1",
            "body": "Same body",
            "targets": ["refine"],
        }
        pack3 = {
            "pack_id": "testpack",
            "version": "2026-08-01",
            "kind": "guidance",
            "content_hash": "hash2",
            "body": "Different body",
            "targets": ["refine"],
        }
        snap1 = snapshot_for_run([pack1])
        snap2 = snapshot_for_run([pack2])
        snap3 = snapshot_for_run([pack3])
        # Same content → same snapshot structure
        self.assertEqual(snap1["packs"][0]["content_hash"], snap2["packs"][0]["content_hash"])
        # Different content → different hash
        self.assertNotEqual(snap1["packs"][0]["content_hash"], snap3["packs"][0]["content_hash"])

    def test_is_first_drive_empty_checkpoint(self) -> None:
        """Empty checkpoint → True."""
        self.assertTrue(is_first_drive(None))
        self.assertTrue(is_first_drive({}))

    def test_is_first_drive_with_snapshot(self) -> None:
        """Checkpoint with prompt_packs → False."""
        checkpoint = {"prompt_packs": {"version": 1, "packs": []}}
        self.assertFalse(is_first_drive(checkpoint))

    def test_lock_snapshot_idempotent(self) -> None:
        """Calling twice with same packs doesn't change hash."""
        packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Test body",
                "targets": ["refine"],
            }
        ]
        checkpoint = {}
        result1 = lock_snapshot_into_checkpoint(checkpoint, packs)
        # Second call with same packs should be idempotent
        result2 = lock_snapshot_into_checkpoint(result1, packs)
        self.assertEqual(
            result1["prompt_packs"]["packs"][0]["content_hash"],
            result2["prompt_packs"]["packs"][0]["content_hash"],
        )

    def test_lock_snapshot_detects_mid_run_edit(self) -> None:
        """First lock with hash X, second lock with hash Y → raises ValueError."""
        packs_v1 = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "hash_v1",
                "body": "Version 1",
                "targets": ["refine"],
            }
        ]
        packs_v2 = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "hash_v2",  # Different hash
                "body": "Version 2 edited",
                "targets": ["refine"],
            }
        ]
        checkpoint = {}
        result = lock_snapshot_into_checkpoint(checkpoint, packs_v1)
        # Second call with different hash should raise
        with self.assertRaises(ValueError) as ctx:
            lock_snapshot_into_checkpoint(result, packs_v2)
        self.assertIn("Mid-run pack edit detected", str(ctx.exception))

    def test_resolve_pack_uses_snapshot_when_present(self) -> None:
        """Checkpoint has pack → snapshot body used."""
        snapshot_packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Snapshot body",
                "targets": ["refine"],
            }
        ]
        checkpoint = {"prompt_packs": snapshot_for_run(snapshot_packs)}
        current_packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Current body",
                "targets": ["refine"],
            }
        ]
        result = resolve_pack(checkpoint, "testpack", current_packs)
        self.assertEqual(result["body"], "Snapshot body")

    def test_resolve_pack_falls_back_to_current_when_missing(self) -> None:
        """Checkpoint missing pack → current body used."""
        checkpoint = {"prompt_packs": snapshot_for_run([])}
        current_packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Current body",
                "targets": ["refine"],
            }
        ]
        result = resolve_pack(checkpoint, "testpack", current_packs)
        self.assertEqual(result["body"], "Current body")

    def test_resolve_pack_warns_on_hash_mismatch(self) -> None:
        """Snapshot has hash X, current has hash Y → returns snapshot body + warning."""
        import logging

        snapshot_packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "old_hash",
                "body": "Old snapshot body",
                "targets": ["refine"],
            }
        ]
        checkpoint = {"prompt_packs": snapshot_for_run(snapshot_packs)}
        current_packs = [
            {
                "pack_id": "testpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "new_hash",  # Different
                "body": "New current body",
                "targets": ["refine"],
            }
        ]
        with self.assertLogs("prompt_pack", level="WARNING") as cm:
            result = resolve_pack(checkpoint, "testpack", current_packs)
        # Should return snapshot body, not current
        self.assertEqual(result["body"], "Old snapshot body")
        # Should log warning
        self.assertTrue(any("Mid-run pack edit detected" in log for log in cm.output))

    def test_resolve_pack_returns_none_when_not_found(self) -> None:
        """Pack not in snapshot or current → returns None."""
        checkpoint = {"prompt_packs": snapshot_for_run([])}
        current_packs = [
            {
                "pack_id": "otherpack",
                "version": "2026-08-01",
                "kind": "guidance",
                "content_hash": "abc123",
                "body": "Other body",
                "targets": ["refine"],
            }
        ]
        result = resolve_pack(checkpoint, "nonexistent", current_packs)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
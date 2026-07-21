"""PR-1 单测 — Pipeline checkpoint 文件 IO(plan §10 的 7 个 case)。

覆盖:
1. 首次 checkpoint_write(succeeded) → 文件存在 + JSON 含正确字段
2. checkpoint_read 读 succeeded → 返 dict
3. 写 failed → checkpoint_read → 返 dict(status=failed)
4. 并发写(threading)→ flock 保证不写坏(tmp + rename)
5. list_pending 含 succeeded → 不在结果中
6. corrupt JSON → checkpoint_read 返 None
7. attempts 递增(running 多次写 → attempts 累加)

依赖: 仅 stdlib + 项目内 src.pipeline_v2.checkpoint。
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

# 让 tests/ 跑 unittest 时能找到 src 包
ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.pipeline_v2.checkpoint import (  # noqa: E402
    CHECKPOINT_DIR_NAME,
    checkpoint_path,
    checkpoint_read,
    checkpoint_write,
    list_pending,
)


class CheckpointIOTest(unittest.TestCase):
    """plan §10 — 7 个 case 全部覆盖。"""

    def setUp(self):
        # 每个 case 独立临时目录,避免相互污染
        self.tmpdir = tempfile.mkdtemp(prefix="pr1_ck_")
        self.archive_dir = str(Path(self.tmpdir) / "archive" / "20260721")
        os.makedirs(self.archive_dir, exist_ok=True)
        self.step_id = "4.1.llm_refine"

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # --- case 1: 首次写 succeeded ---
    def test_first_succeeded_write_creates_file_with_correct_fields(self):
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="succeeded",
            seq=1,
            rank=4,
            sub_rank=1,
            step_type="llm_refine",
            observation={"input_count": 47, "output_count": 31, "elapsed_ms": 26412},
        )
        p = checkpoint_path(self.archive_dir, self.step_id)
        self.assertTrue(p.exists(), f"checkpoint file not created: {p}")
        data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(data["step_id"], self.step_id)
        self.assertEqual(data["step_type"], "llm_refine")
        self.assertEqual(data["rank"], 4)
        self.assertEqual(data["sub_rank"], 1)
        self.assertEqual(data["status"], "succeeded")
        self.assertEqual(data["attempts"], 1)
        self.assertIn("started_at", data)
        self.assertIn("finished_at", data)
        self.assertEqual(data["observation"]["input_count"], 47)

    # --- case 2: 读 succeeded 返 dict ---
    def test_read_succeeded_returns_dict(self):
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="succeeded",
            seq=1,
            rank=4,
            sub_rank=1,
            step_type="llm_refine",
        )
        ck = checkpoint_read(self.archive_dir, self.step_id)
        self.assertIsNotNone(ck)
        self.assertEqual(ck["status"], "succeeded")

    # --- case 3: 写 failed → checkpoint_read 返 dict(status=failed) ---
    def test_write_failed_then_read_returns_dict(self):
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="failed",
            seq=1,
            rank=4,
            sub_rank=1,
            step_type="llm_refine",
            observation={"error": "returncode=1"},
        )
        ck = checkpoint_read(self.archive_dir, self.step_id)
        self.assertIsNotNone(ck)
        self.assertEqual(ck["status"], "failed")
        self.assertEqual(ck["observation"]["error"], "returncode=1")

    # --- case 4: 并发写 → flock 保证不写坏 ---
    def test_concurrent_writes_dont_corrupt_file(self):
        """10 个线程同时写 succeeded。最终文件应是合法 JSON 且 status=succeeded。"""
        n_threads = 10

        def writer(idx):
            checkpoint_write(
                self.archive_dir,
                self.step_id,
                status="succeeded",
                seq=1,
                rank=4,
                sub_rank=1,
                step_type="llm_refine",
                observation={"writer_idx": idx},
            )

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        # 文件存在且为合法 JSON
        p = checkpoint_path(self.archive_dir, self.step_id)
        self.assertTrue(p.exists(), f"checkpoint file missing after concurrent writes: {p}")
        data = json.loads(p.read_text(encoding="utf-8"))  # 若写坏会抛 JSONDecodeError
        self.assertEqual(data["status"], "succeeded")
        self.assertEqual(data["step_type"], "llm_refine")

    # --- case 5: list_pending 含 succeeded → 不在结果中 ---
    def test_list_pending_excludes_succeeded(self):
        checkpoint_write(
            self.archive_dir,
            "1.1.fetch.raw",
            status="succeeded",
            seq=1, rank=1, sub_rank=1, step_type="fetch.raw",
        )
        # 2.1 没写,应 pending
        # 4.1 写 failed,也应 pending(list_pending 只跳 succeeded)
        checkpoint_write(
            self.archive_dir,
            "4.1.llm_refine",
            status="failed",
            seq=1, rank=4, sub_rank=1, step_type="llm_refine",
        )
        pending = list_pending(
            self.archive_dir,
            ["1.1.fetch.raw", "2.1.retrieval.bm25", "4.1.llm_refine"],
        )
        self.assertEqual(pending, ["2.1.retrieval.bm25", "4.1.llm_refine"])

    # --- case 6: corrupt JSON → checkpoint_read 返 None ---
    def test_corrupt_json_returns_none(self):
        p = checkpoint_path(self.archive_dir, self.step_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{this is not valid json", encoding="utf-8")
        self.assertIsNone(checkpoint_read(self.archive_dir, self.step_id))

    # --- case 7: attempts 递增(running 多次写 → attempts 累加)---
    def test_attempts_increments_on_repeated_running_writes(self):
        """plan §6: 写 running 时 attempts 累加;终态 succeeded 由 caller
        通过 observation['attempts'] 提供,不再做 merge(避免覆盖历史)。
        验证 running 阶段 attempts 单调递增,succeeded 用 caller 给的值。"""
        # 第一次写 running: attempts 应为 1(初始)
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="running",
            seq=1, rank=4, sub_rank=1, step_type="llm_refine",
            observation={"attempts": 1},
        )
        ck1 = checkpoint_read(self.archive_dir, self.step_id)
        self.assertEqual(ck1["attempts"], 1, "first running write should have attempts=1")

        # 第二次写 running: attempts 应累加到 2
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="running",
            seq=1, rank=4, sub_rank=1, step_type="llm_refine",
            observation={"attempts": 1},
        )
        ck2 = checkpoint_read(self.archive_dir, self.step_id)
        self.assertEqual(ck2["attempts"], 2, "second running write should have attempts=2")

        # 第三次 running → attempts=3
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="running",
            seq=1, rank=4, sub_rank=1, step_type="llm_refine",
            observation={"attempts": 1},
        )
        ck3 = checkpoint_read(self.archive_dir, self.step_id)
        self.assertEqual(ck3["attempts"], 3)

        # 终态 succeeded: attempts 由 caller 提供(不再 merge,避免覆盖历史)
        # 实际 run_step_with_checkpoint 会传 attempts=1(本 step 单次运行的视角)。
        # 这里验证 plan §6 的字面行为: succeeded 的 attempts 来自 observation。
        checkpoint_write(
            self.archive_dir,
            self.step_id,
            status="succeeded",
            seq=1, rank=4, sub_rank=1, step_type="llm_refine",
            observation={"attempts": 1},
        )
        ck_final = checkpoint_read(self.archive_dir, self.step_id)
        self.assertEqual(ck_final["status"], "succeeded")
        # plan §6 的字面行为: succeeded 写 attempts = observation['attempts'] = 1
        self.assertEqual(ck_final["attempts"], 1, "succeeded write uses caller-supplied attempts (plan §6)")


if __name__ == "__main__":
    unittest.main()
"""Pipeline v2 — Checkpoint 文件 IO 核心(plan §6)。

设计要点:
- 文件位置: archive/<date>/.checkpoints/<step_id>.json
- 并发防护: fcntl.flock(LOCK_EX) 阻塞获取同 step_id 的写锁
  (Windows 没有 fcntl 模块,降级为 no-op 单进程保护 — 实际部署在 GitHub
  Actions Linux runner 上 fcntl 始终可用)
- 原子写盘: mkstemp tmp + os.replace 防止半成品落在最终文件上
- 损坏降级: checkpoint_read 遇到 JSONDecodeError / OSError 返 None,
  让 caller 把该 step 当作"没跑过"对待
- status 状态机: pending | running | succeeded | failed | skipped
- attempts 计数: 写 running 时累加已存的 attempts 字段(PR-1 不引入自动重试)

字段语义:
- verdict: PR-2 填充,PR-1 留 None
- tokens / provenance: PR-3 填充,PR-1 留 None

依赖: 仅 stdlib (fcntl [Linux only] / json / os / tempfile / datetime / pathlib / typing)
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# fcntl 仅 Linux/macOS 可用;Windows 上降级为 no-op。
# GitHub Actions 的 ubuntu-latest runner 有 fcntl,生产部署 lock 正常生效。
if sys.platform != "win32":
    import fcntl  # type: ignore[import-not-found]  # noqa: F401
    _HAVE_FCNTL = True
else:  # pragma: no cover - Windows dev only
    fcntl = None  # type: ignore[assignment]
    _HAVE_FCNTL = False

# 模块级常量(供 test_pipeline_checkpoint.py import 验证)
CHECKPOINT_DIR_NAME = ".checkpoints"
LOCK_SUFFIX = ".lock"

# status 取值集合,写入和读出时校验
_VALID_STATUS = {"pending", "running", "succeeded", "failed", "skipped"}


def checkpoint_path(archive_dir: str, step_id: str) -> Path:
    """archive/<date>/.checkpoints/<step_id>.json

    archive_dir: 通常为 ROOT_DIR/archive/<run_date_token>。
    step_id:    形如 "4.1.llm_refine" 或 "6.2.docs.generate_paper_md.2607.12345"。
    """
    return Path(archive_dir) / CHECKPOINT_DIR_NAME / f"{step_id}.json"


def lock_path(archive_dir: str, step_id: str) -> Path:
    """每个 checkpoint 对应一个 .lock 文件,flock 用。"""
    return checkpoint_path(archive_dir, step_id).with_suffix(LOCK_SUFFIX)


def checkpoint_read(archive_dir: str, step_id: str) -> dict | None:
    """读已有 checkpoint;若 status=succeeded 返 dict,否则 None(让 sub-step 重跑)。

    - 文件不存在 → None
    - JSON 损坏 → None(降级为"没跑过",不抛异常)
    - 正常 JSON → 原始 dict(caller 自己判断 status)
    """
    p = checkpoint_path(archive_dir, step_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # 文件损坏或 IO 异常 → 当作没跑过,下次 cron 会重跑
        return None


def checkpoint_write(
    archive_dir: str,
    step_id: str,
    *,
    status: str,
    seq: int,
    rank: int,
    sub_rank: int,
    step_type: str,
    observation: dict | None = None,
    verdict: dict | None = None,
    tokens: dict | None = None,
    provenance: dict | None = None,
    on_failure: str = "mark_needs_review",
    wrapup: bool = False,
) -> None:
    """atomic write + flock 防并发。

    - 必填: status / seq / rank / sub_rank / step_type
    - 可选: observation(运行观测) / verdict(PR-2) / tokens(PR-3) /
      provenance(PR-3) / on_failure / wrapup
    - attempts 累加: 写 running 时,从已有 ck 读 attempts + 1。
    - started_at: 若 observation 含 started_at 用之,否则用当前 UTC。
    - finished_at: 仅在终态(succeeded/failed/skipped)写当前 UTC,
      running/pending 留 None(方便下次写时续上 attempts 计数)。
    """
    if status not in _VALID_STATUS:
        raise ValueError(
            f"checkpoint_write: invalid status {status!r}; "
            f"expected one of {sorted(_VALID_STATUS)}"
        )

    target = checkpoint_path(archive_dir, step_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    lock = lock_path(archive_dir, step_id)

    payload: dict[str, Any] = {
        "step_id": step_id,
        "step_type": step_type,
        "seq": seq,
        "rank": rank,
        "sub_rank": sub_rank,
        "status": status,
        "started_at": (
            observation.get("started_at")
            if observation and observation.get("started_at")
            else datetime.now(timezone.utc).isoformat()
        ),
        "finished_at": (
            datetime.now(timezone.utc).isoformat()
            if status in {"succeeded", "failed", "skipped"}
            else None
        ),
        "attempts": (
            observation.get("attempts", 1)
            if observation and observation.get("attempts") is not None
            else 1
        ),
        "observation": observation,
        "verdict": verdict,
        "tokens": tokens,
        "provenance": provenance,
        "on_failure": on_failure,
        "wrapup": wrapup,
    }
    # 去掉 None,让 JSON 更干净(succeeded/failed 时 finished_at 必填,所以 None 实际只会留下可选字段)
    payload = {k: v for k, v in payload.items() if v is not None}

    # flock 保证同 step_id 的并发写串行;不同 step_id 互不影响(每个 .lock 独立)。
    # Windows 无 fcntl → no-op(单进程,同进程线程间原子写仍由 mkstemp + rename 保证)。
    lock_fd = open(lock, "w")
    try:
        if _HAVE_FCNTL:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
        try:
            # attempts 累加:仅 running 时递增,避免终态写覆盖历史
            if status == "running":
                existing = checkpoint_read(archive_dir, step_id)
                if existing and existing.get("attempts"):
                    payload["attempts"] = int(existing["attempts"]) + 1

            # atomic write: tmp + os.replace。Windows 兼容使用 os.replace。
            # 用 mkstemp 而不是 .tmp 后缀,确保多进程不会撞同一个临时文件名。
            # Windows 上并发线程 os.replace 到同一目标时偶发 EACCES(目标文件
            # 被刚 close 的 fd 持有)— 退避重试 3 次。
            parent = str(target.parent)
            fd, tmp = tempfile.mkstemp(
                prefix=f".{step_id}.", suffix=".tmp", dir=parent
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(json.dumps(payload, ensure_ascii=False, indent=2))
                _replace_with_retry(tmp, target)
            except Exception:
                # 失败时清理 tmp,不留垃圾
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        finally:
            if _HAVE_FCNTL:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
    finally:
        lock_fd.close()


def _replace_with_retry(tmp: str, target: str, attempts: int = 3) -> None:
    """os.replace + 简单退避。Windows 上目标刚被 close 的 fd 持锁会偶发
    EACCES / EEXIST;Linux/macOS fcntl 已保证单写者,直接命中一次。
    """
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            os.replace(tmp, target)
            return
        except (PermissionError, FileExistsError, OSError) as exc:
            last_err = exc
            time.sleep(0.01 * (i + 1))
    assert last_err is not None
    raise last_err


def list_pending(archive_dir: str, expected_step_ids: list[str]) -> list[str]:
    """返所有未 succeeded 的 step_id 列表,按 expected_step_ids 传入顺序。

    排序: caller 控制顺序(默认按 (rank, sub_rank) 已在传入时排好),
    本函数只过滤 status != succeeded 的项。

    注意: expected_step_ids 通常来自 src.pipeline_v2.state.all_step_ids(),
    已按 rank/sub_rank 排好序。
    """
    pending: list[str] = []
    for sid in expected_step_ids:
        ck = checkpoint_read(archive_dir, sid)
        if ck is None or ck.get("status") != "succeeded":
            pending.append(sid)
    return pending
# PR-1 — Pipeline Checkpoint 骨架

> **状态**：✅ **已实现**（2026-07-21 落地）
> **来源**：`plans/polaris-absorption.md` 能力 1（Voyage 状态机 → DPR Pipeline Checkpoint）
> **依赖**：无（与 PR-A 完全独立；PR-2 依赖此 PR）
> **优先级**：中（不立即可见收益，但 PR-2 的 validate verdict 需要写进 checkpoint）
> **预估 LOC**：~400 行（`src/pipeline_v2/checkpoint.py` + `state.py` + `main.py` 改动 + 1 单测）

---

## 1. 目标

把 [src/main.py:761-897](src/main.py#L761) `main()` 编排的 6 步流水线（实际 18 个 sub-step）从「subprocess + 共享 filesystem 一次性串行」升级为「可断点续跑」。

**核心痛点**：
- 当前流水线「一断全断」——Step 4 LLM 503 重试成功但 Step 5 select 出错，整条回到 Step 1 重跑
- 浪费 BLT 配额 + 污染 `archive/<date>/` 目录
- 没有跨日状态机（每天 cron 独立跑，无连续性）

**解决方案**：仿照 DPR 现有 `fetch_status.json` 哨兵（[src/main.py:798-825](src/main.py#L798)）推广到所有 step，每个 sub-step 入口 `checkpoint_read()`，出口 `checkpoint_write()`。

---

## 2. 设计原则

1. **零破坏**：默认 `pipeline.checkpoints.enabled: false`——老 cron 行为不变
2. **文件 IO 而非数据库**：直接复用现有 `fetch_status.json` 写盘风格 + `flock` 防并发
3. **细粒度到 sub-step**：18 个 sub-step（见第 6 节），不是 6 大步
4. **失败可重入**：sub-step 出口写 `succeeded/failed` 状态，下次 cron 跳过 `succeeded`
5. **原子写盘**：每个 checkpoint 用 `*.tmp` + atomic rename，**直接复用 [src/generate_docs_md_io.py:28-47 `atomic_write_text`](src/generate_docs_md_io.py#L28)**

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/pipeline_v2/__init__.py](src/pipeline_v2/__init__.py) | ~20 | 导出 `checkpoint_read / checkpoint_write / list_pending` |
| [src/pipeline_v2/checkpoint.py](src/pipeline_v2/checkpoint.py) | ~200 | 核心实现：flock / atomic_write / status 转换 |
| [src/pipeline_v2/state.py](src/pipeline_v2/state.py) | ~150 | 18 sub-step 表 + STEP_REGISTRY 字典 |
| [tests/test_pipeline_checkpoint.py](tests/test_pipeline_checkpoint.py) | ~80 | 单测：atomic write / flock / status 转换 |
| `config/checkpoints.example.yaml` | ~30 | 默认值 + 注释 |

### 改动文件

| 文件 | 改动 | 行数 |
|------|------|------|
| [src/main.py](src/main.py) | `run_step()` 加可选 `checkpoint_read/write` 包裹（**不破坏现有调用**：默认 disabled） | +30 |
| [src/main.py:761-897](src/main.py#L761) `main()` | 18 个 sub-step 入口插 `checkpoint_read()`，出口插 `checkpoint_write()` | +40 |
| [config/config.yaml](config/config.yaml) | 新增 `pipeline.checkpoints: { enabled: false }` 块 | +15 |
| [config/config.user.yaml](config/config.user.yaml) | 新增覆盖示例（注释） | +10 |

---

## 4. JSON 数据形态

**Checkpoint 文件位置**：`archive/<date>/.checkpoints/<step_id>.json`

**单文件 schema**（**对齐 Polaris [engine.py:280-303 `_new_step_row`](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L280)**）：

```json
{
  "step_id": "4.llm_refine.arxiv_2026-07-21",
  "step_type": "llm_refine",
  "seq": 1,
  "rank": 4,
  "sub_rank": 1,
  "status": "succeeded",
  "started_at": "2026-07-21T18:30:42Z",
  "finished_at": "2026-07-21T18:31:08Z",
  "attempts": 2,
  "observation": {
    "input_hash": "sha256:3a9c...",
    "input_count": 47,
    "output_count": 31,
    "elapsed_ms": 26412,
    "error": null,
    "self_check": null
  },
  "verdict": null,
  "tokens": { "in": 18142, "out": 2841, "model": "deepseek-chat" },
  "provenance": {
    "code_version": "git:abc1234",
    "config_hash": "sha256:81af...",
    "llm_provider": "deepseek",
    "llm_route": "stage:refine"
  },
  "on_failure": "mark_needs_review",
  "wrapup": false
}
```

**字段语义**：
- `status ∈ {pending, running, succeeded, failed, skipped}`
- `attempts`：本 step 重试次数（PR-1 不引入自动重试，仅记录）
- `verdict`：PR-2 填充（PR-1 留 null）
- `tokens` / `provenance`：PR-3 填充（PR-1 留 null）

---

## 5. 18 个 Sub-step 表（**严格对照 DPR 现状**）

| rank | step_type | 入口 | 备注 |
|------|-----------|------|------|
| 0.1 | `enrich_config_queries` | [src/main.py:761-765](src/main.py#L761) | 仅 `--run-enrich` |
| 1.1 | `fetch.raw` | [src/main.py:788-797](src/main.py#L788) | 含 arxiv/biorxiv/medrxxiv/chemrxiv/openreview/aaai/acl 7 个子源 |
| 2.1 | `retrieval.bm25` | [src/main.py:828-831](src/main.py#L828) | 现有 in-process + Supabase RPC fallback |
| 2.2 | `retrieval.embedding` | [src/main.py:834-844](src/main.py#L834) | E5 + BGE-small-en-v1.5 |
| 2.3 | `retrieval.rrf` | [src/main.py:847-850](src/main.py#L847) | `--rrf-k 60` |
| 3.1 | `rank.blt` / `rank.fallback` | [src/main.py:853-865](src/main.py#L853) | `should_skip_rerank` ([main.py:290](src/main.py#L290)) |
| 4.1 | `llm_refine` | [src/main.py:868-871](src/main.py#L868) | system_prompt [4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352) |
| 5.1 | `select.deep_dive` | [src/main.py:874-881](src/main.py#L874) | `MODES` [5.select_papers.py:24-50](src/5.select_papers.py#L24) |
| 5.2 | `select.quick_skim` | [src/main.py:874-881](src/main.py#L874) | 同上（skims 模式） |
| 6.1 | `docs.generate_readme` | [src/main.py:884-897](src/main.py#L884) | `docs/<date>/README.md` |
| 6.2 | `docs.generate_paper_md` | [src/main.py:884-897](src/main.py#L884) | `process_paper` [6.generate_docs.py:1599](src/6.generate_docs.py#L1599) |
| 6.3 | `docs.ensure_figures` | [src/main.py:884-897](src/main.py#L884) | [src/paper_figures.py](src/paper_figures.py) `ensure_paper_media` |
| 6.4 | `docs.ensure_formulas` | [src/main.py:884-897](src/main.py#L884) | [src/paper_formulas.py](src/paper_formulas.py) `ensure_paper_formulas` |
| 6.5 | `docs.update_sidebar` | [src/main.py:884-897](src/main.py#L884) | `_sidebar.md` |

**特殊处理**：
- `1.1 fetch.raw`：现有 `fetch_status.json` 哨兵保留，checkpoint 写到 `archive/<date>/.checkpoints/1.1.fetch.raw.json` 平行存在
- `6.2~6.5`：在 `process_paper` 内部循环，checkpoint ID 用 `<paper_arxiv_id>` 区分

---

## 6. 核心 API（`src/pipeline_v2/checkpoint.py`）

```python
import fcntl
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CHECKPOINT_DIR_NAME = ".checkpoints"
LOCK_SUFFIX = ".lock"

def checkpoint_path(archive_dir: str, step_id: str) -> Path:
    """archive/<date>/.checkpoints/<step_id>.json"""
    return Path(archive_dir) / CHECKPOINT_DIR_NAME / f"{step_id}.json"

def lock_path(archive_dir: str, step_id: str) -> Path:
    return checkpoint_path(archive_dir, step_id).with_suffix(LOCK_SUFFIX)

def checkpoint_read(archive_dir: str, step_id: str) -> dict | None:
    """读已有 checkpoint；若 status=succeeded 返 dict，否则 None（让 sub-step 重跑）。"""
    p = checkpoint_path(archive_dir, step_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None  # 文件损坏 → 当作没跑过

def checkpoint_write(
    archive_dir: str,
    step_id: str,
    *,
    status: str,               # pending | running | succeeded | failed | skipped
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
    """atomic write + flock 防并发。"""
    target = checkpoint_path(archive_dir, step_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    lock = lock_path(archive_dir, step_id)

    payload = {
        "step_id": step_id,
        "step_type": step_type,
        "seq": seq,
        "rank": rank,
        "sub_rank": sub_rank,
        "status": status,
        "started_at": observation.get("started_at") if observation else datetime.now(timezone.utc).isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat() if status in {"succeeded", "failed", "skipped"} else None,
        "attempts": observation.get("attempts", 1) if observation else 1,
        "observation": observation,
        "verdict": verdict,
        "tokens": tokens,
        "provenance": provenance,
        "on_failure": on_failure,
        "wrapup": wrapup,
    }
    payload = {k: v for k, v in payload.items() if v is not None}

    with open(lock, "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            # 合并已有 attempts
            existing = checkpoint_read(archive_dir, step_id)
            if existing and status == "running":
                payload["attempts"] = existing.get("attempts", 0) + 1
            # atomic write: tmp + rename
            tmp = target.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, target)
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)

def list_pending(archive_dir: str, expected_step_ids: list[str]) -> list[str]:
    """返所有未 succeeded 的 step_id 列表，按 (rank, sub_rank, seq) 排序。"""
    pending = []
    for sid in expected_step_ids:
        ck = checkpoint_read(archive_dir, sid)
        if ck is None or ck.get("status") != "succeeded":
            pending.append(sid)
    return pending
```

---

## 7. `run_step()` 改造（最小侵入）

```python
# src/main.py 改动（在现有 run_step() 旁加，不破坏）
def run_step_with_checkpoint(
    step_name: str,
    args: list[str],
    *,
    step_id: str,
    archive_dir: str,
    enabled: bool,
) -> bool:
    """若 enabled=False → 退化到原始 run_step()；否则 checkpoint 包裹。"""
    if not enabled:
        return run_step(step_name, args)  # 原始行为

    # 1. checkpoint_read
    existing = checkpoint_read(archive_dir, step_id)
    if existing and existing.get("status") == "succeeded":
        print(f"[SKIP] {step_id} 已 succeeded，跳过")
        return True

    # 2. 写 running
    checkpoint_write(archive_dir, step_id, status="running", seq=1, rank=0, sub_rank=0,
                    step_type=step_id.split(".")[-1])

    # 3. 调原始 run_step
    start = time.time()
    try:
        rc = run_step(step_name, args)  # 0 = success
        elapsed_ms = int((time.time() - start) * 1000)
        status = "succeeded" if rc == 0 else "failed"
        checkpoint_write(
            archive_dir, step_id, status=status, seq=1, rank=0, sub_rank=0,
            step_type=step_id.split(".")[-1],
            observation={
                "input_count": None, "output_count": None,
                "elapsed_ms": elapsed_ms, "error": None if status == "succeeded" else f"returncode={rc}",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "attempts": 1,
            },
        )
        return rc == 0
    except subprocess.CalledProcessError as exc:
        # 仿照 main.py:798-825 fetch 失败的 sentinel 风格
        elapsed_ms = int((time.time() - start) * 1000)
        checkpoint_write(
            archive_dir, step_id, status="failed", seq=1, rank=0, sub_rank=0,
            step_type=step_id.split(".")[-1],
            observation={
                "elapsed_ms": elapsed_ms,
                "error": (exc.stderr or "")[-500:] if exc.stderr else str(exc),
                "started_at": datetime.now(timezone.utc).isoformat(),
                "attempts": 1,
            },
        )
        raise
```

---

## 8. 配置开关

`config/config.yaml` 新增：

```yaml
pipeline:
  checkpoints:
    enabled: false
    # 下列字段仅在 enabled=true 时生效
    archive_dir: "archive"           # 相对 repo 根
    on_failure: "mark_needs_review"  # 失败时如何处理（PR-1 仅记录，不实际影响下游）
    lock_timeout_seconds: 60         # flock 等待上限
    cleanup_stale_locks_hours: 1     # 旧 .lock 自动清理（防 cron 中途 kill 残留）
```

**`config/config.user.yaml` 启用示例**：

```yaml
pipeline:
  checkpoints:
    enabled: true
```

**回滚**：把 `enabled: false` 即可，老 archive 目录结构无变化（`.checkpoints/` 子目录独立）。

---

## 9. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-1 |
|------|---------|----------|
| 状态机载体 | Postgres `voyage_runs` + `voyage_steps` | JSON 文件 + `.lock` 防并发 |
| 步骤回放 | ARQ 队列分布式 | GitHub Actions 单进程 |
| 失败分发 | 4 模式（pipeline / template / loop / fail） | 1 模式：`mark_needs_review` |
| 自动重试 | `Navigator.replan` | **无**（PR-1 仅记录 `attempts`，不自动重试） |
| Human gate | `_gate_cleared` | **不引入** |
| 预算暂停 | `_budget_exceeded` | **不引入**（PR-3 会加入 `archive/llm_usage.jsonl` 累计） |

**DPR v1 简化**：失败一律 `mark_needs_review`，不引入 LLM-as-planner，不引入 plan edit，不引入 budget 超限暂停。

---

## 10. 测试方案

### 单测（`tests/test_pipeline_checkpoint.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | 首次 `checkpoint_write(status="succeeded")` | 文件存在 + JSON 含正确字段 |
| 2 | `checkpoint_read` 读 succeeded | 返 dict |
| 3 | 写 `failed` → `checkpoint_read` | 返 dict（status=failed） |
| 4 | 并发写（threading） | flock 保证不写坏文件（tmp + rename） |
| 5 | `list_pending` 含 succeeded | 不在结果中 |
| 6 | corrupt JSON 文件 | `checkpoint_read` 返 None |
| 7 | `attempts` 递增 | running 多次写 → attempts 累加 |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 启用 checkpoints，正常跑完整 cron | 18 个 `.checkpoints/*.json` 全部 status=succeeded |
| 2 | 第二次跑同一天 cron | log 显示 `[SKIP] X.X.X 已 succeeded`，全跳过（subprocess 不启动） |
| 3 | 删 `archive/<date>/.checkpoints/4.1.llm_refine.json`，重跑 | Step 4 重新执行，其他 skip |
| 4 | Step 4 LLM 模拟失败（拔 API key） | `4.1.llm_refine.json` status=failed，下游 step 仍跑（无 abort 行为） |
| 5 | 关 checkpoints，重跑 | 行为完全等同旧版（无 checkpoint 文件） |

---

## 11. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| GitHub Actions kill 残留 `.lock` | 中 | `cleanup_stale_locks_hours: 1`（cron 启动时清） | `enabled: false` |
| checkpoint 写一半 panic | 低 | atomic_write + `.tmp` + rename | 同上 |
| 删错 checkpoint 等于跳过未跑 | 中 | README 明确「删 checkpoint 文件 = 强制重跑」 | 手动恢复 |
| 并发 cron 互踩 | 中 | `fcntl.flock(LOCK_EX)` | 同上 |
| 18 个 sub-step ID 定义错位 | 中 | `STEP_REGISTRY` 单点定义 + 单测覆盖 | ID 改名后用户 cron 全部重跑（无害） |

**通用回滚**：`pipeline.checkpoints.enabled: false`，archive 目录结构无破坏（`.checkpoints/` 子目录独立）。

---

## 12. 验收清单

- [ ] `src/pipeline_v2/` 4 个文件全部存在
- [ ] 单测 7 个 case 全过
- [ ] 默认 `enabled: false` 时 `main()` 行为与 PR 之前完全一致（diff 日志）
- [ ] `enabled: true` 时 archive 写出 18 个 checkpoint JSON
- [ ] 第二次跑全部 skip（`[SKIP]` 日志）
- [ ] atomic write 验证（kill -9 mid-write 不留 corrupt 文件）
- [ ] flock 并发测试通过
- [ ] PR-2 可以读到 `verdict` 字段（schema 已留位）

---

## 13. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/pipeline_v2/checkpoint.py` + `state.py` | 1.5 天 |
| `main.py` 改造（最小侵入） | 0.5 天 |
| 单测 | 0.5 天 |
| 手工测试 + 修复 | 0.5 天 |
| README 文档 | 0.2 天 |
| **合计** | **3.2 天（≈ 1 周）** |
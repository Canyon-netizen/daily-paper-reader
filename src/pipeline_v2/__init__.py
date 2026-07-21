"""DPR Pipeline v2 — 可断点续跑骨架。

PR-1: 18 个 sub-step 的 checkpoint 状态机骨架（文件 IO + fcntl.flock）。
PR-2: Sextant validate verdict 写入 checkpoint.verdict。
PR-3: LLM usage logger 累计 archive/llm_usage.jsonl,接入 tokens 字段。

设计原则:
- 默认 enabled=False,旧 cron 行为不变(零破坏)
- JSON 文件 + .lock 防并发,模仿现有 fetch_status.json 哨兵
- 每个 sub-step 入口 checkpoint_read → 出口 checkpoint_write

公开 API:
- checkpoint_read / checkpoint_write / list_pending: 文件 IO 三件套
- run_step_with_checkpoint (src/main.py 加的薄壳)
- STEP_REGISTRY (src/pipeline_v2/state.py)
"""

from src.pipeline_v2.checkpoint import (
    CHECKPOINT_DIR_NAME,
    LOCK_SUFFIX,
    checkpoint_path,
    checkpoint_read,
    checkpoint_write,
    list_pending,
    lock_path,
)
from src.pipeline_v2.state import (
    STEP_REGISTRY,
    all_step_ids,
    step_def,
)

__all__ = [
    "CHECKPOINT_DIR_NAME",
    "LOCK_SUFFIX",
    "checkpoint_path",
    "checkpoint_read",
    "checkpoint_write",
    "list_pending",
    "lock_path",
    "STEP_REGISTRY",
    "all_step_ids",
    "step_def",
]
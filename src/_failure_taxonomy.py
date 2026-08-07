"""PR-5 统一 failure taxonomy(plan §5.2)。

七态 failure:
  - execution_error    子进程 / 网络 / LLM 调用失败
  - validation_error   程序成功但产物不满足契约
  - configuration_error  provider / model / credentials / config 缺失
  - artifact_error     文件缺失 / 损坏 / 路径错误
  - budget_exhausted   成本上限触发
  - degraded           产物可用但缺少某项能力
  - not_checked        由于网络或配置未执行某检查

用途:checkpoint / citation verdict / topic debate 等任何表示「这个产物
现在状态如何」的地方,统一用这些字符串。前缀 [kind] 保留(plan §3.3
验收 5)。

调用方应:
  - 写 checkpoint.observation.failure_kind 字段时,从 FAILURE_KINDS 选
  - verdict.reason 形如 "[execution_error] returncode=7"
"""
from __future__ import annotations

EXECUTION_ERROR = "execution_error"
VALIDATION_ERROR = "validation_error"
CONFIGURATION_ERROR = "configuration_error"
ARTIFACT_ERROR = "artifact_error"
BUDGET_EXHAUSTED = "budget_exhausted"
DEGRADED = "degraded"
NOT_CHECKED = "not_checked"

FAILURE_KINDS = frozenset({
    EXECUTION_ERROR,
    VALIDATION_ERROR,
    CONFIGURATION_ERROR,
    ARTIFACT_ERROR,
    BUDGET_EXHAUSTED,
    DEGRADED,
    NOT_CHECKED,
})


def classify_subprocess_error(returncode: int, stderr: str | None) -> str:
    """子进程失败的快速分类。已知 returncode:
      - 1/2: 业务失败 → validation_error(产物不达预期)
      - 127: command not found → configuration_error
      - 137/143: OOM / SIGTERM → execution_error
      - 其他: execution_error 兜底
    """
    if returncode in (127,):
        return CONFIGURATION_ERROR
    if returncode in (137, 143):
        return EXECUTION_ERROR
    if returncode in (1, 2):
        return VALIDATION_ERROR
    return EXECUTION_ERROR


def format_failure_reason(kind: str, detail: str) -> str:
    """把 [kind] detail 拼好。kind 不在 FAILURE_KINDS 返原 detail 不加前缀。

    与 src/validate/__init__.py 内的「[observation.error] ...」格式对齐,
    plan §3.3 验收 5 「统一 actionable reason,保留 [kind] 前缀和实际值」。
    """
    if kind in FAILURE_KINDS:
        return f"[{kind}] {detail}"
    return detail


__all__ = [
    "EXECUTION_ERROR",
    "VALIDATION_ERROR",
    "CONFIGURATION_ERROR",
    "ARTIFACT_ERROR",
    "BUDGET_EXHAUSTED",
    "DEGRADED",
    "NOT_CHECKED",
    "FAILURE_KINDS",
    "classify_subprocess_error",
    "format_failure_reason",
]
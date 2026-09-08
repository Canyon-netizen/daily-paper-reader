"""Python 1:1 mirror of astro-src/lib/types/resource-tier.ts 阈值表。

改阈值时**两边同步**(TS 与 Python),单测覆盖在 tests/test_resource_tier.py。

SYNC WITH: astro-src/lib/types/resource-tier.ts
"""
from __future__ import annotations

import re
from typing import Optional


# ============================================================================
# 数字解析工具(与 TS parseCount / parseParamsCount / parseFlopsCount 一致)
# ============================================================================

_NUM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([kKmMbB]?)")


def parse_count(s: Optional[str]) -> Optional[float]:
    """解析带前缀的数字字符串,如 '7B' / '340M' / '1.5k' / '200' → number."""
    if not s or not isinstance(s, str):
        return None
    m = _NUM_RE.match(s)
    if not m:
        return None
    base = float(m.group(1))
    suffix = m.group(2).lower()
    if suffix == "k":
        return base * 1e3
    if suffix == "m":
        return base * 1e6
    if suffix == "b":
        return base * 1e9
    return base


_PARAMS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([bBmMkK]?)\s*(?:params?|parameters?)?", re.IGNORECASE)
_E_NOTATION_RE = re.compile(r"(\d+(?:\.\d+)?)\s*e\s*\+?(\d+)", re.IGNORECASE)


def parse_params_count(s: Optional[str]) -> Optional[float]:
    """解析 params 字符串,如 '7B' / '340M parameters' → 数字(单位:参数量)。"""
    if not s or not isinstance(s, str):
        return None
    # 先试 E 指数(如 '1.5e9')— 比 _PARAMS_RE 更严格的优先级
    em = _E_NOTATION_RE.match(s)
    if em:
        return float(em.group(1)) * (10 ** int(em.group(2)))
    m = _PARAMS_RE.match(s)
    if m:
        base = float(m.group(1))
        suffix = m.group(2).lower()
        if suffix == "k":
            return base * 1e3
        if suffix == "m":
            return base * 1e6
        if suffix == "b":
            return base * 1e9
        # 无单位默认 M(百万)
        return base * 1e6
    return None


def parse_flops_count(s: Optional[str]) -> Optional[float]:
    """解析 flops 字符串,如 '1.5e23 FLOPs' / '5e22' → 数字。"""
    if not s or not isinstance(s, str):
        return None
    em = _E_NOTATION_RE.match(s)
    if em:
        return float(em.group(1)) * (10 ** int(em.group(2)))
    m = _NUM_RE.match(s)
    if not m:
        return None
    return float(m.group(1))


# ============================================================================
# 兜底文本解析(从论文 tldr / method / abstract 文本中提信号)
# ============================================================================

_PARAMS_TEXT_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*([bBmMkK]?)\s*(?:params?|parameters?|model)",
    re.IGNORECASE,
)
_GPU_HOURS_TEXT_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*([kKmMbB]?)\s*(?:gpu|hours|h\b)",
    re.IGNORECASE,
)


def _parse_params_count_from_text(text: str) -> Optional[float]:
    """从兜底文本中提 params 信号,如 '7B parameters' / 'trained a 340M model'."""
    if not text:
        return None
    m = _PARAMS_TEXT_RE.search(text)
    if not m:
        return None
    base = float(m.group(1))
    suffix = m.group(2).lower()
    if suffix == "k":
        return base * 1e3
    if suffix == "m":
        return base * 1e6
    if suffix == "b":
        return base * 1e9
    return base * 1e6  # 无单位默认 M


def _parse_count_from_text(text: str) -> Optional[float]:
    """从兜底文本中提 gpu_hours 信号,如 'trained for 200 GPU hours'."""
    if not text:
        return None
    m = _GPU_HOURS_TEXT_RE.search(text)
    if not m:
        return None
    base = float(m.group(1))
    suffix = m.group(2).lower()
    if suffix == "k":
        return base * 1e3
    if suffix == "m":
        return base * 1e6
    if suffix == "b":
        return base * 1e9
    return base


def _parse_flops_count_from_text(text: str) -> Optional[float]:
    """从兜底文本中提 flops 信号,如 '1.5e23 FLOPs'."""
    if not text:
        return None
    em = _E_NOTATION_RE.search(text)
    if em:
        return float(em.group(1)) * (10 ** int(em.group(2)))
    return None


# ============================================================================
# 推断函数(1:1 对齐 TS inferResourceTier / inferDataScale)
# ============================================================================

def infer_resource_tier(deep: Optional[dict], text_signals: Optional[str] = None) -> str:
    """从 deep_extract.compute_requirements + 兜底文本推断算力档位。

    决策树(优先级从高到低):
      1. 文本含 'TPU v4/v5/pod' 或 flops >= 1e24  → tpu_pod
      2. gpu_hours >= 10000 或 flops >= 1e23       → cluster
      3. gpu_hours 1000-9999 或 params >= 30B      → multi_gpu
      4. gpu_hours 1-999 或 params 1B-29B          → single_gpu
      5. params < 1B + 文本 API/inference 等       → api_only
         或 gpu_hours 空 + replicability_score >= 4 → api_only
      6. 其它 → unknown

    text_signals: 兜底文本(论文 tldr / motivation / method / result / conclusion /
    context 拼接),用于 deep_extract 缺失时仍能推断。SYNC WITH TS inferResourceTier。
    """
    req = (deep or {}).get("compute_requirements") or {}
    limitations = (deep or {}).get("limitations") or []
    structured_text = " ".join(
        [
            str(req.get("params") or ""),
            str(req.get("gpu_hours") or ""),
            str(req.get("model_size") or ""),
            str(req.get("flops") or ""),
            " ".join(limitations) if isinstance(limitations, list) else str(limitations),
        ]
    ).lower()
    fallback_text = (text_signals or "").lower()
    all_text = f"{structured_text} {fallback_text}"

    params = (
        parse_params_count(req.get("params"))
        or _parse_params_count_from_text(fallback_text)
    )
    gpu_hours = (
        parse_count(req.get("gpu_hours"))
        or _parse_count_from_text(fallback_text)
    )
    flops = (
        parse_flops_count(req.get("flops"))
        or _parse_flops_count_from_text(fallback_text)
    )

    # 1. TPU pod
    if re.search(r"tpu\s*v[45]|tpu\s*pod", all_text):
        return "tpu_pod"
    if flops is not None and flops >= 1e24:
        return "tpu_pod"

    # 2. cluster
    if gpu_hours is not None and gpu_hours >= 10000:
        return "cluster"
    if flops is not None and flops >= 1e23:
        return "cluster"

    # 3. multi_gpu
    if gpu_hours is not None and gpu_hours >= 1000:
        return "multi_gpu"
    if params is not None and params >= 30e9:
        return "multi_gpu"

    # 4. single_gpu
    if gpu_hours is not None and gpu_hours >= 1:
        return "single_gpu"
    if params is not None and params >= 1e9:
        return "single_gpu"

    # 5. api_only
    if re.search(
        r"\b(api|inference|zero-?shot|few-?shot|prompt|gpt-?4|claude|gemini|llm-?as-?a-?service)\b",
        all_text,
        re.IGNORECASE,
    ):
        return "api_only"
    if (
        gpu_hours is None
        and (deep or {}).get("replicability_score") is not None
        and (deep or {}).get("replicability_score") >= 4
    ):
        return "api_only"

    return "unknown"


def infer_data_scale(deep: Optional[dict], text_signals: Optional[str] = None) -> str:
    """从 deep_extract.datasets + 兜底文本推断数据规模。

    text_signals: 兜底文本(同 infer_resource_tier)。
    """
    datasets = (deep or {}).get("datasets") or []
    dataset_parts = []
    for d in datasets:
        if isinstance(d, dict):
            dataset_parts.append(str(d.get("name") or ""))
            dataset_parts.append(str(d.get("size") or ""))
    dataset_text = " ".join(dataset_parts).lower()
    fallback_text = (text_signals or "").lower()
    all_text = f"{dataset_text} {fallback_text}".strip()
    if not all_text:
        return "unknown"

    if re.search(r"web[- ]scale|internet[- ]scale|common\s*crawl|laion|billion\s*images?|trillion", all_text):
        return "web_scale"
    if re.search(r"[>＞]\s*1m|\bmillion\b|\b\d+\s*m\+|1m\+|100k\+|10m\+", all_text):
        return "large"
    # small 必须先于 medium(< 10k 不能被 medium 抢先)
    if re.search(r"[<＜]\s*10k|few\s*thousand|hundred|\d{1,3}\s*sample", all_text):
        return "small"
    if re.search(r"(?<![<＜])\s*10k|thousand|\bk\b(?!ilo)|\d+\s*k\b", all_text):
        return "medium"
    return "unknown"
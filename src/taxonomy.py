"""Paper 4-dim 分类白名单 (task/method/type) — 与 `astro-src/lib/taxonomies.ts` 共用
`config/taxonomies.json`,保持 TS 与 Python 两边白名单单一来源。

venue 维度的白名单由 `src/conference_sidebar.py` + `astro-src/lib/venue.ts` 里的
`CONFERENCE_SOURCE_LABELS` 推导 (source → 'ICML 2025' 风格 label),不在此处出现。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Mapping

TAXONOMY_PATH = Path(__file__).resolve().parents[1] / "config" / "taxonomies.json"

# 加载一次,跨进程复用。重复 json.load 的成本可忽略但避免反复 IO。
with TAXONOMY_PATH.open("r", encoding="utf-8") as _f:
    _TAXONOMIES: Mapping[str, list[str]] = json.load(_f)

TASK_ALLOWLIST: frozenset[str] = frozenset(_TAXONOMIES.get("task", []))
METHOD_ALLOWLIST: frozenset[str] = frozenset(_TAXONOMIES.get("method", []))
TYPE_ALLOWLIST: frozenset[str] = frozenset(_TAXONOMIES.get("type", []))

TASK_ALLOWLIST_RAW: tuple[str, ...] = tuple(_TAXONOMIES.get("task", []))
METHOD_ALLOWLIST_RAW: tuple[str, ...] = tuple(_TAXONOMIES.get("method", []))
TYPE_ALLOWLIST_RAW: tuple[str, ...] = tuple(_TAXONOMIES.get("type", []))

# 旧 query:<label> 字符串 → categories.task (单一映射;不区分大小写)。
# 只覆盖历史 tags 里出现过的项;其余 LLM 自由打。
ALIAS_OLD_TAG_TO_TASK: dict[str, str] = {
    "rl": "rl",
    "llm-agent": "agent",
    "reasoning": "reasoning",
    "gui": "gui",
    "vision": "vision",
    "speech": "speech",
    "game ai": "game-ai",
    "self distillation": "distillation",  # 此项映射到 method 维度,见下
    "mas": "mas",
    "retrieval": "retrieval",
    "code": "code",
    "robotics": "robotics",
    "safety": "safety",
    "knowledge": "knowledge",
}

# 旧 tag → method 维度直迁 (与 ALIAS_OLD_TAG_TO_TASK 并行;命中即转 method:)。
ALIAS_OLD_TAG_TO_METHOD: dict[str, str] = {
    "self distillation": "distillation",
}

# 旧 tag 不再归类的 (历史里出现但本轮不映射;由 LLM 自决):"intervention"


def normalize_category_dim(raw: Iterable[object] | None, dim: str) -> list[str]:
    """对一个 dim 的输入列表做白名单 + 大小写无关 + 去空 + 去重 + 保序。

    `dim` 必须是 'task' / 'method' / 'type'。venue 维度直接放行 (无白名单)。"""
    if dim == "venue":
        if not raw:
            return []
        out: list[str] = []
        seen: set[str] = set()
        for x in raw:
            v = str(x).strip()
            if not v or v in seen:
                continue
            seen.add(v)
            out.append(v)
        return out
    allowlist: frozenset[str]
    if dim == "task":
        allowlist = TASK_ALLOWLIST
    elif dim == "method":
        allowlist = METHOD_ALLOWLIST
    elif dim == "type":
        allowlist = TYPE_ALLOWLIST
    else:
        raise ValueError(f"unknown category dim: {dim!r}")
    if not raw:
        return []
    out = []
    seen = set()
    for x in raw:
        t = str(x).strip().lower()
        if not t or t not in allowlist or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def build_categories(c: Mapping[str, object] | None) -> dict[str, list[str]]:
    """集中 4-dim 拷出 (whitelist-copy);任何 LLM / UI / regen 入口构造
    `categories` 时都走本函数,缺字段立刻在调用处 TypeError-or-default。

    返回的 4 维永远是 list,允许空 list (表示 LLM 也拿不准)。"""
    if c is None:
        c = {}
    return {
        "venue": normalize_category_dim(c.get("venue"), "venue"),  # type: ignore[arg-type]
        "task": normalize_category_dim(c.get("task"), "task"),  # type: ignore[arg-type]
        "method": normalize_category_dim(c.get("method"), "method"),  # type: ignore[arg-type]
        "type": normalize_category_dim(c.get("type"), "type"),  # type: ignore[arg-type]
    }


def categories_to_yaml_inline(c: Mapping[str, list[str]]) -> str:
    """压成单行 flow-style YAML,塞进 frontmatter `categories:` 行内。

    `categories: {venue: ["ICML 2025"], task: ["rl"], method: [], type: ["benchmark"]}`
    这样 Python 手写 frontmatter parser (`_parse_front_matter`) 和 JS yaml.load 都认。
    避免多行 block 写法引入要新加状态的解析。"""
    parts = []
    for dim in ("venue", "task", "method", "type"):
        items = c.get(dim, [])
        if not items:
            parts.append(f'{dim}: []')
            continue
        quoted = ", ".join(f'"{v}"' for v in items)
        parts.append(f"{dim}: [{quoted}]")
    return "{ " + ", ".join(parts) + " }"

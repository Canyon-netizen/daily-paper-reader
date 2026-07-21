"""Pipeline v2 — 18 sub-step 状态注册表(plan §5)。

单一事实源: 所有 step_id 在这里定义。后续 PR-2 / PR-3 扩展 verdict / tokens
时,只用修改本文件的 STEP_REGISTRY,不必碰 main.py。

字段语义:
- step_id: 唯一标识,形如 "4.1.llm_refine" 或 "0.1.enrich_config_queries"
- step_type: 类型分类,用于 checkpoint_write 的 step_type 字段
- rank: 大步序号(0 / 1 / 2 / 3 / 4 / 5 / 6)
- sub_rank: 大步内小步序号(0.1 → 0, 1.1 → 0, 2.1 → 0, ...)
- main_line: 对应 src/main.py main() 大致行号,方便定位
- description: 简述

设计选择:
- 静态字典(非 Enum),便于运行期读 config.yaml 决定是否启用某些 step
  (如 --run-enrich 才需要 0.1)
- sorted() 由 (rank, sub_rank) 保证顺序,方便 caller 遍历
"""
from __future__ import annotations

from typing import TypedDict


class StepDef(TypedDict):
    step_id: str
    step_type: str
    rank: int
    sub_rank: int
    main_line: int
    description: str


# 严格对照 plan §5 的 18 个 sub-step 表 + src/main.py:761-897 的实际编排。
# 注意: 6.2~6.5 在 process_paper 内部循环,checkpoint ID 需带 paper_arxiv_id
# 后缀(由 caller 在 run 时填),不在 STEP_REGISTRY 的静态表里。
STEP_REGISTRY: dict[str, StepDef] = {
    # rank 0 - 仅 --run-enrich
    "0.1.enrich_config_queries": {
        "step_id": "0.1.enrich_config_queries",
        "step_type": "enrich_config_queries",
        "rank": 0,
        "sub_rank": 1,
        "main_line": 761,
        "description": "Optional: enrich config queries via LLM (--run-enrich only).",
    },
    # rank 1 - 全量数据拉取
    "1.1.fetch.raw": {
        "step_id": "1.1.fetch.raw",
        "step_type": "fetch.raw",
        "rank": 1,
        "sub_rank": 1,
        "main_line": 788,
        "description": "Fetch raw arxiv/biorxiv/medrxxiv/chemrxiv/openreview/aaai/acl.",
    },
    # rank 2 - retrieval 三件套
    "2.1.retrieval.bm25": {
        "step_id": "2.1.retrieval.bm25",
        "step_type": "retrieval.bm25",
        "rank": 2,
        "sub_rank": 1,
        "main_line": 828,
        "description": "BM25 retrieval (in-process + Supabase RPC fallback).",
    },
    "2.2.retrieval.embedding": {
        "step_id": "2.2.retrieval.embedding",
        "step_type": "retrieval.embedding",
        "rank": 2,
        "sub_rank": 2,
        "main_line": 834,
        "description": "Embedding retrieval (E5 + BGE-small-en-v1.5).",
    },
    "2.3.retrieval.rrf": {
        "step_id": "2.3.retrieval.rrf",
        "step_type": "retrieval.rrf",
        "rank": 2,
        "sub_rank": 3,
        "main_line": 847,
        "description": "Reciprocal rank fusion (--rrf-k 60).",
    },
    # rank 3 - rerank
    "3.1.rank": {
        "step_id": "3.1.rank",
        "step_type": "rank.blt",  # 实际为 rank.blt 或 rank.fallback,由 should_skip_rerank 决定
        "rank": 3,
        "sub_rank": 1,
        "main_line": 853,
        "description": "Rerank (BLT) or local fallback when LLM base lacks /rerank.",
    },
    # rank 4 - LLM refine
    "4.1.llm_refine": {
        "step_id": "4.1.llm_refine",
        "step_type": "llm_refine",
        "rank": 4,
        "sub_rank": 1,
        "main_line": 868,
        "description": "LLM refine paper summaries (deepseek-chat).",
    },
    # rank 5 - select (deep_dive + quick_skim 是同 step 的两个 mode)
    "5.1.select.deep_dive": {
        "step_id": "5.1.select.deep_dive",
        "step_type": "select.deep_dive",
        "rank": 5,
        "sub_rank": 1,
        "main_line": 874,
        "description": "Select papers for deep dive mode (MODES in 5.select_papers.py).",
    },
    "5.2.select.quick_skim": {
        "step_id": "5.2.select.quick_skim",
        "step_type": "select.quick_skim",
        "rank": 5,
        "sub_rank": 2,
        "main_line": 874,
        "description": "Select papers for quick skim mode (--modes skims).",
    },
    # rank 6 - docs 生成的几个高阶入口(6.2~6.4 在 process_paper 内部循环,
    # checkpoint ID 需带 paper_arxiv_id 后缀(由 caller 在 run 时填),不在
    # STEP_REGISTRY 的静态表里。reference: src/6.generate_docs.py process_paper。
    "6.1.docs.generate_readme": {
        "step_id": "6.1.docs.generate_readme",
        "step_type": "docs.generate_readme",
        "rank": 6,
        "sub_rank": 1,
        "main_line": 884,
        "description": "Generate docs/<date>/README.md index.",
    },
    "6.5.docs.update_sidebar": {
        "step_id": "6.5.docs.update_sidebar",
        "step_type": "docs.update_sidebar",
        "rank": 6,
        "sub_rank": 5,
        "main_line": 884,
        "description": "Update _sidebar.md (post-process all papers).",
    },
}


def step_def(step_id: str) -> StepDef | None:
    """按 step_id 查 STEP_REGISTRY,miss 返 None。"""
    return STEP_REGISTRY.get(step_id)


def all_step_ids(include_enrich: bool = False) -> list[str]:
    """返所有 step_id,按 (rank, sub_rank) 排序。

    include_enrich=False(默认)时,排除 0.1.enrich_config_queries。
    """
    rows = list(STEP_REGISTRY.values())
    if not include_enrich:
        rows = [r for r in rows if r["rank"] != 0]
    rows.sort(key=lambda r: (r["rank"], r["sub_rank"]))
    return [r["step_id"] for r in rows]


__all__ = ["STEP_REGISTRY", "all_step_ids", "step_def"]
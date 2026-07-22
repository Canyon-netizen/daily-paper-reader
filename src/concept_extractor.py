"""PR-5 Concept Backlinks — LLM 概念提取 + 后处理。

核心入口:
  extract_concepts(paper_md, *, config) -> list[dict]

LLM 调用复用 src.llm_router.get_llm_router;测试可注入 mock router。
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple


CATEGORY_ENUM = {
    "method",
    "architecture",
    "methodology",
    "problem",
    "metric",
    "dataset",
    "other",
}


CONCEPT_EXTRACT_SYSTEM_PROMPT = (
    "你是一个学术论文概念提取助手。从论文中提取 3 到 7 个核心概念,输出 JSON。\n"
    "输出 schema(严格 JSON,不要 markdown code block 包裹):\n"
    '{"concepts": [{"name": "显示名", "slug": "kebab-case", '
    '"category": "method|architecture|methodology|problem|metric|dataset|other", '
    '"novelty": 0-1, "centrality": 0-1}]}\n\n'
    "novelty: 这个概念在 2025 年是否是'新提出的'(1=新,0=已有)。\n"
    "centrality: 这个概念在这篇论文里的中心程度(1=核心,0=次要)。\n"
    "category 严格使用 7 个枚举值之一。\n"
    "只输出已有领域概念(如 RAG / LoRA / Diffusion),不要编造新词。\n"
    "slug 字段必须满足 ^[a-z0-9-]+$ (kebab-case)。"
)


def build_concept_prompt(paper_md: str) -> str:
    """包装 paper_md 给 LLM。截断到 8000 chars,避免上下文爆炸。"""
    md = paper_md or ""
    if len(md) > 8000:
        md = md[:8000] + "\n\n...(truncated)..."
    return (
        "请从以下论文 markdown 中提取 3 到 7 个核心概念:\n\n"
        "---\n"
        f"{md}\n"
        "---\n\n"
        "严格输出 JSON,不要解释。"
    )


def _load_yaml_dict(path: str) -> Dict[str, str]:
    """加载 YAML dict;文件不存在/解析失败 → 返回 {}."""
    if not path or not os.path.exists(path):
        return {}
    try:
        import yaml  # type: ignore
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict):
            return {}
        return {str(k): str(v) for k, v in data.items()}
    except Exception:
        return {}


def load_blacklist(config: Optional[Dict[str, Any]] = None) -> set:
    """读 yaml blacklist 文件 → 返回 slug 集合。失败 → 空集合。"""
    cfg = config or {}
    path = cfg.get("blacklist_file") or "config/concept_blacklist.yaml"
    return set(_load_yaml_dict(path).keys())


def load_aliases(config: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """读 yaml aliases 文件 → 返回 {alias_slug: canonical_slug}."""
    cfg = config or {}
    path = cfg.get("aliases_file") or "config/concept_aliases.yaml"
    return _load_yaml_dict(path)


def _clamp01(x: Any) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, v))


def _coerce_concepts(raw: Any) -> List[Dict[str, Any]]:
    """LLM 响应 → list[dict] 形式。容忍 {concepts:[...]} 包装或裸 list。"""
    if raw is None:
        return []
    if isinstance(raw, dict):
        if isinstance(raw.get("concepts"), list):
            raw = raw["concepts"]
        else:
            raw = [raw]
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if isinstance(item, dict):
            out.append(item)
    return out


def postprocess_concepts(
    raw_concepts: List[Dict[str, Any]],
    *,
    blacklist: set,
    aliases: Dict[str, str],
    max_concepts: int = 7,
) -> List[Dict[str, Any]]:
    """后处理管道:slug → blacklist → alias → category 校验 → clamp。

    返回 [{slug, display_name, category, novelty, centrality}, ...] 最多 max_concepts 条。
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for c in raw_concepts:
        slug_raw = c.get("slug") or c.get("name") or ""
        slug = __import__("src.concept_slug", fromlist=["wiki_slug"]).wiki_slug(slug_raw)
        if not slug:
            continue
        # 强制对齐 slug_pattern ^[a-z0-9-]+$：_ 替换为 -,多 - 折叠
        slug = slug.replace("_", "-")
        slug = re.sub(r"-+", "-", slug).strip("-")
        if not slug:
            continue
        if slug in blacklist:
            continue
        slug = aliases.get(slug, slug)
        if slug in seen:
            continue
        seen.add(slug)

        category = str(c.get("category") or "").strip().lower()
        if category not in CATEGORY_ENUM:
            category = "other"

        display_name = str(c.get("name") or c.get("display_name") or slug).strip()

        out.append({
            "slug": slug,
            "display_name": display_name,
            "category": category,
            "novelty": _clamp01(c.get("novelty")),
            "centrality": _clamp01(c.get("centrality")),
        })
        if len(out) >= max_concepts:
            break
    return out


def extract_concepts(
    paper_md: str,
    config: Optional[Dict[str, Any]] = None,
    *,
    router: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """调 LLM 提取 concepts 并后处理。

    router: 可选注入(测试用);None → 走 src.llm_router.get_llm_router。
    LLM 失败 → 返回 []。
    """
    cfg = (config or {}).get("concepts") if isinstance(config, dict) else None
    if cfg is None:
        cfg = {}
    max_concepts = int(cfg.get("max_concepts_per_paper") or 7)

    blacklist = load_blacklist(cfg)
    aliases = load_aliases(cfg)

    prompt = build_concept_prompt(paper_md)
    messages = [
        {"role": "system", "content": CONCEPT_EXTRACT_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    raw_text: Optional[str] = None
    try:
        if router is None:
            from src.llm_router import get_llm_router
            router = get_llm_router(config)
        response = router.call(
            "concept.extract",
            messages=messages,
            response_format={"type": "json_object"},
        )
        # PR-3 router wrapper 把 LLMClient.chat 的内部 dict 包成 OpenAI-style
        # {'choices': [{'message': {'content': ...}}]} 形态(见 src/llm_router.py:118)。
        # 但 .choices 是 dict key,不是 attribute — 必须用 ["choices"] 取。
        # 旧版按 .choices 属性访问 → AttributeError,被本 try/except 吞掉 → 静默返 [],
        # backfill 跑 333 篇 0 概念 —— 根因排查极痛(踩过 3 轮才定位)。
        choices = response["choices"] if isinstance(response, dict) and "choices" in response else None
        if choices:
            raw_text = choices[0]["message"]["content"]
        else:
            raw_text = response.get("content") if isinstance(response, dict) else None
    except Exception:
        return []

    parsed = _parse_json_safely(raw_text)
    raw_list = _coerce_concepts(parsed)
    return postprocess_concepts(
        raw_list,
        blacklist=blacklist,
        aliases=aliases,
        max_concepts=max_concepts,
    )


_JSON_OBJ = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json_safely(text: Optional[str]) -> Any:
    """LLM 输出容忍:直接 json / 包了 ```json fences。失败 → None。"""
    if not text:
        return None
    t = text.strip()
    # strip ```json ... ``` fences
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", t, re.DOTALL)
    if fence:
        t = fence.group(1)
    try:
        return json.loads(t)
    except Exception:
        m = _JSON_OBJ.search(t)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
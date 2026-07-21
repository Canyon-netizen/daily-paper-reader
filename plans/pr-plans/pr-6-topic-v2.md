# PR-6 — Topic v2 辩论 stage（多信号 + Elo 排序）

> **状态**：待开工
> **来源**：`plans/polaris-absorption.md` 能力 5（Idea Forge 多信号 + Elo 辩论 → DPR Topic v2）
> **依赖**：PR-4（用 prompt pack 注入 persona 文本）；与 PR-7 可并行
> **优先级**：低（**计划文档明确建议「暂缓」**：成本高、边际收益需 PR-4 成熟后再评估）
> **预估 LOC**：~1400 行（`src/elo_debate.py` + `src/idea_signals.py` + `astro-src/scripts/topic-search-v2.ts` + 改 `astro-src/pages/topic.astro` + 单测）

---

## 1. 目标

把现有 [astro-src/scripts/topic-search.ts:3](astro-src/scripts/topic-search.ts#L3) 5 阶段 Topic 模式升级为「多信号采集 + Elo 辩论排序」——让「什么研究方向值得深挖」这件事从「LLM 单一排序」升级为「4 信号采集 + pairwise debate」。

**核心痛点**：
- 当前 Topic 模式只做「用 LLM 拆解研究方向 → 找论文 → 出报告」
- **不解决「什么方向值得研究」**——纯 LLM 排序易受训练偏差影响

**解决方案**：仿照 Polaris [E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py) `forge.collect_signals`（4 信号）+ `review.match`（Elo 辩论），**不修改** 现有 [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts)——平级新增 `topic-search-v2.ts`。

---

## 2. 设计原则

1. **零破坏**：`topic.v2.enabled: false` 默认——v1 流程完全不动
2. **不修改 [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts)**：平级新增 [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts)
3. **数据落点 = 文件系统**：`archive/<topic_session_id>/ideas/` + `archive/<topic_session_id>/debate/`（**不引入 Supabase 表**）
4. **Elo 常量完整复刻 Polaris**：K=32 / 初始 1200 / `_TOKENS_PER_MATCH_CALL=16000`
5. **debate_max_ideas: 8** 限制范围——避免 6+ LLM call 成本爆炸

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/elo_debate.py](src/elo_debate.py) | ~200 | Elo 辩论引擎（**对齐 Polaris [actions_ideas.py:968](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L968) `_run_match`**） |
| [src/idea_signals.py](src/idea_signals.py) | ~250 | 4 信号采集（**对齐 Polaris [actions_ideas.py:353](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L353) `forge.collect_signals`**） |
| [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts) | ~500 | Elo 辩论 stage（含 4 signals 客户端采集） |
| [astro-src/pages/topics/<session_id>/debate.astro](astro-src/pages/topics/) | ~150 | 辩论过程可视化页 |
| [tests/test_elo_debate.py](tests/test_elo_debate.py) | ~100 | 单测：Elo 更新公式 + Swiss 配对 + per-match failure isolation |
| [tests/test_idea_signals.py](tests/test_idea_signals.py) | ~100 | 单测：4 信号计算 |

### 改动文件

| 文件 | 改动 |
|------|------|
| [astro-src/pages/topic.astro:176-191](astro-src/pages/topic.astro#L176) | `renderSummaryStage` 后插入 `renderDebateStage`；完成后跳 `renderReportStage` |
| [astro-src/scripts/topic-search.ts:64](astro-src/scripts/topic-search.ts#L64) `SESSION_KEY` | 加 `debate_progress` 字段（**不破坏现有 SESSION_KEY**） |
| [config/config.yaml](config/config.yaml) | 新增 `topic.v2:` 块 |

### 不改文件（明确）

| 文件 | 理由 |
|------|------|
| [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) | **v2 平级新增，不动** |
| [src/main.py](src/main.py) | v2 仅浏览器侧流程，不动 Python 流水线 |

---

## 4. 4 信号采集（**对齐 Polaris `forge.collect_signals` [actions_ideas.py:353](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L353)**）

| 信号 | 采集方式 | 落盘 | Polaris 对应 |
|------|----------|------|--------------|
| **概念共现缺口** (`concept_holes`) | 扫 `wiki/concepts/*.md` 反向链接频次 + `docs/papers/**/concepts` 段，按 slug 配对零共现 | `signals/concept_holes.json` | [actions_ideas.py:287 `_concept_holes`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L287) |
| **趋势速度** (`trends`) | 统计过去 90 天每概念出现频次，按月移动平均排序 | `signals/trends.json` | [actions_ideas.py:320 `_trend_concepts`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L320) |
| **论文 limitations** (`limitations`) | Step 6 提取每篇 `limitations: "..."` frontmatter 段（**PR-5 已加**，无需新加） | 已存在 frontmatter | [actions_ideas.py:338 `_limitation_excerpts`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L338) |
| **综述缺口** (`survey_gap`) | 关键词 `"survey" OR "review"` 检索过去 2 年但无新综述覆盖的概念 | `signals/survey_gaps.json` | [actions_ideas.py:433 `forge.gap_analysis`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L433) |

**严格对齐 Polaris 常量**：
- `_HOLE_TOP_CONCEPTS = 8` → `topic.v2.hole_top_concepts: 8`
- `_HOLE_MAX_PAIRS = 5` → `topic.v2.hole_max_pairs: 5`
- `_TREND_WINDOW_DAYS = 90` → `topic.v2.trend_window_days: 90`
- `_TREND_MAX = 5` → `topic.v2.trend_max: 5`
- `DEFAULT_FORGE_KNOBS["dedup_threshold"] = 0.85` → `topic.v2.dedup_threshold: 0.85`

---

## 5. Elo 辩论引擎（`src/elo_debate.py`）

**完整对齐 Polaris K=32 / 初始 1200 / per-match-failure-isolation 语义**：

```python
ELO_K = 32                # 对齐 Polaris Idea.elo K
ELO_INITIAL = 1200        # 对齐 Polaris Idea.elo 初值
TOKENS_PER_MATCH_CALL = 16000  # 对齐 Polaris _TOKENS_PER_MATCH_CALL

def run_debate(
    ideas: list[dict],
    personas: list[str],
    rounds: int = 3,
    *,
    budget_tokens: int = 800_000,
) -> list[dict]:
    """对 ideas 跑 pairwise debate，更新 elo_rating（Swiss 风格配对，非随机）。

    对齐 [actions_ideas.py:968 _run_match](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L968)
    """
    elo = {i["id"]: ELO_INITIAL for i in ideas}
    sorted_ideas = sorted(ideas, key=lambda i: -elo[i["id"]])

    # Swiss 风格配对（相邻两两配对，非随机）
    pairs = [(sorted_ideas[2*k], sorted_ideas[2*k+1]) for k in range(len(sorted_ideas) // 2)]

    used_tokens = 0
    for a, b in pairs:
        for round_n in range(rounds):
            try:
                winner = judge_debate(a, b, personas, round_n)  # LLM 返 "a"/"b"/"tie"
                used_tokens += TOKENS_PER_MATCH_CALL
                if winner == "tie":
                    continue
                Ra, Rb = elo[a["id"]], elo[b["id"]]
                Ea = 1 / (1 + 10 ** ((Rb - Ra) / 400))
                Eb = 1 - Ea
                if winner == "a":
                    elo[a["id"]] += ELO_K * (1 - Ea)
                    elo[b["id"]] += ELO_K * (0 - Eb)
                else:
                    elo[b["id"]] += ELO_K * (1 - Eb)
                    elo[a["id"]] += ELO_K * (0 - Ea)
            except Exception as e:
                # 对齐 Polaris per-match-failure-isolation: 单 match 失败不 abort
                a.setdefault("debate_errors", []).append({"round": round_n, "error": str(e)})
                continue
            if used_tokens >= budget_tokens:
                break
        if used_tokens >= budget_tokens:
            break

    for i in ideas:
        i["elo_rating"] = elo[i["id"]]
    return sorted(ideas, key=lambda i: i["elo_rating"], reverse=True)
```

### `judge_debate` LLM 调用

**对齐 Polaris `review.match` 3 personas + judge**：

```python
def judge_debate(a: dict, b: dict, personas: list[str], round_n: int) -> str:
    """返 "a" / "b" / "tie"。"""
    router = get_llm_router()
    transcript = "\n".join(
        f"[{p}] {run_match_persona(p, a, b, round_n)}" for p in personas
    )
    response = router.call(
        "topic.debate",
        messages=[
            {"role": "system", "content": "你是中立裁判。基于上面的辩论，决定哪个 idea 更值得研究。返 JSON: {\"winner\": \"a\"|\"b\"|\"tie\", \"reason\": \"<50 字，引用 evidence>\"}"},
            {"role": "user", "content": f"## Idea A\n{a}\n\n## Idea B\n{b}\n\n## 辩论 transcript\n{transcript}"},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)["winner"]
```

---

## 6. Idea 数据形态（`archive/<topic_session_id>/ideas/idea_001.json`）

**对齐 Polaris `ideas` 表字段 `elo_rating, matches, wins`**：

```json
{
  "idea_id": "idea_001",
  "session_id": "topic_2026-07-21_abc",
  "title": "用 RAG + Reflection 缓解 LLM 工具调用幻觉",
  "depth": "sketch",
  "scores": {
    "novelty": 7,
    "feasibility": 8,
    "operability": 6,
    "impact": 7.5,
    "rationale": {
      "novelty": "已有 RAG + Reflection 组合工作但未在工具调用场景",
      "feasibility": "现有 RAG 工具链成熟，Reflection prompt 易实现"
    }
  },
  "elo_rating": 1245,
  "matches": 6,
  "wins": 4,
  "evidence": [
    {"paper_id": "2510.18483v1", "claim": "工具调用幻觉率 23%"},
    {"paper_id": "2410.12345v2", "claim": "Reflection 降低幻觉 8%"}
  ],
  "goal": {
    "explore": "现有 reflection 方法在工具调用场景的有效性",
    "refine": "具体到 multi-turn agent 的 reflection 频次策略"
  },
  "signals": ["concept_holes:RAG×Reflection", "trends:agent-benchmark"],
  "debate_log": "debate/idea_001.json"
}
```

---

## 7. Debate log 样例（`archive/<topic_session_id>/debate/idea_001.json`）

**对齐 Polaris `ReviewSession` shape**：

```json
{
  "idea_id": "idea_001",
  "session_type": "idea_match",
  "matches": [
    {
      "round": 1,
      "match": {"a": "idea_001", "b": "idea_002"},
      "personas": ["方法论者", "工程师", "怀疑论者"],
      "transcript": [
        {"persona": "方法论者", "content": "idea_001 的 reflection 机制缺乏理论保证..."},
        {"persona": "工程师", "content": "从实现角度看 reflection 增加 30% 延迟..."},
        {"persona": "怀疑论者", "content": "idea_001 的 novelty 仅 0.7，已有类似工作..."}
      ],
      "judge": {"winner": "a", "reason": "idea_001 evidence 更强"},
      "elo_delta": {"a": 12, "b": -12}
    }
  ]
}
```

---

## 8. 浏览器侧 stage 流程

**插入位置**：[astro-src/pages/topic.astro:176-191](astro-src/pages/topic.astro#L176) `renderSummaryStage` 后 → `renderDebateStage` → `renderReportStage`

```ts
// astro-src/scripts/topic-search-v2.ts
import { collectSignals } from './idea_signals';
import { runDebate } from './elo_debate';

export async function renderDebateStage(sessionId: string, ideas: Idea[]) {
  // 1. 4 signals 采集
  const signals = await collectSignals(sessionId);

  // 2. 限制前 debate_max_ideas=8 名参与
  const topIdeas = ideas.slice(0, DEBATE_MAX_IDEAS);

  // 3. 跑 Elo 辩论
  const rankedIdeas = await runDebate(topIdeas, PERSONAS, DEBATE_ROUNDS);

  // 4. 可视化：persona 气泡 + 进度条 + Elo 排行榜
  showDebateVisualization(rankedIdeas);

  // 5. 持久化到 localStorage（topic-search.ts:64 SESSION_KEY 加 debate_progress 字段）
  saveDebateProgress(sessionId, rankedIdeas);
}
```

**不修改** 现有 [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) 的 5 阶段——v2 是独立 stage 流程。

---

## 9. 配置示例（`config/config.yaml` 新增）

```yaml
topic:
  v2:
    enabled: false
    elo_k: 32                  # 对齐 ELO_K
    elo_initial: 1200          # 对齐 ELO_INITIAL
    debate_rounds: 3
    debate_max_ideas: 8        # 限制前 8 名参与
    budget_tokens: 800_000      # matches * (2*3+1) * 16000 ≈ 8*7*16000 = 896000
    personas: ["方法论者", "工程师", "怀疑论者"]
    hole_top_concepts: 8       # 对齐 _HOLE_TOP_CONCEPTS
    hole_max_pairs: 5          # 对齐 _HOLE_MAX_PAIRS
    trend_window_days: 90      # 对齐 _TREND_WINDOW_DAYS
    trend_max: 5               # 对齐 _TREND_MAX
    dedup_threshold: 0.85      # 对齐 DEFAULT_FORGE_KNOBS["dedup_threshold"]
```

---

## 10. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-6 |
|------|---------|----------|
| idea 存储 | Postgres `ideas` 表（跨 session 复用） | **`archive/<session_id>/ideas/` 文件系统**（仅本 session） |
| 3 personas | 后端固定（`DEFAULT_PERSONAS`） | **用户在 settings 改**（`topic.v2.personas`） |
| Elo 全局共享 | K=32 / 初始 1200 全局 | **每个 session 独立** |
| Budget 计算 | `matches * (2*rounds+1) * 16_000` | **同样公式**（超 `budget_tokens` 提前结束） |
| per-match-failure-isolation | 是 | **完整复刻** |
| Swiss 配对 | 是 | **完整复刻**（不 random） |
| Idea dedup | `forge.dedup` + embedding | **v1 跳过**（debate_max_ideas: 8 已限流） |

---

## 11. 测试方案

### 单测（`tests/test_elo_debate.py` + `tests/test_idea_signals.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | Elo 更新公式 | K=32, winner 0.8 期望 → +12.x |
| 2 | Swiss 配对 | 4 ideas → 2 pairs（按 elo 排序相邻） |
| 3 | per-match failure isolation | 单 match 抛异常不中断其他 match |
| 4 | Budget 超限提前结束 | 累计 token ≥ budget → 跳出循环 |
| 5 | Tie 不更新 elo | winner="tie" → elo 不变 |
| 6 | `_HOLE_TOP_CONCEPTS = 8` | concept_holes 取 top 8 method + top 8 problem |
| 7 | `_TREND_WINDOW_DAYS = 90` | 90 天前的 concept 不计入 trends |
| 8 | `dedup_threshold = 0.85` | cosine > 0.85 视为重复 |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 关 `topic.v2.enabled`，跑 Topic 模式 | v1 流程完全不变 |
| 2 | 开 `topic.v2.enabled`，输入 "RAG in agent" | 4 signals 采集 + 8 idea 辩论 |
| 3 | LLM judge 失败 1 次 | 该 match 跳过，其他 match 继续 |
| 4 | 辩论结束 | Elo 排行榜渲染 + best idea 高亮 |
| 5 | `debate_max_ideas: 4` | 仅前 4 idea 参与辩论 |
| 6 | localStorage `dpr_topic_session_v1` 含 `debate_progress` 字段 | 刷新页面辩论进度保留 |
| 7 | 跨 session（不同 topic_session_id） | Elo 独立，不共享 |

---

## 12. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| LLM debate 引入 6+ LLM call 成本 | 中 | `debate_max_ideas: 8` 限制 | `enabled: false` |
| 浏览器侧 debate 状态断电丢失 | 中 | `localStorage['dpr_topic_session_v1']` 加 `debate_progress` | N/A |
| LLM judge 偏向「说更多」而非「说得对」 | 低 | rubric 加「reason 必须 < 50 字且引用 evidence」 | 同上 |
| concept_hole O(n²) 配对 | 低 | `wiki/concepts/` 限 ≤200，O(40K) 完全可接受 | N/A |
| localStorage 大小 | 中 | debate transcript 每 match ≤ 2KB | 清旧 session |
| `topic-search.ts` 旧流程受影响 | 低 | **不修改 topic-search.ts**，平级新增 | N/A |

**通用回滚**：`topic.v2.enabled: false`，回退到 v1 流程。

---

## 13. 验收清单

- [ ] `src/elo_debate.py` + `src/idea_signals.py` 全部存在
- [ ] 单测 8 个 case 全过
- [ ] 默认 `topic.v2.enabled: false` 时 v1 流程完全不变
- [ ] 开 `topic.v2.enabled` 后辩论页正确渲染
- [ ] 4 signals 全部采集成功
- [ ] Elo 更新公式与 Polaris 一致
- [ ] per-match failure 不中断其他 match
- [ ] localStorage `debate_progress` 字段持久化
- [ ] **不修改** [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) — diff 验证

---

## 14. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/elo_debate.py` Elo 引擎 | 1.5 天 |
| `src/idea_signals.py` 4 信号 | 2 天 |
| `astro-src/scripts/topic-search-v2.ts` | 3 天 |
| `astro-src/pages/topics/<session_id>/debate.astro` | 1 天 |
| [astro-src/pages/topic.astro:176-191](astro-src/pages/topic.astro#L176) 插入新 stage | 0.5 天 |
| localStorage `debate_progress` 持久化 | 0.5 天 |
| 单测 | 1.5 天 |
| 手工测试 + 修复 | 1 天 |
| **合计** | **11 天（≈ 2.5 周）** |

> **计划文档 TL;DR 第 4 条**：「暂缓 PR-6 —— 成本高、收益对单用户边际、需 PR-4 成熟后再做」。建议 PR-5 落地后跑 1-2 周，评估是否启动此 PR。
> 如果单用户对 Topic 模式辩论没强烈需求，可直接砍掉 PR-6（Polaris 文档明确这是「单用户不必要」的能力）。
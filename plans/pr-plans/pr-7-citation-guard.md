# PR-7 — Citation Guard（Deep Dive 引用核查）

> **状态**：待开工
> **来源**：`plans/polaris-absorption.md` 能力 6（Paper Review 引用核查 → DPR Citation Guard）
> **依赖**：PR-5（需要 concept graph 知道哪些 paper 已被仓库收录过）；PR-3 可独立并行（citation_guard 走 GitHub Actions CLI）
> **优先级**：中（默认 disabled，开了才有收益；与 PR-6 并行可做）
> **预估 LOC**：~900 行（`src/citation_guard.py` + `astro-src/scripts/citation-guard.ts` + 改 `save-paper.yml` + 改 `functions/api/proxy.ts` allow-list + 单测）

---

## 1. 目标

把 Deep Dive 8 章节中 LLM 几乎必然编造的引用标记为「未通过核查」，不阻塞 commit。

**核心痛点**：
- [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) `DEEPDIVE_SYSTEM_PROMPT` 让 LLM 写「## 七、相关工作」段时**几乎必然编造引用**
- 当前 docs 没有任何引用字段（速读 4 段 500-800 字无需核查）
- Deep Dive 8 章节会写大量 `[1] [2]` 这种引用标记，**必须有护栏**

**解决方案**：仿照 Polaris [E:/study/Polaris/src/backend/app/services/paper_review.py](E:/study/Polaris/src/backend/app/services/paper_review.py) `classify_fuzzy_hits` + `check_citation_existence` + `review_passed`，**不引入 LaTeX/CRDT**——只做 markdown 引用核查。

---

## 2. 设计原则

1. **零破坏**：默认 `citation_guard.enabled: false`——Deep Dive 流程不变
2. **CLI 后端为主**：GitHub Actions 跑 `python -m citation_guard <md_path>`，不阻塞 commit
3. **三态存在性分类**（**对齐 Polaris [paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)**）：`exact / minor / fabricated`
4. **`PASS_RATING = 6.0` 对齐 Polaris**：DPR 简化为 `(no fabricated) AND (supported / checked) ≥ 0.6`
5. **`run_support_check: false` 默认关**：避免每个引用多 1 次 LLM call 成本

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/citation_guard.py](src/citation_guard.py) | ~300 | CLI 入口 + 三源核查 + LLM support（可选） |
| [astro-src/scripts/citation-guard.ts](astro-src/scripts/citation-guard.ts) | ~250 | 浏览器侧读 `*.citations.json` + UI 徽章 |
| [astro-src/pages/papers/<id>/citations.astro](astro-src/pages/papers/) | ~100 | 单篇引用核查报告页 |
| [tests/test_citation_guard.py](tests/test_citation_guard.py) | ~150 | 单测：三态分类 + 相似度算法 + LLM support mock |

### 改动文件

| 文件 | 改动 |
|------|------|
| [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) | LLM 产 `cite-of-papers` 后插入 guard hook（仅在 deep_dive 模式 + enabled） |
| [src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599) `process_paper` | 写盘后调 guard（仅在 deep_dive 模式 + enabled） |
| [.github/workflows/save-paper.yml](.github/workflows/save-paper.yml) | 用户保存精读后自动跑 `python -m citation_guard` |
| [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139) | allow-list 加 `api.semanticscholar.org` + `api.openalex.org` |
| [config/config.yaml](config/config.yaml) | 新增 `citation_guard:` 块 |

---

## 4. 数据形态

### `*.citations.json`（**对齐 Polaris [paper_review.py:554-559](E:/study/Polaris/src/backend/app/services/paper_review.py#L554) `review_passed` 字段**）

文件位置：`docs/papers/2026/07/21/2510.18483v1-starbench-rpg.citations.json`

```json
{
  "paper_id": "2510.18483v1",
  "verified_at": "2026-07-21T20:00:00Z",
  "pass": false,
  "pass_rating": 6.0,
  "summary": {
    "total": 7,
    "exact": 5,
    "minor": 1,
    "fabricated": 1,
    "supported": 4,
    "partial": 1,
    "unsupported": 0,
    "not_checked": 2
  },
  "citations": [
    {
      "marker": "[1]",
      "raw_text": "Lewis et al., 2020, Retrieval-Augmented Generation",
      "existence": "exact",
      "support": "supported",
      "match": {
        "source": "library",
        "paper_id": "arxiv:2005.11401",
        "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        "year": 2020,
        "similarity": 1.0,
        "year_tolerance": 0
      },
      "support_reason": "原文引用与 Lewis 2020 论文标题 100% 匹配"
    },
    {
      "marker": "[5]",
      "raw_text": "Smith 2023, A New Method for X",
      "existence": "fabricated",
      "support": "not_checked",
      "match": null,
      "reason": "[existence] S2+OpenAlex+library 三源未找到匹配（最高相似度 0.71 < 0.92 EXACT_SIMILARITY；0.71 < 0.75 MINOR_SIMILARITY；判定 fabricated）"
    }
  ],
  "fabricated_action": "replace_with_question_mark"
}
```

---

## 5. 判定规则（**逐条对齐 Polaris 常量**）

| Polaris 常量 | DPR 落点 | 值 |
|--------------|----------|----|
| `EXACT_SIMILARITY` ([paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)) | `src/citation_guard.py::EXACT_SIMILARITY` | `0.92` |
| `MINOR_SIMILARITY` ([paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)) | `src/citation_guard.py::MINOR_SIMILARITY` | `0.75` |
| `YEAR_TOLERANCE` ([paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)) | `src/citation_guard.py::YEAR_TOLERANCE` | `1` |
| `NUMBER_TOLERANCE` ([paper_review.py:352](E:/study/Polaris/src/backend/app/services/paper_review.py#L352)) | `src/citation_guard.py::NUMBER_TOLERANCE` | `0.01` |
| `MAX_SUPPORT_CHECKS` ([actions_review.py:222](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L222)) | `src/citation_guard.py::MAX_SUPPORT_CHECKS` | `30` |
| `MAX_GUARDRAIL_REGENS` ([paper_review.py:501-540](E:/study/Polaris/src/backend/app/services/paper_review.py#L501)) | `src/citation_guard.py::MAX_GUARDRAIL_REGENS` | `2` |
| `PASS_RATING` ([paper_review.py:554-559](E:/study/Polaris/src/backend/app/services/paper_review.py#L554)) | `src/citation_guard.py::PASS_RATING` | `6.0` |

---

## 6. 判定流程（**对齐 Polaris [paper_review.py:282-320](E:/study/Polaris/src/backend/app/services/paper_review.py#L282) `check_citation_existence`**）

```python
# src/citation_guard.py
EXACT_SIMILARITY = 0.92
MINOR_SIMILARITY = 0.75
YEAR_TOLERANCE = 1
NUMBER_TOLERANCE = 0.01
MAX_SUPPORT_CHECKS = 30
MAX_GUARDRAIL_REGENS = 2
PASS_RATING = 6.0

def check_citation_existence(citation: dict, library_papers: list[dict]) -> tuple[str, dict]:
    """返 (existence, match_info)。"""
    title = citation["title"]
    year = citation.get("year")

    # Step 1 — Library exact match（对齐 Polaris step 1）
    for p in library_papers:
        sim = difflib.SequenceMatcher.ratio(_normalize(title), _normalize(p["title"]))
        if sim >= 0.99 and (year is None or abs(p["year"] - year) <= YEAR_TOLERANCE):
            return "exact", {"source": "library", "paper_id": p["id"], "similarity": sim, "year_tolerance": 0}

    # Step 2 — S2 fuzzy match
    s2_hits = search_semantic_scholar(title, limit=5)
    s2_best = best_match(title, year, s2_hits)
    if s2_best and s2_best["similarity"] >= EXACT_SIMILARITY and abs(s2_best["year"] - year) <= YEAR_TOLERANCE:
        return "exact", {"source": "semantic_scholar", **s2_best}

    # Step 3 — OpenAlex fallback
    oa_hits = search_openalex(title, per_page=5)
    oa_best = best_match(title, year, oa_hits)
    if oa_best and oa_best["similarity"] >= MINOR_SIMILARITY:
        return "minor", {"source": "openalex", **oa_best}

    return "fabricated", None

def review_passed(meta: dict, citation_check: dict) -> bool:
    """对齐 Polaris paper_review.py:554-559"""
    has_fabricated = any(i.get("existence") == "fabricated" for i in citation_check.get("citations") or [])
    if has_fabricated:
        return False
    summary = citation_check.get("summary", {})
    checked = summary.get("supported", 0) + summary.get("partial", 0) + summary.get("unsupported", 0)
    if checked == 0:
        return True  # 没跑 support check 视为通过
    return summary.get("supported", 0) / checked >= PASS_RATING / 10  # 6.0/10 = 0.6
```

---

## 7. CLI 入口

```bash
python -m citation_guard docs/papers/2026/07/21/2510.18483v1-starbench-rpg.md
# 写出 2510.18483v1-starbench-rpg.citations.json
# 若 fabricated > 0，退出码 2（区别于 0=pass / 1=error）
```

### 解析引用

**从 markdown 中提取 `[N]` 标记**：

```python
import re
CITE_PATTERN = re.compile(r"\[(\d+)\]")
CITE_REF_PATTERN = re.compile(r"\[(\d+)\]\s+([^\n]+?)(?:\.\s|\n|$)")

def extract_citations(md_text: str) -> list[dict]:
    """提取 [N] 标记 + 文末的引用列表。"""
    markers = set(int(m) for m in CITE_PATTERN.findall(md_text))
    # 在文末 "## 参考文献" / "## References" / "## 七、相关工作" 段找列表
    ref_section = find_ref_section(md_text)
    refs = []
    for line in ref_section.split("\n"):
        m = re.match(r"\s*\[(\d+)\]\s+(.+?)(?:,\s*(\d{4}))?\s*$", line)
        if m:
            refs.append({"marker": f"[{m.group(1)}]", "title": m.group(2), "year": int(m.group(3)) if m.group(3) else None})
    return refs
```

---

## 8. Fail 行为（v1）

- **把 `fabricated` 引用替换为 `[?]` 占位符**（复用 [src/generate_docs_md_io.py:80-102 `upsert_front_matter_field`](src/generate_docs_md_io.py#L80) + [:109-131 `upsert_auto_block`](src/generate_docs_md_io.py#L109) 在已写盘 md 上修改）
- **在文档顶部加 `> ⚠️ 1 处引用未通过核查（见 *.citations.json）`**
- **浏览器侧可视化用红色徽章显示**
- **不阻塞 commit**（与 Polaris 阻塞 submission 不同）

---

## 9. Sources 选择（DPR 已有 + 新增）

- **`semantic_scholar`**：Polaris 同款 API（`https://api.semanticscholar.org/graph/v1/paper/search?query=...`），DPR 不引入 API key（rate limit 100/分钟够个人用）
- **`openalex`**：polite pool（mailto），同 Polaris
- **`in_library`**：扫 `docs/papers/**/*.md` frontmatter 提取 `paper_id`（**复用 [src/paper_paths.py:166](src/paper_paths.py#L166) `paper_id` 函数**）

**CORS 走 [functions/api/proxy.ts](functions/api/proxy.ts) 端点**——浏览器侧跑时 S2/OpenAlex 走 [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139) allow-list（需要把 `api.semanticscholar.org` + `api.openalex.org` 加入 allow-list）。

---

## 10. `save-paper.yml` 改造

```yaml
# .github/workflows/save-paper.yml 增量
- name: Run citation guard
  if: env.CITATION_GUARD_ENABLED == 'true'
  run: |
    for md in $(git diff --name-only HEAD~1 HEAD -- 'docs/papers/**/*.md'); do
      python -m citation_guard "$md" || echo "[WARN] guard fail: $md"
    done
```

**不阻塞原流程**：guard 失败仅 warn，不改变 save-paper.yml 的成功/失败状态。

---

## 11. 配置示例（`config/config.yaml` 新增）

```yaml
citation_guard:
  enabled: false
  sources: ["semantic_scholar", "openalex", "in_library"]   # 对齐 Polaris 顺序
  fabricated_action: "replace_with_question_mark"            # remove / mark_only
  run_support_check: false                                   # 默认关，省 LLM call
  exact_similarity: 0.92
  minor_similarity: 0.75
  year_tolerance: 1
  pass_rating: 6.0
  max_support_checks: 30
  s2_rate_limit_per_min: 100
  s2_retry_max: 5                                            # 指数退避 1/2/4/8/16s
```

---

## 12. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-7 |
|------|---------|----------|
| 6 步流水线 | 提交前 review（阻塞 submission） | **生成后 audit（不阻塞 commit）** |
| `referees×3` LLM 评审 | 是 | **跳过**（成本太高） |
| `MAX_GUARDRAIL_REGENS = 2` | 是 | **保留**（v1 不主动 regen，仅标记） |
| `meta.rating ≥ 6.0` 评审 score | 是 | **简化为「`supported/checked ≥ 0.6`」** |
| `support` LLM step | 是 | **默认 disabled**（`run_support_check: false`） |
| LaTeX number fact-check | 是（`scan_fact_issues`） | **跳过**（不写 LaTeX） |
| `aggregate_reviews` 加权 | 是 | **不复用**（DPR per-paper） |
| 触发时机 | `review.guardrail` step | **save-paper.yml 自动跑** |

---

## 13. 测试方案

### 单测（`tests/test_citation_guard.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | library exact match | similarity ≥ 0.99 → `exact` |
| 2 | S2 fuzzy match (sim=0.95) | `exact` |
| 3 | OpenAlex fallback (sim=0.80) | `minor` |
| 4 | 三源未命中 (sim=0.71) | `fabricated` |
| 5 | year_tolerance=1（年份差 1） | `exact` |
| 6 | `PASS_RATING = 6.0` 判定 | supported/checked < 0.6 → pass=false |
| 7 | 1 个 fabricated → pass=false | 即便 supported/checked ≥ 0.6 |
| 8 | `_normalize_title` 算法 | lowercase + strip punct |
| 9 | S2 API 429 指数退避 | 第 5 次重试成功 |
| 10 | CLI exit code 2 | fabricated > 0 时返 2 |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 关 `citation_guard.enabled`，跑 Deep Dive | 无 `.citations.json` 写出 |
| 2 | 开 `citation_guard.enabled`，StarBench 精读 | 7 个引用核查，1 个 fabricated |
| 3 | fabricated 引用 `[?]` 替换 | md 文件顶部加 `> ⚠️ 1 处引用未通过核查` |
| 4 | `/papers/2510.18483v1/citations` | 引用核查报告渲染 |
| 5 | S2 API key 删除 | guard 用 OpenAlex 兜底 |
| 6 | OpenAlex 也失败 | 引用 `fabricated`，不阻塞 commit |
| 7 | save-paper.yml 自动跑 | commit message 含 `[citation-guard]` marker |

---

## 14. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| S2 API 限流（429） | 中 | 指数退避（1/2/4/8/16s，最多 5 次） | `enabled: false` |
| 浏览器侧跑暴露 S2 API | 低 | DPR 走 GitHub Actions CLI（即便 S2 公开 API 无 key） | 同上 |
| `minor` 引用（年份差 1）用户体验差 | 低 | `minor` 视为 `exact`（仅 `fabricated` 标红） | N/A |
| `NUMBER_TOLERANCE=0.01` 在 markdown 不适用 | 低 | v1 跳过 number check，仅 existence + support | N/A |
| [functions/api/proxy.ts:43-80](functions/api/proxy.ts#L43) rate limit 30/分钟 | 中 | 默认走 CLI 不走浏览器 | 同上 |
| 7 个能力一起开导致 cron 超时 | 中 | 每个能力独立 enabled 开关 | 逐个关 |

**通用回滚**：`citation_guard.enabled: false`，保留生成的 `*.citations.json` 不删。

---

## 15. 验收清单

- [ ] `src/citation_guard.py` + `astro-src/scripts/citation-guard.ts` 全部存在
- [ ] 单测 10 个 case 全过
- [ ] 默认 `citation_guard.enabled: false` 时 Deep Dive 流程完全不变
- [ ] 开 `citation_guard.enabled` 后 StarBench 精读产出 `*.citations.json`
- [ ] fabricated 引用 `[?]` 替换生效
- [ ] md 顶部警告提示正确显示
- [ ] `/papers/<id>/citations` 报告页渲染
- [ ] `functions/api/proxy.ts` allow-list 加 S2/OpenAlex
- [ ] save-paper.yml 自动跑不阻塞

---

## 16. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/citation_guard.py` CLI + 三源核查 | 2 天 |
| LLM support check（可选，默认关） | 0.5 天 |
| `astro-src/scripts/citation-guard.ts` | 1 天 |
| `astro-src/pages/papers/<id>/citations.astro` | 0.5 天 |
| [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) 插入 guard hook | 0.2 天 |
| [src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599) `process_paper` 调 guard | 0.2 天 |
| `save-paper.yml` 自动跑 | 0.2 天 |
| `functions/api/proxy.ts` allow-list | 0.2 天 |
| `config/config.yaml` 新增 `citation_guard` 块 | 0.1 天 |
| 单测 | 1.5 天 |
| 手工测试 + 修复 | 0.5 天 |
| **合计** | **6.9 天（≈ 2 周）** |
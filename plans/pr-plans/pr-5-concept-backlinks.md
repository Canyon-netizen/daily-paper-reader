# PR-5 — Concept Backlinks v1（字符串匹配版概念图谱）

> **状态**：待开工
> **来源**：`plans/polaris-absorption.md` 能力 4（Research Wiki 概念图谱 → DPR Concept Backlinks）
> **依赖**：PR-4（`doc.generate` 阶段才有 LLM 可调）；PR-7 依赖此 PR（需要 concept graph 知道哪些 paper 已被仓库收录过）
> **优先级**：中（默认 disabled，开了才有收益；用户视角立刻多一个 `/concepts` 页面）
> **预估 LOC**：~1100 行（`src/concept_extractor.py` + `src/concept_index.py` + `astro-src/pages/concepts.astro` + `astro-src/lib/concept_graph.ts` + 改 `src/6.generate_docs.py` + 改 `src/generate_docs_md_io.py` + 单测）

---

## 1. 目标

把「论文 md 之间零关联」升级为「项目级概念图谱」——每篇论文提取核心概念（`RAG`、`LoRA`、`Diffusion Model` 等），建立反向链接，Obsidian / VSCode 可渲染。

**核心痛点**：
- 当前 [src/6.generate_docs.py:1181-1198](src/6.generate_docs.py#L1181) 产出的 `docs/papers/2026/07/21/<id>-<slug>.md` 之间**完全无关联**
- 用户看完一篇不知道下一篇为啥相关
- 没有「概念级」搜索 / 浏览 / 「下一篇该看啥」的引导

**解决方案**：仿照 Polaris [E:/study/Polaris/src/backend/app/services/concepts.py](E:/study/Polaris/src/backend/app/services/concepts.py) `link_all_paper_concepts` + [wiki_compile.py](E:/study/Polaris/src/backend/app/services/wiki_compile.py) `LIBRARIAN_SYSTEM_PROMPT`，但**不引入 Postgres/pgvector**——只用字符串匹配 + slug 等价。

---

## 2. 设计原则

1. **零破坏**：默认 `concepts.enabled: false`——老 md 不变（不追加 `wiki_compiled: true` 字段）
2. **wiki 与 docs 目录分离**：`wiki/concepts/`（项目级沉淀）vs `docs/papers/`（论文笔记）
3. **frontmatter 加 3 个新字段**：`wiki_compiled: bool` + `wiki_compiled_at: ISO` + `concepts: [...]`，**保留 [src/6.generate_docs.py:1181-1198](src/6.generate_docs.py#L1181) 现有 8 字段不动**
4. **`[[wikilink]]` 复用**：直接用 Obsidian 标准 wikilink 语法（**对齐 Polaris [concepts.py:28](E:/study/Polaris/src/backend/app/services/concepts.py#L28) `WIKILINK_RE`**）
5. **v1 不引入 embedding**：仅字符串匹配 + slug 等价；v2 才引入浏览器侧 BGE 算 embedding 写 frontmatter

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/concept_extractor.py](src/concept_extractor.py) | ~150 | Step 6 多调 1 次 LLM 提取 `concepts: [...]` |
| [src/concept_index.py](src/concept_index.py) | ~200 | 扫 `wiki/concepts/*.md` + `docs/papers/**/concepts` 重建反向链接 |
| [src/concept_slug.py](src/concept_slug.py) | ~50 | **完整复用 Polaris [concepts.py:75](E:/study/Polaris/src/backend/app/services/concepts.py#L75) `wiki_slug`** |
| [config/concept_blacklist.yaml](config/concept_blacklist.yaml) | ~30 | 100+ 已知伪概念（防 LLM 编造） |
| [config/concept_aliases.yaml](config/concept_aliases.yaml) | ~30 | `RAG → retrieval-augmented-generation` 等 |
| [astro-src/pages/concepts.astro](astro-src/pages/concepts.astro) | ~300 | 概念网格页 + 单 concept 详情页 |
| [astro-src/lib/concept_graph.ts](astro-src/lib/concept_graph.ts) | ~120 | 客户端 fuzzy search |
| [astro-src/pages/wiki/concepts/](astro-src/pages/wiki/concepts/) | ~50 | 单 concept 渲染模板 |
| [tests/test_concept_extractor.py](tests/test_concept_extractor.py) | ~100 | 单测：slug / alias / blacklist |
| [tests/test_concept_index.py](tests/test_concept_index.py) | ~100 | 单测：反向链接构建 |

### 改动文件

| 文件 | 改动 |
|------|------|
| [src/6.generate_docs.py](src/6.generate_docs.py) | `process_paper` ([src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599)) 写盘后多调 1 次 LLM 提取 concepts + 追加 frontmatter 字段 |
| [src/generate_docs_md_io.py:80-154](src/generate_docs_md_io.py#L80) | `upsert_front_matter_field` 支持新 3 字段 |
| [astro-src/lib/paper.ts](astro-src/lib/paper.ts) | `readPaper` 读 frontmatter 新字段（不破坏老 md） |
| [config/config.yaml](config/config.yaml) | 新增 `concepts:` 块 |
| [config/config.user.yaml](config/config.user.yaml) | 启用示例 |

---

## 4. JSON 数据形态

### 论文 md frontmatter 新字段（**保留现有 8 字段，加 3 个**）

```yaml
---
title: "STARBench RPG: 一项针对检索增强 LLM 的星型多跳推理评测"
title_en: "STARBench RPG: A Star-shaped Multi-hop Reasoning Benchmark for RAG LLMs"
authors: "Lewis et al."
date: "2026-07-21"
generated_at: "2026-07-21T18:30:42Z"
pdf: "https://arxiv.org/pdf/2510.18483v1"
categories: {venue: [], task: [reasoning], method: [rag], type: [benchmark]}
tags: [starbench, rpg, benchmark]

# === 新增字段 (PR-5 启用后追加) ===
wiki_compiled: true
wiki_compiled_at: "2026-07-21T19:00:00Z"
concepts:
  - slug: retrieval-augmented-generation
    display_name: "Retrieval-Augmented Generation (RAG)"
    category: methodology
    novelty: 0.0
    centrality: 0.85
  - slug: multi-hop-reasoning
    display_name: "Multi-hop Reasoning"
    category: problem
    novelty: 0.3
    centrality: 0.7
  - slug: starbench
    display_name: "STARBench RPG"
    category: dataset
    novelty: 0.6
    centrality: 0.9
---
```

### 概念文件样例（`wiki/concepts/retrieval-augmented-generation.md`）

**对齐 Polaris `wiki_export.py` 的 concept frontmatter 字段**：

```markdown
---
concept_id: retrieval-augmented-generation
display_name: Retrieval-Augmented Generation (RAG)
category: methodology
created_at: 2026-07-21
---

# Retrieval-Augmented Generation (RAG)

由 Patrick Lewis et al. (2020) 提出，将"信息检索 + 文本生成"组合，
用外部知识库缓解 LLM 幻觉。

## 出处

- [[2510.18483v1-starbench-rpg]] — STARBench RPG benchmark
- [[2410.12345v2-xxx-yyy]] — ...

## 反向链接

（由 build_concept_index.py 自动生成）

## 邻近概念

- [[knowledge-distillation]] — 都属于"参数化 vs 非参数化记忆"
- [[prompt-engineering]] — 都属于 LLM 适配层
```

---

## 5. 概念提取 Prompt（`src/concept_extractor.py`）

```text
从以下论文中提取 3-7 个核心概念，输出 JSON：
{"concepts": [{"name": "概念显示名", "slug": "kebab-case", "category": "method|architecture|methodology|problem|metric|dataset|other", "novelty": 0-1, "centrality": 0-1}]}

novelty: 这个概念在 2025 年是否是"新提出的"（1=新，0=已有）
centrality: 这个概念在这篇论文里的中心程度

category 严格使用 7 个枚举值（对齐 Polaris concepts.py:250-401 7 类别）。
只输出已有领域概念（如 RAG / LoRA / Diffusion），不要编造。
slug 字段必须满足 ^[a-z0-9-]+$（kebab-case）。
```

---

## 6. 核心实现

### `src/concept_slug.py`（**完整复用 Polaris [concepts.py:75](E:/study/Polaris/src/backend/app/services/concepts.py#L75)**）

```python
import re
import hashlib

def wiki_slug(name: str) -> str:
    """对齐 Polaris wiki_slug: name.lower() + 非 word/非 CJK 字符塌缩为 -，空则回落 sha256(name)[:12]。"""
    lowered = name.lower()
    slug = re.sub(r"[^\w一-鿿-]+", "-", lowered).strip("-")
    if not slug:
        slug = hashlib.sha256(name.encode("utf-8")).hexdigest()[:12]
    return slug
```

### `src/concept_extractor.py`（Step 6 调 LLM）

```python
from src.llm_router import get_llm_router
from src.concept_slug import wiki_slug

CATEGORY_ENUM = {"method", "architecture", "methodology", "problem", "metric", "dataset", "other"}

def extract_concepts(paper_md: str, *, config: dict) -> list[dict]:
    """调 LLM 提取 concepts，返回 [{slug, display_name, category, novelty, centrality}, ...]"""
    router = get_llm_router(config)
    prompt = build_concept_prompt(paper_md)
    response = router.call(
        "concept.extract",   # 新 stage（PR-3 已加 default fallback）
        messages=[
            {"role": "system", "content": CONCEPT_EXTRACT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )
    raw_concepts = json.loads(response.choices[0].message.content)["concepts"]

    # 后处理：slug 规范化 + blacklist 过滤 + alias 合并
    concepts = []
    for c in raw_concepts:
        slug = wiki_slug(c["slug"] or c["name"])
        if slug in BLACKLIST:
            continue
        slug = ALIASES.get(slug, slug)  # RAG → retrieval-augmented-generation
        if c["category"] not in CATEGORY_ENUM:
            c["category"] = "other"
        concepts.append({
            "slug": slug,
            "display_name": c["name"],
            "category": c["category"],
            "novelty": max(0.0, min(1.0, c["novelty"])),
            "centrality": max(0.0, min(1.0, c["centrality"])),
        })
    return concepts[:7]  # 最多 7 个
```

### `src/concept_index.py`（扫 `wiki/concepts/*.md` + `docs/papers/**/concepts`）

```python
def rebuild(archive_dir: str = "wiki") -> None:
    """扫描 docs/papers/**/*.md (frontmatter.concepts 已 wiki 化的)，
    对每个 concept 更新其 wiki/concepts/<slug>.md 的"出处"和"反向链接"段。"""
    papers = scan_papers_with_wiki_compiled()
    concept_to_papers: dict[str, list[dict]] = {}

    for paper in papers:
        for c in paper["concepts"]:
            concept_to_papers.setdefault(c["slug"], []).append(paper)

    for slug, papers in concept_to_papers.items():
        path = f"wiki/concepts/{slug}.md"
        upsert_concept_page(path, papers)
        append_reverse_link(path, papers)

def upsert_concept_page(path: str, papers: list[dict]) -> None:
    """新建或更新 wiki/concepts/<slug>.md 的"出处"和"反向链接"段。
    复用 src/generate_docs_md_io.py:109-131 upsert_auto_block。"""
    # 1. 确保 wiki/concepts/<slug>.md 存在（首次创建时填 frontmatter + 占位）
    # 2. upsert_auto_block(path, "## 出处", "\n".join(f"- [[{p['id']}]] — {p['title']}" for p in papers))
    # 3. upsert_auto_block(path, "## 反向链接", "（自动生成）")
```

---

## 7. `/concepts` 页面（`astro-src/pages/concepts.astro`）

```astro
---
// astro-src/pages/concepts.astro
import Layout from '../layouts/Layout.astro';
import { loadConceptIndex } from '../lib/concept_graph';
const concepts = await loadConceptIndex();  // 读 wiki/concepts/_index.json
---
<Layout>
  <h1>概念图谱</h1>
  <input id="concept-search" placeholder="搜索概念..." />
  <div id="concept-grid">
    {concepts.map(c => (
      <a class="concept-card" href={`/concepts/${c.slug}`}>
        <div class="concept-name">{c.display_name}</div>
        <div class="concept-meta">
          <span class="cat">{c.category}</span>
          <span class="papers">{c.paper_count} 篇论文</span>
        </div>
      </a>
    ))}
  </div>
</Layout>
```

### `astro-src/lib/concept_graph.ts`

```ts
export async function loadConceptIndex(): Promise<ConceptMeta[]> {
  // 读 /wiki/concepts/_index.json (构建期生成)
  const res = await fetch(`${import.meta.env.BASE_URL || '/'}wiki/concepts/_index.json`);
  return res.json();
}

// 客户端 fuzzy search
export function searchConcepts(query: string, all: ConceptMeta[]): ConceptMeta[] {
  const q = query.toLowerCase();
  return all.filter(c =>
    c.display_name.toLowerCase().includes(q) ||
    c.slug.includes(q) ||
    c.category.includes(q)
  );
}
```

**构建期生成 `_index.json`**：新增 `scripts/build-concept-index.mjs`，跑 `astro build` 前生成 `public/wiki/concepts/_index.json`。

---

## 8. 配置示例（`config/config.yaml` 新增）

```yaml
concepts:
  enabled: false
  min_appearances: 2              # 至少在 N 篇出现才建独立 md
  max_concepts_per_paper: 7
  blacklist_file: "config/concept_blacklist.yaml"
  aliases_file: "config/concept_aliases.yaml"
  category_enum:                  # 对齐 Polaris 7 类别
    - method
    - architecture
    - methodology
    - problem
    - metric
    - dataset
    - other
  slug_pattern: "^[a-z0-9-]+$"   # kebab-case 强制
```

---

## 9. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-5 |
|------|---------|----------|
| 概念存储 | Postgres `concepts` 表（Vector(1024)） | **`wiki/concepts/*.md` 文件**（无 pgvector） |
| 嵌入向量 | pgvector 语义匹配 | **v1 无嵌入**（字符串匹配 + slug 等价） |
| `[[concept]]` wikilink | 是 | **复用**（Obsidian 标准） |
| `wiki_slug` 算法 | 是 | **完整复用** |
| `_DEF_BATCH_SIZE = 40` definition LLM | 是 | **跳过**（slug + display_name 已够） |
| 7 个 category | 是 | **完整复用 enum** |
| `Knowledge Graph` MCP tool | 是 | **`wiki/concepts/_graph.json`**（静态 JSON + 客户端渲染） |

---

## 10. 测试方案

### 单测（`tests/test_concept_extractor.py` + `tests/test_concept_index.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | `wiki_slug("RAG")` | "rag" |
| 2 | `wiki_slug("LoRA: Low-Rank Adaptation")` | "lora-low-rank-adaptation" |
| 3 | `wiki_slug("中文概念")` | 保留 CJK 字符 |
| 4 | `wiki_slug("!!!")` | 回落 sha256 12 字符 |
| 5 | blacklist 过滤 | "fakerag" 在 blacklist → 跳过 |
| 6 | alias 合并 | "rag" → "retrieval-augmented-generation" |
| 7 | category 校验 | 7 enum 之外 → "other" |
| 8 | slug pattern 校验 | "RAG_2" → 不通过，slug 改写为 "rag-2" |
| 9 | `concept_index.rebuild()` 后 | `wiki/concepts/rag.md` 有"出处"和"反向链接"段 |
| 10 | `concept_min_appearances: 2` | 仅出现 ≥2 次的概念建独立 md |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 关 `concepts.enabled`，跑 cron | docs 老 md 无变化，无 `wiki_compiled` 字段 |
| 2 | 开 `concepts.enabled`，跑 cron | 每篇 md 加 3 字段；`wiki/concepts/*.md` 创建；`_index.json` 生成 |
| 3 | 浏览器 `/concepts` | 概念网格展示，按"近 30 天热度"排序 |
| 4 | 点单个概念 | 进 `/concepts/rag`，看"出处"和"反向链接" |
| 5 | 浏览器侧 fuzzy search | 输入 "rag" 命中 RAG 概念 |
| 6 | LLM 编造 "FakeRAG" | blacklist 拦截，不写 frontmatter |
| 7 | Taxonomy 升级 | 老 `wiki_compiled: true` md 不破坏 |

---

## 11. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| LLM 编造伪概念 | 高 | `concept_slug_pattern` + `concept_blacklist.yaml` (100+ 词) + `min_appearances: 2` | `enabled: false` |
| 概念碎片化（"RAG" vs "retrieval-augmented generation"） | 中 | `concept_aliases.yaml` | 同上 |
| 文档库爆炸（每概念一 md） | 中 | `concept_min_appearances: 2` | 同上 |
| `docs/_sidebar.md` 不包含 wiki 页面 | 中 | v1 sidebar 顶部加 "Wiki" 折叠区 | N/A |
| Step 6 多 1 次 LLM call 增成本 | 中 | 配置开关默认关 | `enabled: false` |
| 构建期 `build-concept-index.mjs` 失败阻塞 build | 低 | `astro build` 前 try-except，失败用空 index | 手动跑 build script |

**通用回滚**：
- `concepts.enabled: false` → Step 6 跳过概念提取
- 已生成的 `wiki/concepts/*.md` 保留（只是不再被引用）
- 已 wiki 化的 md `wiki_compiled: true` 不清（用户决定）

---

## 12. 验收清单

- [ ] `src/concept_extractor.py` + `src/concept_index.py` + `src/concept_slug.py` 全部存在
- [ ] `wiki/concepts/_index.json` 构建期正确生成
- [ ] 单测 10 个 case 全过
- [ ] 默认 `concepts.enabled: false` 时 docs 老 md 无变化
- [ ] 开 `concepts.enabled` 后 5 篇新 md 加 3 字段
- [ ] `/concepts` 页面展示概念网格
- [ ] 点单个概念进 `/concepts/<slug>` 看"出处"+"反向链接"
- [ ] LLM 编造伪概念被 blacklist 拦截
- [ ] **现有 8 字段 frontmatter 不动**（保留兼容性）

---

## 13. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/concept_slug.py` | 0.2 天 |
| `src/concept_extractor.py` + LLM prompt | 0.5 天 |
| `src/concept_index.py` 反向链接构建 | 1 天 |
| `src/6.generate_docs.py` 多调 1 次 LLM + 写 frontmatter | 0.5 天 |
| `src/generate_docs_md_io.py` 支持 3 新字段 | 0.3 天 |
| `config/concept_blacklist.yaml` (100+ 词) | 0.5 天 |
| `config/concept_aliases.yaml` | 0.3 天 |
| `astro-src/pages/concepts.astro` | 1 天 |
| `astro-src/lib/concept_graph.ts` | 0.5 天 |
| `astro-src/pages/wiki/concepts/<slug>.astro` | 0.5 天 |
| `scripts/build-concept-index.mjs` 构建期 | 0.5 天 |
| `docs/_sidebar.md` 加 "Wiki" 折叠区 | 0.2 天 |
| 单测 | 1 天 |
| 手工测试 + 修复 | 0.5 天 |
| **合计** | **7.5 天（≈ 2 周）** |
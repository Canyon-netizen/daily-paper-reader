# Concepts System / 概念系统

本文档描述 DPR (Daily Paper Reader) 的概念系统，对照 Polaris [`docs/wiki-and-concepts.md`](../../Polaris/docs/wiki-and-concepts.md)。

DPR 文献库架构权威文档：[`docs/library-architecture.md`](library-architecture.md)。本文档只讲概念 (concept) 子系统怎么落地，文献库三层抽象请去那边看。

---

## 1. Overview / 概述

DPR 的概念系统与 Polaris 有本质差异：

| 维度 | Polaris | DPR 当前状态 |
|------|---------|--------------|
| 存储位置 | Postgres `concepts` 表 + `paper_concepts` 关联表 | 文件系统 `public/wiki/concepts/*.md`（构建期拷贝） |
| 概念唯一性 | 全局 `slug` 唯一 (`uq_concepts_slug`)，无 `library_id` | 文件名 = slug，靠人不出错 |
| 创建时机 | Wiki 编译时 LLM 标记 `[[name]]` → `extract_wikilinks()` 提取 → 候选 → 2 篇阈值晋升 | **`src/6.generate_docs.py` 离线 LLM 抽取 `concepts:` 段，写到 paper frontmatter**；`astro-src/lib/concepts-index.ts` SSR 时从所有论文 frontmatter 聚合 |
| 状态机 | `candidate` → `active` / `rejected`（数据库字段） | **无状态机字段**，所有现存概念等价于 Polaris 的 `active`；无 rejected 概念 |
| 定义 | `concepts.definition` LLM 一次性写，所有引用共享 | 分散在每个 `.md` 文件正文，重复定义分散 |

DPR 是 **wiki-as-document** 模式（概念文件 = markdown 文件），不是 Polaris 的 **wiki-as-data** 模式（概念 = 数据库行）。

---

## 2. Candidate Gate / 候选门控

### Polaris 机制

Polaris 的概念候选门控（[`wiki-and-concepts.md` §2.1.1](../../Polaris/docs/wiki-and-concepts.md#21-the-gate-two-papers-then-a-verdict)）：

1. **阈值过滤（确定性）**：概念保持 `candidate` 状态直到被 **≥2 篇不同论文** 引用（`CONCEPT_PROMOTION_MIN_PAPERS = 2`）
2. **有效性判定（LLM）**：达到阈值后，触发 `extract` 阶段判断是否为有意义的学术概念
3. **状态流转**：`candidate` → `active` 或 `rejected`

### DPR 当前状态

**DPR 无显式候选门控**。`public/wiki/concepts/` 下的概念文件是**离线 LLM 抽取的产物** + **人工增删**：

- LLM 抽取：`src/6.generate_docs.py` 在生成速读时调用 LLM 给出概念列表，写到 `docs/papers/<id>-<slug>.md` 的 frontmatter `concepts:` 字段。
- 人工增删：直接 commit `.md` 文件到 `public/wiki/concepts/`（git 友好）。
- SSR 索引：`astro-src/lib/concepts-index.ts:buildConceptIndex()` 扫描 `docs/papers/**/*.md` 的 `concepts:` 段，派生 `bySlug` + `relatedBySlug`（co-occurrence）。

**对照 Polaris 缺什么**：

- 无 `candidate` / `active` / `rejected` 字段 —— 任何被 LLM 提到或人手动加的概念都"全开"。
- 无 2 篇阈值 —— 一个概念被一篇论文提到就被收录（co-occurrence 0 也照收录）。
- 无 LLM 有效性判定 —— `category` 字段虽是 LLM 给的，但没"这个值不算真概念"的二次判定。

> 这些缺失是有意的 —— DPR 是单人站，误收录的代价远小于"好概念被门控卡掉"的代价。

---

## 3. Shared Definitions / 共享定义

### Polaris 机制

Polaris 的定义是**集中存储在 `concepts.definition`** 字段，由 LLM 在晋升时一次性写入，后续所有引用该概念的论文共享同一份定义。

```sql
-- Polaris 概念表 (简化)
SELECT name, definition, category, status FROM concepts;
```

### DPR 当前状态

DPR 的概念定义**分散在各 `.md` 文件的正文**，没有"共享一份"的概念：

```markdown
---
concept_id: retrieval-augmented-generation
display_name: Retrieval-Augmented Generation
category: methodology
---

# Retrieval-Augmented Generation (RAG)

由 Patrick Lewis et al. (2020) 提出...

## 出处
- [[papers/...]]
```

每个概念文件独立管理。Polaris 的"晋升时一次性写、所有人引用同一份"语义在 DPR 中由 markdown 文件本体承担 —— 改一个文件，所有引用它的 `[[concept-name]]` 解析到同一文件，等价共享。

---

## 4. 7 Categories / 七类别

Polaris 定义了 7 个固定类别（[`wiki-and-concepts.md` §2.2](../../Polaris/docs/wiki-and-concepts.md#22-definitions-batched-on-the-small-model)）：

| Category | 含义 | 示例 |
|----------|------|------|
| `method` | 具体方法、技术 | LoRA, Chain-of-Thought |
| `architecture` | 模型/系统架构 | Transformer, Diffusion Model |
| `methodology` | 方法论、研究范式 | Retrieval-Augmented Generation |
| `problem` | 研究问题、任务 | Continual Learning, OOD Generalization |
| `metric` | 评估指标 | FID, BLEU, Inception Score |
| `dataset` | 数据集 | ImageNet, COCO, RT-1 |
| `other` | 不属于上述任何类别的杂项 | — |

### DPR 落地情况

**类别枚举已落地但未编码为 TypeScript 常量**：

- `public/wiki/concepts/` 下 140+ 概念文件均在 frontmatter 声明 `category`，值落在 7 类别之一。
- `astro-src/lib/types/concept.ts` 的 `ConceptRef.category: string`（自由 string，未枚举）。
- 没有 `CONCEPT_CATEGORIES` 常量或 `ConceptCategory` 类型别名 —— Polaris 用 `normalize_category()` 强制夹紧到 7 值，DPR 依赖 LLM 输出自觉。

如果未来要严格化：照 Polaris 引入 `normalize_category()` 到 `astro-src/lib/concepts-index.ts`，不在枚举内的归 `other`；同时把 `ConceptRef.category` 类型从 `string` 改成 `'method' | 'architecture' | ...`。

---

## 5. concept-erasure.md / Wiki-as-Doc 模式

### 文件位置

`public/wiki/concepts/concept-erasure.md`

### 内容

```markdown
---
concept_id: concept-erasure
display_name: MANCE: Manifold Aware Concept Erasure
category: problem
---

# MANCE: Manifold Aware Concept Erasure

## 出处
- [[papers/2607.03973v1-mance-manifold-aware-concept-erasure]]
- [[papers/2607.14521v1-uni-adavd-universal-concept-erasure-for-visual-generation-via-orthogonal-value-decomposition]]

## 反向链接
(自动生成)
- [[papers/2607.03973v1-mance-manifold-aware-concept-erasure]]
- [[papers/2607.14521v1-uni-adavd-universal-concept-erasure-for-visual-generation-via-orthogonal-value-decomposition]]
```

### Wiki-as-Data vs Wiki-as-Doc

| 维度 | Polaris (wiki-as-data) | DPR (wiki-as-doc) |
|------|----------------------|-------------------|
| Wiki 存储 | `paper_wikis.content` (Markdown 文本) | 概念页面本身就是 `.md` 文件 |
| `wiki_content` 字段 | `Concept.wiki_content` 列存在但**无写入**（Polaris 自己的死代码） | 不存在此字段 |
| 数据载体 | Postgres 表 | 文件系统 |
| 优势 | 支持 SQL 查询、关联计算 | 人类可读、版本友好 (Git) |
| 劣势 | 需要 DB、迁移复杂 | 无法做跨文件语义检索 |

**结论**：DPR 当前是 **wiki-as-document** 模式。每个概念是一个独立 `.md` 文件，类似 Obsidian vault。Polaris 的 `wiki_content` 列（为未来长文概念页面预留）在 DPR 中无对应实现 —— 不需要，因为整个文件就是 wiki。

---

## 6. Cross-Library Sharing / 跨库共享

### Polaris 机制

- 概念属于**平台**，不属于任何 library
- 「这个 library 有哪些概念」是**派生查询**：`paper_concepts � library_papers`
- `[[wikilink]]` 在 library 内解析时只搜索该 library 的派生概念集

### DPR 当前状态

**DPR 无 library-scoped 概念过滤**。所有概念文件位于 `public/wiki/concepts/` 全局目录：

- `astro-src/lib/libraries.ts` 的 `selectLibraryPapers(items, lib)` 拉成员 → 成员 frontmatter `concepts:` 段 → 收集 slug → 与全局概念索引求交。**结果天然是子集**，无需专门 SQL 风格的派生查询。
- 库内 `[[wikilink]]` 解析：`astro-src/lib/markdown/inline.ts` 用全局 `bySlug` 映射（`astro-src/lib/concepts-index.ts` 输出），没有按 library 范围裁剪。
- 库的概念图谱：`astro-src/lib/library/graph.ts` 用同样的全局索引做节点 + 同库论文 co-occurrence 做边。

**对照 Polaris 的偏差**：Polaris 的 `usePoolConceptNav()` 在 daily feed / 个人图书馆 / reader / shelf 这些无 library 上下文处使用全局概念；DPR 永远走全局，没有 "library context" 概念 —— 这与 DPR 单用户 + 库共享 docs/papers/ 的现实一致。

---

## 7. Style Conventions / 风格约定

`wiki/concepts/` 目录遵循以下约定：

1. **目录结构**：
   ```
   wiki/
   └── concepts/
       ├── README.md           # 本文件
       ├── ghost-concept.md    # 占位 stub
       └── <concept-slug>.md   # 各概念文件（实际数据在 public/wiki/concepts/，本目录只放说明性文档）
   ```

2. **文件名**：`kebab-case`，与 `concept_id` / `slug` 一致

3. **Frontmatter 必填字段**：
   ```yaml
   ---
   concept_id: <slug>
   display_name: <显示名>
   category: <7 类别之一>
   ---
   ```

4. **正文结构**（推荐）：
   - H1 标题：`# <display_name>`
   - 可选：`## 定义` / `## 出处` / `## 反向链接`
   - 使用 `[[wikilink]]` 链接其他概念或论文

5. **`wiki/` 与 `public/wiki/` 的区别**：
   - `wiki/`：人读文档目录（git tracked），不参与 build
   - `public/wiki/concepts/`：构建期拷贝到 dist 的实际概念数据（git tracked，作为内容源）
   - DPR 的概念数据**真值**在 `public/wiki/concepts/*.md`；`wiki/` 只是元说明。

---

## 8. 待完成事项（与 Polaris 对照）

| 事项 | 对应 Polaris 能力 | 优先级 | 备注 |
|------|------------------|--------|------|
| 候选门控（candidate → active/rejected + 2 篇阈值） | `promote_ready_concepts()` | P2 | DPR 单人站不做也行；做了能减少低质量概念 |
| 类别枚举 + `normalize_category()` | `normalize_category()` | P2 | 写 `CONCEPT_CATEGORIES` 常量 + 类型别名 |
| 反向链接自动生成脚本 | `link_all_paper_concepts()` | P2 | build 时遍历论文 frontmatter `concepts:`，反写回每个概念文件的 `## 反向链接` |
| 孤立概念清理 | `delete_orphan_concepts()` | P3 | DPR 没 candidate/active 字段，"孤立"无明确定义 |
| 概念 embedding 语义检索 | pgvector ANN | 不做 | DPR 是静态站 + frontmatter 全文检索 |

---

## 9. 参考资料

- Polaris 原始文档：[`E:/study/Polaris/docs/wiki-and-concepts.md`](../../Polaris/docs/wiki-and-concepts.md)
- DPR 现有概念数据：`public/wiki/concepts/`（git tracked，构建期拷贝）
- DPR 占位 stub：`wiki/concepts/ghost-concept.md`（gitignored 目录里的说明文件，不入库）
- DPR 概念索引构建：`astro-src/lib/concepts-index.ts`
- DPR 概念类型：`astro-src/lib/types/concept.ts`
- Polaris 概念服务：`E:/study/Polaris/src/backend/app/services/concepts.py`
- Polaris Wiki 编译：`E:/study/Polaris/src/backend/app/services/wiki_compile.py`

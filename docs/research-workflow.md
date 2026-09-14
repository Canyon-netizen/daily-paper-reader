# Research Workflow Modules

The DPR platform provides a complete research lifecycle management system with three interconnected modules: Ideas, Experiments, and Writing.

## Architecture Overview

```
                    ┌─────────────┐
                    │   Ideas     │
                    │  (种子想法) │
                    └──────┬──────┘
                           │
                           v
                    ┌─────────────┐
                    │ Experiments │
                    │  (实验设计) │
                    └──────┬──────┘
                           │
                           v
                    ┌─────────────┐
                    │  Writing   │
                    │  (输出沉淀) │
                    └─────────────┘
```

## 1. Ideas Module

**Location:** `/ideas/` and `/ideas/[id]/`

**Purpose:** Capture and manage research ideas with structured metadata.

**Features:**
- Title (English + Chinese)
- Hypothesis formulation
- Related papers (arXiv IDs)
- Tags for categorization
- Creation/update timestamps

**Data Storage:** localStorage (client-side only)

**Entry Points:**
- `/ideas/` - List all ideas
- `/ideas/[id]/` - View/edit specific idea

**Example Files:**
- `docs/ideas/transformer-attention-scaling.md`
- `docs/ideas/context-window-extension.md`
- `docs/ideas/contrastive-sentence-embeddings.md`

## 2. Experiments Module

**Location:** `/experiments/` and `/experiments/[id]/`

**Purpose:** Design and track experimental validation of ideas.

**Features:**
- Hypothesis with bilingual support
- Method description
- Variable design (independent, dependent, controlled)
- Expected vs actual results
- Status tracking (planning, running, completed, failed, paused)
- Related papers and ideas linkage

**Data Storage:** localStorage (client-side only)

**Entry Points:**
- `/experiments/` - List all experiments
- `/experiments/[id]/` - View/edit specific experiment

**Example Files:**
- `docs/experiments/ablation-llm-scale.md`
- `docs/experiments/model-comparison-gpt4o-vs-sonnet.md`
- `docs/experiments/user-study-rag-accuracy.md`

## 3. Writing Module

**Location:** `/writing/` and `/writing/[id]/`

**Purpose:** Document and publish research outputs (papers, proposals, workshop notes).

**Features:**
- Section-based editing
- Citation management
- Full draft view
- Bilingual content support

**Data Storage:** localStorage (client-side only)

**Entry Points:**
- `/writing/` - List all writings
- `/writing/[id]/` - View/edit specific writing

**Example Files:**
- `docs/writing/scaling-laws-workshop.md`
- `docs/writing/transformer-attention-explained.md`
- `docs/writing/multimodal-efficiency-proposal.md`

## Implementation Details

### Static Site Generation

All three modules use `getStaticPaths` to pre-generate pages from known IDs in `docs/`:
- Experiments: 5 entries
- Ideas: 5 entries  
- Writing: 3 entries

### Client-Side Hydration

The pages render a static shell server-side, then hydrate with interactive UI via localStorage. This enables:
- Offline editing
- No server-side database required
- User-specific data persistence

### Cross-Module Linking

Each module supports references to others:
- Ideas can link to related papers (arXiv IDs)
- Experiments can link to ideas and papers
- Writings can cite papers and reference experiments

## 4. Search Module (Iter2)

**Location:** `/search/`

**Purpose:** Cross-module unified search across ideas, experiments, writings, and roadmaps.

**Features:**
- Real-time search with build-time index + runtime localStorage data
- Module filters (全部/想法/实验/写作/路线图)
- Result grouping by module
- Highlighted matches in title, description, tags, and content
- URL-based query state for sharing searches

**Data Sources:**
- Build-time: `/public/search-index.json` (generated at build)
- Runtime: localStorage (user-created content)

**Entry Points:**
- `/search/` - Full search interface
- `/search/?q=keyword` - Pre-filled search
- `/search/?q=keyword&module=ideas` - Filtered search

## 5. Research Dashboard (Iter2)

**Location:** `/research/`

**Purpose:** Unified view of all research activities with statistics and recent items.

**Features:**
- Stats summary (total ideas, running experiments, drafts, current quarter)
- Active ideas list (status: active)
- Running experiments list (status: running)
- Draft writings list (status: draft)
- Current quarter goals from roadmaps
- Status color coding and labels

**Data Aggregation:**
- Server-side: SSR with getStaticPaths pre-generation
- Client-side: localStorage aggregation via `lib/research/index.ts`

**Entry Points:**
- `/research/` - Full dashboard
- Navbar: "研究" link
- Home page: Dashboard link button

## 6. Export & Templates (Iter2)

### Export Features
- **Experiments:** Export as JSON
- **Writing:** Export as Markdown and PDF (print styles)

### Templates

**Experiment Templates:**
- Ablation Study
- Hyperparameter Sweep
- User Study
- A/B Test

**Writing Templates:**
- Workshop Paper
- Blog Post
- Research Proposal

## Technical Stack

- **Framework:** Astro (static site generation)
- **Storage:** localStorage (client-side)
- **Styling:** Component-scoped CSS
- **Routing:** Dynamic routes with static path generation
- **Search Index:** Build-time generated JSON + runtime localStorage merge

## Build Integration

### Search Index Generation
- Script: `scripts/build-search-index.mjs`
- Runs at build time via `prebuild` hook
- Outputs to `public/search-index.json`

### Path Generation
- Script: `scripts/generate-paths.mjs`
- Generates `lib/paths.generated.ts`
- Used for getStaticPaths in dynamic routes

## Future Enhancements

1. **Sync Backend:** Add optional server-side sync for cross-device access
2. **Collaboration:** Share experiments/ideas with other researchers
3. **Metrics:** Track idea-to-paper conversion rates
4. **Advanced Search:** Full-text search with relevance scoring
5. **Dashboard Customization:** User-configurable widgets

## 关联技能文档

本总览是「**架构图**」,不重复讲方法论。所有阶段对应的「**怎么读 / 怎么设计 / 怎么写**」细节在 [`docs/research-skills/`](research-skills/) 下:

| 阶段 | 详细方法论 |
|------|------------|
| 0. 方向定位(怎么写研究问题) | [`research-skills/defining-research-question.md`](research-skills/defining-research-question.md) |
| 1. 文献检索(怎么做综述) | [`research-skills/how-to-lit-review.md`](research-skills/how-to-lit-review.md) |
| 2. 论文速读(怎么读一篇 paper) | [`research-skills/how-to-read-paper.md`](research-skills/how-to-read-paper.md) |
| 3. 实验设计 | [`research-skills/experiment-design.md`](research-skills/experiment-design.md) |
| 4. 论文写作 | [`research-skills/writing-paper.md`](research-skills/writing-paper.md) |
| 5. 审稿应对(rebuttal) | [`research-skills/writing-rebuttal.md`](research-skills/writing-rebuttal.md) |
| 6. 同行审稿 + mindset | [`research-skills/writing-review.md`](research-skills/writing-review.md) + [`reviewer-mindset.md`](research-skills/reviewer-mindset.md) |

**索引页**:`docs/research-skills/README.md`(阶段映射 + 工具配合表)。

闭环设计见 [`docs/agents-workflow.md`](agents-workflow.md)(3 智能体 Designer → Feedback → Gate → Modifier + pipeline 7 stage),agents 在每阶段会消费对应的 skill 文档作为 prompt 上下文。

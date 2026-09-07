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

## Technical Stack

- **Framework:** Astro (static site generation)
- **Storage:** localStorage (client-side)
- **Styling:** Component-scoped CSS
- **Routing:** Dynamic routes with static path generation

## Future Enhancements

1. **Sync Backend:** Add optional server-side sync for cross-device access
2. **Export Formats:** PDF/Markdown export for writings
3. **Collaboration:** Share experiments/ideas with other researchers
4. **Metrics:** Track idea-to-paper conversion rates
5. **Templates:** Pre-built experiment/writing templates

# Unified Design Document — DPR Research Modules

> Version: 1.0 | Date: 2026-09-07
> Synthesized from: design-ui.md, design-data.md, design-integration.md, design-journeys.md

---

## 1. Resolution of Conflicts

### 1.1 Status Enum Conflicts

| Module | design-ui.md | design-data.md | **Resolution** |
|--------|--------------|----------------|----------------|
| Idea | `draft`, `active`, `promoted`, `archived` | `seed`, `growing`, `mature` | **Use design-ui**: `draft` → `active` → `promoted` → `archived` (clearer lifecycle) |
| Experiment | `running`, `completed`, `failed` | `planned`, `running`, `done`, `blocked` | **Use design-data**: `planned` → `running` → `done` / `failed` (includes blocked) |
| Writing | `draft`, `review`, `published` | `draft`, `review`, `final` | **Use design-data**: `draft` → `review` → `final` (aligns with export) |

### 1.2 Writing Type Conflict

- **design-ui**: `paper`, `section`, `note`, `review`, `translation`
- **design-data**: `paper`, `blog`, `proposal`

**Resolution**: Use design-ui types as primary, add `blog` and `proposal` as future extensions.

### 1.3 Field Name Conflicts

| design-ui | design-data | **Resolution** |
|-----------|-------------|----------------|
| `sourcePaperIds` | `relatedPapers` | Use `relatedPapers` (more accurate) |
| `content` (Idea) | `description` | Use `description` (concise) |
| `linkedExperimentIds` | `relatedExperiments` | Use `relatedExperiments` |
| `method` (Experiment) | `method` | Keep |
| `expectedResults` | `expectedResults` | Keep |
| `actualResults` | `results` | Use `results` |

### 1.4 Storage Key Unification

All modules use localStorage with schema version:

```typescript
const STORAGE_KEYS = {
  ideas: 'dpr_ideas_v1',
  experiments: 'dpr_experiments_v1',
  writings: 'dpr_writings_v1',
  roadmaps: 'dpr_roadmaps_v1',
};
```

Document structure: `{ schemaVersion: 1, data: Record<string, T> }`

---

## 2. Page Paths

All paths under `astro-src/pages/`:

| Module | List Page | Detail Page |
|--------|-----------|-------------|
| Ideas | `/ideas/` | `/ideas/[id]/` |
| Experiments | `/experiments/` | `/experiments/[id]/` |
| Writing | `/writing/` | `/writing/[id]/` |
| Roadmap | `/roadmap/` | `/roadmap/[id]/` (inline detail) |

**Navbar Integration** (modify `Navbar.astro`):
```javascript
const links = [
  // ... existing ...
  { href: '/ideas/',       label: 'Ideas',     match: '/ideas' },
  { href: '/experiments/', label: '实验',      match: '/experiments' },
  { href: '/writing/',     label: '写作',      match: '/writing' },
  { href: '/roadmap/',    label: '路线图',     match: '/roadmap' },
];
```

---

## 3. TypeScript Types

### 3.1 Unified Types Location

All types in `astro-src/lib/workflows/types.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════
// SHARED CROSS-MODULE TYPES
// ═══════════════════════════════════════════════════════════════

/** Reference to a paper by canonical arXiv ID (no /vN suffix) */
export interface PaperRef {
  arxivId: string;
  context?: string;  // Why this paper is relevant (for UI)
}

/** Reference to an idea by slug */
export interface IdeaRef {
  ideaId: string;
}

/** Reference to an experiment by slug */
export interface ExperimentRef {
  experimentId: string;
}

// ═══════════════════════════════════════════════════════════════
// IDEA
// ═══════════════════════════════════════════════════════════════

export type IdeaStatus = 'draft' | 'active' | 'promoted' | 'archived';

export interface Idea {
  /** kebab-case slug, auto-generated from title */
  id: string;
  /** Title, 1-100 chars */
  title: string;
  /** Detailed description, markdown */
  description: string;
  /** Lifecycle status */
  status: IdeaStatus;
  /** Papers related to this idea (canonical IDs) */
  relatedPapers: string[];
  /** Concepts this idea relates to */
  relatedConcepts: string[];
  /** User-defined tags */
  tags: string[];
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
}

export interface IdeasDoc {
  schemaVersion: 1;
  ideas: Record<string, Idea>;
}

// ═══════════════════════════════════════════════════════════════
// EXPERIMENT
// ═══════════════════════════════════════════════════════════════

export type ExperimentStatus = 'planned' | 'running' | 'done' | 'failed' | 'blocked';

export interface ExperimentVariable {
  name: string;
  type: 'independent' | 'dependent' | 'control';
  description: string;
  unit?: string;
}

export interface Experiment {
  /** kebab-case slug */
  id: string;
  /** Experiment title */
  title: string;
  /** Research hypothesis */
  hypothesis: string;
  /** Methods description (markdown) */
  method: string;
  /** Variable definitions */
  variables: ExperimentVariable[];
  /** Expected results description */
  expectedResults: string;
  /** Actual results (filled after completion) */
  results?: string;
  /** Status */
  status: ExperimentStatus;
  /** Related idea IDs */
  relatedIdeas: string[];
  /** Cited paper IDs */
  relatedPapers: string[];
  /** Linked writing IDs */
  relatedWritings: string[];
  /** Progress log entries */
  progressLog: ProgressLogEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ProgressLogEntry {
  date: number;
  note: string;
}

export interface ExperimentsDoc {
  schemaVersion: 1;
  experiments: Record<string, Experiment>;
}

// ═══════════════════════════════════════════════════════════════
// WRITING
// ═══════════════════════════════════════════════════════════════

export type WritingType = 'paper' | 'section' | 'note' | 'review' | 'translation';
export type WritingStatus = 'draft' | 'review' | 'final';

export interface WritingSection {
  id: string;
  title: string;
  content: string;  // markdown
  order: number;
}

export interface Writing {
  /** kebab-case slug */
  id: string;
  /** Title */
  title: string;
  /** Writing type */
  type: WritingType;
  /** Status */
  status: WritingStatus;
  /** Target venue (journal/conference/blog name) */
  targetVenue?: string;
  /** Abstract */
  abstract?: string;
  /** Section structure */
  sections: WritingSection[];
  /** Cited paper IDs */
  citedPapers: string[];
  /** Related idea IDs */
  relatedIdeas: string[];
  /** Related experiment IDs */
  relatedExperiments: string[];
  /** Word count (auto-calculated) */
  wordCount: number;
  /** Version history */
  versions: WritingVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface WritingVersion {
  content: string;
  savedAt: number;
}

export interface WritingsDoc {
  schemaVersion: 1;
  writings: Record<string, Writing>;
}

// ═══════════════════════════════════════════════════════════════
// ROADMAP
// ═══════════════════════════════════════════════════════════════

export type RoadmapTimeframe = 'quarter' | 'year';

export interface RoadmapGoal {
  id: string;
  description: string;
  completed: boolean;
  order: number;
}

export interface Roadmap {
  /** kebab-case slug */
  id: string;
  /** Title */
  title: string;
  /** Timeframe */
  timeframe: RoadmapTimeframe;
  /** Period string (e.g., "2026-Q4" or "2026") */
  period: string;
  /** Goals */
  goals: RoadmapGoal[];
  /** Linked idea IDs */
  linkedIdeas: string[];
  /** Linked experiment IDs */
  linkedExperiments: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RoadmapsDoc {
  schemaVersion: 1;
  roadmaps: Record<string, Roadmap>;
}
```

---

## 4. Component Names & Props

### 4.1 Page Components

| Page | Component | Purpose |
|------|-----------|---------|
| `/ideas/` | `IdeasList.astro` | Grid + filter bar |
| `/ideas/[id]/` | `IdeaDetail.astro` | Single idea view |
| `/experiments/` | `ExperimentsList.astro` | Grid + filter bar |
| `/experiments/[id]/` | `ExperimentDetail.astro` | Single experiment with progress log |
| `/writing/` | `WritingList.astro` | Grid + filter bar |
| `/writing/[id]/` | `WritingEditor.astro` | Editor + preview |
| `/roadmap/` | `RoadmapTimeline.astro` | Timeline view |

### 4.2 Shared UI Components

| Component | Location | Props |
|-----------|----------|-------|
| `PaperBadge.astro` | `components/` | `arxivId: string`, `showTitle?: boolean`, `size?: 'sm' \| 'md' \| 'lg'` |
| `EntityChip.astro` | `components/` | `href: string`, `label: string`, `type: 'idea' \| 'experiment' \| 'writing'` |
| `StatusPill.astro` | `components/` | `status: string`, `variant: 'draft' \| 'active' \| 'done' \| 'archived'` |
| `FilterBar.astro` | `components/` | `filters: FilterItem[]`, `activeFilter: string` |
| `ProgressBar.astro` | `components/` | `value: number`, `max: number`, `label?: string` |
| `TimelineEntry.astro` | `components/` | `date: number`, `content: string` |

### 4.3 Modal Components

| Component | Purpose |
|-----------|---------|
| `IdeaModal.astro` | Create/edit idea (title, description, related papers) |
| `ExperimentModal.astro` | Create/edit experiment (title, hypothesis, method, variables) |
| `WritingModal.astro` | Create new writing (title, type) |
| `MilestoneModal.astro` | Create/edit roadmap milestone |

---

## 5. Integration Points

### 5.1 Paper Repository (Read-Only Reference)

```typescript
// All modules reference papers via PaperRepository
import { defaultPaperRepository } from '../paper-repository';

// Usage in components
const paper = await defaultPaperRepository.read(arxivId);
// Returns: { title, authors, date, abstract, ... }
```

### 5.2 Event Bus

Add to `lib/events/names.ts`:
```typescript
export const DPR_IDEA_CREATED = 'dpr:idea-created';
export const DPR_IDEA_UPDATED = 'dpr:idea-updated';
export const DPR_EXPERIMENT_CREATED = 'dpr:experiment-created';
export const DPR_EXPERIMENT_UPDATED = 'dpr:experiment-updated';
export const DPR_WRITING_CREATED = 'dpr:writing-created';
export const DPR_WRITING_UPDATED = 'dpr:writing-updated';
export const DPR_ROADMAP_UPDATED = 'dpr:roadmap-updated';
```

**Emit Sources** (single source per event):
- `DPR_IDEA_CREATED`: `lib/workflows/store.ts` (createIdea)
- `DPR_IDEA_UPDATED`: `lib/workflows/store.ts` (updateIdea)
- `DPR_EXPERIMENT_CREATED`: `lib/workflows/store.ts` (createExperiment)
- `DPR_EXPERIMENT_UPDATED`: `lib/workflows/store.ts` (updateExperiment)
- `DPR_WRITING_CREATED`: `lib/workflows/store.ts` (createWriting)
- `DPR_WRITING_UPDATED`: `lib/workflows/store.ts` (updateWriting)
- `DPR_ROADMAP_UPDATED`: `lib/workflows/store.ts` (updateRoadmap)

### 5.3 User Libraries Integration

Extend `lib/user-libraries/types.ts`:
```typescript
export type LibraryItemType = 'paper' | 'idea' | 'experiment' | 'writing';

export interface LibraryItem {
  type: LibraryItemType;
  id: string;
  addedAt: number;
}
```

### 5.4 Concept Graph Integration

Ideas can link to concepts via `relatedConcepts: string[]`. Display using `ConceptBadge.astro`.

---

## 6. Data Access (Store Layer)

### 6.1 Unified Store Location

All store functions in `astro-src/lib/workflows/store.ts`:

```typescript
import type { 
  Idea, IdeasDoc, IdeaStatus,
  Experiment, ExperimentsDoc, ExperimentStatus, ExperimentVariable,
  Writing, WritingsDoc, WritingType, WritingStatus, WritingSection,
  Roadmap, RoadmapsDoc, RoadmapGoal, RoadmapTimeframe
} from './types';

// ─────────────────────────────────────────────────────────────
// IDEAS
// ─────────────────────────────────────────────────────────────

const IDEAS_KEY = 'dpr_ideas_v1';

export function loadIdeas(): IdeasDoc { /* ... */ }
export function saveIdeas(doc: IdeasDoc): void { /* ... */ }
export function createIdea(title: string, description: string): Idea { /* ... */ }
export function updateIdea(id: string, partial: Partial<Idea>): void { /* ... */ }
export function deleteIdea(id: string): void { /* ... */ }
export function listIdeasByStatus(status: IdeaStatus): Idea[] { /* ... */ }

// ─────────────────────────────────────────────────────────────
// EXPERIMENTS
// ─────────────────────────────────────────────────────────────

const EXPERIMENTS_KEY = 'dpr_experiments_v1';

export function loadExperiments(): ExperimentsDoc { /* ... */ }
export function saveExperiments(doc: ExperimentsDoc): void { /* ... */ }
export function createExperiment(title: string, hypothesis: string, method: string, variables: ExperimentVariable[], expectedResults: string, relatedIdeas: string[]): Experiment { /* ... */ }
export function updateExperiment(id: string, partial: Partial<Experiment>): void { /* ... */ }
export function deleteExperiment(id: string): void { /* ... */ }
export function listExperimentsByStatus(status: ExperimentStatus): Experiment[] { /* ... */ }
export function listExperimentsByIdea(ideaId: string): Experiment[] { /* ... */ }

// ─────────────────────────────────────────────────────────────
// WRITINGS
// ─────────────────────────────────────────────────────────────

const WRITINGS_KEY = 'dpr_writings_v1';

export function loadWritings(): WritingsDoc { /* ... */ }
export function saveWritings(doc: WritingsDoc): void { /* ... */ }
export function createWriting(title: string, type: WritingType, sections?: WritingSection[]): Writing { /* ... */ }
export function updateWriting(id: string, partial: Partial<Writing>): void { /* ... */ }
export function deleteWriting(id: string): void { /* ... */ }
export function listWritingsByType(type: WritingType): Writing[] { /* ... */ }
export function listWritingsByStatus(status: WritingStatus): Writing[] { /* ... */ }

// ─────────────────────────────────────────────────────────────
// ROADMAPS
// ─────────────────────────────────────────────────────────────

const ROADMAPS_KEY = 'dpr_roadmaps_v1';

export function loadRoadmaps(): RoadmapsDoc { /* ... */ }
export function saveRoadmaps(doc: RoadmapsDoc): void { /* ... */ }
export function createRoadmap(title: string, timeframe: RoadmapTimeframe, period: string): Roadmap { /* ... */ }
export function updateRoadmap(id: string, partial: Partial<Roadmap>): void { /* ... */ }
export function deleteRoadmap(id: string): void { /* ... */ }
export function getRoadmapProgress(roadmapId: string): number { /* ... */ }

// ─────────────────────────────────────────────────────────────
// CROSS-MODULE HELPERS
// ─────────────────────────────────────────────────────────────

/** Get all experiments and writings related to an idea */
export function getIdeaNetwork(ideaId: string) { /* ... */ }

/** Get all ideas, experiments, writings related to a paper */
export function getPaperNetwork(arxivId: string) { /* ... */ }
```

---

## 7. Build Order

### Phase 1: Types & Storage (Day 1)
1. Create `astro-src/lib/workflows/types.ts` (unified types)
2. Create `astro-src/lib/workflows/store.ts` (CRUD operations)
3. Add event names to `lib/events/names.ts`

### Phase 2: Core UI Components (Day 2)
4. Create shared components: `PaperBadge.astro`, `EntityChip.astro`, `StatusPill.astro`, `ProgressBar.astro`
5. Create CSS modules: `ideas.css`, `experiments.css`, `roadmap.css`
6. Extend `writing.css` if needed

### Phase 3: List Pages (Day 3)
7. Create `/ideas/index.astro` (IdeasList)
8. Create `/experiments/index.astro` (ExperimentsList)
9. Create `/writing/index.astro` (WritingList)
10. Create `/roadmap.astro` (RoadmapTimeline)

### Phase 4: Detail Pages (Day 4)
11. Create `/ideas/[id].astro` (IdeaDetail)
12. Create `/experiments/[id].astro` (ExperimentDetail)
13. Create `/writing/[id].astro` (WritingEditor)

### Phase 5: Integration (Day 5)
14. Update `Navbar.astro` with new nav links
15. Integrate with PaperRepository for paper badges
16. Add event emission to store functions
17. Add "Add to Library" functionality

### Phase 6: Polish (Day 6)
18. Empty states for all list pages
19. Responsive behavior verification
20. Dark theme verification

---

## 8. Sample Data Requirements

### 8.1 Initial State (Empty)

All modules start with empty localStorage:
```javascript
{
  "dpr_ideas_v1": { "schemaVersion": 1, "ideas": {} },
  "dpr_experiments_v1": { "schemaVersion": 1, "experiments": {} },
  "dpr_writings_v1": { "schemaVersion": 1, "writings": {} },
  "dpr_roadmaps_v1": { "schemaVersion": 1, "roadmaps": {} }
}
```

### 8.2 Sample Idea (for testing)

```json
{
  "id": "transformer-attention-scaling",
  "title": "Transformer Attention Scaling Laws",
  "description": "Explore non-linear relationship between attention heads and model capacity. Key questions: Does more heads always mean better performance? What is the optimal head-to-parameter ratio?",
  "status": "active",
  "relatedPapers": ["1706.03762", "2008.11826"],
  "relatedConcepts": ["attention-mechanism", "scaling-laws"],
  "tags": ["architecture", "theory"],
  "createdAt": 1694064000000,
  "updatedAt": 1694150400000
}
```

### 8.3 Sample Experiment

```json
{
  "id": "ablation-head-count",
  "title": "Ablation Study: Attention Head Count",
  "hypothesis": "Reducing attention heads from 12 to 6 yields 40% inference speedup with <5% accuracy loss on GLUE",
  "method": "Fine-tune BERT-base with varying head counts (4, 6, 8, 12) on GLUE benchmark",
  "variables": [
    { "name": "head_count", "type": "independent", "description": "Number of attention heads", "unit": "count" },
    { "name": "glue_score", "type": "dependent", "description": "Average GLUE score", "unit": "percentage" }
  ],
  "expectedResults": "Speedup scales linearly with head reduction; accuracy degrades sub-linearly",
  "status": "planned",
  "relatedIdeas": ["transformer-attention-scaling"],
  "relatedPapers": ["1810.04805"],
  "relatedWritings": [],
  "progressLog": [],
  "createdAt": 1694150400000,
  "updatedAt": 1694150400000
}
```

### 8.4 Sample Writing

```json
{
  "id": "attention-scaling-paper",
  "title": "Scaling Laws for Attention Mechanisms",
  "type": "paper",
  "status": "draft",
  "targetVenue": "ICML 2027",
  "abstract": "We investigate the relationship between attention head count and model performance...",
  "sections": [
    { "id": "intro", "title": "Introduction", "content": "...", "order": 1 },
    { "id": "method", "title": "Methodology", "content": "...", "order": 2 }
  ],
  "citedPapers": ["1706.03762", "2008.11826"],
  "relatedIdeas": ["transformer-attention-scaling"],
  "relatedExperiments": ["ablation-head-count"],
  "wordCount": 0,
  "versions": [],
  "createdAt": 1694236800000,
  "updatedAt": 1694236800000
}
```

### 8.5 Sample Roadmap

```json
{
  "id": "2026-q4-research",
  "title": "Q4 2026 Research Plan",
  "type": "quarter",
  "period": "2026-Q4",
  "goals": [
    { "id": "g1", "description": "Complete attention scaling experiments", "completed": false, "order": 1 },
    { "id": "g2", "description": "Write first draft of ICML paper", "completed": false, "order": 2 }
  ],
  "linkedIdeas": ["transformer-attention-scaling"],
  "linkedExperiments": ["ablation-head-count"],
  "createdAt": 1694323200000,
  "updatedAt": 1694323200000
}
```

---

## 9. CSS Design System (Reference)

Use existing CSS variables from `global.css`. New module styles must use:

```css
/* Hue colors for left border branding */
.idea-card { border-left: 4px solid var(--hue-emerald); }
.experiment-card { border-left: 4px solid var(--hue-amber); }
.writing-card { border-left: 4px solid var(--hue-purple); }
.milestone { border-left: 4px solid var(--hue-sky); }

/* Card base */
.dpr-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}

/* Grid layout */
.ideas-grid, .experiments-grid, .writing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}

/* Timeline (roadmap) */
.roadmap-timeline {
  display: flex;
  gap: var(--space-8);
  overflow-x: auto;
}
```

---

## 10. Out of Scope

These are deferred to future phases:

- Server-side rendering of workflow data
- Cross-device sync (Gist integration)
- Collaboration features
- Export to PDF/DOCX
- External tool integration (Overleaf, MLflow)
- Automated experiment tracking

---

## 11. Acceptance Criteria

1. All 4 new routes render without errors
2. Navbar displays all 4 new links with correct active state
3. List pages show filterable grid of items
4. Detail pages render with all sections
5. Writing editor auto-saves to localStorage
6. Timeline scrolls horizontally on mobile
7. All colors/spacing use existing CSS variables
8. No new colors introduced
9. Responsive down to 320px width
10. Dark theme works via existing CSS variables
11. Paper badges fetch metadata via PaperRepository
12. Events emit on all CRUD operations

---

## Appendix: File Structure

```
astro-src/
├── pages/
│   ├── ideas/
│   │   ├── index.astro
│   │   └── [id].astro
│   ├── experiments/
│   │   ├── index.astro
│   │   └── [id].astro
│   ├── writing/
│   │   ├── index.astro
│   │   └── [id].astro
│   └── roadmap.astro
├── components/
│   ├── PaperBadge.astro
│   ├── EntityChip.astro
│   ├── StatusPill.astro
│   ├── FilterBar.astro
│   ├── ProgressBar.astro
│   ├── TimelineEntry.astro
│   ├── IdeaModal.astro
│   ├── ExperimentModal.astro
│   ├── WritingModal.astro
│   └── MilestoneModal.astro
├── lib/
│   └── workflows/
│       ├── types.ts      # All TypeScript interfaces
│       └── store.ts      # CRUD + queries
├── styles/
│   ├── ideas.css
│   ├── experiments.css
│   ├── roadmap.css
│   └── writing.css       # extend if needed
└── scripts/
    └── workflows-ui.ts   # Client-side logic
```

# Research Modules Integration Design

This document defines how new research modules (Ideas, Experiments, Writing, Roadmap) integrate with existing DPR systems.

---

## 1. Paper Reference Pattern

### 1.1 Core Principle: Single Source of Truth

All modules MUST reference papers via **canonical arXiv ID** only. Never duplicate paper metadata.

```typescript
// CORRECT: Reference by ID, fetch data on demand
import { defaultPaperRepository } from '../paper-repository';

interface PaperReference {
  arxivId: string;  // canonical (no /vN suffix)
}

async function getPaperData(ref: PaperReference) {
  return defaultPaperRepository.read(ref.arxivId);
}
```

### 1.2 Why This Pattern

- **No duplication**: Paper metadata lives in one place (`/docs/papers/`)
- **Cache reuse**: `PaperRepository` caches metadata, avoiding repeated disk I/O
- **Consistency**: All modules see the same paper data
- **SSR-safe**: Repository works in both SSR and client contexts

### 1.3 Data Flow

```
New Module (Idea/Experiment/Writing)
         │
         ▼
   arxivId (string)
         │
         ▼
   PaperRepository.read(id)
         │
    ┌────┴────┐
    ▼         ▼
Cache Hit   Cache Miss
    │         │
    └────┬────┘
         ▼
    Paper object (title, authors, date, etc.)
```

---

## 2. Cross-Module Link Definitions

### 2.1 Link Type Summary

| Source | Target | Field | Purpose |
|--------|--------|-------|---------|
| Idea | Paper | `anchorArxivId` | Which paper sparked this idea |
| Idea | Paper[] | `citedArxivIds` | Background literature |
| Experiment | Idea | `ideaId` | Which idea this tests |
| Experiment | Paper[] | `citedArxivIds` | Baseline methods |
| Writing | Paper[] | `citedArxivIds` | Citations |
| Writing | Experiment[] | `experimentIds` | Evidence for claims |
| Roadmap | Idea[] | `ideaIds` | Planned ideas |
| Roadmap | Experiment[] | `experimentIds` | Planned experiments |

### 2.2 Type Definitions

Add to `astro-src/lib/schemas.ts`:

```typescript
// ─────────────────────────────────────────────────────────────
// Cross-module link types (shared by all research modules)
// ─────────────────────────────────────────────────────────────

/** Reference to a paper by canonical arXiv ID.
 *  Use this instead of inlining paper metadata. */
export interface PaperRef {
  arxivId: string;
  /** Optional: why this paper is relevant (for UI display) */
  context?: string;
}

/** Reference to an idea */
export interface IdeaRef {
  ideaId: string;
}

/** Reference to an experiment */
export interface ExperimentRef {
  experimentId: string;
}

// ─────────────────────────────────────────────────────────────
// Idea (existing in lib/projects/ideas.ts - augment with links)
// ─────────────────────────────────────────────────────────────

export interface ProjectIdea {
  // ... existing fields ...
  /** The paper that sparked this idea (primary inspiration) */
  anchorArxivId?: string;
  /** Papers cited as background/related work */
  citedArxivIds: string[];
  /** Parent roadmap if this idea is planned */
  roadmapId?: string;
}

// ─────────────────────────────────────────────────────────────
// Experiment (new module)
// ─────────────────────────────────────────────────────────────

export type ExperimentStatus = 'planned' | 'running' | 'completed' | 'failed';

export interface ProjectExperiment {
  id: string;
  projectId: string;
  /** Which idea this experiment tests */
  ideaId: string;
  status: ExperimentStatus;
  title: string;
  method: string;
  /** Baseline papers for comparison */
  citedArxivIds: string[];
  results?: string;        // markdown
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Writing (new module)
// ─────────────────────────────────────────────────────────────

export type WritingStatus = 'draft' | 'review' | 'published';

export interface ProjectWriting {
  id: string;
  projectId: string;
  title: string;
  /** Papers cited in this writing */
  citedArxivIds: string[];
  /** Experiments that provide evidence */
  experimentIds: string[];
  status: WritingStatus;
  content?: string;       // markdown
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Roadmap (new module)
// ─────────────────────────────────────────────────────────────

export interface ProjectRoadmap {
  id: string;
  projectId: string;
  title: string;
  /** Ideas planned for this roadmap */
  ideaIds: string[];
  /** Experiments planned for this roadmap */
  experimentIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

---

## 3. Event Bus Integration

### 3.1 Existing Event Pattern (to follow)

The event bus in `lib/events/` follows a strict pattern:

- **Single emit source**: Only one module can emit each event type
- **Broadcast to listeners**: Other modules subscribe via `on*` functions
- **Typed payloads**: Each event has a strongly-typed detail object

### 3.2 New Events to Add

Add to `lib/events/names.ts`:

```typescript
// New event names
export const DPR_IDEA_CREATED = 'dpr:idea-created';
export const DPR_IDEA_UPDATED = 'dpr:idea-updated';
export const DPR_EXPERIMENT_CREATED = 'dpr:experiment-created';
export const DPR_EXPERIMENT_UPDATED = 'dpr:experiment-updated';
export const DPR_WRITING_CREATED = 'dpr:writing-created';
export const DPR_WRITING_UPDATED = 'dpr:writing-updated';
export const DPR_ROADMAP_UPDATED = 'dpr:roadmap-updated';
```

Add to `lib/events/types.ts`:

```typescript
// ─────────────────────────────────────────────────────────────
// Research module events
// ─────────────────────────────────────────────────────────────

export type DprIdeaCreatedReason = 'manual' | 'llm-generated' | 'imported';
export type DprIdeaUpdatedReason = 'status' | 'link' | 'content' | 'delete';

export interface DprIdeaCreatedDetail {
  ideaId: string;
  projectId: string;
  reason: DprIdeaCreatedReason;
  anchorArxivId?: string;
}

export interface DprIdeaUpdatedDetail {
  ideaId: string;
  projectId: string;
  reason: DprIdeaUpdatedReason;
}

export interface DprExperimentCreatedDetail {
  experimentId: string;
  projectId: string;
  ideaId: string;
}

export interface DprExperimentUpdatedDetail {
  experimentId: string;
  projectId: string;
  reason: 'status' | 'results' | 'link' | 'delete';
}

export interface DprWritingCreatedDetail {
  writingId: string;
  projectId: string;
}

export interface DprWritingUpdatedDetail {
  writingId: string;
  projectId: string;
  reason: 'status' | 'content' | 'link' | 'delete';
}

export interface DprRoadmapUpdatedDetail {
  roadmapId: string;
  projectId: string;
  reason: 'add-idea' | 'remove-idea' | 'add-experiment' | 'remove-experiment';
}
```

Add emit/listen functions to `lib/events/bus.ts` (following existing pattern):

```typescript
// ─────────────────────────────────────────────────────────────
// dpr:idea-created
//
// Unique emit source: lib/projects/ideas.ts (saveIdea function)
// ─────────────────────────────────────────────────────────────
export function emitDprIdeaCreated(
  target: EventTarget = document,
  detail: DprIdeaCreatedDetail,
): boolean {
  return emit(target, DPR_IDEA_CREATED, detail, undefined, { bubbles: true });
}

export function onDprIdeaCreated(
  target: EventTarget = document,
  handler: (detail: DprIdeaCreatedDetail) => void,
): () => void {
  return on(target, DPR_IDEA_CREATED, handler);
}

// ... similar for other events
```

### 3.3 When to Emit Events

| Action | Emit Event | Listeners Notified |
|--------|------------|-------------------|
| New idea created | `DPR_IDEA_CREATED` | Roadmap (to show count), UI (toast) |
| Idea status changed | `DPR_IDEA_UPDATED` | Dashboard (stats), Roadmap (status filter) |
| Experiment created | `DPR_EXPERIMENT_CREATED` | Dashboard (stats) |
| Writing cites new paper | `DPR_WRITING_UPDATED` | Citation graph (update edges) |
| Roadmap adds idea | `DPR_ROADMAP_UPDATED` | Idea bank (show roadmap badge) |

---

## 4. Shared UI: Paper Reference Badge

### 4.1 Component Pattern

Create a reusable paper reference badge that works across all modules:

```typescript
// astro-src/components/PaperBadge.astro
---
interface Props {
  arxivId: string;
  showTitle?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const { arxivId, showTitle = false, size = 'md' } = Astro.props;
---

<a 
  href={`/papers/${arxivId}/`}
  class={`paper-badge paper-badge--${size}`}
  data-arxiv-id={arxivId}
>
  <span class="paper-badge__id">{arxivId}</span>
  {showTitle && <span class="paper-badge__title" data-paper-title={arxivId}>Loading...</span>}
</a>

<style>
  .paper-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    text-decoration: none;
    font-size: var(--font-size-sm);
  }
  
  .paper-badge--sm { padding: 0.125rem 0.25rem; font-size: var(--font-size-xs); }
  .paper-badge--lg { padding: 0.5rem 0.75rem; font-size: var(--font-size-md); }
  
  .paper-badge__id {
    font-family: monospace;
    color: var(--color-link);
  }
  
  .paper-badge__title {
    color: var(--color-text);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

<script>
  import { defaultPaperRepository } from '../lib/paper-repository';
  
  // Hydrate titles on demand
  document.querySelectorAll('[data-paper-title]').forEach(async (el) => {
    const arxivId = el.dataset.arxivId;
    if (!arxivId) return;
    
    const paper = await defaultPaperRepository.read(arxivId);
    if (paper) {
      el.textContent = paper.title?.slice(0, 50) + (paper.title?.length > 50 ? '...' : '');
    }
  });
</script>
```

### 4.2 Usage in Different Modules

```astro
---
// In Idea detail view
import PaperBadge from '../../components/PaperBadge.astro';
---
{idea.anchorArxivId && (
  <div class="idea-anchor">
    <span>Spawned from:</span>
    <PaperBadge arxivId={idea.anchorArxivId} showTitle />
  </div>
)}

<!-- In Experiment detail -->
{experiment.citedArxivIds.map(id => (
  <PaperBadge arxivId={id} size="sm" />
))}

<!-- In Writing citations -->
{writing.citedArxivIds.map(id => (
  <PaperBadge arxivId={id} />
))}
```

---

## 5. Library Integration

### 5.1 Can Users Add Ideas to Their Library?

**Design Decision**: Yes, ideas can be added to user libraries. This allows users to collect interesting ideas alongside papers.

### 5.2 Implementation

Extend `lib/user-libraries/types.ts`:

```typescript
// Add to existing types
export type LibraryItemType = 'paper' | 'idea' | 'experiment' | 'writing';

export interface LibraryItem {
  type: LibraryItemType;
  id: string;           // paper arxivId, or idea/experiment/writing UUID
  addedAt: number;
}
```

Add to `lib/user-libraries/store.ts`:

```typescript
/** Add an idea/experiment/writing to a library */
export async function addItemToLibrary(
  libraryId: string,
  item: LibraryItem
): Promise<WriteResult> {
  // Similar to addPaper, but accept any LibraryItemType
  // Emit DPR_USER_LIBRARIES_CHANGE with reason 'item-add'
}
```

### 5.3 UI Integration

In the project workspace UI, add "Add to Library" action:

```typescript
// In project-ideas-ui.ts
import { addItemToLibrary } from '../lib/user-libraries/store';

async function addIdeaToLibrary(ideaId: string, libraryId: string) {
  const result = await addItemToLibrary(libraryId, {
    type: 'idea',
    id: ideaId,
    addedAt: Date.now(),
  });
  
  if (result.ok) {
    emitDprUserLibrariesChange(document, {
      ids: [libraryId],
      reason: 'item-add',
    });
  }
}
```

### 5.4 Event Coordination

When an idea is added to a library:

```typescript
// lib/user-libraries/store.ts (addItemToLibrary implementation)
import { emitDprUserLibrariesChange } from '../events';

// After successful add
emitDprUserLibrariesChange(document, {
  ids: [libraryId],
  reason: 'item-add',
});
```

---

## 6. Concept Graph Integration

### 6.1 Link Ideas to Concepts

Ideas can be tagged with concepts from the concept graph:

```typescript
// Extend ProjectIdea
export interface ProjectIdea {
  // ... existing fields ...
  /** Concepts this idea relates to */
  conceptIds: string[];
}
```

### 6.2 Bidirectional Links

- **Concept → Ideas**: When viewing a concept, show related ideas
- **Idea → Concepts**: When viewing an idea, show its concept tags

### 6.3 Implementation

Add helper in `lib/library/graph.ts` (or new module):

```typescript
/** Get all ideas associated with a concept */
export async function getIdeasByConcept(conceptId: string): Promise<ProjectIdea[]> {
  // Query idea IDB, filter by conceptIds
}

/** Get all concepts associated with an idea */
export function getConceptsForIdea(idea: ProjectIdea): string[] {
  return idea.conceptIds || [];
}
```

### 6.4 UI: Concept Badges on Ideas

```astro
---
// In idea card
import ConceptBadge from '../../components/ConceptBadge.astro';
---
<div class="idea-concepts">
  {idea.conceptIds?.map(id => (
    <ConceptBadge conceptId={id} />
  ))}
</div>
```

---

## 7. Implementation Checklist

### Phase 1: Core Types (Day 1)
- [ ] Add cross-module link types to `lib/schemas.ts`
- [ ] Add experiment/writing/roadmap types

### Phase 2: Data Layer (Day 2)
- [ ] Create `lib/experiments/` module (IDB-backed, similar to ideas.ts)
- [ ] Create `lib/writing/` module
- [ ] Create `lib/roadmaps/` module

### Phase 3: Event Bus (Day 3)
- [ ] Add event names to `lib/events/names.ts`
- [ ] Add event types to `lib/events/types.ts`
- [ ] Add emit/listen functions to `lib/events/bus.ts`

### Phase 4: UI Components (Day 4)
- [ ] Create `PaperBadge.astro` component
- [ ] Update ideas UI to show paper references
- [ ] Create experiment/writing detail views

### Phase 5: Library Integration (Day 5)
- [ ] Extend library item types
- [ ] Add "Add to Library" for ideas
- [ ] Handle mixed-type library views

### Phase 6: Concept Integration (Day 6)
- [ ] Add conceptIds to ideas
- [ ] Create concept-idea linking helpers
- [ ] Update concept graph to show ideas

---

## 8. Migration Path for Existing Data

### Ideas (Existing)
- `anchorArxivId` field already exists in `lib/projects/ideas.ts`
- Add `conceptIds: []` field for future concept linking
- Add `roadmapId?: string` for roadmap integration

### Future Modules
- All new modules should use `PaperRepository` from day 1
- Emit events on all CRUD operations
- Use shared `PaperBadge` component

---

## 9. Key Design Principles

1. **Reference by ID, not by value**: Always use arXiv ID strings, never inline paper metadata
2. **Single emit source**: Each event type has exactly one emitter
3. **Typed events**: All events have strongly-typed detail objects
4. **Shared UI components**: PaperBadge used everywhere papers are referenced
5. **Library as aggregation**: User libraries can aggregate any item type
6. **Concept graph bidirectional**: Ideas link to concepts, concepts show ideas

---

## Appendix: Import Paths Reference

```typescript
// Paper repository (for fetching paper metadata)
import { defaultPaperRepository } from '../paper-repository';

// Event bus
import { emitDprIdeaCreated, onDprIdeaCreated } from '../events';

// Ideas (existing)
import { saveIdea, listIdeasByProject, loadIdea } from '../projects/ideas';

// User libraries
import { addPaper, listUserLibraries } from '../user-libraries/store';

// Paper references (new shared component)
import PaperBadge from '../../components/PaperBadge.astro';
```

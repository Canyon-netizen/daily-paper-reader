# Iteration 2 — Consolidated Design Plan

**Date:** 2026-09-08
**Purpose:** Combine 4 designer outputs into focused execution plan

---

## Priority Summary

| Priority | Feature | Owner |
|----------|---------|-------|
| P0 | Build-time auto-discovery (paths) | Builder A |
| P0 | Cross-module unified search | Builder A |
| P1 | Export functionality | Builder B |
| P1 | Templates system | Builder B |
| P2 | UX polish (CSS unification) | Builder C |
| P2 | Dashboard + Flows | Builder C |

**Constraint:** Each builder owns distinct files. No overlap.

---

## Phase 1: P0 — Infrastructure (Enable Everything)

### 1.1 Build-Time Auto-Discovery

**Problem:** Adding `docs/ideas/*.md` doesn't auto-create routes. `getStaticPaths` is hardcoded.

**Solution:** Generate paths at build time.

**Files:**

| File | Action |
|------|--------|
| `astro-src/scripts/generate-paths.mjs` | **CREATE** — scans docs/{module}/*.md, outputs TypeScript registry |
| `astro-src/lib/paths.generated.ts` | **AUTO-GENERATED** — output of script |
| `package.json` | **MODIFY** — add `prebuild` script |

**Script output example:**
```typescript
// astro-src/lib/paths.generated.ts (generated)
export const ideasPaths = ['scaling-laws', 'attention-mechanism', ...] as const;
export const experimentsPaths = [...] as const;
export const allModulePaths = { ideas: ideasPaths, experiments: experimentsPaths, ... };
```

**Usage in `[id].astro`:**
```astro
---
import { ideasPaths } from '../../lib/paths.generated';
export async function getStaticPaths() {
  return ideasPaths.map((id) => ({ params: { id } }));
}
---
```

### 1.2 Cross-Module Unified Search

**Problem:** No unified search across ideas + experiments + writings + papers.

**Solution:** Single search page queries all modules.

**Files:**

| File | Action |
|------|--------|
| `astro-src/lib/search/unified.ts` | **CREATE** — unifiedSearch() API |
| `astro-src/pages/search.astro` | **CREATE** — search results page |
| `astro-src/components/Navbar.astro` | **MODIFY** — add search icon/link |

**API signature:**
```typescript
interface UnifiedSearchResult {
  module: 'paper' | 'idea' | 'experiment' | 'writing';
  id: string;
  title: string;
  excerpt: string;
  score: number;
}

function unifiedSearch(query: string, modules?: string[], topK?: number): Promise<UnifiedSearchResult[]>
```

**Search page behavior:**
1. User visits `/search?q=scaling`
2. Server renders results from unifiedSearch()
3. Results grouped by module with links to detail pages

---

## Phase 2: P1 — Core Features

### 2.1 Export Functionality

**Problem:** No way to export writings/experiments/ideas.

**Solution:** Client-side download (Markdown/JSON) + PDF print.

**Files:**

| File | Action |
|------|--------|
| `astro-src/lib/export/index.ts` | **CREATE** — export handlers |
| `astro-src/styles/print.css` | **CREATE** — @media print styles |
| `astro-src/components/ExportButton.astro` | **CREATE** — reusable dropdown |
| `astro-src/pages/ideas/[id].astro` | **MODIFY** — add export button |
| `astro-src/pages/experiments/[id].astro` | **MODIFY** — add export button |
| `astro-src/pages/writing/[id].astro` | **MODIFY** — add export buttons |
| `astro-src/pages/roadmap/index.astro` | **MODIFY** — add export button |

**Export handlers:**
- `exportAsMarkdown(entity)` — returns formatted string, triggers download
- `exportAsJSON(entity)` — JSON.stringify, triggers download
- `exportAsPDF(element)` — window.print() with print CSS

### 2.2 Templates System

**Problem:** New experiments/writings start blank.

**Solution:** Pre-built templates in localStorage.

**Files:**

| File | Action |
|------|--------|
| `astro-src/lib/templates/types.ts` | **CREATE** — Template interfaces |
| `astro-src/lib/templates/builtins.ts` | **CREATE** — 4 experiment + 3 writing templates |
| `astro-src/lib/templates/index.ts` | **CREATE** — CRUD operations |
| `astro-src/components/TemplatePicker.astro` | **CREATE** — selection modal |
| `astro-src/pages/experiments/index.astro` | **MODIFY** — add template selector |
| `astro-src/pages/writing/index.astro` | **MODIFY** — add template selector |

**Built-in templates:**
- Experiment: Ablation Study, Hyperparameter Sweep, User Study, A/B Test
- Writing: Workshop Paper (4-page), Blog Post, Research Proposal

---

## Phase 3: P2 — UX Polish & Flows

### 3.1 CSS Unification (UX Critical)

**Problem:** Inconsistent status badges, modals, empty states across modules.

**Solution:** Add unified components to global.css.

**Files:**

| File | Action |
|------|--------|
| `astro-src/styles/global.css` | **MODIFY** — add `.status-pill`, `.chip`, `.modal-*`, `.empty-state`, `.kbd` |
| `astro-src/styles/ideas.css` | **MODIFY** — migrate to unified classes |
| `astro-src/styles/experiments.css` | **MODIFY** — migrate to unified classes |
| `astro-src/styles/writing.css` | **MODIFY** — migrate to unified classes, add sample card |
| `astro-src/styles/roadmap.css` | **MODIFY** — migrate to unified classes |

**New global CSS components:**
```css
.status-pill { ... }
.status-pill--draft, .status-pill--active, .status-pill--completed { ... }
.chip { ... }
.modal { ... }
.empty-state { ... }
.kbd { ... }
```

### 3.2 Dashboard + Pipeline Flows

**Problem:** No unified view, modules feel disconnected.

**Solution:** Cross-module dashboard + CTAs in detail pages.

**Files:**

| File | Action |
|------|--------|
| `astro-src/pages/dashboard.astro` | **CREATE** — summary stats + filtered list |
| `astro-src/components/DashboardSummary.astro` | **CREATE** — stats cards |
| `astro-src/components/PipelineCard.astro` | **CREATE** — unified card for all types |
| `astro-src/pages/ideas/[id].astro` | **MODIFY** — add "Create Experiment" CTA |
| `astro-src/pages/experiments/[id].astro` | **MODIFY** — add "Write Up" CTA |
| `astro-src/scripts/keyboard-shortcuts.ts` | **CREATE** — j/k navigation, / search |

**Dashboard layout:**
- Summary stats row (Ideas | Experiments | Writings | Roadmap)
- Filter bar (Status, Type, Date, Tags)
- Active items list (scrollable)
- Quick action buttons

### 3.3 Mobile Responsiveness

**Files:**

| File | Action |
|------|--------|
| `astro-src/styles/home.css` | **MODIFY** — add `.home .workflow-cards` responsive |
| `astro-src/styles/ideas.css` | **MODIFY** — add `@media (max-width: 640px)` grid |
| `astro-src/styles/experiments.css` | **MODIFY** — add responsive grid |
| `astro-src/styles/writing.css` | **MODIFY** — add responsive grid |
| `astro-src/styles/roadmap.css` | **MODIFY** — add responsive grid |

---

## File Count Summary

| Phase | Created | Modified | Total |
|-------|---------|----------|-------|
| P0 Infrastructure | 3 | 2 | 5 |
| P1 Features | 7 | 4 | 11 |
| P2 UX/Flows | 4 | 10 | 14 |
| **TOTAL** | **14** | **16** | **30** |

---

## Ownership Assignment

| Builder | Phase | Files |
|---------|-------|-------|
| Builder A | P0 | generate-paths.mjs, paths.generated.ts, package.json, unified.ts, search.astro, Navbar.astro |
| Builder B | P1 | export/*, print.css, ExportButton.astro, templates/*, TemplatePicker.astro, modify 4 detail pages |
| Builder C | P2 | global.css, 4 module CSS files, dashboard.astro, DashboardSummary.astro, PipelineCard.astro, keyboard-shortcuts.ts, modify 2 detail pages |

---

## Out of Scope (v2)

- Server-side sync
- Automated experiment tracking (MLflow)
- Citation management (BibTeX)
- Mobile app
- Real-time collaboration

---

## Acceptance Criteria

### P0 (Must Have)
- [ ] `npm run build` generates paths from docs/*.md
- [ ] `/search?q=x` returns results from all 4 modules
- [ ] Detail pages render without errors

### P1 (Should Have)
- [ ] Export button downloads Markdown/JSON
- [ ] Writing detail has working PDF print
- [ ] Template picker pre-fills form fields

### P2 (Nice to Have)
- [ ] Status badges consistent across all modules
- [ ] Dashboard shows summary counts
- [ ] Mobile responsive at 640px breakpoint
- [ ] j/k keyboard navigation works

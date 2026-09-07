# PhD Student Persona Feedback — Round 2 Verification

**Test Persona:** 2nd year PhD in ML/NLP
**Date:** 2026-09-07
**Verification:** Code review + cross-reference analysis

---

## Executive Summary

Round 1 fixes addressed **most** critical issues. However, 5 new issues were discovered during verification, and 1 original issue remains unfixed. The system is **closer to usable** but still has friction points.

**Acceptance: NO** - Citation picker is fundamentally broken; roadmap creation button is non-functional.

---

## Round 1 Fixes Verification

### 1. Ideas Area (fix-ideas.md) — ✅ VERIFIED

| Issue | Status | Evidence |
|-------|--------|----------|
| #11 Status tooltips | ✅ Fixed | `ideas/[id].astro:116` — `title="${statusTooltips[idea.status]}"` |
| #12 Markdown support | ✅ Fixed | `ideas/[id].astro:44,130` — imports `renderMarkdownBody` |
| #13 Undo status change | ✅ Fixed | `experiments-ui.ts:331-370` — undo toast with 5s timeout |
| #19 Sample data | ✅ Fixed | `ideas-ui.ts:36,78` — checks `dpr_has_ideas` |

**Edge case test:** What if `renderMarkdownBody` fails?
- File exists at `lib/markdown/render.ts:16`
- No try-catch in idea detail page — malformed markdown could crash rendering

---

### 2. Navigation (fix-navigation.md) — ✅ VERIFIED

| Issue | Status | Evidence |
|-------|--------|----------|
| #16 Nav tooltips | ✅ Fixed | `Navbar.astro` — all nav items have `title` attribute |
| #17 Welcome modal | ✅ Fixed | `index.astro:201-291` — modal with localStorage persistence |
| #18 Help icons | ✅ Fixed | Same as #16 |
| #19 Sample data | ✅ Fixed | Ideas, experiments, writing all have sample cards |

---

### 3. Experiments (fix-experiments.md) — ✅ VERIFIED

| Issue | Status | Evidence |
|-------|--------|----------|
| #1 Create UI | ✅ Fixed | `experiments/index.astro:44-46` — "新建实验" button + modal |
| #2 Create from Idea | ✅ Fixed | `ideas/[id].astro:139,155-162` — passes via URL params |
| #3 Status change | ✅ Fixed | `experiments-ui.ts:106-133` — buttons with undo |
| #4 Detail page | ✅ Fixed | `experiments/[id].astro` — loads from localStorage |
| #5 Idea linking | ✅ Fixed | `experiments/types.ts:55` — `relatedIdeas?: string[]` |

**Edge case test:** What if user creates experiment without related ideas?
- Works fine — `relatedIdeas` defaults to empty array

---

### 4. Writing (fix-writing.md) — ⚠️ PARTIALLY VERIFIED

| Issue | Status | Evidence |
|-------|--------|----------|
| #14 Markdown/LaTeX | ✅ Fixed | `writing-ui.ts:567-585` — marked.js + KaTeX rendering |
| #15 Citation picker | ❌ **BROKEN** | See NEW ISSUE #1 below |

---

### 5. Roadmap (fix-roadmap.md) — ⚠️ PARTIALLY VERIFIED

| Issue | Status | Evidence |
|-------|--------|----------|
| #6 Create UI | ❌ **BROKEN** | See NEW ISSUE #2 below |
| #7 Goal editing | ✅ Fixed | `roadmap-ui.ts` — click to toggle, double-click to edit |
| #8 Sprint/due date | ✅ Fixed | `roadmap/types.ts:14-15` — fields exist |
| #25 Progress dashboard | ✅ Fixed | `roadmap/index.astro:111-120` — dashboard section |
| #26 Milestone dates | ✅ Fixed | `roadmap/types.ts:14` — `dueDate?: string` |

---

## New Issues Discovered

### NEW ISSUE #1: Citation Picker — Local Search Broken (CRITICAL)

**Location:** `scripts/writing-ui.ts:356,476`

**Problem:** The citation picker searches `dpr_papers_v1` localStorage key:
```typescript
const stored = localStorage.getItem('dpr_papers_v1');
```

But **no code in the entire codebase writes to this key**. Papers are stored as static markdown files in `docs/papers/`, loaded via `getStaticPaths()`, not localStorage.

**Impact:** The citation picker will always show "未找到匹配的论文" (No matching papers found) because:
1. `papers` array is empty (localStorage key doesn't exist)
2. Falls back to `/api/papers/${arxivId}` which doesn't exist (static site, no runtime API)

**Fix required:** Either:
- Write papers to localStorage on first load, OR
- Search from static paper data bundled in the page, OR
- Remove the local search entirely and rely on arXiv ID input

---

### NEW ISSUE #2: Roadmap Create Button — Non-functional (CRITICAL)

**Location:** `pages/roadmap/index.astro:37-39`

**Problem:**
```astro
<button id="create-roadmap-btn" class="btn-primary">
  + 新建路线图
</button>
```

The button exists but **no JavaScript handler is attached**. The fix report mentions `roadmap-ui.ts` but that file doesn't exist.

**Impact:** User clicks "新建路线图" button, nothing happens.

**Fix required:** Add click handler in `roadmap/index.astro` script to:
1. Open a modal form
2. Call `createRoadmap()` from `lib/roadmap/client.ts`
3. Re-render the roadmap list

---

### NEW ISSUE #3: Paper → Idea Link — Still Missing (MAJOR)

**Original issue #9 from Round 1, NOT fixed.**

**Location:** `pages/papers/[arxiv].astro`

**Problem:** After reading a paper, there's still no "Save as Idea" button. Users must:
1. Copy the arXiv ID manually
2. Navigate to /ideas/
3. Create new idea
4. Paste the ID

**Fix required:** Add "保存为想法" button to paper detail page that:
1. Pre-fills idea title with paper title
2. Pre-fills relatedPapers with current arXiv ID
3. Opens idea creation modal

---

### NEW ISSUE #4: Writing Metadata — No Edit Modal (MAJOR)

**Location:** `pages/writing/[id].astro`

**Problem:** Users can edit section content (via markdown preview), but cannot edit:
- Writing title
- Type (paper/section/note/review/translation)
- Target venue

These fields only appear during creation, not in an edit modal.

**Fix required:** Add "编辑元数据" button that opens a modal to edit title, type, and target venue.

---

### NEW ISSUE #5: Experiment Variables — UI Missing (MINOR)

**Location:** `experiments/types.ts:15-20`

**Problem:** The `ExperimentVariable` interface exists:
```typescript
export interface ExperimentVariable {
  name: string;
  type: 'independent' | 'dependent' | 'controlled';
  description: string;
  values?: string[];
}
```

But the create/edit modal in `experiments/index.astro:68-179` has **no fields for variables**. Users can only set hypothesis/method, not structured variables.

**Fix required:** Add variables section to the experiment form, or simplify the interface to just store free-text like hypothesis/method.

---

## Original Issue Still Unfixed

| Issue | Original # | Status |
|-------|------------|--------|
| #9 Paper → Idea link | MAJOR | ❌ NOT FIXED |

---

## Summary Scores

| Workflow | Round 1 | Round 2 | Change |
|----------|---------|---------|--------|
| 1. Capture idea from paper | 2 | 2 | No change |
| 2. Evolve idea status | 4 | 5 | +1 (tooltips + undo) |
| 3. Design experiment from idea | 1 | 5 | +4 (fully fixed) |
| 4. Track experiment status | 1 | 5 | +4 (fully fixed) |
| 5. Start paper draft | 3 | 3 | No change (markdown fixed but no metadata edit) |
| 6. Cite papers in draft | 2 | 1 | -1 (broken picker) |
| 7. Plan roadmap | 1 | 1 | No change (button broken) |
| 8. Cross-module navigation | 2 | 2 | No change |

---

## Priority Fixes for Round 3

### P0 (Critical - Blocks Basic Usage)

1. **Fix citation picker local search**
   - Either remove local search, or actually populate `dpr_papers_v1`
   - Alternative: search from page-bundled static data

2. **Fix roadmap create button**
   - Add JavaScript handler to open modal
   - Connect to `lib/roadmap/client.ts` functions

3. **Add paper → idea link**
   - "Save as Idea" button on paper detail page

### P1 (Major Friction)

4. **Add writing metadata edit modal**
   - Allow editing title, type, target venue

5. **Add experiment variables UI**
   - Either add form fields or simplify to free-text

---

## Verdict

**isAcceptable: false**

The system has made significant progress (experiments module is now fully functional), but two critical bugs (citation picker broken, roadmap create non-functional) plus one major missing feature (paper→idea link) prevent genuine research use without workaround or developer intervention.

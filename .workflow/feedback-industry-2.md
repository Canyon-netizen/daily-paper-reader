# Industry Researcher Persona Feedback - Round 2

**Persona**: Research Scientist at Tech Company (5 years experience)
**Date**: 2026-09-07
**Test Focus**: Verify round-1 fixes and identify remaining gaps

---

## Executive Summary

Round 1 fixes addressed most UI/interaction issues in the roadmap/experiments/ideas modules. However, the **fundamental architecture problem** — localStorage-only storage — remains unsolved. Industry researchers cannot collaborate with teams or share progress with managers.

---

## Round 1 Fixes Verification

### Roadmap Module

| Issue | Status | Verification |
|-------|--------|-------------|
| No UI to create roadmaps | ✅ FIXED | Modal form at `/roadmap/` with title, type, dates |
| No UI to edit goals | ✅ FIXED | Double-click opens edit modal, click toggles status |
| Sprint/month breakdown | ⚠️ PARTIAL | `dueDate` and `sprint` fields added to types, displayed on cards. No timeline/Gantt view |
| No progress dashboard | ✅ FIXED | Stats cards (total/completed/in-progress/pending) + progress bar |
| Milestone date tracking | ✅ FIXED | Due date displayed on goal cards |

**Files verified**: `roadmap/index.astro`, `roadmap/types.ts`, `roadmap-ui.ts`

### Experiments Module

| Issue | Status | Verification |
|-------|--------|-------------|
| No UI to create experiments | ✅ FIXED | Modal form at `/experiments/` with full fields |
| Create from Idea | ✅ FIXED | Button on idea detail passes data via URL params |
| Status change from UI | ✅ FIXED | Buttons on cards + detail page + undo toast |
| No detail page | ✅ FIXED | `/experiments/[id].astro` with edit modal |
| No idea linking | ✅ FIXED | `relatedIdeas` field in type + UI |

**Files verified**: `experiments/index.astro`, `experiments/[id].astro`, `experiments-ui.ts`

### Ideas Module

| Issue | Status | Verification |
|-------|--------|-------------|
| Status meanings unclear | ✅ FIXED | Tooltips on filter pills |
| No markdown in description | ✅ FIXED | Uses `renderMarkdownBody()` |
| No undo on status change | ✅ FIXED | Toast with 5-second undo window |
| No sample data for new users | ✅ FIXED | Sample card shown on first visit |

**Files verified**: `ideas/index.astro`, `ideas/[id].astro`, `ideas-ui.ts`

### Writing Module

| Issue | Status | Verification |
|-------|--------|-------------|
| No markdown/LaTeX support | ✅ FIXED | Added marked.js + KaTeX, preview toggle |
| No citation picker | ✅ FIXED | Modal searches localStorage papers |

**Files verified**: `writing/[id].astro`, `writing-ui.ts`

---

## Remaining Critical Gaps

### 1. All Data Still LocalStorage-Only (CRITICAL)

**Status**: NOT FIXED

All modules (ideas, experiments, writing, roadmaps) store data in browser localStorage only:
- `experiments-ui.ts`: `localStorage.getItem('dpr_experiments')`
- `ideas-ui.ts`: `localStorage.getItem('dpr_ideas')`
- `roadmap-ui.ts`: Uses `lib/roadmap/client.ts` for localStorage

**Impact**:
- Manager cannot view progress
- No team collaboration
- Data lost on browser clear / device change
- Cannot generate PDF/slides for stakeholders

**Verdict**: This is a **fundamental architecture issue** — not fixable without adding server-side storage (GitHub-backed docs, database, or external API).

---

### 2. No Export to PDF/Slides (MAJOR)

**Status**: NOT FIXED

- No way to export roadmap progress as PDF
- No way to export experiments as shareable report
- No way to export writing as formatted document

**Industry need**: Weekly status reports to manager, quarterly presentations.

---

### 3. Daily Paper Assumption Still Core (CRITICAL)

**Status**: NOT ADDRESSED

The homepage still centers on "daily paper reader" — daily feed, calendar view, paper-of-the-day. For industry:
- I don't read papers daily
- I search when I have a problem
- I need "question mode": "How do I implement X?"

**Verdict**: DPR's core mental model is academic. This is a design philosophy gap, not a bug.

---

### 4. No Team Features (CRITICAL)

**Status**: NOT ADDRESSED

- No shared library (user library is personal only)
- No team roadmaps
- No experiment sharing
- No commenting/collaboration on ideas

---

### 5. No Integration with Internal Knowledge Bases (MAJOR)

**Status**: NOT ADDRESSED

Industry researchers need:
- Link to internal wikis (Notion, Confluence)
- Link to Slack channels
- Link to internal docs

DPR has no such integrations.

---

### 6. Sprint Granularity UI Missing (MINOR)

**Status**: PARTIALLY FIXED

Data model supports `granularity: 'quarter' | 'month' | 'sprint'`, but:
- No visual timeline/Gantt view
- No month-level breakdown in UI
- No 2-week sprint view

**Impact**: Industry researchers still think in sprints, not quarters.

---

## Summary: What's Fixed vs. What's Missing

### Fixed (Round 1)
- UI for creating/editing roadmaps, experiments, ideas
- Status tracking and dashboards
- Markdown/LaTeX in writing
- Citation picker
- Status tooltips and undo

### Still Missing (Round 2)
| Gap | Severity | Root Cause |
|-----|----------|------------|
| LocalStorage-only storage | CRITICAL | No backend/storage layer |
| No PDF/slides export | MAJOR | No export pipeline |
| Daily paper core assumption | CRITICAL | DPR design philosophy |
| No team collaboration | CRITICAL | No shared storage |
| No internal KB integration | MAJOR | Out of scope |
| Sprint timeline UI | MINOR | Partial fix only |

---

## Recommendations for Next Round

### If staying within DPR ecosystem:

1. **Add GitHub-backed storage**: Store roadmaps/experiments/writings in `docs/roadmap/`, `docs/experiments/`, `docs/writing/` — same as existing docs system. SSR renders them, client edits push to GitHub via API.

2. **Add export pipeline**: Generate PDF from markdown using `markdown-pdf` or similar. Add "Export Progress" button to roadmap detail page.

3. **Add "question mode" search**: Beyond "What's new in Y?" allow "How do I implement X?" that surfaces solutions from papers, not just paper titles.

4. **Add team visibility toggle**: Allow marking roadmaps/experiments as "shared" — render in team view, not just personal.

### If building industry-specific tool:

Start from scratch. The localStorage + daily-digest architecture is fundamentally incompatible with industry research workflows.

---

## Rating

**Acceptable for Industry Use**: NO

**Rationale**:
- Round 1 fixed all UI/interaction issues ✓
- Round 2 reveals that localStorage-only architecture prevents team use ✗
- DPR is an excellent personal academic tool
- For industry, you need: shared storage, progress export, team views, sprint planning, question-based search

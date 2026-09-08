# Industry Researcher Persona Feedback - Iteration 3

**Persona**: Research Scientist at Tech Company (5 years experience)
**Date**: 2026-09-08
**Test Focus**: Industry-specific iteration 2 features

---

## Executive Summary

Tested 5 industry-relevant features per iteration 2 design spec. Results: **3/5 partially implemented**, **2/5 not implemented**. Core localStorage limitation remains blocker for team collaboration.

---

## Test Results

### 1. Search Across All Modules — "alignment"

**Status**: NOT IMPLEMENTED (as unified feature)

- Grep finds 250+ files containing "alignment" across the codebase
- No UI-level unified search across Ideas/Experiments/Writing/Roadmap
- Each module has independent localStorage data, no cross-module search
- Workaround: Use browser devtools console to grep localStorage

```javascript
// Manual workaround
Object.keys(localStorage).filter(k => k.includes('dpr_')).forEach(k => {
  console.log(k, JSON.parse(localStorage.getItem(k)));
});
```

**Verdict**: Feature missing. Need module-search.ts implementation per iter2-design-features.md

---

### 2. Export Experiment as JSON

**Status**: NOT IMPLEMENTED

- export-bridge.ts exists for paper library exports (BibTeX, CSL, RIS, Obsidian ZIP)
- No experiment-specific export handler
- No "Export as JSON" button on experiment cards or detail page

**Current workaround**:
```javascript
// Manual JSON export
const experiments = JSON.parse(localStorage.getItem('dpr_experiments') || '[]');
const blob = new Blob([JSON.stringify(experiments, null, 2)], {type: 'application/json'});
// Then download...
```

**Verdict**: Feature missing. Need export-ui.ts implementation per spec lines 206-208.

---

### 3. Templates — A/B Test Template

**Status**: ✅ IMPLEMENTED

Found at `astro-src/lib/experiments/templates.ts`:

```typescript
{
  id: 'ab-test',
  name: 'A/B Test',
  nameZh: 'A/B 测试',
  description: 'Compare two system variants in production or controlled environment',
  // ...
  tags: ['a-b-test', 'production', 'online-evaluation'],
}
```

Available in create modal at `/experiments/`:
- Ablation Study (消融实验)
- Hyperparameter Sweep (超参数搜索)
- User Study (用户研究)
- A/B Test (A/B 测试)

**Verdict**: Fully implemented. Works as designed.

---

### 4. Dashboard — Quarterly Progress Visualization

**Status**: ✅ PARTIALLY IMPLEMENTED

Found at `astro-src/pages/roadmap/index.astro` lines 110-124:

```astro
<div id="roadmap-dashboard" class="roadmap-dashboard">
  <div class="dashboard-header">
    <h3>进度概览</h3>
    <div class="dashboard-progress">
      <div class="dashboard-progress-bar">
        <div class="dashboard-progress-fill" style="width: 0%"></div>
      </div>
      <span class="dashboard-progress-text">0%</span>
    </div>
  </div>
  <div class="dashboard-stats">
    <!-- Populated by JS -->
  </div>
</div>
```

Features present:
- Progress bar showing % complete
- Stats cards (total/completed/in-progress/pending goals)
- Quarter-by-quarter timeline view

**Limitation**: Visual only, no computed progress from linked experiments (per spec lines 908-979).

**Verdict**: Basic dashboard works. Needs experiment-linked progress calculation.

---

### 5. Roadmap Progress Tracking — % Update on Experiment Status Change

**Status**: NOT IMPLEMENTED

- Roadmap progress computed from goal completion only (lines 59-68 of roadmap/index.astro)
- No code to read linked_experiments and weight by status
- Even though linked_experiments field exists (line 179-188), no progress calculation

**Per spec (iter2-design-features.md lines 936-961)**:
```typescript
const EXPERIMENT_PROGRESS_WEIGHTS: Record<ExperimentStatus, number> = {
  completed: 1.0,
  running: 0.5,
  planning: 0.1,
  paused: 0,
  failed: 0,
};
```

This code is not implemented.

**Verdict**: Feature missing. Progress does NOT update when experiment status changes.

---

## Summary Table

| Feature | Status | Notes |
|---------|--------|-------|
| Search across modules | ❌ Not implemented | No unified search UI |
| Export experiment as JSON | ❌ Not implemented | Paper export exists, experiment not |
| A/B Test template | ✅ Implemented | 4 templates available |
| Dashboard quarterly progress | ✅ Partial | Visual works, no experiment linking |
| Roadmap progress from experiments | ❌ Not implemented | Only goal-based progress |

---

## Root Cause Analysis

**Why 2/5 features missing**:
1. No client-side script `module-search.ts` created
2. No `export-ui.ts` for non-paper exports
3. No `roadmap-ui.ts` update for experiment-linked progress

**Why 2/5 features partial**:
1. Dashboard UI exists but data binding incomplete
2. Templates fully work but no custom template save feature

---

## Rating

**Acceptable for Industry Use**: NO

**Rationale**:
- Templates feature complete and useful ✓
- Dashboard provides basic visibility ✓
- Export for team sharing MISSING ✗
- Cross-module search MISSING ✗
- Progress tracking incomplete ✗

For industry teams, **export + collaboration** are critical. Current localStorage-only architecture makes these impossible without backend.

---

## Recommendations

### Immediate (can ship)
1. Add JSON export button to experiment detail page (low effort, high value)
2. Wire up dashboard stats to actual goal counts (medium effort)

### Next Iteration
1. Implement module-search.ts for unified search
2. Add GitHub-backed storage for roadmaps/experiments (enables export + collaboration)
3. Compute roadmap progress from linked experiments

### Long Term
Replace localStorage with GitHub-backed docs system so teams can share URLs.

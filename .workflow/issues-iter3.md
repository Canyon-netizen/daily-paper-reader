# Iteration 3 Feedback Synthesis

Aggregated from 3 persona reports (PhD, Industry, New User)
Date: 2026-09-08

---

## Summary

| Area | PhD | Industry | New User |
|------|-----|----------|----------|
| Search | PASS | NOT IMPLEMENTED | PASS |
| Export | PASS | NOT IMPLEMENTED | — |
| Templates | PASS | IMPLEMENTED | PASS |
| Dashboard | PASS | PARTIAL | — |
| Dynamic Routes | PASS | — | — |
| Home | — | — | PASS |
| Mobile | — | — | FAIL |
| Nav | Minor | — | Minor |
| Cross-Module | PASS | Issues | — |
| Empty States | — | — | PARTIAL |

---

## Search

**Status: INCONSISTENT / PARTIAL**

- **PhD**: Cross-module search works at `/search/`, uses `search-index.json`, client-side weighted scoring
- **Industry**: No unified search UI across modules (localStorage data silos)
- **New User**: Search easily discoverable on home page hero

**Issue**: Industry persona cannot access search across modules despite feature existing. The build-time `search-index.json` only covers Ideas/Experiments/Writing/Roadmap markdown docs, not client-side localStorage data.

---

## Export

**Status: PARTIAL**

- **PhD**: Writing export works (Markdown + PDF)
- **Industry**: Experiment JSON export NOT IMPLEMENTED (only paper export exists)

**Issue**: Missing `export-ui.ts` for non-paper exports. Need "Export as JSON" button on experiment detail page.

---

## Templates

**Status: PASS**

- **PhD**: 4 templates available at `/experiments/`
- **Industry**: A/B Test template fully implemented
- **New User**: Template selector clearly labeled with auto-fill

---

## Dashboard

**Status: PARTIAL**

- **PhD**: Research dashboard works at `/research/`
- **Industry**: Visual present but no experiment-linked progress calculation

**Issue**: Roadmap progress only computed from goal completion. Per spec, should weight by experiment status (completed=1.0, running=0.5, planning=0.1).

---

## Dynamic Routes

**Status: PASS**

- **PhD**: Add new idea → `bun run predev` → regenerates paths and search index correctly

---

## Home

**Status: PASS**

- **New User**: Welcome modal + workflow cards + shortcuts row provide excellent next-step guidance

---

## Mobile

**Status: FAIL**

- **New User**: `.workflow-cards` has no media query, breaks on narrow screens (<640px)

**Issue #I3-1**: Workflow Cards Not Mobile Responsive
```css
@media (max-width: 640px) {
  .workflow-cards {
    grid-template-columns: 1fr;
  }
}
```

---

## Nav

**Status: MINOR ISSUES**

- **PhD**: Dev server port 4321, trailing slash required, prebuild needed for markdown changes
- **New User**: 14 nav items + GitHub link require horizontal scroll on mobile; tooltips don't work on touch

---

## Cross-Module

**Status: ISSUES**

- **Industry**: localStorage-only architecture blocks team collaboration and export

---

## Empty States

**Status: PARTIAL**

- **New User**: Writing module lacks sample card (Ideas shows example, Writing only shows text)

**Issue #I3-2**: Writing Empty State Missing Sample Card

---

## Additional Issues (New User)

### Issue #I3-3: No Persistent Help Access
- Help button in navbar requires clicking "?" icon
- No obvious help entry point for new users

### Issue #I3-4: Navbar Horizontal Scroll Unfriendly
- 14 nav items require horizontal scroll on mobile
- Tooltips don't work on touch

---

## Priority Matrix

| Priority | Issue | Area |
|----------|-------|------|
| P1 | Mobile CSS for workflow cards | Mobile |
| P1 | Experiment JSON export | Export |
| P1 | Unified search for localStorage data | Search |
| P2 | Writing sample card in empty state | Empty States |
| P2 | Roadmap progress from linked experiments | Dashboard |
| P2 | Help discoverability | Nav |
| P3 | Navbar mobile dropdown | Mobile |

---

## Discrepancies

1. **Search**: PhD/NewUser say PASS, Industry says NOT IMPLEMENTED → Build-time index works, runtime localStorage search missing
2. **Dashboard**: PhD says PASS, Industry says PARTIAL → UI exists, data binding incomplete

# Roadmap Fix Report - Round 1

## Summary

Fixed 5 issues in the roadmap area addressing user feedback from round 1.

---

## Issues Fixed

### Issue #6: No UI to create roadmaps (CRITICAL)
- **Status**: FIXED
- **Files Changed**:
  - `astro-src/pages/roadmap/index.astro` - Added "新建路线图" button and modal form
  - `astro-src/lib/roadmap/client.ts` - Created new client-side module for localStorage operations
  - `astro-src/scripts/roadmap-ui.ts` - Added modal open/close logic
  - `astro-src/styles/roadmap.css` - Added modal styles and button styles

### Issue #7: No UI to edit roadmap goals (CRITICAL)
- **Status**: FIXED
- **Files Changed**:
  - `astro-src/scripts/roadmap-ui.ts` - Added goal status toggle (click to cycle: pending → in-progress → completed)
  - `astro-src/scripts/roadmap-ui.ts` - Added goal edit modal on double-click
  - `astro-src/lib/roadmap/types.ts` - Added `dueDate` and `sprint` fields to RoadmapGoal interface
  - `astro-src/lib/roadmap/index.ts` - Added parsing for dueDate and sprint from markdown
  - `astro-src/pages/roadmap/index.astro` - Added goal edit modal UI

### Issue #8: No sprint/month breakdown (MAJOR)
- **Status**: PARTIALLY FIXED
- **Changes**:
  - Added `granularity` field to RoadmapQuarter (`quarter` | `month` | `sprint`)
  - Added `sprint` field to RoadmapGoal for sprint assignment
  - Added `dueDate` field to RoadmapGoal for milestone tracking
  - Display sprint badges on goal cards
  - Note: Full timeline/Gantt view requires additional UI work

### Issue #25: No progress dashboard (CRITICAL)
- **Status**: FIXED
- **Files Changed**:
  - `astro-src/pages/roadmap/index.astro` - Added progress dashboard section with stats cards
  - `astro-src/scripts/roadmap-ui.ts` - Added dashboard initialization to calculate and display stats
  - `astro-src/styles/roadmap.css` - Added dashboard styles

### Issue #26: No milestone date tracking (MAJOR)
- **Status**: FIXED
- **Changes**:
  - Added `dueDate` optional field to RoadmapGoal interface
  - Added parsing for `DueDate` / `截止日期` from markdown
  - Display due date on goal cards
  - UI ready for future "overdue" highlighting

---

## Technical Details

### Architecture
- **Server-side**: Reads roadmaps from `docs/roadmap/*.md` files (existing)
- **Client-side**: New localStorage-based storage for user-created roadmaps
- Modal forms for creating/editing roadmaps and goals
- Click-to-toggle goal status
- Double-click to edit goal details

### New Files Created
- `astro-src/lib/roadmap/client.ts` - Client-side roadmap operations

### Modified Files
- `astro-src/lib/roadmap/types.ts` - Added dueDate, sprint, granularity fields
- `astro-src/lib/roadmap/index.ts` - Added parsing for new fields
- `astro-src/pages/roadmap/index.astro` - Added UI components
- `astro-src/scripts/roadmap-ui.ts` - Full client interactivity
- `astro-src/styles/roadmap.css` - Modal, dashboard, and badge styles

---

## Limitations

1. **localStorage-only**: Client-created roadmaps persist only in browser localStorage, not in the GitHub-backed docs system. They won't appear in SSR builds.
2. **Granularity UI**: The sprint/month view is data-ready but lacks a full timeline/Gantt visualization.
3. **Bidirectional linking**: Ideas/experiments can be linked in data but UI for linking is not yet implemented.

---

## Follow-up Items (Out of Scope)

- #22: UI to link ideas/experiments to roadmap (integration area)
- Export to PDF/slides for progress reports
- GitHub-backed storage for roadmap sharing

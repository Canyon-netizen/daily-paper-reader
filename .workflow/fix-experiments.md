# Experiments Area Fix Report — Round 1

## Issues Fixed

### Critical Issues

#### 1. No UI to create experiments (#1)
**Status**: FIXED
- Added "新建实验" button to experiments list page
- Created modal form with all experiment fields (title, hypothesis, method, expected results, tags, related papers, related ideas)
- Data stored in localStorage (like ideas)
- File: `astro-src/pages/experiments/index.astro`, `astro-src/scripts/experiments-ui.ts`

#### 2. No "Create Experiment from Idea" button (#2)
**Status**: FIXED
- Added "创建实验" button on idea detail page (`astro-src/pages/ideas/[id].astro`)
- Pre-fills experiment title and hypothesis from idea data
- Passes idea ID via URL params to experiments page
- Experiments page auto-opens modal with pre-filled data (`astro-src/scripts/experiments-ui.ts`)

#### 3. Cannot change experiment status from UI (#3)
**Status**: FIXED
- Added status change buttons on experiment cards (running/completed/paused/failed)
- Added status change buttons on detail page
- Added undo toast with 5-second timeout
- File: `astro-src/scripts/experiments-ui.ts`, `astro-src/pages/experiments/[id].astro`

### Major Issues

#### 4. No experiment detail page (#4)
**Status**: FIXED
- Updated detail page to load from localStorage client-side
- Added edit modal for all experiment fields
- Shows related papers, related ideas, variables, results
- File: `astro-src/pages/experiments/[id].astro`

#### 5. No experiment-idea linking (#5)
**Status**: FIXED
- Added `relatedIdeas` field to experiment type (`astro-src/lib/experiments/types.ts`)
- Form allows input of related idea IDs
- Detail page shows linked ideas with links to idea pages
- "Create from Idea" automatically links the source idea

## Changes Made

### Files Modified

1. **astro-src/lib/experiments/types.ts**
   - Added `relatedIdeas?: string[]` field to Experiment
   - Added `EXPERIMENTS_KEY`, `ExperimentsDoc` for localStorage
   - Added `createExperimentData()` helper function

2. **astro-src/lib/experiments/index.ts**
   - Complete rewrite to support localStorage persistence
   - Added `loadExperiments()`, `saveExperiments()`, `createExperiment()`, `updateExperiment()`, `deleteExperiment()`, `getExperimentCounts()`
   - Default experiments pre-populated on first load

3. **astro-src/scripts/experiments-ui.ts**
   - Complete rewrite with client-side rendering
   - Filter, create, edit, delete, status change functionality
   - Undo toast for status changes
   - URL parameter handling for prefill from idea

4. **astro-src/pages/experiments/index.astro**
   - Changed to client-side rendering shell
   - Added new experiment modal with full form
   - Removed SSR data fetching

5. **astro-src/pages/experiments/[id].astro**
   - Changed to load from localStorage client-side
   - Added edit modal
   - Added status change buttons
   - Shows related ideas and papers

6. **astro-src/pages/ideas/[id].astro**
   - Added "创建实验" button
   - Passes idea data via URL params

7. **astro-src/styles/experiments.css**
   - Added modal styles
   - Added card action styles
   - Added undo toast styles
   - Added detail page action styles

## Limitations / Notes

- All data is localStorage-only (same as ideas) — no SSR persistence
- Related ideas must be entered manually as IDs (no dropdown/search)
- Experiment variables are not editable via current UI (stored but no form field)
- Default experiments load on first visit but are read-only until user creates first custom experiment

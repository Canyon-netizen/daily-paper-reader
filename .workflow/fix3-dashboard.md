# Iter3 Fix: Dashboard Area

## Summary

Fixed the roadmap progress calculation to include experiment status weighting as specified in iter3 feedback.

## Issues Addressed

### Issue: Roadmap Progress from Linked Experiments (P2 - Dashboard)

**Problem**: Roadmap progress was only computed from goal completion. Per iter3 feedback, it should weight by experiment status:
- completed = 1.0
- running = 0.5
- planning = 0.1
- failed/paused = 0.0

**Root Cause**: The progress calculation in `lib/roadmap/index.ts` only counted goal completion, ignoring linked experiments.

**Fix Applied**:

1. **lib/roadmap/types.ts**: Added `experimentProgress` field to `RoadmapSummary` interface

2. **lib/roadmap/index.ts**:
   - Added `EXPERIMENT_STATUS_WEIGHTS` constant for experiment status weighting
   - Added `getExperimentProgressWeight()` helper function
   - Added `calculateExperimentProgress()` function to compute weighted progress from linked experiments (client-side localStorage)
   - Updated `listRoadmaps()` to include experiment progress in summaries

3. **scripts/roadmap-ui.ts**:
   - Updated `initProgressDashboard()` to calculate experiment progress
   - Added combined progress calculation: 70% goals + 30% experiments
   - Added experiment progress stat card in the dashboard
   - Updated progress bar to show combined progress

## Files Modified

- `astro-src/lib/roadmap/types.ts` - Added experimentProgress field
- `astro-src/lib/roadmap/index.ts` - Added experiment progress calculation
- `astro-src/scripts/roadmap-ui.ts` - Updated dashboard to display weighted progress

## Testing Notes

- The experiment progress calculation runs client-side using localStorage (`dpr_experiments`)
- Progress weights: completed=1.0, running=0.5, planning=0.1, failed/paused=0.0
- Combined progress displayed in roadmap detail page dashboard: 70% goal + 30% experiment weighting

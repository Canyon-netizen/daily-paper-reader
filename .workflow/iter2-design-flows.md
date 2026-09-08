# Iteration 2: End-to-End Workflow Design

> Version: 1.0 | Date: 2026-09-08
> Purpose: Connect 4 separate modules into unified research workflows

---

## Overview

Iteration 1 built 4 independent modules (Ideas, Experiments, Writing, Roadmap) that function as separate tools. This iteration designs the connective tissue that makes them feel like one coherent research journey.

**Design Principle**: The user should always know "where they are" in their research lifecycle and have clear paths to next steps.

---

## 1. Paper-to-Paper Pipeline

**User Story**: I read papers → find insights → develop ideas → run experiments → write up → cite related work → submit

### 1.1 Pipeline Stages

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Read       │───▶│  Highlight  │───▶│  Save as    │───▶│  Design     │───▶│  Run        │
│  Paper      │    │  Insight    │    │  Idea       │    │  Experiment │    │  Experiment │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                                                   │                      │
       │                                    ┌─────────────┴─────────────┐     │
       │                                    ▼                           ▼     │
       │                           ┌─────────────┐              ┌─────────────┐
       │                           │  Link to   │              │  Write      │
       │                           │  Library   │              │  Section    │
       │                           └─────────────┘              └─────────────┘
       │                                    │                      │
       ▼                                    ▼                      ▼
┌─────────────┐                     ┌─────────────┐      ┌─────────────┐
│  Cite in    │◀────────────────────│  See How    │      │  Add to     │
│  Writing    │                      │  It Links   │      │  Writing    │
└─────────────┘                      └─────────────┘      └─────────────┘
```

### 1.2 Page Sequence

| Step | Page | Action | Auto-Link | Manual-Link |
|------|------|--------|------------|--------------|
| 1 | `/papers/[id]/` | Read paper | - | - |
| 2 | Speed-read note modal | Highlight key insight | Save insight text to idea.description | User selects "Save as Idea" |
| 3 | `/ideas/[id]/` | Refine idea | Related papers auto-populated from speed-read | User adds more papers |
| 4 | `/experiments/new/` (from idea) | Design experiment | relatedIdeas populated from current idea | User adds hypothesis/method |
| 5 | Experiment status update | Mark running → done | - | User updates status |
| 6 | `/writing/[id]/` (from experiment) | Write up | relatedExperiments, relatedPapers populated | User writes content |
| 7 | Writing detail | Add citations | citedPapers populated from linked experiments | User adds more citations |
| 8 | Submit | Final status | - | User marks final |

### 1.3 Auto-Link Behavior

| Trigger | Auto-Links To | Example |
|---------|---------------|---------|
| Speed-read "Save as Idea" | Current paper → new Idea | Paper 1706.03762 → Idea "Attention Scaling" |
| Create Experiment from Idea | Idea → new Experiment | Idea "Attention Scaling" → Experiment "Ablation Heads" |
| Create Writing from Experiment | Experiment + its papers → new Writing | Experiment + papers → Writing "Scaling Paper" |
| Experiment status → done | Experiment → linked Roadmap goals | Auto-check roadmap goals if all experiments done |

### 1.4 Manual-Link Behavior

| Action | Manual Link UI |
|--------|----------------|
| Add related paper to Idea | "+ Add Paper" button → opens paper search modal |
| Link Idea to another Idea | "Link Idea" button → dropdown of existing ideas |
| Add experiment to Roadmap | Roadmap detail "Add Experiment" → experiment picker |
| Add citation to Writing | Citation toolbar → paper search with recent papers |

### 1.5 "My Research Journey" Dashboard

**Route**: `/dashboard/` (new)

**Layout**:
```
┌─────────────────────────────────────────────────────────────────┐
│  My Research Journey                         [Last 30 days ▼]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Ideas    │  │Experi-   │  │ Writings │  │ Roadmaps │      │
│  │ 3 active │  │ments 2   │  │ 4 drafts │  │ 1 active │      │
│  │ +2 this  │  │ +1 this  │  │          │  │          │      │
│  │ month    │  │ month    │  │          │  │          │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Recent Activity                                                │
│  ─────────────────────────────────────────────────────────────  │
│  • Sep 8  Created "Transformer Scaling" idea                   │
│  • Sep 7  Completed "Ablation Head Count" experiment           │
│  • Sep 6  Wrote Section 2 in "Scaling Laws Paper"              │
│  • Sep 5  Linked paper 1706.03762 to "Attention" idea         │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Pipeline View (horizontal scroll)                             │
│  ─────────────────────────────────────────────────────────────  │
│  [Idea] ──▶ [Experiment] ──▶ [Writing] ──▶ [Submit]           │
│     │           │               │                               │
│     ▼           ▼               ▼                               │
│  ──────      ──────         ──────                             │
│  Ideas 2    Expts 1       Writings 1                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Filters**:
- Time range: Last 7/30/90 days, All time
- Status: All, Active only, Completed only
- Tags: Multi-select from user's tags

---

## 2. Quarterly Planning Workflow

**User Story**: I plan my quarter → create goals → link ideas/experiments → track progress visually

### 2.1 Visual Progress Representation

**Route**: `/roadmap/[id]/`

**Layout**:
```
┌─────────────────────────────────────────────────────────────────┐
│  Q4 2026 Research Plan                      [Edit] [Delete]  │
├─────────────────────────────────────────────────────────────────┤
│  Period: 2026-Q4 (Oct-Dec)    Goals: 3/5 completed             │
│  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  60%                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Goal 1: Complete attention scaling experiments          │   │
│  │ ████████████████████████████████░░░░░░░░  90%           │   │
│  │                                                         │   │
│  │ Linked: [Idea: Attention Scaling]  [Experiment: Ablation]│  │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Goal 2: Submit ICML paper                              │   │
│  │ ██████████░░░░░░░░░░░░░░░░░░░░░░░░░  40%              │   │
│  │                                                         │   │
│  │ Linked: [Writing: ICML Paper]                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Goal 3: Read 20 papers on related work                 │   │
│  │ ██████████████████████████████████████  100% ✓           │   │
│  │                                                         │   │
│  │ Linked: [Library: 22 papers]                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [+ Add Goal]  [Link Idea]  [Link Experiment]                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Color-Coded Status Bars

| Goal Status | Visual | Condition |
|-------------|--------|-----------|
| Not started | Gray (`#6b7280`) | No linked items, 0% |
| In progress | Blue (`#3b82f6`) | Linked items exist, status mixed |
| At risk | Amber (`#f59e0b`) | Linked experiments overdue (not implemented) |
| Completed | Green (`#22c55e`) | All linked items are done/finished |
| Blocked | Red (`#ef4444`) | Any linked experiment marked "blocked" |

### 2.3 Auto-Aggregation Logic

When computing goal progress:

```typescript
function computeGoalProgress(goal: RoadmapGoal): number {
  const linkedIdeas = goal.linkedIdeas.filter(id => ideas[id]?.status === 'active');
  const linkedExperiments = goal.linkedExperiments.filter(id => {
    const exp = experiments[id];
    return exp?.status === 'done' || exp?.status === 'running';
  });
  const linkedWritings = goal.linkedWritings.filter(id => {
    const w = writings[id];
    return w?.status === 'review' || w?.status === 'final';
  });

  const total = linkedIdeas.length + linkedExperiments.length + linkedWritings.length;
  if (total === 0) return 0;

  const completed = linkedExperiments.filter(e => experiments[e]?.status === 'done').length +
                    linkedWritings.filter(w => writings[w]?.status === 'final').length;

  return Math.round((completed / total) * 100);
}
```

### 2.4 Quarterly Planning Page Sequence

| Step | Page | Action |
|------|------|--------|
| 1 | `/roadmap/` | Click "Create Roadmap" |
| 2 | Modal: Create Roadmap | Select "Quarter", enter period "2026-Q4" |
| 3 | Roadmap detail | Click "+ Add Goal", enter description |
| 4 | Goal detail | Click "Link Idea" → picker → select ideas |
| 5 | Goal detail | Click "Link Experiment" → picker → select/create experiments |
| 6 | Return to Roadmap | See progress bars auto-update |

---

## 3. New User Onboarding

**User Story**: First visit → understand what this tool does → create first idea → see how it connects to library

### 3.1 First Visit Detection

Check localStorage on initial load:
```typescript
const SEEN_ONBOARDING_KEY = 'dpr_onboarding_completed_v1';

function hasCompletedOnboarding(): boolean {
  return localStorage.getItem(SEEN_ONBOARDING_KEY) === 'true';
}
```

### 3.2 Tutorial Overlay Flow

**Trigger**: User visits any page and `!hasCompletedOnboarding()`

**Sequence**:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              Welcome to Your Research Workspace                │
│                                                                 │
│    This tool helps you track ideas, run experiments,          │
│    and write papers — all connected to your paper library.    │
│                                                                 │
│    Let's take a quick tour.                               [Skip]│
│                                                                 │
│                                                    [Next ▶]     │
└─────────────────────────────────────────────────────────────────┘
```

**Step 1: Ideas**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    💡 Ideas capture research insights                          │
│                                                                 │
│    When you read papers, save key insights as ideas.           │
│    Each idea links to the papers that inspired it.            │
│                                                                 │
│         ┌─────────────────────────────┐                       │
│         │ Idea: Attention Scaling     │                       │
│         │ "More heads → better perf"   │                       │
│         │ 📄 1706.03762, 2008.11826   │                       │
│         └─────────────────────────────┘                       │
│                                                                 │
│                                         [◀ Back] [Next ▶]      │
└─────────────────────────────────────────────────────────────────┘
```

**Step 2: Experiments**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    🔬 Experiments verify your hypotheses                       │
│                                                                 │
│    Turn ideas into concrete experiments.                       │
│    Track progress from planned → running → done.              │
│                                                                 │
│         ┌─────────────────────────────┐                       │
│         │ Ablation: Head Count    [▶]│                       │
│         │ Hypothesis: ...            │                       │
│         │ Status: Running ████░░     │                       │
│         └─────────────────────────────┘                       │
│                                                                 │
│                                         [◀ Back] [Next ▶]      │
└─────────────────────────────────────────────────────────────────┘
```

**Step 3: Writing**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    ✍️ Writing connects experiments to papers                   │
│                                                                 │
│    Write sections, notes, or full papers.                      │
│    Citations auto-link from your experiments.                  │
│                                                                 │
│         ┌─────────────────────────────┐                       │
│         │ Scaling Laws Paper (draft)  │                       │
│         │ Intro ████████░░ 40%         │                       │
│         │ Methods ██░░░░░░░ 10%        │                       │
│         │ Related: 2 experiments       │                       │
│         └─────────────────────────────┘                       │
│                                                                 │
│                                         [◀ Back] [Next ▶]      │
└─────────────────────────────────────────────────────────────────┘
```

**Step 4: Roadmap**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    🗺️ Roadmap tracks your long-term goals                     │
│                                                                 │
│    Plan quarterly goals. Link ideas and experiments.          │
│    Progress bars show how you're doing.                        │
│                                                                 │
│         ┌─────────────────────────────┐                       │
│         │ Q4 2026 Goals          60%  │                       │
│         │ ████████████░░░░░░░░░░░     │                       │
│         │ ✓ Paper submitted           │                       │
│         │ ○ 3 experiments complete    │                       │
│         └─────────────────────────────┘                       │
│                                                                 │
│                                         [◀ Back] [Next ▶]      │
└─────────────────────────────────────────────────────────────────┘
```

**Step 5: Create First Idea**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    Try it now: Create your first idea                          │
│                                                                 │
│    Title: [                                    ]               │
│                                                                 │
│    Description: [                                         ]   │
│                [                                         ]   │
│                                                                 │
│    Related Papers: [+ Add from Library]                       │
│                                                                 │
│           [Cancel]                      [Create Idea]         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Completion**:
- Save to localStorage: `dpr_onboarding_completed_v1 = 'true'`
- Show success toast: "Welcome! Your research journey begins."

### 3.3 Sample Data for Demo

If user skips creation, pre-populate with sample data:

```typescript
const SAMPLE_IDEA = {
  id: 'sample-attention-scaling',
  title: 'Attention Mechanism Scaling',
  description: 'Explore relationship between attention heads and model performance',
  status: 'active' as const,
  relatedPapers: ['1706.03762'],  // Attention is All You Need
  relatedConcepts: [],
  tags: ['sample'],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

const SAMPLE_EXPERIMENT = {
  id: 'sample-head-ablation',
  title: 'Attention Head Ablation Study',
  hypothesis: 'Reducing heads by 50% yields <10% accuracy loss',
  method: 'Ablate heads in BERT-base, evaluate on GLUE',
  variables: [
    { name: 'head_count', type: 'independent' as const, description: 'Number of heads' },
    { name: 'glue_score', type: 'dependent' as const, description: 'GLUE score' }
  ],
  expectedResults: 'Sub-linear degradation',
  status: 'planned' as const,
  relatedIdeas: ['sample-attention-scaling'],
  relatedPapers: ['1706.03762', '1810.04805'],
  relatedWritings: [],
  progressLog: [],
  createdAt: Date.now(),
  updatedAt: Date.now()
};
```

### 3.4 Onboarding Completion State

After tutorial:
- User has 1 idea in `/ideas/`
- User understands: ideas come from papers, experiments verify ideas, writing connects experiments, roadmap organizes goals

---

## 4. Cross-Module Dashboard

**User Story**: I want to see all my active work in one place, filter by what matters, drill down into details

### 4.1 Dashboard Route

**Route**: `/dashboard/` (new standalone page, not under existing nav)

**Entry Point**: Add to Navbar under "Research" dropdown:
```
Research ▼
  ├── Dashboard (new)
  ├── Ideas
  ├── Experiments
  ├── Writing
  └── Roadmap
```

### 4.2 Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  Research Dashboard                        [🔍 Search...]       │
│  ────────────────────────────────────────────────────────────  │
│                                                                 │
│  Filters:  [Status ▼]  [Type ▼]  [Date ▼]  [Tags ▼]  [Clear]  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Summary Stats                                            │   │
│  │ ───────────────────────────────────────────────────────  │   │
│  │  Ideas    │ Experiments │ Writings  │ Roadmap Goals   │   │
│  │  12       │ 5           │ 8         │ 15/24           │   │
│  │  +3 this  │ +2 this     │ +1 this   │ +5 this quarter │   │
│  │  week     │ week        │ week      │                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐     │
│  │ Active Items (scrollable list)                         │     │
│  │ ─────────────────────────────────────────────────────  │     │
│  │                                                       │     │
│  │ ┌─────────────────────────────────────────────────┐   │     │
│  │ │ 💡 Attention Scaling                            │   │     │
│  │ │ "More heads → better performance"               │   │     │
│  │ │ Status: active  •  Related: 3 papers            │   │     │
│  │ │ [View Idea] [→ Experiment] [→ Writing]          │   │     │
│  │ └─────────────────────────────────────────────────┘   │     │
│  │                                                       │     │
│  │ ┌─────────────────────────────────────────────────┐   │     │
│  │ │ 🔬 Ablation Head Count                          │   │     │
│  │ │ Hypothesis: Reducing heads yields <5% loss       │   │     │
│  │ │ Status: running  •  Progress: ████░░░░ 60%      │   │     │
│  │ │ [View Experiment] [→ Writing]                   │   │     │
│  │ └─────────────────────────────────────────────────┘   │     │
│  │                                                       │     │
│  │ ┌─────────────────────────────────────────────────┐   │     │
│  │ │ ✍️ Scaling Laws Paper                           │   │     │
│  │ │ Type: paper  •  Venue: ICML 2027                │   │     │
│  │ │ Status: draft  •  Words: 2,340                  │   │     │
│  │ │ [View Writing]                                  │   │     │
│  │ └─────────────────────────────────────────────────┘   │     │
│  │                                                       │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐     │
│  │ Quick Actions                                          │     │
│  │ ─────────────────────────────────────────────────────  │     │
│  │ [+ New Idea]  [+ New Experiment]  [+ New Writing]    │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Filter Behavior

| Filter | Options | Logic |
|--------|---------|-------|
| Status | All, Active, Draft, Completed, Archived | `item.status === selected` |
| Type | All, Idea, Experiment, Writing | `item.type === selected` |
| Date | Last 7 days, Last 30 days, Last 90 days, All time | `item.updatedAt > cutoff` |
| Tags | Dynamic from user's tags | `item.tags.includes(selected)` |

**URL Sync**: Filters sync to URL query params:
- `/dashboard/?status=active&type=experiment`
- Allows sharing filtered views

### 4.4 Drill-Down Interactions

| Item Type | Click Action | Result |
|-----------|--------------|--------|
| Idea card | Click card | Navigate to `/ideas/[id]/` |
| Idea card | Click "→ Experiment" | Open modal to create experiment linked to this idea |
| Experiment card | Click card | Navigate to `/experiments/[id]/` |
| Experiment card | Click "→ Writing" | Open modal to create writing linked to this experiment |
| Writing card | Click card | Navigate to `/writing/[id]/` |
| Any card | Hover | Show quick actions: Edit, Delete, Archive |

### 4.5 State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                     DASHBOARD STATE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   LOAD ──▶ FETCH_ALL_DATA ──▶ RENDER_DASHBOARD                │
│     │              │                                             │
│     │              ▼                                             │
│     │         FILTER_APPLIED ──▶ RENDER_FILTERED               │
│     │              │                                             │
│     │              ▼                                             │
│     │         SEARCH_QUERY ──▶ RENDER_SEARCH_RESULTS           │
│     │                                                     │     │
│     ▼                                                     │     │
│   ITEM_CLICKED ──▶ NAVIGATE_TO_DETAIL ◀────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Notes

### 5.1 New Routes Required

| Route | Component | Notes |
|-------|------------|-------|
| `/dashboard/` | `Dashboard.astro` | Main cross-module view |
| `/roadmap/[id]/` | `RoadmapDetail.astro` | Already in design-final.md |

### 5.2 Existing Routes to Modify

| Route | Modification |
|-------|--------------|
| `/papers/[id]/` | Add "Save as Idea" button in speed-read modal |
| `/ideas/[id]/` | Add "Create Experiment" CTA |
| `/experiments/[id]/` | Add "Write Up" CTA |
| `/writing/[id]/` | Already has paper citation UI |

### 5.3 Event Emissions (Extend Phase E)

```typescript
// lib/events/names.ts additions
export const DPR_IDEA_PROMOTED_TO_EXPERIMENT = 'dpr:idea-promoted-to-experiment';
export const DPR_EXPERIMENT_COMPLETED = 'dpr:experiment-completed';
export const DPR_EXPERIMENT_WRITING_CREATED = 'dpr:experiment-writing-created';
export const DPR_GOAL_PROGRESS_UPDATED = 'dpr:goal-progress-updated';
```

### 5.4 localStorage Keys (Existing)

Already defined in design-final.md:
- `dpr_ideas_v1`
- `dpr_experiments_v1`
- `dpr_writings_v1`
- `dpr_roadmaps_v1`

Add:
- `dpr_onboarding_completed_v1`

---

## 6. Acceptance Criteria

### 6.1 Dashboard
- [ ] `/dashboard/` renders without errors
- [ ] Shows count summaries for all 4 module types
- [ ] Filter by status works
- [ ] Filter by type works
- [ ] Search filters by title
- [ ] Clicking item navigates to detail
- [ ] Quick action buttons create new linked items

### 6.2 Pipeline Navigation
- [ ] Paper detail has "Save as Idea" in speed-read
- [ ] Idea detail has "Create Experiment" CTA
- [ ] Experiment detail has "Write Up" CTA
- [ ] Auto-populates linked items when creating downstream

### 6.3 Quarterly Planning
- [ ] Roadmap shows progress bars per goal
- [ ] Progress auto-calculates from linked items
- [ ] Color coding reflects status
- [ ] Goals can link ideas, experiments, writings

### 6.4 Onboarding
- [ ] First visit shows tutorial overlay
- [ ] Can skip or complete tutorial
- [ ] After completion, marked in localStorage
- [ ] Sample data available for demo

---

## 7. File Structure Updates

```
astro-src/
├── pages/
│   ├── dashboard.astro          # NEW
│   ├── ideas/
│   │   └── [id].astro           # MODIFIED: add Create Experiment CTA
│   ├── experiments/
│   │   └── [id].astro          # MODIFIED: add Write Up CTA
│   ├── writing/
│   │   └── [id].astro
│   └── roadmap/
│       └── [id].astro           # NEW
├── components/
│   ├── TutorialOverlay.astro     # NEW
│   ├── DashboardSummary.astro   # NEW
│   ├── PipelineCard.astro       # NEW
│   └── GoalProgressBar.astro    # NEW
└── lib/
    └── workflows/
        ├── store.ts            # MODIFIED: add cross-module queries
        └── pipeline.ts         # NEW: pipeline helper functions
```

---

## 8. Out of Scope (v2)

- Server-side sync
- Collaborative editing
- Automated experiment tracking (MLflow integration)
- Citation management (BibTeX export)
- PDF export
- Mobile app

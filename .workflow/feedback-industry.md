# Industry Researcher Persona Feedback

**Persona**: Research Scientist at Tech Company (5 years experience)
**Date**: 2026-09-07
**Test Focus**: DPR for industry research workflows

---

## Executive Summary

The DPR roadmap/experiments/writing modules exist structurally but are **deeply academic** in design. An industry researcher cannot effectively use this system without significant workflow changes. The core assumption—that researchers read many papers daily—is incompatible with industry realities.

---

## Workflow-by-Workflow Assessment

### 1. Define Quarterly Research Goals in Roadmap

**Status**: PARTIALLY FUNCTIONAL

The roadmap system supports quarter-based goals with `type: 'industry'`. There is an example at `docs/roadmap/industry-llm-agent-2026.md`.

**Gaps**:
- Goals are static markdown files—no UI to create/edit goals dynamically
- No way to set goals per quarter through the web interface
- No milestone date tracking (only quarter-level granularity)
- Industry researchers need month-by-month or sprint-based breakdown, not quarterly
- No concept of "researcher headcount" or "budget allocation" tied to goals

**Verdict**: Academic timeline design. Industry needs sprint velocity, not quarterly milestones.

---

### 2. Plan 3 Ideas for the Quarter

**Status**: EXISTS BUT DISCONNECTED

Ideas module exists (`lib/ideas/`) with proper types (draft/active/promoted/archived). The roadmap can link ideas via `linked_ideas` array.

**Gaps**:
- Ideas are stored in localStorage—zero SSR, no sharing with team members
- No "scoping" or "estimation" fields on ideas (effort days, priority rank, dependency links)
- No UI to create ideas and link them to roadmap goals in one flow
- The example roadmap references `idea-agent-observability` and `idea-cost-optimization` but these don't exist in docs/ideas/
- No "idea bank" or "backlog" view to manage pipeline

**Verdict**: Ideas exist as a concept but are isolated islands. No workflow to turn ideas into scoped work.

---

### 3. Design Experiment Per Idea

**Status**: FUNCTIONAL

The experiments module (`lib/experiments/types.ts`) is well-designed with:
- Hypothesis, method, variables (independent/dependent/controlled)
- Status tracking (planning/running/completed/failed/paused)
- Related papers linking

**Gaps**:
- Experiments must be written as markdown files in `docs/experiments/`—no web UI to create/edit
- No integration with ideas—can't say "experiment validates idea X"
- Variables are free-form text, not structured data fields (hard to query/filter)
- No experiment template library
- No "run" tracking (which LLM, which dataset, which commit hash used)

**Verdict**: Structure is there but it's a documentation system, not a tool.

---

### 4. Track Experiments Running vs Planned

**Status**: PARTIALLY FUNCTIONAL

The experiments list page (`/experiments/`) shows:
- Status filter tabs (planning/running/completed/failed/paused)
- Count badges per status
- Card grid with status badges

**Gaps**:
- No visual progress indicator (e.g., "2/5 experiments running")
- No timeline view of experiments
- No Gantt chart or calendar view
- Cannot see "experiments per quarter" or "experiments per goal"
- The roadmap detail page shows linked experiments as a simple list—no status summary

**Verdict**: Basic status filtering works. No visual progress dashboard.

---

### 5. Write Up Results as Internal Report

**Status**: PARTIALLY IMPLEMENTED

Writing module exists (`/writing/`) with:
- Types: paper/section/note/review/translation
- Status: draft/review/final
- Sections with version history
- Related ideas/experiments linking

**Gaps**:
- Writing is 100% client-side (localStorage only)—cannot share with manager
- No "internal report" type—only academic paper/note/review
- No export to Markdown/HTML/PDF
- No collaboration features (comments, reviews)
- No integration with experiments to auto-populate results section

**Verdict**: A personal note-taking system, not a team reporting system.

---

### 6. Show Progress to Manager

**Status**: NON-FUNCTIONAL

**Critical gaps**:
- No "dashboard" showing roadmap progress
- No exportable progress report (PDF/slide)
- No "share with manager" feature
- All data in localStorage—manager cannot view unless they have access to your browser
- No email/Slack notification of progress
- No "single-page progress view" for external stakeholders

**Verdict**: Completely missing. The system cannot show progress to anyone but the user.

---

### 7. Less-Paper-Heavy Workflow

**Status**: ASSUMPTION VIOLATION

DPR is built on "daily paper reading." For industry:
- I don't read papers daily—I read them when I need to solve a problem
- I need search, not daily digest
- I need internal reports, not paper annotations
- I need team knowledge, not personal library

**Gaps**:
- Daily feed is the core of DPR—there's no "turn off daily feed" option
- All roads lead back to arXiv papers
- No "question-based" workflow: "How do I implement X?" instead of "What's new in Y?"
- No integration with internal knowledge bases ( wikis, Slack, Notion)
- User library is personal—cannot share papers with team

**Verdict**: DPR assumes academic workload. Industry researchers need a fundamentally different system.

---

## Summary of Critical Gaps for Industry Use

| Gap | Severity | Impact |
|-----|----------|--------|
| No shared storage (all localStorage) | CRITICAL | Cannot collaborate with team |
| No UI to create/edit roadmaps | MAJOR | Must edit markdown manually |
| No progress dashboard | MAJOR | Cannot show manager |
| No experiment-idea linking | MAJOR | Workflow disconnected |
| No sprint/month breakdown | MAJOR | Too coarse for industry |
| No export (PDF/slides) | MAJOR | Cannot communicate results |
| Daily paper assumption | CRITICAL | Wrong mental model |
| No team features | CRITICAL | Solo use only |

---

## Recommendations

### If staying within DPR ecosystem:

1. **Add team sync layer**: Store roadmaps/experiments/writings in GitHub, not localStorage
2. **Build progress dashboard**: Aggregate status counts, render as single-page report
3. **Add sprint support**: Allow month or 2-week granularity in roadmap
4. **Create experiment templates**: Pre-built markdown templates for common experiment types
5. **Add "question mode"**: Search that surfaces solutions, not just papers

### If building industry-specific tool:

Start from scratch. Industry research tools need:
- Team collaboration (not personal notes)
- Progress reporting (for stakeholders)
- Sprint planning (not quarterly milestones)
- Integration with internal docs
- Export to corporate formats

DPR is a fantastic personal academic tool. It is not an industry research tool.

---

## Rating

**Acceptable for Industry Use**: NO

The fundamental assumptions (daily paper reading, personal localStorage, academic output) are incompatible with industry research workflows.

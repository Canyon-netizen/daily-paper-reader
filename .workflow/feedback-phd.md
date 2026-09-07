# PhD Student Persona Feedback — Research Modules

**Test Persona:** 2nd year PhD in ML/NLP, reads 50+ papers/month, manages 5-10 active research ideas, designing 2 experiments, drafting 1 workshop paper, 6-month research roadmap.

**Date:** 2026-09-07

**Note:** Could not run dev server (node not available in environment), feedback based on code review.

---

## Workflow 1: Capture Idea After Reading Paper

### What Works Well
- Ideas stored in localStorage, fast and private
- Card shows title, description preview, related papers as badges, tags
- Status workflow: draft → active → promoted → archived with quick-toggle buttons
- Date tracking (created/updated)

### Issues Found

**MAJOR: No way to link from paper detail page**
- After reading a paper at `/papers/[id]/`, there's no "Save as Idea" or "Add to Ideas" button
- User must copy arXiv ID, navigate to /ideas/, create new idea, paste ID
- Friction kills the capture workflow

**MAJOR: Related papers field is free-text**
- Input accepts comma-separated arXiv IDs, but no validation
- No autocomplete or paper search
- User must know the exact arXiv ID (e.g., "1706.03762" not "Attention is All You Need")

**MINOR: No markdown support in description**
- Description is plain text only
- Can't add bullet points, links, or formatting for complex ideas

**MINOR: No rich text editor**
- Just a plain textarea

---

## Workflow 2: Evolve Idea (Status Change)

### What Works Well
- Quick status toggle buttons on card (rockets/stars/box icons)
- Status persists to localStorage immediately
- Count badges update dynamically (e.g., "进行中 3")

### Issues Found

**MINOR: Status meanings unclear**
- "promoted" — promoted to what? No tooltip explaining lifecycle
- "archived" — is this deletion with history? Or a holding state?

**MINOR: No status change confirmation**
- One click changes status, no undo
- No "undo" button if accidentally clicked

---

## Workflow 3: Design Experiment From Idea

### What Works Well
- Experiments have rich structure: hypothesis, method, variables, expected/actual results
- Status: planning → running → completed/failed/paused
- Tags and related papers support

### Critical Issues

**CRITICAL: No "Create Experiment from Idea" button**
- Idea detail page has no link to experiments
- User must:
  1. Go to /experiments/
  2. Click "新建实验" (but there's NO create button on the list page — it's SSR-only with no create UI!)
  3. Manually copy idea title → experiment title
  4. Manually copy idea description → hypothesis
- This is a **broken workflow**

**CRITICAL: No create UI for experiments**
- Looking at `/experiments/index.astro`, there's NO "New Experiment" button
- Only status filter buttons
- Data is hardcoded in `lib/experiments/index.ts` as `EXPERIMENTS` array
- New experiments require code changes, not UI

**MAJOR: No experiment detail page**
- Card links to `/experiments/[id]/` but that page doesn't exist (404)

---

## Workflow 4: Track Experiment Status

### What Works Well
- Status badges show on cards with color coding
- SSR renders experiment data from code

### Issues Found

**CRITICAL: Can't change status from UI**
- No buttons on card to change status
- No detail page to edit
- Status can only be changed by editing `lib/experiments/index.ts` code
- This makes status tracking impossible for end users

---

## Workflow 5: Start Paper Draft

### What Works Well
- Writing module supports multiple types: paper, section, note, review, translation
- Sections structure (Introduction, Related Work, Method, etc.)
- Target venue field
- Version history tracking
- Status: draft → review → final

### Issues Found

**MAJOR: No create button visible**
- `/writing/index.astro` has "新建写作" button in actionbar
- But on actual page, button is hidden or not prominent enough

**MAJOR: No rich text editing**
- Plain textarea for each section
- No markdown preview
- No LaTeX support (critical for paper writing)

**MINOR: No word count guidance**
- Paper drafts often have length requirements (8 pages, 4 pages)
- No guidance on typical lengths

---

## Workflow 6: Cite Papers in Draft

### What Works Well
- Citation UI exists: arXiv ID input + context field
- Citations render as removable cards
- Citation count shown on card

### Issues Found

**MAJOR: No citation picker**
- Must know exact arXiv ID
- No search or autocomplete
- No link to user's library

**MAJOR: No citation formatting**
- Just shows raw arXiv ID
- No auto-formatted bibliography (APA, IEEE, etc.)
- No BibTeX export

**MINOR: Citation context is free-text**
- User must manually write "In [Author1] et al. (2023)..."

---

## Workflow 7: Plan Roadmap

### What Works Well
- Roadmap shows quarters and goals
- Progress bar visualization
- Links to linked ideas and experiments

### Critical Issues

**CRITICAL: No UI to create roadmaps**
- Empty state says: "在 docs/roadmap/ 目录下创建 Markdown 文件来添加路线图"
- Requires YAML editing, not a web UI
- PhD students cannot create roadmaps without developer help

**CRITICAL: No UI to edit roadmap goals**
- Can only view existing roadmaps
- Can't check off goals
- Can't change goal status

**MAJOR: No UI to link ideas/experiments**
- Can only link via YAML frontmatter
- User must manually match idea IDs

---

## Workflow 8: Cross-Module Navigation

### What Works Well
- Idea cards link to paper detail pages
- Back links exist ("← 所有想法")

### Issues Found

**MAJOR: No bidirectional links**
- Paper detail pages don't show "Related Ideas"
- Experiment pages don't show "Based on Idea X"
- No breadcrumbs or navigation trail

**MAJOR: No unified view**
- Can't see "My Research Pipeline" showing ideas → experiments → writing
- Each module is siloed

---

## Summary Scores (1-5)

| Workflow | Score | Critical Blocker |
|----------|-------|------------------|
| 1. Capture idea from paper | 2 | No paper→idea link |
| 2. Evolve idea status | 4 | Works but lacks clarity |
| 3. Design experiment from idea | 1 | NO CREATE UI, no link |
| 4. Track experiment status | 1 | Can't change status |
| 5. Start paper draft | 3 | Basic works, needs rich text |
| 6. Cite papers in draft | 2 | No picker, no formatting |
| 7. Plan roadmap | 1 | NO CREATE/EDIT UI |
| 8. Cross-module navigation | 2 | Siloed, no bidirectional |

---

## Priority Fixes

### P0 (Blocks Basic Usage)

1. **Add experiment creation UI**
   - Add "新建实验" button to `/experiments/index.astro`
   - Create form with: title, hypothesis, method, variables, tags
   - Store in localStorage (like ideas)

2. **Add roadmap creation UI**
   - Create modal/form to add new roadmap
   - UI to add/edit quarters and goals
   - Checkbox to mark goals complete

3. **Link ideas → experiments**
   - Add "Create Experiment" button on idea detail page
   - Pre-fill experiment fields from idea

4. **Enable experiment status changes**
   - Add status dropdown/buttons on experiment cards or detail page

### P1 (Major Friction)

5. **Add paper search to idea creation**
   - Autocomplete from local paper collection
   - Show paper titles, not just IDs

6. **Add citation picker**
   - Search user's library
   - Auto-format citations

7. **Add bidirectional links**
   - Paper shows "Related Ideas"
   - Experiment shows "Derived from Idea X"

### P2 (Quality of Life)

8. **Add markdown support** to idea descriptions and writing sections
9. **Add undo** for status changes
10. **Add tooltips** explaining status meanings
11. **Show progress pipeline** — unified view of idea→experiment→writing

# Synthesized Issues — Round 1

## Deduplication Summary

Identified **28 unique issues** across 3 personas. Overlaps merged:

- **Roadmap no create/edit UI**: Reported by all 3 personas (PhD/Industry/NewUser) → merged
- **Experiment creation no UI**: PhD + NewUser both report → merged
- **Idea→Experiment flow missing**: PhD + NewUser → merged
- **Status meanings unclear**: PhD + NewUser → merged
- **No bidirectional links**: PhD + Industry → merged
- **localStorage-only (no sharing)**: PhD context + Industry explicit → merged
- **Daily paper assumption wrong for industry**: Industry unique but critical

---

## Area: experiments

### 1. No UI to create experiments
- **severity**: critical
- **description**: `/experiments/index.astro` has no "New Experiment" button. Data hardcoded in `lib/experiments/index.ts` as `EXPERIMENTS` array. Users must edit code to add experiments.
- **suggestion**: Add "新建实验" button to experiments list page. Create form with title, hypothesis, method, variables, tags. Store in localStorage (like ideas) or GitHub-backed storage.
- **affected_personas**: [phd, newuser]

### 2. No "Create Experiment from Idea" button
- **severity**: critical
- **description**: Idea detail page has no link to experiments. User must manually copy idea title → experiment title, idea description → hypothesis. No pre-fill from idea.
- **suggestion**: Add "Create Experiment" button on idea detail page that pre-fills experiment fields from the idea data.
- **affected_personas**: [phd, newuser]

### 3. Cannot change experiment status from UI
- **severity**: critical
- **description**: No buttons on cards to change status. No detail page to edit. Status can only be changed by editing `lib/experiments/index.ts` code. Makes status tracking impossible.
- **suggestion**: Add status dropdown/buttons on experiment cards or create detail page at `/experiments/[id]/`.
- **affected_personas**: [phd]

### 4. No experiment detail page
- **severity**: major
- **description**: Card links to `/experiments/[id]/` but that page doesn't exist (404).
- **suggestion**: Create experiment detail page showing full experiment data with edit capability.
- **affected_personas**: [phd]

### 5. No experiment-idea linking
- **severity**: major
- **description**: Can't say "experiment validates idea X". No UI to link experiments to ideas. Roadmap can reference experiments but workflow disconnected.
- **suggestion**: Add "Based on Idea X" field when creating/editing experiment. Show linked experiment on idea detail.
- **affected_personas**: [phd, industry]

---

## Area: roadmap

### 6. No UI to create roadmaps
- **severity**: critical
- **description**: Empty state says "在 docs/roadmap/ 目录下创建 Markdown 文件来添加路线图" — requires YAML editing, not a web UI. PhD students and new users cannot create roadmaps without developer help.
- **suggestion**: Create modal/form to add new roadmap with title, description, quarter selections. Allow adding goals with title/description/due date.
- **affected_personas**: [phd, industry, newuser]

### 7. No UI to edit roadmap goals
- **severity**: critical
- **description**: Can only view existing roadmaps. Can't check off goals or change goal status. All editing requires YAML frontmatter.
- **suggestion**: Add checkbox UI to mark goals complete. Add edit button for goal details.
- **affected_personas**: [phd, industry]

### 8. No sprint/month breakdown (industry mismatch)
- **severity**: major
- **description**: Roadmap uses quarter-based goals only. Industry researchers need month-by-month or sprint-based breakdown (2-week cycles). Too coarse for industry workflow.
- **suggestion**: Add granularity options: sprint (2 weeks), month, quarter. Show timeline view.
- **affected_personas**: [industry]

---

## Area: ideas

### 9. No link from paper detail to create idea
- **severity**: major
- **description**: After reading a paper at `/papers/[id]/`, no "Save as Idea" or "Add to Ideas" button. User must copy arXiv ID, navigate to /ideas/, create new idea, paste ID. Friction kills capture workflow.
- **suggestion**: Add "Save as Idea" button on paper detail page. Pre-fills title from paper, adds paper to relatedPapers.
- **affected_personas**: [phd]

### 10. Related papers field is free-text without validation
- **severity**: major
- **description**: Input accepts comma-separated arXiv IDs but no validation. No autocomplete or paper search. User must know exact arXiv ID (e.g., "1706.03762" not "Attention is All You Need").
- **suggestion**: Add paper search/autocomplete from local paper collection. Show paper titles, not just IDs.
- **affected_personas**: [phd, newuser]

### 11. Idea status meanings unclear
- **severity**: minor
- **description**: "promoted" — promoted to what? No tooltip explaining lifecycle. "archived" — deletion with history or holding state? New users don't understand transitions.
- **suggestion**: Add tooltips explaining each status: "草稿→进行中→推荐→归档" with clear meanings. Add "?" icons next to status labels.
- **affected_personas**: [phd, newuser]

### 12. No markdown support in idea description
- **severity**: minor
- **description**: Description is plain text only. Can't add bullet points, links, or formatting for complex ideas. Plain textarea, no rich text.
- **suggestion**: Add markdown preview or rich text editor. At minimum, render markdown in display mode.
- **affected_personas**: [phd]

### 13. No status change confirmation/undo
- **severity**: minor
- **description**: One click changes status, no undo. No "undo" button if accidentally clicked.
- **suggestion**: Add undo button that appears for 5 seconds after status change. Or require confirmation dialog.
- **affected_personas**: [phd]

---

## Area: writing

### 14. No rich text / markdown / LaTeX support
- **severity**: major
- **description**: Plain textarea for each section. No markdown preview. No LaTeX support (critical for academic paper writing). No word count guidance.
- **suggestion**: Add markdown editor with preview. Add LaTeX rendering (KaTeX or MathJax). Show typical length guidance per paper type.
- **affected_personas**: [phd]

### 15. No citation picker
- **severity**: major
- **description**: Must know exact arXiv ID to cite. No search or autocomplete. No link to user's library. No auto-formatted bibliography (APA, IEEE). No BibTeX export.
- **suggestion**: Add citation picker that searches user's library. Auto-generate formatted citations. Add BibTeX export.
- **affected_personas**: [phd]

---

## area: navigation

### 16. Too many nav options overwhelming new users
- **severity**: critical
- **description**: New user sees 12+ nav items (文献库, 全部论文, 引用图, 主题探索, 会议, 概念, 想法, 实验, 写作, 路线图, 设置) plus 4 workflow cards on first load. No explanation of what each section does.
- **suggestion**: Show only core 4-5 items initially (home, papers, ideas, experiments). Reveal more on demand. Add "?" help icons explaining each.
- **affected_personas**: [newuser]

### 17. No onboarding flow / welcome guide
- **severity**: critical
- **description**: No welcome modal, no guided tour, no "start here" for first-time users. New users don't know what "想法" vs "实验" vs "写作" means or when to use each.
- **suggestion**: Add welcome modal for first visit. Show brief explanations for each nav item. Create onboarding wizard: "What problem are you solving?" → "What papers relate?" → "What do you expect?"
- **affected_personas**: [newuser]

### 18. No "What's this?" help icons / tooltips
- **severity**: major
- **description**: No help button in UI. No tooltips or "?" icons. Settings page has configuration but no usage guide. Tutorial exists but doesn't cover workflow modules.
- **suggestion**: Add "?" help icons next to "想法", "实验", "写作", "路线图" in nav. Show tooltip on hover explaining purpose and when to use.
- **affected_personas**: [newuser]

### 19. No sample data shown to new users
- **severity**: critical
- **description**: No sample idea shown to illustrate format. Empty states are clear but users don't see example before creating. Data model unclear.
- **suggestion**: Show example idea card even when user has no ideas. Display "Here's an example of a well-formed idea: ..." with sample data.
- **affected_personas**: [newuser]

---

## area: integration

### 20. No bidirectional links between modules
- **severity**: major
- **description**: Paper detail pages don't show "Related Ideas". Experiment pages don't show "Based on Idea X". No breadcrumbs or navigation trail. Each module is siloed.
- **suggestion**: Add "Related Ideas" section on paper detail. Add "Derived from Idea X" on experiment detail. Add breadcrumb navigation.
- **affected_personas**: [phd, industry]

### 21. No unified pipeline view
- **severity**: major
- **description**: Can't see "My Research Pipeline" showing ideas → experiments → writing. Each module is isolated. No "idea bank" or "backlog" view to manage pipeline.
- **suggestion**: Create "Research Pipeline" page showing: ideas (by status) → linked experiments → linked writings. Visual flow diagram.
- **affected_personas**: [phd, industry]

### 22. No UI to link ideas/experiments to roadmap
- **severity**: major
- **description**: Roadmap has `linked_ideas` and `linked_experiments` fields but no UI to link them. User must manually match IDs in YAML.
- **suggestion**: In roadmap edit UI, add dropdown/search to link existing ideas and experiments. Show linked items on roadmap detail.
- **affected_personas**: [phd, industry, newuser]

---

## area: data-model

### 23. All data in localStorage — no sharing / team features
- **severity**: critical
- **description**: Ideas, experiments, writings stored in localStorage only. Zero SSR. Cannot share with team members. Manager cannot view progress unless they have access to your browser. No collaboration features.
- **suggestion**: Add GitHub-backed storage option for roadmaps/experiments/writings. Implement team sharing layer. Add "share with manager" feature.
- **affected_personas**: [phd, industry]

### 24. Writing is 100% client-side — cannot share
- **severity**: major
- **description**: Writing is localStorage only. Cannot share with manager. No "internal report" type — only academic paper/note/review. No export to Markdown/HTML/PDF.
- **suggestion**: Add export to Markdown/HTML/PDF. Add "internal report" type. Consider SSR storage option for sharing.
- **affected_personas**: [industry]

---

## area: roadmap

### 25. No progress dashboard
- **severity**: critical
- **description**: No dashboard showing roadmap progress. No exportable progress report (PDF/slide). No "single-page progress view" for external stakeholders.
- **suggestion**: Build progress dashboard: aggregate status counts (ideas by status, experiments by status), render as single-page report. Add export to PDF/slides.
- **affected_personas**: [industry]

### 26. No milestone date tracking
- **severity**: major
- **description**: Goals have only quarter-level granularity. No milestone date tracking per goal. Industry needs specific dates for sprint planning.
- **suggestion**: Add due date field to goals. Show timeline/Gantt view of experiments per goal.
- **affected_personas**: [industry]

---

## area: integration

### 27. Daily paper reading assumption wrong for industry
- **severity**: critical
- **description**: DPR core assumption is "daily paper reading." For industry: don't read papers daily — read when solving a problem. Need search, not daily digest. Need internal reports, not paper annotations. No "turn off daily feed" option.
- **suggestion**: Add "question mode" search: "How do I implement X?" surfaces solutions not just papers. Add option to disable/hide daily feed. Consider industry-specific workflow preset.
- **affected_personas**: [industry]

### 28. No team features / collaboration
- **severity**: critical
- **description**: Complete lack of team features. User library is personal — cannot share papers with team. No comments, reviews, notifications.
- **suggestion**: Add team collaboration: shared libraries, commenting, review workflows, Slack/email notifications of progress.
- **affected_personas**: [industry]

---

## Priority Summary

### P0 — Critical (Blocks Basic Usage)
1. No UI to create experiments (#1)
2. No "Create Experiment from Idea" (#2)
3. Cannot change experiment status (#3)
4. No UI to create roadmaps (#6)
5. No UI to edit roadmap goals (#7)
6. Too many nav options (#16)
7. No onboarding flow (#17)
8. No sample data shown (#19)
9. All data in localStorage (#23)
10. No progress dashboard (#25)
11. Daily paper assumption wrong (#27)
12. No team features (#28)

### P1 — Major (Significant Friction)
13. No experiment detail page (#4)
14. No experiment-idea linking (#5)
15. No link paper→idea (#9)
16. Related papers free-text (#10)
17. No rich text in writing (#14)
18. No citation picker (#15)
19. No help icons (#18)
20. No bidirectional links (#20)
21. No unified pipeline view (#21)
22. No UI to link roadmap items (#22)
23. Writing client-side only (#24)
24. No milestone dates (#26)

### P2 — Minor (Quality of Life)
25. Status meanings unclear (#11)
26. No markdown in ideas (#12)
27. No status change undo (#13)

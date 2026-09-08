# DPR Workflow Modules — UI/UX Design Document

> Version: 1.0 | Created: 2026-09-07
> Status: Design specification for implementation

---

## 1. Design System Foundation

### 1.1 CSS Variables (already defined in global.css)

All new modules MUST use existing CSS variables. Do NOT introduce new colors or spacing tokens.

```css
/* Key tokens to use */
--bg, --bg-elevated, --bg-muted
--fg, --fg-muted, --fg-subtle
--border, --border-strong
--accent, --accent-hover, --accent-soft
--success, --success-soft, --danger, --danger-soft, --warning, --warning-soft
--shadow-sm, --shadow-md, --shadow-lg
--radius-sm, --radius-md, --radius-lg
--space-1 through --space-16
--font-sans, --font-serif, --font-mono
--transition, --transition-slow
--content-max-width: 780px
--wide-max-width: 1100px
--shell-max-width: 1240px
--navbar-height: 64px
```

### 1.2 Hue System (from libraries.css/projects.css)

Use existing hue colors for module branding:

| Hue Name   | CSS Variable      | Use Case                    |
|------------|-------------------|-----------------------------|
| emerald    | `--hue-emerald`   | Ideas (growth/seed)        |
| amber      | `--hue-amber`    | Experiments (progress)     |
| purple     | `--hue-purple`    | Writing (creativity)      |
| sky        | `--hue-sky`      | Roadmap (timeline/path)   |
| rose       | `--hue-rose`     | Alerts/urgent             |
| cyan       | `--hue-cyan`     | Info/neutral              |

Hue application: left border `4px solid var(--hue-{name})` on cards.

### 1.3 Component Patterns

**Base card** (reused everywhere):
```css
.dpr-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.dpr-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}
```

**Button variants**:
- `.button primary` — accent background, white text
- `.button` — transparent, border, muted text
- `.button.sm` — smaller padding (4px 10px)

**Status pills**:
```css
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
}
.status-pill--draft { background: var(--bg-muted); color: var(--fg-muted); }
.status-pill--active { background: var(--warning-soft); color: var(--warning); }
.status-pill--done { background: var(--success-soft); color: var(--success); }
.status-pill--archived { background: var(--bg-muted); color: var(--fg-subtle); text-decoration: line-through; }
```

---

## 2. Navigation Integration

### 2.1 Navbar Links

Add to `Navbar.astro` links array:

```javascript
const links = [
  { href: '/libraries/',   label: '文献库',    match: '/libraries' },
  { href: '/papers/',      label: '全部论文',   match: '/papers' },
  { href: '/ideas/',       label: 'Ideas',     match: '/ideas' },        // NEW
  { href: '/experiments/', label: '实验',      match: '/experiments' },  // NEW
  { href: '/writing/',     label: '写作',      match: '/writing' },      // NEW
  { href: '/roadmap/',    label: '路线图',     match: '/roadmap' },      // NEW
  { href: '/projects/',   label: '项目',      match: '/projects' },
  { href: '/graph/',      label: '引用图',    match: '/graph' },
  { href: '/topic/',      label: '主题探索',  match: '/topic' },
  { href: '/conferences/',label: '会议',       match: '/conferences' },
  { href: '/concepts/',   label: '概念',      match: '/concepts' },
  { href: '/settings/',   label: '设置',      match: '/settings' },
];
```

**Order rationale**: Ideas → Experiments → Writing flow is a researcher workflow; Roadmap is meta-planning. Projects remains separate as workspace container.

### 2.2 Mobile Behavior

Navbar already supports horizontal scroll on narrow screens (`overflow-x: auto` with fade mask). New links will automatically inherit this behavior.

---

## 3. Module 1: Ideas (/ideas/)

### 3.1 Page Structure

```
/ideas/
├── Header (hero)
├── Filter bar (status / source / date)
├── Ideas grid (card layout)
└── Empty state + CTA

/ideas/[id]/
├── Back link
├── Idea header (title, status badge, meta)
├── Content section (markdown rendered)
├── Source papers (chip list linked to /papers/)
├── Related experiments (chip list linked to /experiments/)
├── Action bar (edit / promote / archive / delete)
└── Timestamps (created / updated)
```

### 3.2 List Page Layout

**Header**:
```html
<header class="ideas-hero">
  <h1>💡 Ideas</h1>
  <p class="lead">Research ideas derived from paper analysis, debates, and experiments.</p>
</header>
```

**Filter bar** (matches libraries.css pattern):
```html
<div class="ideas-filter">
  <span class="filter-label">状态:</span>
  <button class="filter-pill active" data-filter="all">全部</button>
  <button class="filter-pill" data-filter="draft">草稿</button>
  <button class="filter-pill" data-filter="active">进行中</button>
  <button class="filter-pill" data-filter="promoted">已提升</button>
  <button class="filter-pill" data-filter="archived">已归档</button>
  <span class="filter-count">24 条</span>
  <button class="button primary sm" id="idea-new-btn">+ 新建</button>
</div>
```

**Grid** (3-column responsive):
```css
.ideas-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}
```

### 3.3 Card Component

```css
.idea-card {
  border-left: 4px solid var(--hue-emerald);
}
.idea-card--draft { border-left-color: var(--fg-subtle); }
.idea-card--active { border-left-color: var(--warning); }
.idea-card--promoted { border-left-color: var(--success); }
.idea-card--archived { opacity: 0.6; }
```

Card structure:
```html
<article class="dpr-card idea-card idea-card--active">
  <div class="idea-card-header">
    <h3 class="idea-card-title">Multi-Agent Reinforcement Learning with Hierarchical Communication</h3>
    <span class="status-pill status-pill--active">进行中</span>
  </div>
  <p class="idea-card-statement">探索层级通信协议在 MARL 中的作用...</p>
  <div class="idea-card-meta">
    <span class="kbd">来自 3 篇论文</span>
    <span class="kbd">2026-09-01</span>
  </div>
  <div class="idea-card-sources">
    <a href="/papers/..." class="paper-chip">2301.12345</a>
    <a href="/papers/..." class="paper-chip">2302.06789</a>
  </div>
</article>
```

### 3.4 Detail Page Layout

**Shell**: Use existing `.shell` container with `max-width: var(--shell-max-width)`.

**Sections**:
1. **Header row**: Back link + title + status pill + action buttons
2. **Content**: Rendered markdown (reuse existing markdown styles from global.css)
3. **Sources**: Paper chips linking to /papers/[arxiv]
4. **Linked experiments**: Horizontal chip list
5. **Timestamps**: `var(--fg-subtle)` text at bottom

### 3.5 Interaction Patterns

- **Filter**: Client-side toggle, no fetch
- **New idea**: Modal form (see projects.css `.projects-new-form` pattern)
- **Status change**: Dropdown or button cycle (draft → active → promoted → archived)
- **Link to paper**: Click chip → navigate to paper detail
- **Link to experiment**: Click chip → navigate to experiment detail

---

## 4. Module 2: Experiments (/experiments/)

### 4.1 Page Structure

```
/experiments/
├── Header
├── Filter bar (status / idea-source / date)
├── Experiments grid
└── Empty state

/experiments/[id]/
├── Back link
├── Experiment header (title, status, idea source)
├── Hypothesis section
├── Methods section (markdown)
├── Results section (markdown / code blocks)
├── Linked papers (chips)
├── Linked ideas (chips)
├── Linked writing (chips)
├── Progress log (timeline entries)
└── Timestamps
```

### 4.2 List Page Layout

**Header**: Same pattern as Ideas.

**Filter bar**:
```html
<div class="experiments-filter">
  <span class="filter-label">状态:</span>
  <button class="filter-pill active" data-filter="all">全部</button>
  <button class="filter-pill" data-filter="running">进行中</button>
  <button class="filter-pill" data-filter="completed">已完成</button>
  <button class="filter-pill" data-filter="failed">失败</button>
  <span class="filter-count">12 个</span>
  <button class="button primary sm" id="exp-new-btn">+ 新建</button>
</div>
```

**Grid**: Same as Ideas (`minmax(320px, 1fr)`).

### 4.3 Card Component

```css
.experiment-card {
  border-left: 4px solid var(--hue-amber);
}
.experiment-card--running { border-left-color: var(--warning); }
.experiment-card--completed { border-left-color: var(--success); }
.experiment-card--failed { border-left-color: var(--danger); }
```

Card structure:
```html
<article class="dpr-card experiment-card experiment-card--running">
  <div class="experiment-card-header">
    <h3 class="experiment-card-title">Baseline: COMA on HawkEye Environment</h3>
    <span class="status-pill status-pill--active">进行中</span>
  </div>
  <p class="experiment-card-hypothesis"><strong>假设:</strong> COMA 在多智能体场景下优于 QMIX</p>
  <div class="experiment-card-meta">
    <span class="kbd">来自 idea: MARL 层级通信</span>
    <span class="kbd">2026-09-03</span>
  </div>
  <div class="experiment-card-progress">
    <div class="progress-bar">
      <div class="progress-fill" style="width: 60%"></div>
    </div>
    <span class="progress-label">3/5 阶段</span>
  </div>
</article>
```

### 4.4 Progress Bar Component

```css
.progress-bar {
  height: 6px;
  background: var(--bg-muted);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width var(--transition-slow);
}
.progress-label {
  font-size: 0.75rem;
  color: var(--fg-subtle);
  margin-top: var(--space-1);
}
```

### 4.5 Detail Page Layout

**Sections**:
1. **Header**: Back + title + status + linked idea chip + action buttons
2. **Hypothesis**: Blockquote style `border-left: 3px solid var(--accent)`
3. **Methods**: Markdown rendered, code blocks with syntax highlighting (existing pre/code styles)
4. **Results**: Markdown or embedded images/tables
5. **Progress log**: Vertical timeline (see Section 7)
6. **Linked writing**: Chips pointing to /writing/[id]

### 4.6 Interaction Patterns

- **Link to idea**: Required on creation, displays as chip
- **Progress update**: Inline form to add log entry (date + note)
- **Status change**: Running → Completed (with results) or Failed (with reason)
- **Link to writing**: Optional, for writing about experiment results

---

## 5. Module 3: Writing (/writing/)

### 5.1 Page Structure

```
/writing/
├── Header
├── Filter bar (status / type / date)
├── Writing grid (card layout)
└── Empty state

/writing/[id]/
├── Back link
├── Writing header (title, type badge, status, word count)
├── Editor area (or rendered markdown view)
├── Linked papers (chips)
├── Linked experiments (chips)
├── Linked ideas (chips)
├── Version history (compact list)
└── Timestamps
```

### 5.2 Types

- `paper` — Full paper draft
- `section` — Paper section (intro, method, etc.)
- `note` — Research notes
- `review` — Literature review
- `translation` — Translation of paper/abstract

### 5.3 List Page Layout

**Filter bar**:
```html
<div class="writing-filter">
  <span class="filter-label">类型:</span>
  <button class="filter-pill active" data-filter="all">全部</button>
  <button class="filter-pill" data-filter="paper">论文</button>
  <button class="filter-pill" data-filter="section">章节</button>
  <button class="filter-pill" data-filter="note">笔记</button>
  <button class="filter-pill" data-filter="review">综述</button>
  <span class="filter-count">8 篇</span>
  <button class="button primary sm" id="writing-new-btn">+ 新建</button>
</div>
```

**Grid**: Same as Ideas/Experiments.

### 5.4 Card Component

```css
.writing-card {
  border-left: 4px solid var(--hue-purple);
}
```

Card structure:
```html
<article class="dpr-card writing-card">
  <div class="writing-card-header">
    <h3 class="writing-card-title">Hierarchical Communication in MARL</h3>
    <div class="writing-card-badges">
      <span class="type-badge">论文</span>
      <span class="status-pill status-pill--draft">草稿</span>
    </div>
  </div>
  <p class="writing-card-excerpt">本文提出一种层级通信协议...</p>
  <div class="writing-card-meta">
    <span class="kbd">2,450 字</span>
    <span class="kbd">来自 3 篇论文</span>
    <span class="kbd">2026-09-05</span>
  </div>
</article>
```

### 5.5 Detail Page — Editor Mode

**Toolbar** (matches writing.css `.draft-toolbar`):
```html
<div class="draft-toolbar">
  <input type="text" class="draft-title-input" value="Hierarchical Communication in MARL" />
  <span class="draft-word-count">2,450 字</span>
  <span class="draft-save-status saved">已保存</span>
  <div class="toolbar-actions">
    <button class="button sm" id="toggle-preview">预览</button>
    <button class="button sm" id="export-md">导出 .md</button>
    <button class="button primary sm" id="save-draft">保存</button>
  </div>
</div>
```

**Editor**:
```html
<textarea
  id="draft-editor"
  class="draft-editor"
  placeholder="开始写作..."
  spellcheck="true"
></textarea>
```

**Preview mode**: Render markdown to HTML in a read-only container below toolbar.

### 5.6 Detail Page — Linked Items

```css
.writing-links-section {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border);
}
.writing-links-section h4 {
  font-size: 0.9rem;
  color: var(--fg-muted);
  margin-bottom: var(--space-3);
}
.linked-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
```

### 5.7 Interaction Patterns

- **Auto-save**: Debounced save on input (500ms delay)
- **Manual save**: Button trigger
- **Word count**: Live update on input
- **Link to paper**: Autocomplete dropdown (cite `@arxivid` syntax or search)
- **Link to experiment**: Chip picker from existing experiments
- **Link to idea**: Chip picker from existing ideas
- **Version history**: Click to view/restore previous version (store in localStorage or IndexedDB)

---

## 6. Module 4: Roadmap (/roadmap/)

### 6.1 Page Structure

```
/roadmap/
├── Header
├── Timeline view (horizontal scrollable on mobile)
├── Milestone cards (inline or as detail panels)
└── Progress overview
```

### 6.2 Timeline Component

**Structure**:
```html
<div class="roadmap-timeline">
  <!-- Timeline track -->
  <div class="timeline-track">
    <div class="timeline-line"></div>
  </div>
  
  <!-- Milestone items -->
  <div class="timeline-items">
    <article class="milestone milestone--done" data-date="2026-07">
      <div class="milestone-marker">
        <span class="milestone-dot"></span>
        <span class="milestone-date">2026-07</span>
      </div>
      <div class="milestone-content">
        <h3 class="milestone-title">Phase 1: Foundation</h3>
        <p class="milestone-desc">Basic idea capture and paper linking</p>
        <div class="milestone-items">
          <span class="kbd">3 ideas</span>
          <span class="kbd">2 experiments</span>
        </div>
      </div>
    </article>
    
    <article class="milestone milestone--active" data-date="2026-09">
      <div class="milestone-marker">
        <span class="milestone-dot"></span>
        <span class="milestone-date">2026-09</span>
      </div>
      <div class="milestone-content">
        <h3 class="milestone-title">Phase 2: Experimentation</h3>
        <p class="milestone-desc">Run baseline experiments, iterate on methods</p>
        <div class="milestone-progress">
          <div class="progress-bar"><div class="progress-fill" style="width: 45%"></div></div>
        </div>
      </div>
    </article>
    
    <article class="milestone milestone--pending" data-date="2026-11">
      <div class="milestone-marker">
        <span class="milestone-dot"></span>
        <span class="milestone-date">2026-11</span>
      </div>
      <div class="milestone-content">
        <h3 class="milestone-title">Phase 3: Writing</h3>
        <p class="milestone-desc">Draft full paper, incorporate results</p>
      </div>
    </article>
  </div>
</div>
```

### 6.3 Timeline CSS

```css
.roadmap-timeline {
  position: relative;
  padding: var(--space-8) 0;
}

.timeline-track {
  position: absolute;
  top: calc(var(--space-8) + 12px);
  left: var(--space-6);
  right: var(--space-6);
  height: 2px;
  background: var(--border);
}

.timeline-line {
  height: 100%;
  background: var(--hue-sky);
  width: 35%; /* Progress */
}

.timeline-items {
  display: flex;
  gap: var(--space-8);
  overflow-x: auto;
  padding: var(--space-4) var(--space-6);
  scroll-snap-type: x mandatory;
}

.milestone {
  flex: 0 0 280px;
  scroll-snap-align: start;
  position: relative;
}

.milestone-marker {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.milestone-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--border-strong);
  border: 2px solid var(--bg);
}

.milestone--done .milestone-dot {
  background: var(--success);
}

.milestone--active .milestone-dot {
  background: var(--hue-sky);
  box-shadow: 0 0 0 4px var(--info-soft);
  animation: pulse 2s infinite;
}

.milestone-date {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--fg-subtle);
}

.milestone-content {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

.milestone--active .milestone-content {
  border-color: var(--hue-sky);
  box-shadow: var(--shadow-md);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 4px var(--info-soft); }
  50% { box-shadow: 0 0 0 8px transparent; }
}
```

### 6.4 Milestone Card CSS

```css
.milestone-title {
  margin: 0 0 var(--space-2);
  font-size: 1rem;
  font-weight: 600;
  color: var(--fg);
}

.milestone-desc {
  margin: 0 0 var(--space-3);
  font-size: 0.85rem;
  color: var(--fg-muted);
  line-height: 1.5;
}

.milestone-items {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.milestone-items .kbd {
  background: var(--bg-muted);
  color: var(--fg-subtle);
}
```

### 6.5 Progress Overview Section

```html
<div class="roadmap-overview">
  <div class="overview-stats">
    <div class="overview-stat">
      <span class="dpr-stat-value dpr-stat-value--sm">12</span>
      <span class="dpr-stat-label">Ideas</span>
    </div>
    <div class="overview-stat">
      <span class="dpr-stat-value dpr-stat-value--sm">5</span>
      <span class="dpr-stat-label">Experiments</span>
    </div>
    <div class="overview-stat">
      <span class="dpr-stat-value dpr-stat-value--sm">2</span>
      <span class="dpr-stat-label">Writing</span>
    </div>
    <div class="overview-stat">
      <span class="dpr-stat-value dpr-stat-value--sm dpr-stat-value--accent">35%</span>
      <span class="dpr-stat-label">Progress</span>
    </div>
  </div>
</div>
```

### 6.6 Interaction Patterns

- **Create milestone**: Button opens modal form (date + title + description)
- **Edit milestone**: Click card to open detail view
- **Mark complete**: Button in milestone detail view
- **Navigate to items**: Click kbd chips to go to respective list pages filtered by milestone
- **Scroll timeline**: Horizontal scroll with snap points on mobile

---

## 7. Shared Components

### 7.1 Chip Components

**Paper chip** (links to /papers/[arxiv]):
```css
.paper-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 8px;
  background: var(--tag-bg);
  color: var(--tag-fg);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  text-decoration: none;
  transition: background var(--transition), color var(--transition);
}
.paper-chip:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
```

**Idea/Experiment/Writing chip**:
```css
.entity-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 10px;
  background: var(--bg-muted);
  color: var(--fg-muted);
  border-radius: 999px;
  font-size: 0.8rem;
  text-decoration: none;
  transition: background var(--transition), color var(--transition);
}
.entity-chip:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
```

### 7.2 Type Badge

```css
.type-badge {
  display: inline-block;
  padding: 2px 8px;
  background: var(--bg-muted);
  color: var(--fg-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.type-badge--paper { background: var(--info-soft); color: var(--info); }
.type-badge--section { background: var(--accent-soft); color: var(--accent); }
.type-badge--note { background: var(--success-soft); color: var(--success); }
.type-badge--review { background: var(--warning-soft); color: var(--warning); }
```

### 7.3 Timeline Entry (for experiment progress log)

```css
.timeline-entry {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.timeline-entry:last-child { border-bottom: none; }

.timeline-entry-date {
  flex-shrink: 0;
  width: 80px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--fg-subtle);
}

.timeline-entry-content {
  flex: 1;
}

.timeline-entry-text {
  font-size: 0.9rem;
  color: var(--fg);
  margin: 0;
}
```

### 7.4 Modal Form Pattern

Reuse from projects.css:
```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-4);
}

.modal-content {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  width: 100%;
  max-width: 480px;
  box-shadow: var(--shadow-lg);
}
```

---

## 8. Responsive Breakpoints

All modules follow existing DPR breakpoints:

| Breakpoint | Width    | Behavior                                      |
|------------|----------|----------------------------------------------|
| Mobile     | < 640px  | Single column, horizontal scroll timeline    |
| Tablet     | 640-920px| 2-column grid                               |
| Desktop    | > 920px  | 3-column grid, full timeline                |

**Timeline horizontal scroll** on mobile:
```css
@media (max-width: 640px) {
  .timeline-items {
    padding: var(--space-4) var(--space-3);
    gap: var(--space-4);
  }
  .milestone { flex: 0 0 260px; }
}
```

---

## 9. Data Storage

All modules use **client-side storage** (localStorage or IndexedDB) matching the existing DPR pattern:

| Module   | Storage Key Prefix        | Data Structure                              |
|----------|--------------------------|---------------------------------------------|
| Ideas    | `dpr_ideas_v1`          | `Idea[]`                                    |
| Experiments | `dpr_experiments_v1` | `Experiment[]`                              |
| Writing  | `dpr_writings_v1`       | `Writing[]`                                 |
| Roadmap  | `dpr_roadmap_v1`        | `{ milestones: Milestone[], progress: number }` |

**TypeScript interfaces** (to be defined in `astro-src/lib/workflows/types.ts`):

```typescript
interface Idea {
  id: string;
  title: string;
  content: string;          // Markdown
  status: 'draft' | 'active' | 'promoted' | 'archived';
  sourcePaperIds: string[]; // arXiv IDs
  linkedExperimentIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  methods: string;          // Markdown
  results: string;           // Markdown
  status: 'running' | 'completed' | 'failed';
  linkedIdeaId: string;
  linkedPaperIds: string[];
  linkedWritingIds: string[];
  progressLog: ProgressLogEntry[];
  createdAt: number;
  updatedAt: number;
}

interface ProgressLogEntry {
  date: number;
  note: string;
}

interface Writing {
  id: string;
  title: string;
  content: string;          // Markdown
  type: 'paper' | 'section' | 'note' | 'review' | 'translation';
  status: 'draft' | 'review' | 'published';
  wordCount: number;
  linkedPaperIds: string[];
  linkedExperimentIds: string[];
  linkedIdeaIds: string[];
  versions: WritingVersion[];
  createdAt: number;
  updatedAt: number;
}

interface WritingVersion {
  content: string;
  savedAt: number;
}

interface Milestone {
  id: string;
  title: string;
  description: string;
  date: string;              // YYYY-MM
  status: 'pending' | 'active' | 'done';
  linkedIdeaIds: string[];
  linkedExperimentIds: string[];
}
```

---

## 10. Implementation Files

### 10.1 New Files to Create

| Path                                    | Purpose                              |
|-----------------------------------------|--------------------------------------|
| `astro-src/styles/ideas.css`           | Ideas module styles                 |
| `astro-src/styles/experiments.css`     | Experiments module styles           |
| `astro-src/styles/writing.css`         | (exists, extend)                    |
| `astro-src/styles/roadmap.css`         | Roadmap timeline styles             |
| `astro-src/pages/ideas/index.astro`   | Ideas list page                     |
| `astro-src/pages/ideas/[id].astro`    | Ideas detail page                   |
| `astro-src/pages/experiments/index.astro` | Experiments list page            |
| `astro-src/pages/experiments/[id].astro` | Experiments detail page           |
| `astro-src/pages/writing/index.astro` | Writing list page                   |
| `astro-src/pages/writing/[id].astro`  | Writing detail/editor page          |
| `astro-src/pages/roadmap.astro`        | Roadmap timeline page               |
| `astro-src/lib/workflows/types.ts`     | TypeScript interfaces               |
| `astro-src/lib/workflows/store.ts`      | Storage utilities                   |
| `astro-src/scripts/workflows-ui.ts`     | Client-side UI logic                |

### 10.2 Files to Modify

| File                              | Change                                           |
|-----------------------------------|--------------------------------------------------|
| `astro-src/components/Navbar.astro` | Add 4 new nav links                           |
| `astro-src/styles/writing.css`    | Extend for new writing detail page              |
| `astro-src/lib/user-libraries/types.ts` | Add hue values if needed                  |

---

## 11. Visual Consistency Summary

| Element              | Pattern Source                    | Implementation                      |
|----------------------|-----------------------------------|-------------------------------------|
| Page shell           | `.shell` in projects.css         | `max-width: var(--shell-max-width)` |
| Hero header          | `.libraries-hero` in libraries.css | `margin-bottom: var(--space-10)`  |
| Filter pills         | `.filter-pill` in libraries.css  | Reuse directly                     |
| Card grid            | `.projects-grid` in projects.css | `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))` |
| Card hover           | `.dpr-card:hover`                | `border-color + shadow`             |
| Status pills         | Section 1.3                     | Reuse pattern                      |
| Modal form           | `.projects-new-form` in projects.css | Extend for each module           |
| Empty state          | `.dpr-empty` in global.css      | Reuse directly                     |
| Timeline             | Section 6.3                     | New component                      |
| Back button          | `.button` in projects.css       | "← 返回" text                      |

---

## 12. Out of Scope

These are NOT in this design (deferred to future phases):

- Server-side rendering of workflow data
- Cross-device sync (Gist integration)
- Collaboration features
- Export to PDF/DOCX
- Integration with external tools (Overleaf, etc.)
- Automated experiment tracking (MLflow, etc.)
- Citation management within writing

---

## 13. Acceptance Criteria

1. All 4 new routes (`/ideas/`, `/experiments/`, `/writing/`, `/roadmap/`) render without errors
2. Navbar displays all 4 new links with correct active state
3. List pages show filterable grid of items
4. Detail pages render with all sections
5. Writing editor saves to localStorage
6. Timeline scrolls horizontally on mobile
7. All colors/spacing use existing CSS variables
8. No new colors introduced
9. Responsive down to 320px width
10. Dark theme works via existing CSS variables

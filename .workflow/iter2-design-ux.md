# DPR Iteration 2 — UX Design Polish

**Date:** 2026-09-08
**Author:** UX Polish Designer
**Based on:** Round 2 Feedback from 3 personas

---

## 1. Executive Summary

Round 2 feedback reveals **significant progress** on core flows (Idea→Experiment, roadmap creation, status tooltips), but **critical UX gaps remain** that require CSS-only or minimal JS fixes:

| Category | Status | Priority |
|----------|--------|---------|
| Cross-module consistency | Partial — inconsistent status pills/badges | P1 |
| Mobile responsive | Missing workflow card stacking | P1 |
| Empty states | Writing module lacks sample | P2 |
| Keyboard shortcuts | Not implemented | P2 |
| Help system | No floating help button | P2 |

---

## 2. Cross-Module Consistency

### 2.1 Unified Status Pill Style

**Problem:** Each module uses different status badge styling:
- `ideas.css`: `.idea-card--starred`, `.idea-card--draft`, `.idea-card--active`
- `experiments.css`: `.exp-status--planning`, `.exp-status--running`, `.exp-status--completed`
- `writing.css`: `.writing-card-status.draft`, `.writing-card-status.review`
- `roadmap.css`: Goals use `border-left-color` + `data-status` attribute

**Solution:** Create unified `.status-pill` component in `global.css`:

```css
/* Add to global.css */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Status variants - academic tone */
.status-pill--draft {
  background: var(--bg-muted);
  color: var(--fg-muted);
}
.status-pill--active, .status-pill--running {
  background: #dbeafe;
  color: #1e40af;
}
.status-pill--completed, .status-pill--done {
  background: #d1fae5;
  color: #065f46;
}
.status-pill--failed, .status-pill--rejected {
  background: #fee2e2;
  color: #991b1b;
}
.status-pill--archived, .status-pill--paused {
  background: #f3f4f6;
  color: #6b7280;
}
.status-pill--starred, .status-pill--promoted {
  background: #fef3c7;
  color: #92400e;
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.status-pill` base + variants
- `astro-src/styles/ideas.css` — migrate from `.idea-card--*` to use `.status-pill`
- `astro-src/styles/experiments.css` — migrate from `.exp-status--*` to use `.status-pill`
- `astro-src/styles/writing.css` — migrate from `.writing-card-status.*` to use `.status-pill`

### 2.2 Unified Paper Badge / Chip Style

**Problem:** No consistent "chip" style for:
- Related papers links
- Tags on cards
- Venue badges

**Solution:** Add to `global.css`:

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--bg-muted);
  color: var(--fg-muted);
  border: 1px solid var(--border);
}

.chip--accent {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: transparent;
}

.chip--clickable {
  cursor: pointer;
  transition: all var(--transition-fast);
}
.chip--clickable:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.chip` component

### 2.3 Unified Modal Style

**Current state:** Each module has its own modal implementation:
- `ideas.css`: `.idea-modal` (uses `<dialog>`)
- `experiments.css`: `.experiment-modal` (uses `<dialog>` with backdrop)
- `roadmap.css`: `.modal-overlay.active` + `.modal-content` (custom div)
- `writing.css`: `.modal` (custom div)

**Solution:** Consolidate to single `.modal-*` pattern in `global.css`:

```css
/* Unified modal base */
.modal {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  padding: 1rem;
}
.modal.open { display: flex; }

.modal-backdrop {
  position: absolute;
  inset: 0;
}

.modal-content {
  position: relative;
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  max-width: 560px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding: 1.5rem;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
}
.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--fg-muted);
  cursor: pointer;
  line-height: 1;
}
.modal-close:hover { color: var(--fg); }

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add unified `.modal-*` classes
- `astro-src/styles/ideas.css` — remove `.idea-modal`, `.modal-*` duplicates
- `astro-src/styles/experiments.css` — remove `.experiment-modal` duplicates
- `astro-src/styles/roadmap.css` — remove `.modal-overlay`, `.modal-content` duplicates
- `astro-src/styles/writing.css` — remove `.modal` duplicates

---

## 3. Empty States

### 3.1 Writing Module — Add Sample Card

**Problem:** Writing module empty state shows "还没有写作" but no sample card, unlike Ideas/Experiments which show example data.

**Current (writing.css:173-195):**
```css
.writing-empty {
  text-align: center;
  padding: var(--space-8) var(--space-4);
  background: var(--bg-elevated);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
}
```

**Solution:** Add sample writing card below empty state in `writing-ui.ts` and style in `writing.css`:

```css
.writing-sample {
  margin-top: var(--space-6);
  padding: var(--space-6);
  background: var(--bg-elevated);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
}

.writing-sample-label {
  font-size: 0.85rem;
  color: var(--fg-muted);
  margin-bottom: var(--space-4);
}

.writing-sample-card {
  padding: var(--space-4);
  background: var(--bg-muted);
  border-left: 4px solid var(--writing-color);
  border-radius: var(--radius-md);
}

.writing-sample-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.writing-sample-abstract {
  font-size: 0.9rem;
  color: var(--fg-muted);
  line-height: 1.5;
}
```

**Files to modify:**
- `astro-src/styles/writing.css` — add `.writing-sample` styles
- `astro-src/scripts/writing-ui.ts` — add sample data rendering for empty state

### 3.2 Roadmap Empty State Improvement

**Problem:** Roadmap empty state message still implies file editing ("点击上方「新建路线图」按钮创建您的研究路线图,或参考下方示例").

**Solution:** Update empty state text to be clearer:

```css
.roadmap-empty-title {
  font-size: 1.25rem;
  margin-bottom: var(--space-2);
}
.roadmap-empty-desc {
  color: var(--fg-muted);
  margin-bottom: var(--space-4);
}
```

**Files to modify:**
- `astro-src/pages/roadmap/index.astro` — update empty state HTML text

### 3.3 Unified Empty State Pattern

All modules should follow this pattern:

```css
.empty-state {
  text-align: center;
  padding: var(--space-12) var(--space-4);
  background: var(--bg-elevated);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
}
.empty-state-icon {
  font-size: 3rem;
  margin-bottom: var(--space-4);
}
.empty-state-title {
  font-size: 1.25rem;
  margin-bottom: var(--space-2);
}
.empty-state-desc {
  color: var(--fg-muted);
  margin-bottom: var(--space-4);
  max-width: 400px;
  margin-left: auto;
  margin-right: auto;
}
.empty-state-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-md);
  font-weight: 600;
  text-decoration: none;
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.empty-state` pattern
- `astro-src/styles/ideas.css` — migrate to use `.empty-state`
- `astro-src/styles/experiments.css` — migrate to use `.empty-state`
- `astro-src/styles/writing.css` — migrate to use `.empty-state`
- `astro-src/styles/roadmap.css` — migrate to use `.empty-state`

---

## 4. Loading / Error States

### 4.1 Loading Skeleton

**Problem:** No loading states. When localStorage is being read, user sees blank area.

**Solution:** Add loading skeleton pattern to `global.css`:

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-muted) 25%,
    var(--bg-elevated) 50%,
    var(--bg-muted) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-text {
  height: 1em;
  margin-bottom: 0.5em;
}
.skeleton-text:last-child { width: 60%; }

.skeleton-card {
  height: 120px;
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.skeleton` classes

### 4.2 Error State

**Problem:** No unified error display. Each module handles errors differently or silently fails.

**Solution:** Add error state pattern:

```css
.error-state {
  text-align: center;
  padding: var(--space-8);
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  border-radius: var(--radius-lg);
}
.error-state-icon {
  font-size: 2rem;
  margin-bottom: var(--space-3);
}
.error-state-title {
  color: var(--danger);
  font-weight: 600;
  margin-bottom: var(--space-2);
}
.error-state-desc {
  color: var(--fg-muted);
  font-size: 0.9rem;
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.error-state` classes

---

## 5. Mobile Responsive Fixes

### 5.1 Workflow Cards — Stack Vertically on Mobile

**Problem:** Home page workflow cards don't stack on small screens (<640px). Round 2 feedback explicitly requests this.

**Current (home.css:667-676):**
```css
@media (max-width: 720px) {
  .libraries-page .workflow-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .libraries-page .workflow-cards {
    grid-template-columns: 1fr;
  }
}
```

This exists for `.libraries-page` but NOT for home page. Add:

```css
@media (max-width: 720px) {
  .home .workflow-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .home .workflow-cards {
    grid-template-columns: 1fr;
  }
}
```

**Files to modify:**
- `astro-src/styles/home.css` — add mobile responsive for workflow cards

### 5.2 Card Grids — Consistent Mobile Behavior

All modules should stack at <640px:

```css
@media (max-width: 640px) {
  .ideas-grid,
  .experiments-grid,
  .writing-grid,
  .roadmap-list {
    grid-template-columns: 1fr;
  }
}
```

**Files to modify:**
- `astro-src/styles/ideas.css` — add responsive grid
- `astro-src/styles/experiments.css` — add responsive grid
- `astro-src/styles/writing.css` — add responsive grid
- `astro-src/styles/roadmap.css` — add responsive grid

### 5.3 Touch-Friendly Target Sizes

**Problem:** Buttons too small for touch. Many are <44px height.

**Solution:** Add touch-friendly minimums:

```css
button,
.btn,
.btn-primary,
.btn-secondary {
  min-height: 44px;
  min-width: 44px;
  padding: 0.625rem 1rem;
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add touch-friendly button styles

---

## 6. Keyboard Shortcuts

### 6.1 Keyboard Navigation System

**Problem:** No keyboard shortcuts implemented. Round 2 feedback requests j/k navigation, / search, e edit, n new.

**Solution:** Add keyboard handler in `global.css` and create a shared UI module.

**Add to global.css:**

```css
/* Keyboard shortcut hints */
.kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--fg-muted);
}

.kbd {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--fg-muted);
}

/* Keyboard shortcut help overlay */
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.shortcuts-overlay.open { display: flex; }

.shortcuts-panel {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
}

.shortcuts-panel h3 {
  margin: 0 0 1rem;
  font-size: 1.1rem;
}

.shortcut-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}
.shortcut-row:last-child { border-bottom: none; }

.shortcut-keys {
  display: flex;
  gap: 0.25rem;
}
```

### 6.2 Keyboard Shortcuts Implementation

**File to create:** `astro-src/scripts/keyboard-shortcuts.ts`

```typescript
// Keyboard shortcuts implementation
// j/k: navigate cards, /: search, e: edit, n: new, ?: help

interface ShortcutConfig {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

const shortcuts: ShortcutConfig[] = [
  { key: 'j', action: () => navigate('down'), description: 'Navigate down' },
  { key: 'k', action: () => navigate('up'), description: 'Navigate up' },
  { key: '/', action: () => focusSearch(), description: 'Search' },
  { key: 'e', action: () => editCurrent(), description: 'Edit current item' },
  { key: 'n', action: () => createNew(), description: 'Create new item' },
  { key: 'Escape', action: () => closeModals(), description: 'Close modal' },
  { key: '?', shift: true, action: () => toggleHelp(), description: 'Show shortcuts' },
];

let currentIndex = -1;
let cardSelector = '.idea-card, .exp-card, .writing-card, .roadmap-card';

function navigate(direction: 'up' | 'down') {
  const cards = document.querySelectorAll(cardSelector);
  if (!cards.length) return;

  if (direction === 'down') {
    currentIndex = Math.min(currentIndex + 1, cards.length - 1);
  } else {
    currentIndex = Math.max(currentIndex - 1, 0);
  }

  cards.forEach((c, i) => c.classList.toggle('active', i === currentIndex));
  cards[currentIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function focusSearch() {
  const searchInput = document.querySelector('input[type="search"], input[placeholder*="搜索"]') as HTMLInputElement;
  searchInput?.focus();
}

function editCurrent() {
  const active = document.querySelector('.active, [data-active]');
  const editBtn = active?.querySelector('[data-action="edit"]') as HTMLButtonElement;
  editBtn?.click();
}

function createNew() {
  const createBtn = document.querySelector('[data-action="create"]') as HTMLButtonElement;
  createBtn?.click();
}

function closeModals() {
  const modals = document.querySelectorAll('.modal.open, dialog[open]');
  modals.forEach(m => {
    if (m instanceof HTMLDialogElement) m.close();
    else m.classList.remove('open');
  });
}

function toggleHelp() {
  const helpPanel = document.getElementById('shortcuts-help');
  helpPanel?.classList.toggle('open');
}

export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger when typing in inputs
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (!e.metaKey && !e.ctrlKey) return;
    }

    const match = shortcuts.find(s =>
      s.key.toLowerCase() === e.key.toLowerCase() &&
      s.shift === e.shiftKey &&
      s.ctrl === (e.ctrlKey || e.metaKey)
    );

    if (match) {
      e.preventDefault();
      match.action();
    }
  });
}
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.kbd`, `.kbd-hint`, `.shortcuts-*` styles
- `astro-src/scripts/keyboard-shortcuts.ts` — new file with shortcut implementation

---

## 7. Help System

### 7.1 Floating Help Button

**Problem:** No dedicated help button. Round 2 feedback requests "floating help button (?)".

**Solution:** Add to `global.css`:

```css
.help-fab {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  border: none;
  font-size: 1.5rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-lg);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
}
.help-fab:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 20px var(--accent-glow);
}
```

### 7.2 Help Panel Content

**HTML to add to page layout:**

```html
<button class="help-fab" id="help-fab" aria-label="帮助">?</button>

<div class="help-panel" id="help-panel">
  <div class="help-panel-header">
    <h3>帮助</h3>
    <button class="help-close" aria-label="关闭">&times;</button>
  </div>
  <div class="help-section">
    <h4>快捷键</h4>
    <div class="help-shortcut"><kbd>j</kbd> <kbd>k</kbd> 导航</div>
    <div class="help-shortcut"><kbd>/</kbd> 搜索</div>
    <div class="help-shortcut"><kbd>e</kbd> 编辑</div>
    <div class="help-shortcut"><kbd>n</kbd> 新建</div>
    <div class="help-shortcut"><kbd>?</kbd> 显示此帮助</div>
  </div>
  <div class="help-section">
    <h4>模块</h4>
    <p><strong>想法</strong> — 记录研究灵感</p>
    <p><strong>实验</strong> — 设计验证实验</p>
    <p><strong>写作</strong> — 撰写论文初稿</p>
    <p><strong>路线图</strong> — 规划研究进度</p>
  </div>
</div>
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.help-fab`, `.help-panel` styles
- Layout component (likely `Navbar.astro` or `Layout.astro`) — add help button + panel HTML

---

## 8. Discoverability Improvements

### 8.1 Home Page — Research Workflow Section

**Problem:** Research workflow not prominent enough. Round 2 feedback requests home page showcase.

**Solution:** The workflow cards already exist in `home.css` (lines 614-676) under `.libraries-page .workflow-cards`. Ensure this section appears on home page, not just libraries page.

**Current CSS is scoped to `.libraries-page`**:
```css
.libraries-page .workflow-cards { ... }
```

**Solution:** Also target home page:
```css
.home .workflow-cards,
.libraries-page .workflow-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}
```

**Files to modify:**
- `astro-src/styles/home.css` — ensure workflow cards work on home page

### 8.2 Breadcrumb Navigation

Add breadcrumbs to detail pages for better navigation:

```css
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--fg-muted);
  margin-bottom: var(--space-4);
}
.breadcrumb a {
  color: var(--fg-muted);
  text-decoration: none;
}
.breadcrumb a:hover { color: var(--accent); }
.breadcrumb-sep { color: var(--border-strong); }
```

**Files to modify:**
- `astro-src/styles/global.css` — add `.breadcrumb` styles
- Detail pages — add breadcrumb HTML

---

## 9. Priority Implementation Order

### Phase 1: Critical (CSS only, no JS)
1. Add unified `.status-pill` to `global.css`
2. Add unified `.modal-*` to `global.css`
3. Add `.empty-state` to `global.css`
4. Add mobile responsive grids to all 4 module CSS files

### Phase 2: High Priority (Minimal JS)
5. Add keyboard shortcuts implementation
6. Fix writing empty state sample
7. Add touch-friendly button styles

### Phase 3: Medium Priority
8. Add floating help button
9. Add skeleton loading states
10. Add error states

---

## 10. Files Summary

| File | Changes |
|------|---------|
| `astro-src/styles/global.css` | Add `.status-pill`, `.chip`, `.modal-*`, `.empty-state`, `.skeleton`, `.kbd`, `.help-fab`, `.breadcrumb` |
| `astro-src/styles/ideas.css` | Migrate to unified patterns, add mobile responsive |
| `astro-src/styles/experiments.css` | Migrate to unified patterns, add mobile responsive |
| `astro-src/styles/writing.css` | Migrate to unified patterns, add mobile responsive, add sample card |
| `astro-src/styles/roadmap.css` | Migrate to unified patterns, add mobile responsive |
| `astro-src/styles/home.css` | Add mobile responsive for workflow cards |
| `astro-src/scripts/keyboard-shortcuts.ts` | New file |
| Layout component | Add help button + panel |

---

## 11. Notes

- All CSS changes follow DPR's existing design language (academic, minimal, warm tones)
- Status pills use consistent color scheme across modules
- Mobile breakpoints align with existing DPR breakpoints (640px, 720px)
- Keyboard shortcuts follow common patterns (j/k from email clients, / from search bars)
- Help system is non-intrusive floating button in bottom-right corner

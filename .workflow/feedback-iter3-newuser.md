# New User Persona Feedback — Iteration 3

**Test Persona:** First-time user, never used DPR before
**Date:** 2026-09-08
**Reviewer:** Claude (simulated new user testing)

---

## Executive Summary

Iteration 2 made meaningful progress on onboarding and navigation clarity. The welcome modal, navbar tooltips, and Idea→Experiment flow are now functional. However, several discoverability and mobile UX issues persist from Round 2.

---

## Test 1: Find Search

### Test Procedure
1. Land on home page
2. Look for search functionality without guidance

### Findings

**Location:** Search is prominently placed on home page hero section (lines 60-85 in `index.astro`)

**UI Elements:**
- Large search input with placeholder "搜索想法、实验、写作、路线图..."
- Search button with magnifying glass icon
- "研究仪表板" link next to search box

**Dedicated Search Page:** `/search/` has:
- Full-width search input (autofocus)
- Module filter radio buttons (全部/想法/实验/写作/路线图)
- Results grouped by module with highlighting

**Assessment:** ✅ **PASS** — Search is easily discoverable on home page, no scrolling needed. Placeholder text clearly indicates what's searchable.

---

## Test 2: Use Template

### Test Procedure
1. Navigate to /experiments/
2. Click "新建实验" button
3. Look for template selection

### Findings

**Location:** `/experiments/` page, modal form (lines 71-72)

**UI Elements:**
- Label: "选择模板 (可选)"
- Dropdown with options:
  - "— 空白实验 —" (default)
  - "消融实验 (Ablation Study)"
  - "超参数搜索 (Hyperparameter Sweep)"
  - "对比实验 (Baseline Comparison)"
  - "案例研究 (Case Study)"

**Interaction:** Selecting a template auto-fills:
- title, titleZh
- hypothesis, hypothesisZh
- method, methodZh
- expectedResults, expectedResultsZh
- tags
- variables

**Writing Module:** Similar template picker at `/writing/`:
- "— 空白文档 —"
- "工作论文 (4页ACM格式)"
- "博客文章"

**Assessment:** ✅ **PASS** — Template selector is clearly labeled and functional. "可选" (optional) label is appropriate.

---

## Test 3: Read Empty States

### Test Procedure
1. Visit each module with no data
2. Evaluate clarity of CTAs

### Findings

**Ideas (`/ideas/`):**
- Empty state shows: "还没有想法" with icon
- CTA: "➕ 新建想法" button
- ✅ Has sample card displayed (per Round 2 fix)

**Writing (`/writing/`):**
- Empty state shows: "还没有写作" with icon
- CTA: "➕ 新建写作" button
- ❌ No sample card (only example in modal help text)

**Libraries (`/` → "我的文献库"):**
- Empty state shows: "还没有个人文献库"
- CTA: "➕ 新建文献库" button
- Helper text: "点右上角「➕ 新建文献库」开始——名字 + 一句话方向描述,30 秒搞定。"

**Search (`/search/`):**
- Empty state: "输入关键词开始搜索..."
- No CTA needed (search is the primary action)

**Roadmap (`/roadmap/`):**
- Empty state: "还没有路线图"
- CTA: "➕ 新建路线图" button
- Helper text: "点击上方「新建路线图」按钮创建您的研究路线图,或参考下方示例。"

**Assessment:** ⚠️ **PARTIAL PASS** — Most empty states have clear CTAs. Writing module still lacks sample card (Issue #R6 persists).

---

## Test 4: Mobile Experience

### Test Procedure
1. Simulate narrow viewport (analyze CSS media queries)
2. Check for responsive behavior

### Findings

**Navbar:**
- `@media (max-width: 920px)`: Links get smaller padding/font
- `@media (max-width: 720px)`: Brand subtitle hidden
- `@media (max-width: 460px)`: Brand text hidden
- Horizontal scroll preserved (no hamburger menu by design)
- 14 nav items scroll horizontally on narrow screens

**Workflow Cards (home):**
- No media query found for `.workflow-cards`
- Cards likely overflow or break on mobile
- **Issue:** `.workflow-cards` has `display: grid` but no responsive breakpoint

**Global:**
- `@media (max-width: 640px)`: `.dpr-show-mobile` / `.dpr-hide-mobile` classes exist
- Multiple component-specific media queries (papers, libraries, etc.)

**Assessment:** ❌ **FAIL** — Workflow cards section lacks mobile-specific CSS. User would need to horizontal scroll to see all cards on narrow viewport.

---

## Test 5: Home Page Next Steps

### Test Procedure
1. Land on home page
2. Identify what to do next

### Findings

**Welcome Modal:**
- Appears after 800ms on first visit
- Explains 5 core features with icons and descriptions
- "下次不再显示" checkbox for persistence
- Clear CTA: "开始使用" button

**Hero Section:**
- Headline: "文献库"
- Subtitle explains paper count, library count, personal library sync
- Search box prominently placed
- Shortcuts row: 今日新增, 最近更新, 全部论文, 主题探索, 项目工作区, 阅读仪表板

**Research Workflow Section:**
- Title: "研究工作流"
- Subtitle: "从想法到实验、写作、路线图 — 完整的研究生命周期管理"
- 4 clickable cards: 想法, 实验, 写作, 路线图
- Each card shows: icon, label, description, count badge

**Libraries Section:**
- Filter tabs: 全部/公共/我的
- "➕ 新建文献库" button
- Public libraries grid with paper counts

**Assessment:** ✅ **PASS** — Home page provides excellent next-step guidance. Welcome modal + workflow cards + shortcuts row give clear direction.

---

## Summary Scores

| Aspect | Score (1-5) | Notes |
|--------|-------------|-------|
| Search discoverability | 5 | Prominent on home + dedicated page |
| Template usability | 4 | Clear dropdown, auto-fill works, could be more prominent |
| Empty state clarity | 4 | Most have CTAs, writing needs sample |
| Mobile responsive | 2 | Workflow cards break on narrow screens |
| Next-step guidance | 5 | Welcome modal + workflow cards excellent |

---

## Iteration 3 Issues

### Issue #I3-1: Workflow Cards Not Mobile Responsive
**Severity:** Major
**Area:** Mobile experience
**Description:** The `.workflow-cards` section on home page has no media query. On narrow screens (<640px), cards overflow or break layout.
**Suggestion:** Add CSS:
```css
@media (max-width: 640px) {
  .workflow-cards {
    grid-template-columns: 1fr;
  }
}
```

### Issue #I3-2: Writing Empty State Missing Sample Card
**Severity:** Minor
**Area:** Empty states
**Description:** Ideas shows example card in empty state, but Writing only shows "还没有写作" text. User must click "新建写作" to see format guidance.
**Suggestion:** Add sample writing card to empty state, similar to ideas.

### Issue #I3-3: No Persistent Help Access
**Severity:** Major
**Area:** Help/guidance
**Description:** Help button exists in navbar (opens modal with quick start guide), but requires clicking "?" icon. No obvious help entry point for new users.
**Suggestion:** Consider adding "帮助" link to shortcuts row, or prominent "?" in hero section.

### Issue #I3-4: Navbar Horizontal Scroll Unfriendly
**Severity:** Minor
**Area:** Mobile
**Description:** 14 nav items + GitHub link require horizontal scroll on mobile. Tooltips (primary guidance) don't work on touch.
**Suggestion:** Keep current design but consider adding "更多" dropdown for secondary items on mobile.

---

## Recommendations for Next Iteration

### P0 (Critical)
None remaining from previous iterations.

### P1 (High Priority)
1. Add mobile CSS for workflow cards (Issue #I3-1)
2. Add sample writing card to empty state (Issue #I3-2)
3. Improve help discoverability (Issue #I3-3)

### P2 (Medium Priority)
4. Consider "更多" dropdown for navbar on mobile
5. Add context tooltips to form fields (e.g., "hypothesis" field)
6. Idea picker dropdown in experiment creation form

### P3 (Nice to Have)
7. Keyboard shortcut overlay (press "?")
8. Guided walkthrough beyond welcome modal

---

## Files Verified

| File | What Was Checked |
|------|------------------|
| `index.astro` | Search box, workflow cards, welcome modal |
| `search.astro` | Search page, module filters |
| `Navbar.astro` | Nav items, tooltips, help button |
| `ideas/index.astro` | Empty state, sample card |
| `writing/index.astro` | Empty state, template selector |
| `experiments/index.astro` | Template selector, form |
| `home.css` | Welcome modal styles |
| `global.css` | Mobile utility classes |
| `libraries.css` | Responsive breakpoints |

---

## Overall Assessment

Iteration 2 successfully addressed the critical onboarding issues from Round 1. Welcome modal, navbar tooltips, and Idea→Experiment flow now work. The main remaining issues are:

1. **Mobile UX** — Workflow cards need responsive CSS
2. **Writing sample** — Empty state should show example like Ideas
3. **Help access** — Could be more discoverable

The project is now much more usable for new users. These remaining issues are polish items rather than critical blockers.

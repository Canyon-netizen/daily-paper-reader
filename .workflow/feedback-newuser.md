# New User Persona Feedback — DPR First Impressions

**Test Persona:** 1st year PhD student, never used DPR before, wants to organize research workflow.

**Date:** 2026-09-07

---

## 1. Navigation & Discoverability

### What Works
- **Navbar** clearly shows 12 main sections: 文献库, 全部论文, 引用图, 主题探索, 会议, 概念, 想法, 实验, 写作, 路线图, 设置
- **Home page** has a dedicated "研究工作流" section with 4 workflow cards (想法 → 实验 → 写作 → 路线图)
- Navigation uses Chinese labels that are familiar to Chinese researchers

### Issues
- **Too many options at once** — A new user sees 12+ nav items plus 4 workflow cards on first load. Overwhelming.
- **Missing context** — Nav items don't explain what each section does. "想法" (ideas) vs "实验" (experiments) vs "写作" (writing) — what's the difference? When should I use each?
- **No onboarding flow** — No welcome modal, no guided tour, no "start here" for first-time users

---

## 2. Creating First Idea — Clarity Issues

### What Works
- Ideas page has a clear "新建想法" button
- Modal includes fields: 标题, 描述, 关联论文, 标签

### Critical Issues

**What IS an "idea"?**
- User sees field "标题" but doesn't know: Is this a research hypothesis? A todo item? A note about a paper?
- Field "描述" asks for "详细描述这个想法的背景、目标和预期价值" — but a 1st year PhD student may not know what constitutes a good research idea

**Data model unclear:**
- From `lib/ideas/types.ts`:
  ```
  interface Idea {
    id, title, description, status, relatedPapers, relatedConcepts, tags, createdAt, updatedAt
  }
  ```
- Status: `draft | active | promoted | archived` — What does "promoted" mean? When should I promote?
- There's no field for "hypothesis" or "expected outcome" explicitly — user must stuff everything into "description"
- **No examples** — No sample idea shown to illustrate the format

---

## 3. Data Model — Field Names Not Self-Explanatory

### Ideas
| Field | Issue |
|-------|-------|
| `relatedPapers` | What format? Just arXiv IDs? How do I find them? |
| `relatedConcepts` | What concepts? From where? No picker provided |
| `status: promoted` | Unclear what "promoted" means — promoted to what? |

### Experiments
| Field | Issue |
|-------|-------|
| `hypothesis`, `method`, `variables` | Good structure, but user doesn't know what level of detail is expected |
| `expectedResults`, `actualResults` | No guidance on what to write |
| `status: planning\|running\|completed\|failed\|paused` | Clear enough |

### Writing
- Types: paper, section, note, review, translation — unclear distinction between "note" and "review"

---

## 4. Moving Idea → Experiment — Flow Not Obvious

**The critical gap:**
- No visible connection between /ideas/ and /experiments/
- How do I turn an idea into an experiment?
- **No "promote to experiment" button** in the idea detail view
- User must manually create a new experiment and copy-paste content

**Roadmap connection:**
- Roadmap has `linked_ideas` and `linked_experiments` fields
- But there's no UI to link them — user must edit YAML manually

---

## 5. Help/Documentation

### What Exists
- `/docs/tutorial/README.md` exists but focuses on:
  - Keyboard shortcuts (1-4 keys)
  - Zotero integration
  - Sidebar navigation
  - "专题" (topic) setup
- **Missing:** How to use Ideas/Experiments/Writing/Roadmap modules

### Where to Look When Confused
- No help button in UI
- No tooltips or "?" icons
- Settings page has configuration but no usage guide

---

## 6. Empty States

### Ideas
```
"还没有想法" 
"点右上角「➕ 新建想法」开始 — 名字 + 一句话方向描述,30 秒搞定。"
```
**Good** — Encouraging, specific action.

### Experiments
```
"没有匹配的实验" / "试试选择其他状态过滤条件。"
```
**Acceptable** — But no prompt to create first experiment.

### Writing
```
"还没有写作" 
"点右上角「➕ 新建写作」开始你的第一篇论文或笔记。"
```
**Good** — Clear call to action.

### Roadmap
```
"暂无研究路线图"
"在 docs/roadmap/ 目录下创建 Markdown 文件来添加路线图。"
```
**PROBLEM** — Requires editing files, not a UI. New users can't create roadmaps from browser.

### Libraries (My Libraries)
```
"还没有个人文献库"
"点右上角「➕ 新建文献库」开始 —— 名字 + 一句话方向描述,30 秒搞定。"
```
**Good** — Clear.

---

## 7. Mobile/Responsive

### What Works
- CSS media queries present (640px, 720px, 768px, 1024px breakpoints)
- Navbar has horizontal scroll on small screens: `overflow-x: auto` with fade mask
- Brand title hides on <460px, subtitle hides on <720px

### Issues
- **Workflow cards on home** — 4 cards in a row likely break on mobile (no media query found for `.workflow-cards`)
- **Navbar** — 12 links + GitHub link = horizontal scroll. Functional but may confuse new users
- **No hamburger menu** — Comment in code: "这里不做汉堡菜单(避免引入 JS),保留滚动" — this is a design choice, but may frustrate mobile users

---

## Summary Scores (1-5)

| Aspect | Score | Reason |
|--------|-------|--------|
| Navigation discoverability | 2 | Too many options, no explanation |
| Idea creation clarity | 1 | What is an idea? No examples, unclear status |
| Data model transparency | 2 | Fields exist but semantics unclear |
| Idea→Experiment flow | 1 | No UI connection between modules |
| Help availability | 2 | Tutorial exists but doesn't cover workflow modules |
| Empty states | 4 | Generally clear and encouraging |
| Mobile responsive | 3 | Basic support works, but workflow cards may break |

---

## Recommendations

### P0 (Critical)
1. **Add onboarding tooltips** — When user first visits, show brief explanations for each nav item
2. **Show sample idea** — Display an example idea card so users know the format
3. **Add "Promote to Experiment" button** — In idea detail view, button to auto-create experiment from idea

### P1 (High)
4. **Explain status transitions** — Add tooltips: "草稿→进行中→推荐→归档" with meanings
5. **Add "What's this?" help icons** — Next to "想法", "实验", "写作", "路线图" in nav
6. **Create roadmap UI** — Remove requirement to edit YAML files manually

### P2 (Medium)
7. **Reduce nav options for first visit** — Show only core 4-5 items initially, reveal more on demand
8. **Add wizard for first idea** — Step-by-step: "What problem are you solving?" → "What papers relate?" → "What do you expect?"
9. **Mobile: stack workflow cards** — Add CSS to show cards vertically on small screens

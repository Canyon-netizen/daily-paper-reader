# New User Persona Feedback — Round 2

**Test Persona:** 1st year PhD student, never used DPR before
**Date:** 2026-09-07
**Reviewer:** New User Persona (simulated)

---

## Executive Summary

Round 1 fixes addressed **most critical issues**. Welcome modal, nav tooltips, sample data, and the Idea→Experiment flow now work. However, several clarity and discoverability issues remain.

---

## 1. Onboarding Flow — Verification Results

### ✅ Welcome Modal (Fixed)
- **Test:** First visit to home page
- **Result:** Modal appears after 800ms with feature explanations
- **Content:** Covers 文献库, 想法, 实验, 写作, 路线图 with icons and descriptions
- **Persistence:** "下次不再显示" checkbox works correctly
- **Verdict:** Working as intended

### ✅ Navbar Tooltips (Fixed)
- **Test:** Hover over any nav item
- **Result:** All 11 nav items now show tooltip on hover
- **Examples:** "想法" → "记录研究灵感与思考", "实验" → "设计实验验证想法"
- **Verdict:** Working as intended

### ✅ Sample Data Display (Fixed)
- **Test:** Visit Ideas page with no data
- **Result:** Shows example idea card with realistic content
- **Test:** Visit Writing page with no data
- **Result:** Shows example writing card
- **Verdict:** Working as intended

---

## 2. Discoverability — Verification Results

### ✅ Idea → Experiment Flow (Fixed)
- **Test:** Go to an idea detail page
- **Result:** "🔬 创建实验" button present
- **Action:** Clicking it pre-fills experiment form with idea title/hypothesis
- **Verdict:** Working as intended

### ✅ Status Tooltips (Fixed)
- **Test:** View idea status pill
- **Result:** Hover shows tooltip with status meaning (草稿/进行中/推荐/归档)
- **Verdict:** Working as intended

### ✅ Roadmap UI (Fixed)
- **Test:** Visit roadmap page
- **Result:** "新建路线图" button visible, clickable modal form works
- **Test:** Progress dashboard shows statistics
- **Verdict:** Working as intended

### ⚠️ Writing Module (Partially Fixed)
- **Test:** Create new writing
- **Result:** Markdown preview toggle works, KaTeX rendering works, citation picker works
- **Issue:** No sample writing shown in empty state (only example in modal help text)
- **Verdict:** Core functionality fixed, minor discoverability issue remains

---

## 3. Remaining Clarity Issues

### Issue #R1: Roadmap Empty State Still Refers to File Editing
**Severity:** Minor
**Current text:**
```
点击上方「新建路线图」按钮创建您的研究路线图,或参考下方示例。
```
**Previous text (from feedback):**
```
在 docs/roadmap/ 目录下创建 Markdown 文件来添加路线图。
```
**Assessment:** This was the critical issue (#6 in round 1). The fix correctly added UI button, but the empty state message was not fully updated. The current message is much better but could be clearer that no file editing needed.

---

### Issue #R2: No Dedicated Help Button / "?" Icons
**Severity:** Major
**Status:** Not addressed in round 1
**Details:**
- Nav tooltips exist (via `title` attribute) but no visual "?" icons
- No persistent help panel or "帮助" link in UI
- User must discover tooltips by hovering (not obvious on mobile/touch)
- No context-sensitive help when filling forms

**Recommendation:** Add a floating help button (?) in corner that opens help panel with:
- Quick start guide
- Module explanations
- Keyboard shortcuts reference

---

### Issue #R3: Mobile Discoverability Still Problematic
**Severity:** Major
**Status:** Not addressed in round 1
**Details:**
- No hamburger menu (by design decision, acknowledged)
- 12 nav items + GitHub link = horizontal scroll
- Workflow cards on home page likely break on small screens (no media query for `.workflow-cards`)
- Tooltips require hover — not accessible on touch devices

**Current state:** Same as round 1
**Recommendation:** At minimum, add CSS to stack workflow cards vertically on mobile (<640px)

---

### Issue #R4: Bidirectional Module Links Not Visible in UI
**Severity:** Major
**Status:** Partially addressed (data model exists, UI incomplete)
**Details:**
- Experiments can link to ideas (data-level)
- But no UI to search/select ideas when creating experiment
- Must manually enter idea ID
- Roadmap can technically link to ideas/experiments but no UI
- No visual indication of "this idea led to this experiment"

**Round 1 notes:** "Bidirectional linking: Ideas/experiments can be linked in data but UI for linking is not yet implemented."

---

### Issue #R5: Nav Reduction for First Visit Not Implemented
**Severity:** Minor
**Status:** Partial (tooltips added instead)
**Details:**
- Original feedback: "Show only core 4-5 items initially, reveal more on demand"
- Round 1 fix: Added tooltips to explain each item
- Current state: All 12 items still visible, just with tooltips
- Assessment: Tooltips are good workaround, but still overwhelming for true first-time users

---

### Issue #R6: Writing Module Empty State Missing Sample
**Severity:** Minor
**Details:**
- Ideas shows sample card in empty state
- Writing shows "还没有写作" but no sample
- User must click "新建写作" to see format guidance

---

### Issue #R7: Form Field Guidance Still Limited
**Severity:** Minor
**Status:** Partial
**Details:**
- Idea description: No hint about what makes a good research idea
- Experiment fields: Word count / detail level guidance missing
- Writing sections: Now shows word count (fixed in round 1), but no "why this matters" guidance

---

## 4. Summary Scores (Round 2)

| Aspect | Round 1 | Round 2 | Change |
|--------|---------|---------|--------|
| Navigation discoverability | 2 | 3 | +1 |
| Idea creation clarity | 1 | 3 | +2 |
| Data model transparency | 2 | 3 | +1 |
| Idea→Experiment flow | 1 | 4 | +3 |
| Help availability | 2 | 2 | 0 |
| Empty states | 4 | 4 | 0 |
| Mobile responsive | 3 | 3 | 0 |

**Overall improvement:** Significant progress on critical user flow issues (onboarding, Idea→Experiment). Help and mobile issues remain unaddressed.

---

## 5. Recommendations for Round 3

### P0 (Critical) — None remaining from round 1

### P1 (High)
1. **Add help button** — Floating "?" button that opens help panel with quick start guide
2. **Mobile workflow cards** — Add CSS media query to stack cards vertically on small screens
3. **Idea picker in experiment form** — Replace manual idea ID input with searchable dropdown

### P2 (Medium)
4. **Reduce nav on first visit** — Collapse secondary items behind "更多" menu initially
5. **Writing sample in empty state** — Show example writing card like ideas does
6. **Context tooltips in forms** — Add "?" icons next to fields like "hypothesis" explaining what's expected

### P3 (Nice to Have)
7. **Keyboard shortcut overlay** — Press "?" to show shortcuts anywhere
8. **Guided tour** — Step-by-step walkthrough for first-time users (beyond welcome modal)

---

## Appendix: Files Verified

| File | What Was Checked |
|------|------------------|
| `index.astro` | Welcome modal HTML + JS |
| `Navbar.astro` | Tooltip attributes on all links |
| `ideas-ui.ts` | Sample data display logic |
| `writing-ui.ts` | Sample data + markdown preview |
| `experiments-ui.ts` | Prefill from idea + status changes |
| `ideas/[id].astro` | "创建实验" button |
| `roadmap/index.astro` | Create button + dashboard |
| `home.css` | Welcome modal styles |
| `ideas.css` | Status tooltip styles |

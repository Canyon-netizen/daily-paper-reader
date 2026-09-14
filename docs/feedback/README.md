# User Feedback System — Library Operations

> **Purpose:** Collect user feedback on the multi-dimensional library inclusion standard
> in a way that's actionable but doesn't get in the way.
>
> **Design:** All-local, zero-network, FIFO-trimmed. User can clear at any time.
>
> **Source of truth:** `astro-src/lib/library/feedback.ts`

---

## 1. What we collect

11 event kinds, all optional, all user-initiated or user-reacting:

| Kind | When | Why |
|------|------|-----|
| `library_created` | User creates a new library | Track adoption of multi-image system |
| `library_deleted` | User deletes | Detect failed onboarding |
| `library_profile_changed` | User switches audienceProfile | Most important signal |
| `library_threshold_changed` | User adjusts threshold | Calibration data |
| `paper_included` | User accepts candidate | Positive signal per profile × paper |
| `paper_excluded` | User rejects | Negative signal |
| `paper_marked_irrelevant` | Explicit "off-topic" button | Strong negative signal |
| `candidate_score_too_low` | User overrides a low score | Threshold calibration |
| `candidate_score_too_high` | User overrides a high score | Threshold calibration |
| `paper_reading_status_changed` | star / read / reading | Engagement per library |
| `feedback_note` | Free-form note | Qualitative signal |

Each entry has:
- `id` (cuid-style)
- `at` (epoch ms)
- `kind`
- `libraryId?` / `arxivId?` (scoping)
- `value?` (numeric payload, e.g. LLM score, threshold)
- `text?` (free text, capped 500 chars)
- `audienceProfile?` (snapshot)

---

## 2. How it flows

```
User clicks button in UI
        ↓
[client side] recordFeedback({ kind, libraryId, arxivId, value, text })
        ↓
writeDoc() → localStorage['dpr_library_feedback_v1']
        ↓
emitDprLibraryFeedback({ kind, libraryId, arxivId, entryId })
        ↓
Settings page / other listeners refresh badge
```

Storage cap: **5000 entries** (FIFO trim). At a heavy user doing 50 actions/day,
this is 100 days of history — plenty.

Privacy: **zero PII**. No IP, no UA, no timestamps beyond epoch ms.

---

## 3. How users can inspect / clear

In `/settings/` page (TODO: implement UI for next iteration):

- Show count by kind (`countByKind()`)
- "导出 JSON" button — calls `exportFeedbackJson()`
- "清空所有反馈" button — calls `clearFeedback()`

The exported JSON has a header explaining how to share it.

---

## 4. How it informs the inclusion standard

Three signals tracked in [`library-inclusion-log.md`](library-inclusion-log.md):

1. **Adoption rate**: % of libraries with `audienceProfile` set after 30 days.
2. **Score-precision proxy**: among papers the user marks as `included` after
   seeing the LLM score, what's the average score per `audienceProfile`? If
   `novice` users mark `included` for low-pedagogical-clarity papers, the rubric
   weight on `pedagogical_clarity` is too high.
3. **Override rate**: how often users flip a `candidate` decision. High override
   rate = the threshold or the rubric doesn't match user intent.

These are **not** used to auto-tune. They're surfaced as signals in the
log so the maintainer can decide what to adjust.

---

## 5. Why not send to a server?

DPR is a **single-user static site** with zero backend. Adding telemetry
breaks that contract. The user can choose to share their exported JSON
voluntarily (Discord, GitHub issue, etc.).

The trade-off:
- ✅ Privacy preserved
- ✅ Zero infrastructure
- ❌ We don't have aggregate data
- → Mitigation: maintain the inclusion-log.md doc with signals we DO see
  (e.g., manual data dumps from users who share), and offer to fold
  shared feedback into the standard's calibration

---

## 6. Privacy & retention

- Storage: `localStorage` only, never leaves the browser
- No third-party scripts see this data
- User can clear via `/settings/` → "清空所有反馈"
- FIFO trim at 5000 entries prevents quota overflow

---

## 7. Future work

- [ ] UI in `/settings/` to view / export / clear
- [ ] Optional "share monthly digest" button (user-initiated, anonymous)
- [ ] Calibration script: given an exported JSON, suggest threshold adjustments
- [ ] A/B test of rubric weights based on user overrides (manual analysis)

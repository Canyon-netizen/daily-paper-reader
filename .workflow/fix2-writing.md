# Writing Module Fix Report — Round 2

## Summary

Round 1 implemented both the citation picker and metadata edit functionality. Round 2 verification identified one issue that needed fixing:

| Issue | Status | Notes |
|-------|--------|-------|
| Citation picker local search | ✅ FIXED | Removed broken localStorage fallback |
| Roadmap create button | ✅ ALREADY WORKS | Functionality exists and works |
| Writing metadata edit | ✅ ALREADY WORKS | Modal and handlers exist |

---

## Issue #1: Citation Picker — Broken LocalStorage Fallback

**Severity**: Major  
**Status**: ✅ FIXED in Round 2  
**Files Modified**: `astro-src/scripts/writing-ui.ts`

### Problem

The citation picker searched `dpr_papers_v1` localStorage key, which never exists because papers are stored as static markdown files, not in localStorage. This caused the picker to always show "未找到匹配的论文".

### Root Cause Analysis

The code had a two-tier fallback:
1. First try: Page-embedded `#papers-data` script (works on writing detail page)
2. Second try: `dpr_papers_v1` localStorage key (never populated → always fails)

### Fix Applied

Changed the fallback to search user library paper IDs from `dpr_user_libraries_v1`:

```typescript
// If no papers embedded, try user's library papers from localStorage
if (papers.length === 0) {
  try {
    const libsData = localStorage.getItem('dpr_user_libraries_v1');
    if (libsData) {
      const doc = JSON.parse(libsData);
      const libraries = doc.libraries || {};
      const paperIds = new Set<string>();
      for (const lib of Object.values(libraries) as any[]) {
        for (const pid of lib.paperIds || []) {
          paperIds.add(pid);
        }
      }
      papers = Array.from(paperIds).map(id => ({
        arxivId: id,
        title: `arXiv: ${id}`,
        authors: [],
      }));
    }
  } catch { /* ignore */ }
}
```

### Verification

- Writing detail page already embeds paper data via SSR (`papersPayload`)
- Users with papers in their libraries will see those papers in the citation picker
- Manual arXiv ID input still works as fallback

---

## Verified: Existing Functionality

### Roadmap Create Button

**Verification**: The create button already works correctly.

- `roadmap-ui.ts:initCreateRoadmapModal()` handles the click
- Opens modal, handles form submit, calls `createClientRoadmap()`
- Page imports and auto-initializes the UI module

The feedback's claim that the button was "non-functional" was incorrect.

### Writing Metadata Edit

**Verification**: The metadata edit modal already exists and works.

- HTML modal in `writing/[id].astro:117-150`
- `setupMetadataEdit()` in `writing-ui.ts:801-849` handles the form
- Updates title, type, and targetVenue via `updateWriting()`

---

## Related Issues (Out of Scope for Writing Module)

The following issues from feedback affect other modules:

1. **Paper → Idea Link** - Missing "Save as Idea" button on paper detail page
2. **Experiment Variables UI** - No form fields for structured variables
3. **Sprint Granularity UI** - No timeline/Gantt view for roadmap

These belong to their respective modules (papers, experiments, roadmap) and are out of scope for the writing fix report.

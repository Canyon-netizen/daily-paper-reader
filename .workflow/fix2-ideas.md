# Fix Report — Ideas Module (Round 2)

## Fixed Issues

### #1 — Paper → Idea Link (Original Issue #9 from Round 1)
**Fixed in:**
- `astro-src/pages/papers/[arxiv].astro` — Added "Save as Idea" button in paper header actions
- `astro-src/pages/papers/[arxiv].astro` — Added click handler to navigate to ideas page with prefill params
- `astro-src/scripts/ideas-ui.ts` — Added URL param handling for prefill_title and prefill_papers
- `astro-src/scripts/ideas-ui.ts` — Modified openIdeaModal() to accept prefill parameters
- `astro-src/pages/papers/[arxiv].astro` — Added CSS styling for the new button

**Behavior:** User clicks "💡 保存为想法" on a paper detail page, then:
1. Redirects to `/ideas/` with prefill parameters in URL
2. Ideas page automatically opens the "New Idea" modal
3. Title field is pre-filled with paper title
4. Related papers field is pre-filled with paper arXiv ID

### #2 — Citation Picker Local Search (NEW ISSUE #1 from Round 2)
**Fixed in:**
- `astro-src/pages/writing/index.astro` — Added paper data embedding via paper repository
- `astro-src/pages/writing/[id].astro` — Added paper data embedding for citation picker search
- `astro-src/scripts/writing-ui.ts` — Updated initCitationPickerSearch to use embedded paper data

**Behavior:** The citation picker now searches from page-embedded paper data instead of broken localStorage:
1. Writing pages embed paper data at build time via `<script id="papers-data">`
2. Citation picker modal reads from this embedded data
3. Search works by title, author, or arXiv ID

### Note: Roadmap Create Button
The feedback reported the roadmap create button was non-functional, but upon investigation, the handler already exists in `roadmap-ui.ts:65-114`. The code correctly opens the modal and creates roadmaps. This was likely a false positive in the feedback.

### Note: Writing Metadata Edit
The feedback reported missing metadata edit modal, but the modal already exists in `writing/[id].astro:118` and the handler exists in `writing-ui.ts:800-849`. This was likely a false positive in the feedback.

## Files Modified

1. `astro-src/pages/papers/[arxiv].astro` — Added save-as-idea button + handler + CSS
2. `astro-src/scripts/ideas-ui.ts` — Added URL param handling + prefill support in modal
3. `astro-src/pages/writing/index.astro` — Added paper data embedding for citation picker
4. `astro-src/pages/writing/[id].astro` — Added paper data embedding for citation picker

## Verification

To verify:
1. Visit any paper detail page (e.g., `/papers/1706.03762/`)
2. Click the "💡 保存为想法" button
3. Should redirect to `/ideas/` with modal auto-opened and fields pre-filled
4. Visit `/writing/` and open citation picker modal
5. Search should return papers from the embedded data

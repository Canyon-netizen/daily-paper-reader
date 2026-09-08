# Writing Module Fix Report — Round 1

## Issues Addressed

### Issue #14: No rich text / markdown / LaTeX support
- **Severity**: Major
- **Description**: Plain textarea for each section. No markdown preview. No LaTeX support (critical for academic paper writing). No word count guidance.
- **Status**: ✅ FIXED
- **Files Modified**:
  - `astro-src/scripts/writing-ui.ts` - Added markdown preview toggle, KaTeX/LaTeX rendering, word count guidance per section
  - `astro-src/pages/writing/[id].astro` - Added KaTeX and marked.js CDN loading
  - `astro-src/styles/writing.css` - Added preview mode styles

### Issue #15: No citation picker
- **Severity**: Major
- **Description**: Must know exact arXiv ID to cite. No search or autocomplete. No link to user's library.
- **Status**: ✅ FIXED
- **Files Modified**:
  - `astro-src/scripts/writing-ui.ts` - Added citation picker modal with paper search from localStorage
  - `astro-src/pages/writing/[id].astro` - Added citation picker modal UI
  - `astro-src/styles/writing.css` - Added citation picker modal styles

## Implementation Details

### Markdown Preview
- Added toggle button (编辑/预览) for each section
- Uses `marked.js` from CDN for markdown rendering
- Falls back to basic formatting if marked unavailable
- Supports: bold, italic, code, lists, blockquotes, headers

### LaTeX Support
- Uses KaTeX from CDN for math rendering
- Block math: `$$E=mc^2$$`
- Inline math: `$x^2$`
- Graceful fallback if KaTeX fails to load

### Word Count Guidance
- Shows live word count per section
- Provides typical length guidance:
  - 摘要: 200-300 字
  - 引言: 800-1500 字
  - 方法: 1000-2000 字
  - 实验: 1500-3000 字
  - 结果: 1000-2000 字
  - 讨论: 800-1500 字
  - 结论: 200-500 字

### Citation Picker
- New "从文库选择" button opens search modal
- Searches local paper collection by title, author, arXiv ID
- Shows paper titles (not just IDs)
- Also keeps manual arXiv ID input as fallback
- Loads paper titles from localStorage dynamically
- Links to paper detail pages

## Related Issues (Out of Scope for Writing Module)

The following issues from round1 affect writing but belong to other areas:
- **#24** (Writing is 100% client-side — no sharing) → data-model area
- **#20** (No bidirectional links between modules) → integration area
- **#21** (No unified pipeline view) → integration area

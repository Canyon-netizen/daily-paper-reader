# Iteration 3 Testing Feedback - PhD Student Persona

Date: 2026-09-08

## Test Summary

All 6 test scenarios were executed against the dev server running at `http://localhost:4321/`.

### 1. Add New Idea via Markdown

**Status: PASS**

- Created `docs/ideas/test-new-idea.md` with proper frontmatter
- Ran `bun run predev` - output confirmed 11 paths (was 10 before):
  ```
  [generate-paths] ideas: 11 paths
  [generate-paths] Total: 27 paths across 4 modules
  ```
- Dynamic route `/ideas/test-new-idea/` returns valid HTML page
- The prebuild script regenerates `paths.generated.ts` and `search-index.json`

### 2. Cross-Module Search

**Status: PASS**

- Page `/search/` renders with search form and module filters
- Filters available: all, ideas, experiments, writing, roadmap
- Uses build-time generated `public/search-index.json` (27 entries across 4 modules)
- Client-side search with weighted scoring:
  - Title match: +10 points
  - Description match: +5 points
  - Tag match: +3 points
  - Content match: +1 point

### 3. Export Writing

**Status: PASS**

- Export functionality implemented in `writing-ui.ts` (lines 906-958)
- Markdown export generates `.md` file with:
  - Title, status, type, target venue
  - Abstract and all sections (sorted by order)
  - Citations as markdown links
- PDF export uses `window.print()` for browser print dialog

### 4. Use Template

**Status: PASS**

- Experiments page (`/experiments/`) has template selector dropdown
- Available templates in `lib/experiments/templates.ts`:
  - `ablation-study` - 消融实验
  - `hyperparameter-sweep` - 超参数搜索
  - `user-study` - 用户研究
  - `ab-test` - A/B 测试
- Templates include pre-filled fields: hypothesis, method, expectedResults, variables, tags

### 5. Research Dashboard

**Status: PASS**

- Page `/research/` renders with title "Research Dashboard"
- Aggregates cross-module data via `lib/research/index.ts`:
  - Stats: ideas total, experiments by status, writings drafts, current quarter
  - Active ideas (status: active)
  - Running experiments (status: running)
  - Draft writings
  - Current quarter goals
- Client-side rendering with status color coding

### 6. Existing Flows (Iteration 1)

**Status: PASS**

- `/papers/` page loads correctly
- Navigation components (Navbar, Footer) render
- Core functionality intact

## Observations

1. **Dev Server Port**: Uses port 4321 (not 4322 as some docs might suggest)
2. **Trailing Slash**: Astro configured with `trailingSlash: always` - URLs require trailing slash (`/research/` not `/research`)
3. **Prebuild Required**: Any markdown changes require `bun run predev` to regenerate paths and search index
4. **Client-Side Hydration**: Many pages render shell HTML and hydrate on client (ideas, experiments, writings)

## Minor Notes

- The test idea file created (`docs/ideas/test-new-idea.md`) can be kept or removed as needed
- Search is client-side only - depends on `search-index.json` being loaded
- All features work as expected - no blockers identified

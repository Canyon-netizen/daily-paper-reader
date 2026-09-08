# Infrastructure Build Summary

**Date:** 2026-09-08
**Commit:** feat(infra): dynamic route scanning + cross-module search

---

## PART A: Build-time Dynamic Route Scanning

### Problem
- Adding `docs/ideas/foo.md` did not auto-create `/ideas/foo` route
- Required manual `getStaticPaths` updates in each `[id].astro` file

### Solution
Created `generate-paths.mjs` script that:
1. Scans `docs/{module}/*.md` directories at build time
2. Extracts file IDs (filename without .md)
3. Generates `paths.generated.ts` with typed path arrays

### Files Changed
- **Created:** `astro-src/scripts/generate-paths.mjs`
- **Generated:** `astro-src/lib/paths.generated.ts`
- **Modified:** `astro-src/pages/ideas/[id].astro`
- **Modified:** `astro-src/pages/experiments/[id].astro`
- **Modified:** `astro-src/pages/writing/[id].astro`
- **Modified:** `astro-src/scripts/prebuild.mjs` (added generate-paths step)

### How It Works
```
docs/ideas/*.md → generate-paths.mjs → paths.generated.ts → [id].astro imports
```

Now adding a new doc automatically creates the route after rebuild:
```bash
# Add new idea
echo "# New idea" > docs/ideas/my-new-idea.md

# Rebuild (paths auto-regenerate)
npm run build

# Route /ideas/my-new-idea is now available
```

---

## PART B: Cross-Module Search

### Problem
- No unified search across ideas, experiments, writings, and roadmaps
- Each module had separate data sources

### Solution
1. Build-time search index: `build-search-index.mjs` scans all modules
2. Client-side search: `search.astro` loads JSON index and performs BM25-like scoring

### Files Created
- `astro-src/scripts/build-search-index.mjs` - Generates `public/search-index.json`
- `astro-src/pages/search.astro` - Search UI page
- `astro-src/styles/search.css` - Search page styles

### Search Features
- **Modules indexed:** ideas, experiments, writing, roadmap
- **Searchable fields:** title, description, tags, content
- **Scoring:** Title match (10pts), description (5pts), tags (3pts), content (1pt)
- **Filters:** Radio buttons for module filtering
- **Highlights:** Query terms highlighted in results
- **URL-based:** `/search?q=scaling&module=ideas`

### Index Structure
```json
{
  "v": 1,
  "generatedAt": "2026-09-08T...",
  "modules": ["ideas", "experiments", "writing", "roadmap"],
  "count": 26,
  "entries": [
    {
      "module": "ideas",
      "id": "transformer-attention-scaling",
      "title": "...",
      "description": "...",
      "tags": ["architecture", "theory"],
      "content": "...",
      "url": "/ideas/transformer-attention-scaling"
    }
  ]
}
```

---

## Verification

### Build Status
- `npm run build` - **PASSED**
- 2120 pages built including search and all dynamic routes

### Dynamic Routes Verified
- `/search` - Search page loads
- `/ideas/*` - All 10 ideas have routes
- `/experiments/*` - All 8 experiments have routes
- `/writing/*` - All 5 writings have routes

### Auto-Generation Verified
```bash
$ node astro-src/scripts/generate-paths.mjs
[generate-paths] ideas: 10 paths
[generate-paths] experiments: 8 paths
[generate-paths] writing: 5 paths
[generate-paths] roadmap: 3 paths
[generate-paths] Total: 26 paths across 4 modules
```

---

## Usage

### For New Content
1. Create `docs/ideas/my-new-idea.md`
2. Run `npm run build`
3. Route `/ideas/my-new-idea` is automatically available

### For Search
1. Visit `/search?q=keyword`
2. Results show across all modules
3. Use module filter to narrow results

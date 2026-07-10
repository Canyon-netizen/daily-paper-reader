// astro-src/lib/dom-utils.ts
//
// Small DOM-utility helpers previously copy-pasted across multiple scripts.
// Extracted in PR-7 to give a single source of truth. Only the functions
// that were byte-identical (or near-identical) across all call sites are
// moved here; anything with subtle signature drift stays in place for
// now to avoid breaking subtle call-site assumptions.

/**
 * Trailing-edge debounce: invokes `fn` only after `ms` milliseconds of
 * silence. Latest call wins; intermediate calls are dropped.
 *
 * This implementation is byte-identical to the one in
 * `scripts/paper-analyzer.ts:374`, `scripts/settings-page.ts:67`, and
 * `scripts/topic-search.ts:209` — those three definitions were copies
 * of the same closure. PR-7 deletes them and re-routes through this export.
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Strip the trailing `vN` version suffix from an arXiv ID, returning a
 * canonical (version-less) identifier used for de-duplication.
 *
 * Two name variants existed in the wild — `canonicalArxivId` in
 * `scripts/paper-analyzer.ts:2153` and `canonicalId` in
 * `scripts/topic-search.ts:221`. Both share the same body; this is the
 * single canonical version. Call sites in this PR update the import name
 * to `canonicalArxivId` for consistency with the rest of the codebase.
 */
export function canonicalArxivId(id: string): string {
  return id.replace(/v\d+$/i, '');
}
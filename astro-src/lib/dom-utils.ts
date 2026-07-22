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

/**
 * HTML-escape a string for safe injection into innerHTML / template
 * literals. Handles `&` / `<` / `>` / `"` / `'`.
 *
 * Four near-identical implementations existed across
 * `scripts/paper-analyzer.ts:330`, `scripts/settings-page.ts:59`,
 * `scripts/topic-search.ts:288`, and `lib/markdown.ts:32`. The first
 * three were 5-replace variants (this canonical version); `markdown.ts`
 * was a 4-replace variant missing the `"` and `'` escapes — an actual
 * bug fixed by this consolidation. Accepts `unknown` so callers that
 * pass optional fields don't have to coerce first.
 */
export function escapeHtml(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 按 id 取 DOM 元素；找不到时抛错（topic-search / paper-analyzer 等多入口共用约定）。
 * 之所以写在这里而不是各模块自建 $ helper：消除 scripts/ 三处副本。
 */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}
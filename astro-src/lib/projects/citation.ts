// astro-src/lib/projects/citation.ts
//
// Cite resolver for writing workspace: [cite:arxivId|optional caption]
// SSR-safe: all functions are pure synchronous transformations.

import { canonicalArxivId } from '../arxiv';

/**
 * Cite pattern: [cite:2607.01234] or [cite:2607.01234v1|section 3.2]
 * Captures: arxivId (with optional version) and optional caption
 */
const CITE_PATTERN = /\[cite:([\w.-]+(?:v\d+)?)(?:\|([^\]]+))?\]/g;

export interface CiteToken {
  fullMatch: string;      // '[cite:2607.01234|section 3]'
  arxivId: string;        // '2607.01234' (canonical after normalization)
  version?: string;       // 'v1' if present, undefined otherwise
  caption?: string;       // 'section 3' if provided
  index: number;          // start offset in markdown
}

/**
 * Extract all cite tokens from markdown, preserving order and position.
 */
export function extractCites(markdown: string): CiteToken[] {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

  const tokens: CiteToken[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  const regex = new RegExp(CITE_PATTERN.source, 'g');

  while ((match = regex.exec(markdown)) !== null) {
    const fullMatch = match[0];
    const rawId = match[1];
    const caption = match[2] || undefined;

    // Normalize: strip version for canonical id
    const versionMatch = rawId.match(/v(\d+)$/);
    const version = versionMatch ? `v${versionMatch[1]}` : undefined;
    const arxivId = canonicalArxivId(rawId);

    tokens.push({
      fullMatch,
      arxivId,
      version,
      caption,
      index: match.index,
    });
  }

  return tokens;
}

/**
 * Normalize cite targets: extract unique canonical IDs and all tokens.
 * Returns both the canonical list (deduplicated) and full token array.
 */
export function normalizeCiteTargets(
  markdown: string,
): { canonical: string[]; tokens: CiteToken[] } {
  const tokens = extractCites(markdown);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const canonical: string[] = [];

  for (const token of tokens) {
    if (!seen.has(token.arxivId)) {
      seen.add(token.arxivId);
      canonical.push(token.arxivId);
    }
  }

  return { canonical, tokens };
}

/**
 * Build a map of cite index -> token for quick lookup during rendering.
 */
export function buildCiteIndex(markdown: string): Map<number, CiteToken> {
  const tokens = extractCites(markdown);
  const index = new Map<number, CiteToken>();

  for (const token of tokens) {
    index.set(token.index, token);
  }

  return index;
}

/**
 * Replace all [cite:xxx] with numbered citations [N].
 * Returns the transformed markdown and the citation order map.
 */
export function numberCites(
  markdown: string,
): { transformed: string; citationMap: Map<string, number> } {
  const tokens = extractCites(markdown);
  const citationMap = new Map<string, number>();

  // Build citation order
  for (const token of tokens) {
    if (!citationMap.has(token.arxivId)) {
      citationMap.set(token.arxivId, citationMap.size + 1);
    }
  }

  // Replace in reverse order to preserve indices
  let transformed = markdown;
  const replacements = new Map<string, string>();

  for (const [id, num] of citationMap) {
    // Escape for regex: handle both with and without version
    const patterns = [
      new RegExp(`\\[cite:${id}\\]`, 'g'),
      new RegExp(`\\[cite:${id}\\|([^\\]]+)\\]`, 'g'),
    ];

    for (const pattern of patterns) {
      transformed = transformed.replace(pattern, (_, caption) => {
        if (caption) {
          return `[${num}${caption ? `, ${caption}` : ''}]`;
        }
        return `[${num}]`;
      });
    }
  }

  return { transformed, citationMap };
}

/**
 * Generate a slug-safe string from arbitrary text.
 * ASCII-fold, lowercase, replace non-alphanumeric with hyphens.
 */
export function slugify(text: string): string {
  if (!text) return 'untitled';

  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with -
    .replace(/^-|-$/g, '')           // Trim leading/trailing hyphens
    .slice(0, 64);                   // Limit length
}

/**
 * astro-src/lib/agents/proposal-dedup.ts
 *
 * Proposal deduplication helper for R7 polish.
 * Uses Jaccard similarity on words.
 */

export interface Proposal {
  id: string;
  title: string;
  [key: string]: unknown;
}

/**
 * Extract words from a title (lowercase, alphanumeric only).
 * @param title - The proposal title
 * @returns Set of words
 */
function extractWords(title: string): Set<string> {
  const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  return new Set(words.filter(w => w.length > 0));
}

/**
 * Calculate Jaccard similarity between two sets.
 * @param a - First set
 * @param b - Second set
 * @returns Similarity score 0..1
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);

  return intersection.size / union.size;
}

/**
 * Deduplicate proposals by title similarity.
 * @param proposals - Array of proposals
 * @param threshold - Similarity threshold (default 0.8)
 * @returns Deduplicated array (keeps first occurrence)
 */
export function dedupeProposals(
  proposals: Proposal[],
  threshold: number = 0.8
): Proposal[] {
  if (proposals.length <= 1) return [...proposals];

  const result: Proposal[] = [];

  for (const proposal of proposals) {
    const words = extractWords(proposal.title);
    const isDuplicate = result.some(existing => {
      const existingWords = extractWords(existing.title);
      return jaccardSimilarity(words, existingWords) >= threshold;
    });

    if (!isDuplicate) {
      result.push(proposal);
    }
  }

  return result;
}

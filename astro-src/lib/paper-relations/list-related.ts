// astro-src/lib/paper-relations/list-related.ts
//
// List-similarity helper for finding related papers for a list of papers.
// Used by dashboard recommendations and project workspace.
//
// Reuses computeRelations() from index.ts, then aggregates edges by candidate id.

import type { PaperListItem } from '../paper';
import { computeRelations } from './index';

export interface RelatedForListResult {
  arxivId: string;
  weight: number;
  relatedTo: string[];
}

export interface FindRelatedForListOpts {
  papers: PaperListItem[];
  algorithm?: 'hybrid' | 'embedding' | 'tfidf' | 'jaccard';
  topK?: number;
  minWeight?: number;
  sinceDate?: string;
  queryLimit?: number;
  embeddingProvider?: unknown;
}

/**
 * Find papers related to a list of query papers.
 *
 * @param canonicalIds - List of canonical arxiv IDs to find related papers for
 * @param opts - Options including papers array, algorithm, thresholds
 * @returns Array of related papers with aggregated weights
 */
export async function findRelatedForList(
  canonicalIds: string[],
  opts: FindRelatedForListOpts,
): Promise<RelatedForListResult[]> {
  const {
    papers,
    algorithm = 'hybrid',
    topK = 12,
    minWeight = 0.05,
    sinceDate,
    queryLimit = 50,
  } = opts;

  if (canonicalIds.length === 0 || papers.length === 0) {
    return [];
  }

  // Build a set of query IDs for exclusion
  const querySet = new Set<string>();
  for (const id of canonicalIds) {
    const canonical = normalizeId(id);
    if (canonical) querySet.add(canonical);
  }

  // Get PaperListItem for query papers
  const queryPapers = papers.filter((p) => {
    const id = normalizeId(p.id);
    return id && querySet.has(id);
  }).slice(0, queryLimit);

  if (queryPapers.length === 0) {
    return [];
  }

  // Compute relations using the selected algorithm
  const result = await computeRelations(queryPapers, {
    algorithm,
    topK,
    minWeight: 0, // We filter after aggregation
  });

  // Aggregate edges by target paper
  const candidateMap = new Map<string, { weight: number; relatedTo: Set<string> }>();

  for (const edge of result.edges) {
    const sourceId = normalizeId(edge.source);
    const targetId = normalizeId(edge.target);

    if (!sourceId || !targetId) continue;

    // Skip if target is in query set
    if (querySet.has(targetId)) continue;

    const existing = candidateMap.get(targetId);
    if (existing) {
      existing.weight += edge.weight;
      existing.relatedTo.add(sourceId);
    } else {
      candidateMap.set(targetId, {
        weight: edge.weight,
        relatedTo: new Set([sourceId]),
      });
    }
  }

  // Convert to result array and apply filters
  const results: RelatedForListResult[] = [];

  for (const [arxivId, data] of candidateMap) {
    // Apply minWeight filter
    if (data.weight < minWeight) continue;

    // Apply sinceDate filter if provided
    if (sinceDate) {
      const paper = papers.find((p) => normalizeId(p.id) === arxivId);
      if (paper && paper.date) {
        if (paper.date < sinceDate) continue;
      }
    }

    results.push({
      arxivId,
      weight: data.weight,
      relatedTo: Array.from(data.relatedTo),
    });
  }

  // Sort by weight descending
  results.sort((a, b) => b.weight - a.weight);

  // Apply topK limit per query paper (not total)
  const effectiveTopK = topK * queryPapers.length;
  return results.slice(0, effectiveTopK);
}

/**
 * Normalize an arxiv ID to canonical form.
 */
function normalizeId(id: string | undefined): string | null {
  if (!id) return null;
  // Strip version suffix if present (e.g., 2601.12345v1 -> 2601.12345)
  return id.replace(/v\d+$/, '').toLowerCase();
}

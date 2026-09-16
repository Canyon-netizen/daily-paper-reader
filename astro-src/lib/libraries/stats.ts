// astro-src/lib/libraries/stats.ts
//
// R7 D.2.3: Library statistics.
//
// Compute stats for a library: paperCount, uniqueAuthors, yearRange, topCategories.

import type { Library } from '../libraries';

/** Paper data from library. */
export interface LibraryPaper {
  arxivId: string;
  date?: string;
  authors?: string[];
  categories?: Record<string, string[] | undefined>;
  tags?: string[];
}

/** Library stats result. */
export interface LibraryStats {
  paperCount: number;
  uniqueAuthors: string[];
  yearRange: [number | null, number | null];
  topCategories: { cat: string; count: number }[];
}

/**
 * Compute statistics for a library given its papers.
 *
 * @param library - The library definition
 * @param papers - Papers belonging to this library
 * @returns Stats object
 */
export function computeLibraryStats(
  library: Library,
  papers: LibraryPaper[]
): LibraryStats {
  // Paper count
  const paperCount = papers.length;

  // Unique authors (flatten, take first 3 per paper)
  const authorSet = new Set<string>();
  for (const paper of papers) {
    for (const author of (paper.authors || []).slice(0, 3)) {
      if (author) authorSet.add(author);
    }
  }
  const uniqueAuthors = Array.from(authorSet);

  // Year range from dates
  const years: number[] = [];
  for (const paper of papers) {
    if (paper.date) {
      const year = parseInt(paper.date.slice(0, 4), 10);
      if (!isNaN(year)) years.push(year);
    }
  }
  years.sort((a, b) => a - b);
  const yearRange: [number | null, number | null] =
    years.length > 0 ? [years[0], years[years.length - 1]] : [null, null];

  // Top categories (dim:label format)
  const catCount: Record<string, number> = {};
  for (const paper of papers) {
    const cats = paper.categories || {};
    for (const dim of ['venue', 'task', 'method', 'type'] as const) {
      for (const label of cats[dim] || []) {
        const key = `${dim}:${label}`;
        catCount[key] = (catCount[key] || 0) + 1;
      }
    }
    // Also check tags for legacy format
    for (const tag of paper.tags || []) {
      if (tag.startsWith('query:')) {
        const key = `task:${tag.slice(6)}`;
        catCount[key] = (catCount[key] || 0) + 1;
      }
    }
  }
  const topCategories = Object.entries(catCount)
    .map(([cat, count]) => ({ cat, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    paperCount,
    uniqueAuthors,
    yearRange,
    topCategories,
  };
}

/**
 * Get papers belonging to a library.
 */
export function getLibraryPapers(
  allPapers: LibraryPaper[],
  library: Library
): LibraryPaper[] {
  return allPapers.filter((paper) => {
    const paperTags = getPaperTags(paper);
    return library.tags.some((t) => paperTags.includes(t));
  });
}

function getPaperTags(paper: LibraryPaper): string[] {
  const tags: string[] = [];
  const cats = paper.categories || {};
  for (const dim of ['venue', 'task', 'method', 'type'] as const) {
    for (const label of cats[dim] || []) {
      tags.push(`${dim}:${label}`);
    }
  }
  for (const tag of paper.tags || []) {
    if (tag.startsWith('query:')) {
      tags.push(`task:${tag.slice(6)}`);
    } else {
      tags.push(tag);
    }
  }
  return tags;
}

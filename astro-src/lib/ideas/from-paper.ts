// astro-src/lib/ideas/from-paper.ts
//
// R7 E.1.1: Create idea from paper.
//
// One-click button to convert a paper into an idea draft.

import type { Idea } from './types';

/** Paper metadata for creating an idea. */
export interface PaperMeta {
  arxivId: string;
  title: string;
  tldr?: string;
  abstract?: string;
  authors?: string[];
  date?: string;
}

/** Options for creating idea from paper. */
export interface CreateIdeaFromPaperOpts {
  /** Additional tags to add */
  tags?: string[];
  /** Custom description override */
  description?: string;
  /** Additional related papers */
  additionalRelatedPapers?: string[];
}

/**
 * Create an idea spec from a paper.
 *
 * @param arxivId - The paper's arXiv ID
 * @param paperMeta - Paper metadata (title, tldr/abstract, etc.)
 * @param opts - Additional options
 * @returns Idea spec object (not saved to storage)
 */
export function createIdeaFromPaper(
  arxivId: string,
  paperMeta: PaperMeta,
  opts: CreateIdeaFromPaperOpts = {}
): Omit<Idea, 'id' | 'createdAt' | 'updatedAt' | 'versions' | 'currentVersion'> {
  // Derive title from paper title
  const title = deriveIdeaTitle(paperMeta.title, arxivId);

  // Derive summary from tldr/abstract
  const summary = opts.description ?? deriveIdeaSummary(paperMeta);

  // Build related papers list
  const relatedPapers = [arxivId, ...(opts.additionalRelatedPapers || [])];

  // Build tags
  const tags = [...(opts.tags || [])];

  return {
    title,
    description: summary,
    status: 'draft',
    relatedPapers,
    relatedConcepts: [],
    tags,
  };
}

/**
 * Derive idea title from paper title.
 */
function deriveIdeaTitle(paperTitle: string, arxivId: string): string {
  // Clean up paper title: truncate if too long, make concise
  const cleaned = paperTitle
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= 80) {
    return `Idea: ${cleaned}`;
  }

  // Truncate long titles
  return `Idea: ${cleaned.slice(0, 77)}...`;
}

/**
 * Derive idea description from tldr or abstract.
 */
function deriveIdeaSummary(paperMeta: PaperMeta): string {
  // Prefer tldr (short summary)
  if (paperMeta.tldr) {
    return paperMeta.tldr;
  }

  // Fall back to abstract (truncated)
  if (paperMeta.abstract) {
    const truncated = paperMeta.abstract.slice(0, 500);
    if (paperMeta.abstract.length > 500) {
      return truncated + '...';
    }
    return truncated;
  }

  // Fall back to just the paper info
  let summary = `Paper: ${paperMeta.title}`;
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    summary += `\n\nAuthors: ${paperMeta.authors.slice(0, 3).join(', ')}${paperMeta.authors.length > 3 ? ' et al.' : ''}`;
  }
  if (paperMeta.date) {
    summary += `\nPublished: ${paperMeta.date}`;
  }

  return summary;
}

/**
 * Generate a preview of what the idea would look like.
 */
export function previewIdeaFromPaper(
  arxivId: string,
  paperMeta: PaperMeta,
  opts: CreateIdeaFromPaperOpts = {}
): {
  title: string;
  summaryLength: number;
  relatedPapersCount: number;
  tagsCount: number;
} {
  const spec = createIdeaFromPaper(arxivId, paperMeta, opts);
  return {
    title: spec.title,
    summaryLength: spec.description.length,
    relatedPapersCount: spec.relatedPapers.length,
    tagsCount: spec.tags.length,
  };
}

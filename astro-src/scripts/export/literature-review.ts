// astro-src/scripts/export/literature-review.ts
//
// Export a project draft as a Literature Review: numbered citations + BibTeX.
//
// Input: draft markdown with [cite:xxx] + paper lookup function
// Output: .md with [N] citations + .bib file

import { extractCites, normalizeCiteTargets, slugify } from '../../lib/projects/citation';
import { downloadAsFile } from './trigger-download';

export interface Draft {
  id: string;
  projectId: string;
  title: string;
  markdown: string;
  savedAt: number;
  wordCount: number;
}

export interface PaperLookupResult {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
}

export interface ExportInput {
  projectName: string;
  draftTitle: string;
  draftMarkdown: string;
  paperLookup: (arxivId: string) => PaperLookupResult | null;
}

export interface ExportBundle {
  mdText: string;
  bibText: string;
  filenameBase: string;
}

/**
 * Transform [cite:arxivId] into numbered [N] citations.
 * Returns transformed markdown with References section appended.
 */
function transformToNumberedCitations(markdown: string): {
  transformed: string;
  citationOrder: string[];
} {
  const { tokens } = normalizeCiteTargets(markdown);

  // Build citation order (unique, preserve first-seen)
  const citationOrder: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!seen.has(token.arxivId)) {
      seen.add(token.arxivId);
      citationOrder.push(token.arxivId);
    }
  }

  // Replace each cite with numbered version
  let transformed = markdown;

  // Sort tokens by index descending to replace from end first (preserves positions)
  const sortedTokens = [...tokens].sort((a, b) => b.index - a.index);

  for (const token of sortedTokens) {
    const prev = seen.get(token.arxivId);
    const citationNum = (prev ?? 0) + 1; // 1-based
    const caption = token.caption ? `, ${token.caption}` : '';
    const replacement = `[${citationNum}${caption}]`;

    // Replace only this specific occurrence (by index)
    const before = transformed.slice(0, token.index);
    const after = transformed.slice(token.index + token.fullMatch.length);
    transformed = before + replacement + after;
  }

  return { transformed, citationOrder };
}

/**
 * Build References section markdown.
 */
function buildReferencesSection(citationOrder: string[], paperLookup: (id: string) => PaperLookupResult | null): string {
  if (citationOrder.length === 0) {
    return '';
  }

  const lines: string[] = ['\n\n## References\n'];

  citationOrder.forEach((arxivId, idx) => {
    const paper = paperLookup(arxivId);
    const num = idx + 1;

    if (paper) {
      const authors = paper.authors?.length > 0 ? paper.authors.join(', ') : 'Unknown Author';
      const year = paper.year || 'n.d.';
      const title = paper.title || 'Untitled';
      const venue = paper.venue ? `*${paper.venue}*` : '';

      lines.push(`[${num}] ${authors} (${year}). ${title}. ${venue}`);
    } else {
      lines.push(`[${num}] ${arxivId} (cited in text, metadata unavailable)`);
    }
  });

  return lines.join('\n');
}

/**
 * Generate BibTeX entry for a paper.
 */
function generateBibtexEntry(paper: PaperLookupResult, arxivId: string): string {
  const authors = paper.authors?.length > 0 ? paper.authors.join(' and ') : 'Unknown';
  const year = paper.year || new Date().getFullYear();
  const title = paper.title || 'Untitled';

  // Build cite key: firstauthor_year_firstword
  const firstAuthor = paper.authors?.[0]?.split(' ').pop()?.toLowerCase() || 'unknown';
  const firstWord = title.toLowerCase().split(' ').find(w => w.length > 3) || 'paper';
  const citeKey = `${firstAuthor}_${year}_${firstWord}`.replace(/[^a-z0-9]/g, '');

  const lines: string[] = [
    `@article{${citeKey},`,
    `  author = {${authors}},`,
    `  title = {${title}},`,
    `  year = {${year}},`,
  ];

  if (paper.venue) {
    lines.push(`  journal = {${paper.venue}},`);
  }

  if (paper.doi) {
    lines.push(`  doi = {${paper.doi}},`);
  }

  if (arxivId) {
    lines.push(`  eprint = {${arxivId}},`);
    lines.push(`  archivePrefix = {arXiv},`);
  }

  // Close the entry
  lines.push('}');

  return lines.join('\n');
}

/**
 * Build the complete literature review export bundle.
 */
export function buildLiteratureReview(input: ExportInput): ExportBundle {
  const { projectName, draftTitle, draftMarkdown, paperLookup } = input;

  // Transform citations to numbered format
  const { transformed, citationOrder } = transformToNumberedCitations(draftMarkdown);

  // Build References section
  const referencesSection = buildReferencesSection(citationOrder, paperLookup);

  // Combine: original transformed markdown + references
  const mdText = transformed + referencesSection;

  // Build BibTeX
  const bibEntries: string[] = [];
  for (const arxivId of citationOrder) {
    const paper = paperLookup(arxivId);
    if (paper) {
      bibEntries.push(generateBibtexEntry(paper, arxivId));
    }
  }
  const bibText = bibEntries.join('\n\n');

  // Build filename base: project-slug-draft-slug
  const projectSlug = slugify(projectName);
  const draftSlug = slugify(draftTitle);
  const filenameBase = `${projectSlug}-${draftSlug}`;

  return {
    mdText,
    bibText,
    filenameBase,
  };
}

/**
 * Download the literature review as .md + .bib files (two downloads).
 */
export function downloadLiteratureReview(input: ExportInput): void {
  const bundle = buildLiteratureReview(input);

  // Download markdown
  downloadAsFile(bundle.mdText, `${bundle.filenameBase}.md`, 'text/markdown');

  // Download BibTeX (small delay to ensure first download starts)
  setTimeout(() => {
    downloadAsFile(bundle.bibText, `${bundle.filenameBase}.bib`, 'application/x-bibtex');
  }, 200);
}

/**
 * Download as a combined .zip (future Phase D enhancement).
 * For now, we do two separate downloads as MVP.
 */
export function downloadLiteratureReviewZip(_input: ExportInput): void {
  // TODO: Implement ZIP creation without npm dependencies
  // For MVP, fallback to dual download
  console.warn('[literature-review] ZIP not implemented, falling back to dual download');
}

// astro-src/lib/ideas/similarity.ts
//
// R7 LP.2: Idea ↔ paper similarity scoring.
//
// Compute similarity between an idea and a paper based on shared keywords
// and cited papers overlap.

import type { Idea } from './types';

/** Paper metadata for similarity computation. */
export interface PaperMeta {
  arxivId: string;
  title: string;
  abstract?: string;
  keywords?: string[];
  citedPapers?: string[]; // Array of cited arXiv IDs
}

/** Similarity score result. */
export interface SimilarityResult {
  score: number; // 0-1
  keywordOverlap: number; // 0-1
  citationOverlap: number; // 0-1
  sharedKeywords: string[];
  sharedCitations: string[];
}

/**
 * Compute similarity between an idea and a paper.
 *
 * @param idea - The idea to compare
 * @param paper - The paper to compare
 * @returns Similarity result with score 0-1
 *
 * Algorithm:
 * - Keyword overlap: extract words from title/description/tags vs paper keywords/abstract
 * - Citation overlap: shared citedPapers (if available)
 * - Final score: weighted average (60% keywords, 40% citations)
 */
export function ideaPaperSimilarity(
  idea: Idea,
  paper: PaperMeta
): SimilarityResult {
  // Extract keywords from idea
  const ideaKeywords = extractKeywords(idea);

  // Extract keywords from paper
  const paperKeywords = new Set<string>();
  if (paper.keywords) {
    for (const kw of paper.keywords) {
      paperKeywords.add(kw.toLowerCase());
    }
  }
  // Also extract from title and abstract
  if (paper.title) {
    for (const kw of extractTextKeywords(paper.title)) {
      paperKeywords.add(kw);
    }
  }
  if (paper.abstract) {
    for (const kw of extractTextKeywords(paper.abstract)) {
      paperKeywords.add(kw);
    }
  }

  // Compute keyword overlap
  const sharedKeywords = ideaKeywords.filter((kw) => paperKeywords.has(kw));
  const keywordOverlap = ideaKeywords.length > 0
    ? sharedKeywords.length / Math.sqrt(ideaKeywords.length * Math.max(paperKeywords.size, 1))
    : 0;

  // Compute citation overlap
  let citationOverlap = 0;
  let sharedCitations: string[] = [];

  if (paper.citedPapers && idea.relatedPapers.length > 0) {
    const ideaCitations = new Set(idea.relatedPapers);
    sharedCitations = paper.citedPapers.filter((cid) => ideaCitations.has(cid));

    const totalUnique = new Set([...idea.relatedPapers, ...paper.citedPapers]).size;
    citationOverlap = totalUnique > 0 ? sharedCitations.length / totalUnique : 0;
  }

  // Weighted final score: 60% keywords, 40% citations
  const score = (keywordOverlap * 0.6) + (citationOverlap * 0.4);

  return {
    score: Math.min(1, Math.max(0, score)),
    keywordOverlap: Math.min(1, keywordOverlap),
    citationOverlap: Math.min(1, citationOverlap),
    sharedKeywords,
    sharedCitations,
  };
}

/**
 * Extract keywords from an idea.
 */
function extractKeywords(idea: Idea): string[] {
  const keywords = new Set<string>();

  // From title
  for (const kw of extractTextKeywords(idea.title)) {
    keywords.add(kw);
  }

  // From description
  for (const kw of extractTextKeywords(idea.description)) {
    keywords.add(kw);
  }

  // From tags
  for (const tag of idea.tags) {
    keywords.add(tag.toLowerCase());
  }

  // From related concepts
  for (const concept of idea.relatedConcepts) {
    keywords.add(concept.toLowerCase());
  }

  return Array.from(keywords);
}

/**
 * Extract keywords from free text.
 * Splits on whitespace/punctuation, filters short words, lowercases.
 */
function extractTextKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((word) => word.length >= 3)
    .filter((word) => !STOP_WORDS.has(word));
}

/** Common stop words to filter out. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been',
  'with', 'they', 'this', 'that', 'from', 'will', 'what',
  'when', 'your', 'more', 'about', 'into', 'over', 'after',
]);

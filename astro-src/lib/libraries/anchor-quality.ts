// astro-src/lib/libraries/anchor-quality.ts
//
// R7 D.2.2: Anchor paper quality scoring.
//
// Score an anchor paper based on:
//   - citation count (0..0.4)
//   - recency (0..0.3)
//   - milestone flag (0..0.3)
//
// Returns { score: 0..1, reasons: string[] }

export interface AnchorPaperQuality {
  score: number;
  reasons: string[];
}

/**
 * Known paper data shape (from library papers).
 */
export interface KnownPaper {
  arxivId: string;
  citations?: number;
  date?: string;
  milestone?: boolean;
  categories?: Record<string, string[] | undefined>;
}

/**
 * Score an anchor paper.
 *
 * @param arxivId - The paper's arXiv ID
 * @param knownPapers - Map of known papers (from library)
 * @returns Quality score + reasons
 */
export function scoreAnchorPaper(
  arxivId: string,
  knownPapers: Map<string, KnownPaper>
): AnchorPaperQuality {
  const paper = knownPapers.get(arxivId);
  const reasons: string[] = [];
  let score = 0;

  // Citation score (0..0.4)
  // Scale: 0-10 citations = 0.0-0.2, 10-50 = 0.2-0.3, 50-100 = 0.3-0.35, 100+ = 0.35-0.4
  if (paper?.citations != null) {
    const cit = paper.citations;
    if (cit >= 100) {
      score += 0.4;
      reasons.push('High citations (100+)');
    } else if (cit >= 50) {
      score += 0.35;
      reasons.push('Good citations (50-99)');
    } else if (cit >= 10) {
      score += 0.3 - (cit - 10) * 0.01; // Linear interp 10->50
      reasons.push(`Moderate citations (${cit})`);
    } else {
      score += cit * 0.02; // 0-10: 0-0.2
      reasons.push(`Low citations (${cit})`);
    }
  } else {
    reasons.push('No citation data');
  }

  // Recency score (0..0.3)
  // Within 6 months = 0.3, 6-12 months = 0.2, 1-2 years = 0.1, 2+ years = 0
  if (paper?.date) {
    const pubDate = new Date(paper.date);
    const now = new Date();
    const ageMs = now.getTime() - pubDate.getTime();
    const ageYears = ageMs / (365 * 24 * 60 * 60 * 1000);

    if (ageYears <= 0.5) {
      score += 0.3;
      reasons.push('Recent (<6 months)');
    } else if (ageYears <= 1) {
      score += 0.2;
      reasons.push('Recent (6-12 months)');
    } else if (ageYears <= 2) {
      score += 0.1;
      reasons.push('Moderate age (1-2 years)');
    } else {
      reasons.push('Older paper (>2 years)');
    }
  } else {
    reasons.push('No date data');
  }

  // Milestone flag (0..0.3)
  if (paper?.milestone) {
    score += 0.3;
    reasons.push('Milestone paper');
  } else {
    reasons.push('Not a milestone');
  }

  // Clamp score to 0..1
  score = Math.max(0, Math.min(1, score));

  return { score, reasons };
}

/**
 * Sort papers by anchor quality score (descending).
 */
export function rankAnchorPapers(
  arxivIds: string[],
  knownPapers: Map<string, KnownPaper>
): { arxivId: string; score: number }[] {
  return arxivIds
    .map((id) => ({
      id,
      ...scoreAnchorPaper(id, knownPapers),
    }))
    .sort((a, b) => b.score - a.score);
}

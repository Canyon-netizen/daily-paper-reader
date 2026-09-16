/**
 * astro-src/lib/agents/priority.ts
 *
 * Proposal priority scoring for R7 polish.
 * Combines feedbackScore (0.5), confidence (0.3), evidence size (0.2).
 */

export interface PriorityOptions {
  feedbackWeight?: number;
  confidenceWeight?: number;
  evidenceWeight?: number;
}

export interface Proposal {
  id: string;
  feedbackScore?: number;
  confidence?: number;
  evidenceSize?: number;
  [key: string]: unknown;
}

/**
 * Calculate priority score for a proposal.
 * @param proposal - The proposal to score
 * @param opts - Weight options (must sum to 1)
 * @returns Priority score 0..1
 */
export function scoreProposalPriority(
  proposal: Proposal,
  opts: PriorityOptions = {}
): number {
  const {
    feedbackWeight = 0.5,
    confidenceWeight = 0.3,
    evidenceWeight = 0.2,
  } = opts;

  // Validate weights sum to 1
  const totalWeight = feedbackWeight + confidenceWeight + evidenceWeight;
  if (Math.abs(totalWeight - 1) > 0.001) {
    throw new Error('Weights must sum to 1');
  }

  // Normalize each metric to 0..1
  const feedback = normalizeMetric(proposal.feedbackScore);
  const confidence = normalizeMetric(proposal.confidence);
  const evidence = normalizeMetric(proposal.evidenceSize);

  // Calculate weighted score
  const score =
    feedback * feedbackWeight +
    confidence * confidenceWeight +
    evidence * evidenceWeight;

  return Math.max(0, Math.min(1, score));
}

/**
 * Normalize a metric to 0..1 range.
 * @param value - The metric value (undefined → 0.5)
 * @returns Normalized value
 */
function normalizeMetric(value: number | undefined): number {
  if (value === undefined || value === null) {
    return 0.5; // Default middle value
  }
  return Math.max(0, Math.min(1, value));
}

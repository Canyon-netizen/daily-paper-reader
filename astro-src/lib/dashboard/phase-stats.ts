// astro-src/lib/dashboard/phase-stats.ts
//
// R7 E.4.2: Dashboard phase statistics.
//
// Compute research phase distribution from papers, ideas, experiments, writings.

/** Research phase types. */
export type ResearchPhase =
  | 'literature'
  | 'idea'
  | 'experiment'
  | 'writing'
  | 'review'
  | 'submitted'
  | 'published';

/** Phase stat entry. */
export interface PhaseStat {
  phase: ResearchPhase;
  count: number;
  latestAt: number | null; // timestamp ms
}

/** Input data for computing phase stats. */
export interface PhaseStatsInput {
  papers?: { id: string; date?: string; status?: string }[];
  ideas?: { id: string; status?: string; updatedAt?: number }[];
  experiments?: { id: string; status?: string; updatedAt?: number }[];
  writings?: { id: string; status?: string; updatedAt?: number }[];
}

/**
 * Compute phase statistics from research items.
 *
 * @param input - Papers, ideas, experiments, writings
 * @returns Array of PhaseStat sorted by count desc
 */
export function computePhaseStats(input: PhaseStatsInput): PhaseStat[] {
  const phaseMap: Record<ResearchPhase, { count: number; latestAt: number | null }> = {
    literature: { count: 0, latestAt: null },
    idea: { count: 0, latestAt: null },
    experiment: { count: 0, latestAt: null },
    writing: { count: 0, latestAt: null },
    review: { count: 0, latestAt: null },
    submitted: { count: 0, latestAt: null },
    published: { count: 0, latestAt: null },
  };

  // Count papers
  for (const paper of input.papers || []) {
    const phase = inferPaperPhase(paper);
    phaseMap[phase].count++;
    updateLatest(phaseMap[phase], paper.date ? new Date(paper).getTime() : null);
  }

  // Count ideas
  for (const idea of input.ideas || []) {
    const phase = inferIdeaPhase(idea);
    phaseMap[phase].count++;
    updateLatest(phaseMap[phase], idea.updatedAt || null);
  }

  // Count experiments
  for (const exp of input.experiments || []) {
    const phase = inferExperimentPhase(exp);
    phaseMap[phase].count++;
    updateLatest(phaseMap[phase], exp.updatedAt || null);
  }

  // Count writings
  for (const writing of input.writings || []) {
    const phase = inferWritingPhase(writing);
    phaseMap[phase].count++;
    updateLatest(phaseMap[phase], writing.updatedAt || null);
  }

  // Convert to array and sort by count desc
  const result: PhaseStat[] = Object.entries(phaseMap).map(([phase, data]) => ({
    phase: phase as ResearchPhase,
    count: data.count,
    latestAt: data.latestAt,
  }));

  return result.sort((a, b) => b.count - a.count);
}

/**
 * Infer phase for a paper.
 */
function inferPaperPhase(paper: { date?: string; status?: string }): ResearchPhase {
  if (paper.status === 'published') return 'published';
  if (paper.status === 'submitted') return 'submitted';
  return 'literature';
}

/**
 * Infer phase for an idea.
 */
function inferIdeaPhase(idea: { status?: string }): ResearchPhase {
  switch (idea.status) {
    case 'promoted':
      return 'experiment';
    case 'active':
      return 'idea';
    case 'archived':
      return 'published'; // or review
    default:
      return 'idea';
  }
}

/**
 * Infer phase for an experiment.
 */
function inferExperimentPhase(exp: { status?: string }): ResearchPhase {
  switch (exp.status) {
    case 'completed':
      return 'writing';
    case 'running':
      return 'experiment';
    case 'failed':
      return 'review';
    default:
      return 'experiment';
  }
}

/**
 * Infer phase for a writing.
 */
function inferWritingPhase(writing: { status?: string }): ResearchPhase {
  switch (writing.status) {
    case 'published':
      return 'published';
    case 'submitted':
      return 'submitted';
    case 'review':
    case 'reviewing':
      return 'review';
    case 'draft':
    default:
      return 'writing';
  }
}

/**
 * Update latest timestamp.
 */
function updateLatest(
  stat: { count: number; latestAt: number | null },
  ts: number | null
): void {
  if (ts !== null && (stat.latestAt === null || ts > stat.latestAt)) {
    stat.latestAt = ts;
  }
}

/**
 * Get total items across all phases.
 */
export function getTotalPhaseItems(stats: PhaseStat[]): number {
  return stats.reduce((sum, s) => sum + s.count, 0);
}

/**
 * Get phase with most items.
 */
export function getDominantPhase(stats: PhaseStat[]): ResearchPhase | null {
  if (stats.length === 0) return null;
  return stats[0].count > 0 ? stats[0].phase : null;
}

// astro-src/lib/dashboard/time-to-paper.ts
//
// R7 E.4.3: Dashboard time-to-paper metrics.
//
// Track and compute time from first seen to publication.

import type { ResearchPhase } from './phase-stats';

/** A status transition record. */
export interface StatusTransition {
  phase: ResearchPhase;
  ts: number; // timestamp ms
}

/** Paper timeline for tracking phase progression. */
export interface PaperTimeline {
  arxivId: string;
  firstSeenAt: number; // timestamp ms when paper was first discovered
  statusTransitions: StatusTransition[];
  publishedAt?: number; // timestamp ms when published
}

/** Time-to-paper result for a single paper. */
export interface TimeToPaperResult {
  daysFromFirstSeen: number;
  daysPerPhase: Record<ResearchPhase, number>;
  bottlenecks: ResearchPhase[]; // phases with longest duration
}

/** Aggregate time-to-paper statistics. */
export interface AggregateTimeStats {
  avgDaysFromFirstSeen: number;
  medianDaysFromFirstSeen: number;
  avgDaysPerPhase: Record<ResearchPhase, number>;
  totalPapers: number;
  completedPapers: number;
}

/**
 * Compute time-to-paper metrics for a single timeline.
 *
 * @param timeline - Paper timeline
 * @returns Time-to-paper result
 */
export function computeTimeToPaper(timeline: PaperTimeline): TimeToPaperResult {
  const firstSeen = timeline.firstSeenAt;
  const endTime = timeline.publishedAt ?? Date.now();

  // Calculate days from first seen to end
  const daysFromFirstSeen = Math.round((endTime - firstSeen) / (1000 * 60 * 60 * 24));

  // Calculate days per phase
  const daysPerPhase: Record<ResearchPhase, number> = {
    literature: 0,
    idea: 0,
    experiment: 0,
    writing: 0,
    review: 0,
    submitted: 0,
    published: 0,
  };

  const sorted = [...timeline.statusTransitions].sort((a, b) => a.ts - b.ts);

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const phaseEnd = next ? next.ts : endTime;
    const duration = phaseEnd - current.ts;
    const days = Math.round(duration / (1000 * 60 * 60 * 24));
    daysPerPhase[current.phase] = days;
  }

  // Find bottlenecks (phases with longest duration)
  const phaseDurations = Object.entries(daysPerPhase)
    .filter(([phase]) => phase !== 'published')
    .sort((a, b) => b[1] - a[1]);

  const maxDuration = phaseDurations[0]?.[1] ?? 0;
  const bottlenecks = phaseDurations
    .filter(([, days]) => days >= maxDuration * 0.8) // within 80% of max
    .map(([phase]) => phase as ResearchPhase);

  return {
    daysFromFirstSeen,
    daysPerPhase,
    bottlenecks: bottlenecks.length > 0 ? bottlenecks : [phaseDurations[0]?.[0] as ResearchPhase].filter(Boolean),
  };
}

/**
 * Aggregate time-to-paper metrics across multiple timelines.
 *
 * @param timelines - Array of paper timelines
 * @returns Aggregate statistics
 */
export function aggregateTimeToPaper(timelines: PaperTimeline[]): AggregateTimeStats {
  if (timelines.length === 0) {
    return {
      avgDaysFromFirstSeen: 0,
      medianDaysFromFirstSeen: 0,
      avgDaysPerPhase: {
        literature: 0,
        idea: 0,
        experiment: 0,
        writing: 0,
        review: 0,
        submitted: 0,
        published: 0,
      },
      totalPapers: 0,
      completedPapers: 0,
    };
  }

  const results = timelines.map(computeTimeToPaper);

  // Filter completed (has publishedAt)
  const completed = timelines.filter((t) => t.publishedAt).map((t) => t.arxivId);
  const completedResults = results.filter((_, i) => completed.includes(timelines[i].arxivId));

  // Calculate avg days from first seen
  const daysList = completedResults.map((r) => r.daysFromFirstSeen);
  const avgDaysFromFirstSeen =
    daysList.length > 0 ? daysList.reduce((a, b) => a + b, 0) / daysList.length : 0;

  // Calculate median
  const sortedDays = [...daysList].sort((a, b) => a - b);
  const mid = Math.floor(sortedDays.length / 2);
  const medianDaysFromFirstSeen =
    sortedDays.length % 2 === 0
      ? (sortedDays[mid - 1] + sortedDays[mid]) / 2
      : sortedDays[mid];

  // Calculate avg per phase
  const avgDaysPerPhase: Record<ResearchPhase, number> = {
    literature: 0,
    idea: 0,
    experiment: 0,
    writing: 0,
    review: 0,
    submitted: 0,
    published: 0,
  };

  const phases: ResearchPhase[] = ['literature', 'idea', 'experiment', 'writing', 'review', 'submitted', 'published'];

  for (const phase of phases) {
    const phaseDays = completedResults.map((r) => r.daysPerPhase[phase]);
    if (phaseDays.length > 0) {
      avgDaysPerPhase[phase] = phaseDays.reduce((a, b) => a + b, 0) / phaseDays.length;
    }
  }

  return {
    avgDaysFromFirstSeen: Math.round(avgDaysFromFirstSeen),
    medianDaysFromFirstSeen: Math.round(medianDaysFromFirstSeen),
    avgDaysPerPhase: Object.fromEntries(
      Object.entries(avgDaysPerPhase).map(([k, v]) => [k, Math.round(v)])
    ) as Record<ResearchPhase, number>,
    totalPapers: timelines.length,
    completedPapers: completed.length,
  };
}

/**
 * Add a status transition to a timeline.
 */
export function addStatusTransition(
  timeline: PaperTimeline,
  phase: ResearchPhase,
  ts?: number
): PaperTimeline {
  return {
    ...timeline,
    statusTransitions: [
      ...timeline.statusTransitions,
      { phase, ts: ts ?? Date.now() },
    ],
  };
}

/**
 * Mark a paper as published.
 */
export function markPublished(timeline: PaperTimeline, publishedAt?: number): PaperTimeline {
  return {
    ...timeline,
    publishedAt: publishedAt ?? Date.now(),
  };
}

// astro-src/lib/dashboard/aggregate.ts
//
// R7 LP.7: Dashboard data aggregation helper.
//
// Aggregate data from multiple dashboard modules into unified view.

/** Activity stat entry. */
export interface ActivityStat {
  kind: string;
  count: number;
}

/** Phase distribution entry. */
export interface PhaseDistribution {
  [phase: string]: number;
}

/** Unified dashboard aggregation result. */
export interface DashboardAggregation {
  activity: ActivityStat[];
  phaseDistribution: PhaseDistribution;
  avgDaysToPublish: number;
}

/**
 * Aggregate dashboard data from multiple sources.
 *
 * @param activityFeed - Array of activity events (or counts by kind)
 * @param phaseStats - Phase statistics (phase -> count)
 * @param timeToPaper - Array of days to publish for each paper
 * @returns Unified aggregation result
 */
export function aggregateDashboard(
  activityFeed: { kind: string }[],
  phaseStats: Record<string, number>,
  timeToPaper: number[]
): DashboardAggregation {
  // Aggregate activity by kind
  const activityMap: Record<string, number> = {};
  for (const event of activityFeed) {
    activityMap[event.kind] = (activityMap[event.kind] || 0) + 1;
  }
  const activity: ActivityStat[] = Object.entries(activityMap).map(
    ([kind, count]) => ({ kind, count })
  );

  // Phase distribution (use provided stats)
  const phaseDistribution: PhaseDistribution = { ...phaseStats };

  // Average days to publish
  const avgDaysToPublish =
    timeToPaper.length > 0
      ? timeToPaper.reduce((a, b) => a + b, 0) / timeToPaper.length
      : 0;

  return {
    activity,
    phaseDistribution,
    avgDaysToPublish: Math.round(avgDaysToPublish * 100) / 100,
  };
}

/**
 * Get summary string for dashboard aggregation.
 */
export function formatDashboardSummary(agg: DashboardAggregation): string {
  const parts: string[] = [];

  // Activity summary
  const totalActivity = agg.activity.reduce((sum, a) => sum + a.count, 0);
  parts.push(`${totalActivity} activities`);

  // Phase summary
  const phases = Object.keys(agg.phaseDistribution);
  if (phases.length > 0) {
    parts.push(`${phases.length} phases`);
  }

  // Time to publish
  if (agg.avgDaysToPublish > 0) {
    parts.push(`${agg.avgDaysToPublish.toFixed(1)} days avg`);
  }

  return parts.join(', ');
}

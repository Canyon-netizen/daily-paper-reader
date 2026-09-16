// astro-src/lib/experiments/results.ts
//
// R7 E.2.3: Experiment result tracking.
//
// Track expected vs actual results for experiments.

import type { Experiment } from './types';

/** Experiment result record. */
export interface ExperimentResult {
  id: string;
  experimentId: string;
  metric: string;
  expected: number;
  actual: number;
  unit?: string;
  ts: number;
}

/** Storage for experiment results. */
const RESULTS_KEY = 'dpr_experiment_results_v1';

/** Delta computation result for a metric. */
export interface MetricDelta {
  expected: number;
  actual: number;
  delta: number;
  percentOff: number;
}

/** Delta computation result for all metrics. */
export interface ComputeDeltaResult {
  metric: Record<string, MetricDelta>;
}

/**
 * Generate a unique result ID.
 */
export function genResultId(): string {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Record a result for an experiment.
 *
 * @param experimentId - The experiment ID
 * @param result - The result to record
 * @returns The recorded result with ID
 */
export function recordResult(
  experimentId: string,
  result: Omit<ExperimentResult, 'id' | 'experimentId' | 'ts'>
): ExperimentResult {
  const fullResult: ExperimentResult = {
    id: genResultId(),
    experimentId,
    metric: result.metric,
    expected: result.expected,
    actual: result.actual,
    unit: result.unit,
    ts: Date.now(),
  };

  if (typeof window !== 'undefined') {
    const results = getAllResults();
    results.push(fullResult);
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  }

  return fullResult;
}

/**
 * Get all results for an experiment.
 *
 * @param experimentId - The experiment ID
 * @returns Array of results
 */
export function getResults(experimentId: string): ExperimentResult[] {
  if (typeof window === 'undefined') return [];

  const all = getAllResults();
  return all.filter((r) => r.experimentId === experimentId);
}

/**
 * Get all results from storage.
 */
function getAllResults(): ExperimentResult[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Compute delta between expected and actual for a set of results.
 *
 * @param results - Array of results
 * @returns Delta computation result
 */
export function computeDelta(results: ExperimentResult[]): ComputeDeltaResult {
  const metric: Record<string, MetricDelta> = {};

  for (const r of results) {
    const delta = r.actual - r.expected;
    const percentOff = r.expected !== 0 ? Math.abs(delta / r.expected) : 0;

    metric[r.metric] = {
      expected: r.expected,
      actual: r.actual,
      delta,
      percentOff: Math.round(percentOff * 10000) / 10000, // 4 decimal places
    };
  }

  return { metric };
}

/**
 * Clear all results for an experiment.
 *
 * @param experimentId - The experiment ID
 */
export function clearResults(experimentId: string): void {
  if (typeof window === 'undefined') return;

  const all = getAllResults();
  const filtered = all.filter((r) => r.experimentId !== experimentId);
  localStorage.setItem(RESULTS_KEY, JSON.stringify(filtered));
}

/**
 * Get summary stats for an experiment.
 */
export function getResultSummary(experimentId: string): {
  count: number;
  avgPercentOff: number;
  metrics: string[];
} {
  const results = getResults(experimentId);
  const delta = computeDelta(results);

  const metrics = Object.keys(delta.metric);
  const percentOffs = metrics.map((m) => delta.metric[m].percentOff);
  const avgPercentOff =
    percentOffs.length > 0
      ? percentOffs.reduce((a, b) => a + b, 0) / percentOffs.length
      : 0;

  return {
    count: results.length,
    avgPercentOff: Math.round(avgPercentOff * 10000) / 10000,
    metrics,
  };
}

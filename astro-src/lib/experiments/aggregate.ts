// astro-src/lib/experiments/aggregate.ts
//
// R7 LP.4: Experiment metrics aggregation.
//
// Aggregate numerical results from experiments with statistical functions.

/** Numeric results to aggregate. */
export type NumericResults = number[];

/** Aggregation result. */
export interface AggregationResult {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Aggregate metrics from an array of numbers.
 *
 * @param results - Array of numeric results
 * @returns Aggregation with mean, median, stddev, min, max, count
 *
 * Uses population standard deviation (not sample).
 */
export function aggregateMetrics(results: NumericResults): AggregationResult {
  const count = results.length;

  if (count === 0) {
    return {
      mean: 0,
      median: 0,
      stddev: 0,
      min: 0,
      max: 0,
      count: 0,
    };
  }

  // Sort for median calculation
  const sorted = [...results].sort((a, b) => a - b);

  // Mean
  const sum = results.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  // Median
  let median: number;
  const mid = Math.floor(count / 2);
  if (count % 2 === 0) {
    median = (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    median = sorted[mid];
  }

  // Population standard deviation
  const squaredDiffs = results.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stddev = Math.sqrt(variance);

  // Min/Max
  const min = sorted[0];
  const max = sorted[count - 1];

  return {
    mean: round6(mean),
    median: round6(median),
    stddev: round6(stddev),
    min,
    max,
    count,
  };
}

/**
 * Round to 6 decimal places.
 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Get summary string for aggregation result.
 */
export function formatAggregation(result: AggregationResult): string {
  if (result.count === 0) {
    return 'No data';
  }
  return `n=${result.count}, mean=${result.mean.toFixed(2)}, median=${result.median.toFixed(2)}, stddev=${result.stddev.toFixed(2)}, range=[${result.min}, ${result.max}]`;
}

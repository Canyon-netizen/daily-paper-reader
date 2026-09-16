/**
 * astro-src/lib/agents/batch.ts
 *
 * Batched LLM call helper for R7 polish.
 * Pure helper, no actual LLM calls.
 */

export interface BatchOptions {
  batchSize?: number;
  maxConcurrent?: number;
}

export interface BatchedPrompts {
  batches: string[][];
  metadata: {
    total: number;
    batchCount: number;
    batchSize: number;
  };
}

/**
 * Split prompts into batches of specified size.
 * @param prompts - Array of prompts to batch
 * @param opts - Batch options
 * @returns Batched prompts with metadata
 */
export function batchPrompts(
  prompts: string[],
  opts: BatchOptions = {}
): BatchedPrompts {
  const { batchSize = 10 } = opts;

  if (prompts.length === 0) {
    return {
      batches: [],
      metadata: {
        total: 0,
        batchCount: 0,
        batchSize,
      },
    };
  }

  const batches: string[][] = [];
  for (let i = 0; i < prompts.length; i += batchSize) {
    batches.push(prompts.slice(i, i + batchSize));
  }

  return {
    batches,
    metadata: {
      total: prompts.length,
      batchCount: batches.length,
      batchSize,
    },
  };
}

/**
 * Calculate optimal batch size based on total prompts and concurrency.
 * @param total - Total number of prompts
 * @param maxConcurrent - Maximum concurrent batches
 * @returns Recommended batch size
 */
export function calculateOptimalBatchSize(
  total: number,
  maxConcurrent: number = 5
): number {
  if (total <= 0) return 10;
  return Math.ceil(total / maxConcurrent);
}

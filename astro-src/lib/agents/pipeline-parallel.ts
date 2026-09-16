/**
 * lib/agents/pipeline-parallel.ts — Pipeline parallel stage execution.
 *
 * Runs independent stages concurrently with optional concurrency limiting.
 */

export interface ParallelStage<T> {
  id: string;
  run: () => Promise<T>;
}

export interface ParallelStageOpts {
  /**
   * Maximum concurrent stages. Default: unlimited (run all at once).
   */
  concurrency?: number;
  /**
   * Called on each stage completion (optional).
   */
  onComplete?: (id: string, result: unknown) => void;
  /**
   * Called on stage error (optional).
   */
  onError?: (id: string, error: Error) => void;
}

export interface ParallelResult<T> {
  results: Record<string, T>;
  errors: Record<string, Error>;
  totalDurationMs: number;
}

/**
 * Run multiple stages in parallel with optional concurrency limit.
 *
 * @param stages - Array of stages to run
 * @param opts - Options including concurrency limit
 * @returns Results and errors for each stage
 */
export async function parallelStages<T>(
  stages: Array<ParallelStage<T>>,
  opts: ParallelStageOpts = {},
): Promise<ParallelResult<T>> {
  const results: Record<string, T> = {};
  const errors: Record<string, Error> = {};
  const startTime = Date.now();

  const concurrency = opts.concurrency ?? Infinity;

  if (concurrency === Infinity) {
    // Run all at once
    const promises = stages.map(async (stage) => {
      try {
        const result = await stage.run();
        results[stage.id] = result;
        opts.onComplete?.(stage.id, result);
        return result;
      } catch (err) {
        const error = err as Error;
        errors[stage.id] = error;
        opts.onError?.(stage.id, error);
        throw error;
      }
    });

    await Promise.allSettled(promises);
  } else {
    // Run with concurrency limit using a semaphore pattern
    let index = 0;
    const running: Promise<void>[] = [];

    const runOne = async (): Promise<void> => {
      while (index < stages.length) {
        const currentIndex = index++;
        const stage = stages[currentIndex];

        try {
          const result = await stage.run();
          results[stage.id] = result;
          opts.onComplete?.(stage.id, result);
        } catch (err) {
          const error = err as Error;
          errors[stage.id] = error;
          opts.onError?.(stage.id, error);
        }
      }
    };

    // Start initial batch
    for (let i = 0; i < Math.min(concurrency, stages.length); i++) {
      running.push(runOne());
    }

    await Promise.all(running);
  }

  return {
    results,
    errors,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Run stages in parallel but stop on first error.
 * Returns after first error or all complete.
 */
export async function parallelStagesStrict<T>(
  stages: Array<ParallelStage<T>>,
  opts: ParallelStageOpts = {},
): Promise<ParallelResult<T>> {
  const results: Record<string, T> = {};
  const errors: Record<string, Error> = {};
  const startTime = Date.now();

  const concurrency = opts.concurrency ?? Infinity;
  const limit = Math.min(concurrency, stages.length);

  let index = 0;
  let hasError = false;

  const workers = Array.from({ length: limit }, async () => {
    while (index < stages.length && !hasError) {
      const currentIndex = index++;
      const stage = stages[currentIndex];

      try {
        const result = await stage.run();
        results[stage.id] = result;
        opts.onComplete?.(stage.id, result);
      } catch (err) {
        hasError = true;
        const error = err as Error;
        errors[stage.id] = error;
        opts.onError?.(stage.id, error);
        break;
      }
    }
  });

  await Promise.all(workers);

  return {
    results,
    errors,
    totalDurationMs: Date.now() - startTime,
  };
}

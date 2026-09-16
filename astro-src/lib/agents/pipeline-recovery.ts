/**
 * lib/agents/pipeline-recovery.ts — Pipeline recovery from failed stages.
 *
 * Provides snapshot save/load and recovery functionality for pipeline runs.
 */

export interface PipelineSnapshot {
  ts: number;
  completedStages: string[];
  currentStage: string;
  failedStage?: string;
  error?: string;
  pipelineId: string;
  metadata?: Record<string, unknown>;
}

const STORAGE_KEY = 'dpr_pipeline_snapshot_v1';

/**
 * Get globalThis.localStorage or a mock for Node/testing.
 */
function getStorage(): Storage | { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  if (typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage;
  }
  // Node/test mock
  const store: Record<string, string> = {};
  return {
    getItem(k: string) { return store[k] ?? null; },
    setItem(k: string, v: string) { store[k] = v; },
    removeItem(k: string) { delete store[k]; },
  };
}

/**
 * Save pipeline snapshot to localStorage.
 */
export function saveSnapshot(pipelineId: string, snapshot: PipelineSnapshot): void {
  const storage = getStorage();
  const key = `${STORAGE_KEY}_${pipelineId}`;
  storage.setItem(key, JSON.stringify(snapshot));
}

/**
 * Load pipeline snapshot from localStorage.
 */
export function loadSnapshot(pipelineId: string): PipelineSnapshot | null {
  const storage = getStorage();
  const key = `${STORAGE_KEY}_${pipelineId}`;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PipelineSnapshot;
  } catch {
    return null;
  }
}

/**
 * Delete a snapshot after recovery or pipeline completion.
 */
export function clearSnapshot(pipelineId: string): void {
  const storage = getStorage();
  const key = `${STORAGE_KEY}_${pipelineId}`;
  storage.removeItem(key);
}

/**
 * Recover from a snapshot by resuming from currentStage, skipping completed ones.
 *
 * @param snapshot - The saved pipeline snapshot
 * @param runStage - Function to execute a stage (stageId) => Promise<result>
 * @returns Object with results for each stage executed
 */
export async function recoverFromSnapshot<T>(
  snapshot: PipelineSnapshot,
  runStage: (stageId: string) => Promise<T>,
): Promise<{ results: Record<string, T>; resumedFrom: string; errors: Record<string, Error> }> {
  const results: Record<string, T> = {};
  const errors: Record<string, Error> = {};

  // Determine where to resume
  const completedSet = new Set(snapshot.completedStages);
  const stagesToRun = snapshot.completedStages.length === 0
    ? [snapshot.currentStage]
    : [...snapshot.completedStages, snapshot.currentStage];

  // Re-run completed stages if needed (for idempotency), or skip to currentStage
  // Here we skip completed stages and only run from currentStage onwards
  const resumeIndex = snapshot.completedStages.length;

  for (let i = resumeIndex; i < stagesToRun.length; i++) {
    const stageId = stagesToRun[i];
    try {
      results[stageId] = await runStage(stageId);
    } catch (err) {
      errors[stageId] = err as Error;
      // Stop on first error during recovery
      break;
    }
  }

  return {
    results,
    resumedFrom: snapshot.currentStage,
    errors,
  };
}

/**
 * Create a snapshot object from current pipeline state.
 */
export function createSnapshot(
  pipelineId: string,
  completedStages: string[],
  currentStage: string,
  options?: {
    failedStage?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  },
): PipelineSnapshot {
  return {
    ts: Date.now(),
    completedStages,
    currentStage,
    failedStage: options?.failedStage,
    error: options?.error,
    pipelineId,
    metadata: options?.metadata,
  };
}

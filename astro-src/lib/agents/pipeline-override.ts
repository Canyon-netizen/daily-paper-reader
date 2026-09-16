/**
 * lib/agents/pipeline-override.ts — Pipeline user override system.
 *
 * Allows users to skip, retry, or modify stages during pipeline execution.
 */

export type OverrideAction = 'skip' | 'retry' | 'modify';

export interface Override {
  stageId: string;
  action: OverrideAction;
  /**
   * For 'modify' action: the modified stage config.
   */
  payload?: Record<string, unknown>;
  ts: number;
  reason: string;
}

export interface StageConfig {
  id: string;
  type?: string;
  config?: Record<string, unknown>;
}

const STORAGE_KEY = 'dpr_pipeline_overrides_v1';

/**
 * Get storage (localStorage or mock).
 */
function getStorage(): Storage | { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  if (typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage;
  }
  const store: Record<string, string> = {};
  return {
    getItem(k: string) { return store[k] ?? null; },
    setItem(k: string, v: string) { store[k] = v; },
    removeItem(k: string) { delete store[k]; },
  };
}

/**
 * Record an override for a pipeline.
 */
export function recordOverride(pipelineId: string, override: Override): void {
  const storage = getStorage();
  const key = `${STORAGE_KEY}_${pipelineId}`;
  const existing = storage.getItem(key);
  const overrides: Override[] = existing ? JSON.parse(existing) : [];
  overrides.push(override);
  storage.setItem(key, JSON.stringify(overrides));
}

/**
 * Get all overrides for a pipeline.
 */
export function getOverrides(pipelineId: string): Override[] {
  const storage = getStorage();
  const key = `${STORAGE_KEY}_${pipelineId}`;
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Override[];
  } catch {
    return [];
  }
}

/**
 * Clear all overrides for a pipeline.
 */
export function clearOverrides(pipelineId: string): void {
  const storage = getStorage();
  const key = `${STORAGE_KEY}_${pipelineId}`;
  storage.removeItem(key);
}

/**
 * Apply an override to a stage.
 *
 * @param stage - The stage configuration
 * @param override - The override to apply
 * @returns Modified stage config, or null if action is 'skip'
 */
export function applyOverride(stage: StageConfig, override: Override): StageConfig | null {
  if (override.stageId !== stage.id) {
    // Override doesn't apply to this stage
    return stage;
  }

  switch (override.action) {
    case 'skip':
      return null;

    case 'retry':
      // Retry keeps same stage config but signals to re-run
      return {
        ...stage,
        config: {
          ...stage.config,
          _retry: true,
          _retryTimestamp: override.ts,
        },
      };

    case 'modify':
      if (override.payload) {
        return {
          ...stage,
          ...override.payload,
        };
      }
      return stage;

    default:
      return stage;
  }
}

/**
 * Find the latest override for a specific stage.
 */
export function getStageOverride(pipelineId: string, stageId: string): Override | null {
  const overrides = getOverrides(pipelineId);
  // Find most recent override for this stage
  const filtered = overrides.filter(o => o.stageId === stageId);
  if (filtered.length === 0) return null;
  // Sort by timestamp descending
  filtered.sort((a, b) => b.ts - a.ts);
  return filtered[0];
}

/**
 * Create an override object.
 */
export function createOverride(
  stageId: string,
  action: OverrideAction,
  reason: string,
  payload?: Record<string, unknown>,
): Override {
  return {
    stageId,
    action,
    payload,
    ts: Date.now(),
    reason,
  };
}

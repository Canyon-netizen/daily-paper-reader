/**
 * astro-src/lib/agents/history.ts
 *
 * Agent run history tracking for R7 polish.
 * Storage: localStorage `dpr_agent_runs_v1`.
 */

export interface RunMetadata {
  timestamp?: number;
  duration?: number;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface AgentRun {
  agentName: string;
  timestamp: number;
  metadata: RunMetadata;
}

export interface RunSummary {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  lastRun: number;
  avgDuration?: number;
}

/**
 * Record an agent run.
 * @param agentName - Name of the agent
 * @param metadata - Run metadata
 */
export function recordAgentRun(agentName: string, metadata: RunMetadata = {}): void {
  const storageKey = `dpr_agent_runs_v1`;
  let runs: AgentRun[] = [];

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        runs = JSON.parse(raw);
      }
    } catch {
      // Ignore parse errors
    }
  }

  runs.push({
    agentName,
    timestamp: metadata.timestamp ?? Date.now(),
    metadata,
  });

  // Keep only last 1000 runs per agent
  const agentRuns = runs.filter(r => r.agentName === agentName);
  if (agentRuns.length > 1000) {
    const otherRuns = runs.filter(r => r.agentName !== agentName);
    runs = [...otherRuns, ...agentRuns.slice(-1000)];
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(runs));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get recent runs for an agent.
 * @param agentName - Name of the agent
 * @param limit - Max number of runs to return (default 20)
 * @returns Array of recent runs
 */
export function getRecentRuns(agentName: string, limit: number = 20): AgentRun[] {
  const storageKey = `dpr_agent_runs_v1`;
  let runs: AgentRun[] = [];

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        runs = JSON.parse(raw);
      }
    } catch {
      // Ignore parse errors
    }
  }

  return runs
    .filter(r => r.agentName === agentName)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Summarize runs for an agent.
 * @param agentName - Name of the agent
 * @returns Summary statistics
 */
export function summarizeRuns(agentName: string): RunSummary {
  const runs = getRecentRuns(agentName, 1000);

  if (runs.length === 0) {
    return {
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
      lastRun: 0,
    };
  }

  const successCount = runs.filter(r => r.metadata.success !== false).length;
  const failureCount = runs.filter(r => r.metadata.success === false).length;

  const durations = runs
    .map(r => r.metadata.duration)
    .filter((d): d is number => d !== undefined && d !== null);

  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : undefined;

  return {
    totalRuns: runs.length,
    successCount,
    failureCount,
    lastRun: runs[0]?.timestamp ?? 0,
    avgDuration,
  };
}

/**
 * Clear history for an agent (for testing).
 * @param agentName - Name of the agent
 */
export function clearAgentHistory(agentName: string): void {
  const storageKey = `dpr_agent_runs_v1`;
  let runs: AgentRun[] = [];

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        runs = JSON.parse(raw);
      }
    } catch {
      // Ignore parse errors
    }
  }

  runs = runs.filter(r => r.agentName !== agentName);

  try {
    localStorage.setItem(storageKey, JSON.stringify(runs));
  } catch {
    // Ignore storage errors
  }
}

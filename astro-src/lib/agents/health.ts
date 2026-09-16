/**
 * astro-src/lib/agents/health.ts
 *
 * Agent health check utility for R7 polish.
 * Reads from localStorage `dpr_agent_health_v1`.
 */

export interface HealthCheckOptions {
  maxErrorRate?: number;
  staleMs?: number;
}

export interface AgentHealth {
  available: boolean;
  lastRun: number;
  errorRate: number;
}

/**
 * Check health status of an agent.
 * @param agentName - Name of the agent to check
 * @param opts - Options for health evaluation
 * @returns Health status object
 */
export function checkAgentHealth(
  agentName: string,
  opts: HealthCheckOptions = {}
): AgentHealth {
  const { maxErrorRate = 0.5, staleMs = 24 * 60 * 60 * 1000 } = opts;

  const storageKey = `dpr_agent_health_v1`;
  let healthData: Record<string, AgentHealth> = {};

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        healthData = JSON.parse(raw);
      }
    } catch {
      // Ignore parse errors
    }
  }

  const agentHealth = healthData[agentName] || {
    available: true,
    lastRun: 0,
    errorRate: 0,
  };

  const now = Date.now();
  const isStale = agentHealth.lastRun > 0 && (now - agentHealth.lastRun > staleMs);
  const isErrorRateTooHigh = agentHealth.errorRate > maxErrorRate;

  return {
    available: agentHealth.available && !isStale && !isErrorRateTooHigh,
    lastRun: agentHealth.lastRun,
    errorRate: agentHealth.errorRate,
  };
}

/**
 * Update health data for an agent (for internal use).
 * @param agentName - Name of the agent
 * @param health - Health data to store
 */
export function updateAgentHealth(
  agentName: string,
  health: Partial<AgentHealth>
): void {
  const storageKey = `dpr_agent_health_v1`;
  let healthData: Record<string, AgentHealth> = {};

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        healthData = JSON.parse(raw);
      }
    } catch {
      // Ignore parse errors
    }
  }

  healthData[agentName] = {
    available: healthData[agentName]?.available ?? true,
    lastRun: healthData[agentName]?.lastRun ?? 0,
    errorRate: healthData[agentName]?.errorRate ?? 0,
    ...health,
  };

  try {
    localStorage.setItem(storageKey, JSON.stringify(healthData));
  } catch {
    // Ignore storage errors
  }
}

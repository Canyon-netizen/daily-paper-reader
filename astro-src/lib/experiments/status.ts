// astro-src/lib/experiments/status.ts
//
// R7 E.2.4: Experiment status transitions.
//
// Valid transitions map and transition validation.

import type { Experiment, ExperimentStatus } from './types';
import { EXPERIMENT_STATUS_TRANSITIONS } from './types';

/** Valid status transitions (imported from types). */
export { EXPERIMENT_STATUS_TRANSITIONS };

/**
 * Check if a status transition is valid.
 *
 * @param from - Current status
 * @param to - Target status
 * @returns Object with { valid: boolean, reason?: string }
 */
export function canTransition(
  from: ExperimentStatus,
  to: ExperimentStatus
): { valid: boolean; reason?: string } {
  // No self-transitions
  if (from === to) {
    return { valid: false, reason: 'Self-transition not allowed' };
  }

  // Check if target is in valid transitions
  const validTargets = EXPERIMENT_STATUS_TRANSITIONS[from];
  if (!validTargets) {
    return { valid: false, reason: `Unknown source status: ${from}` };
  }

  if (!validTargets.includes(to)) {
    return {
      valid: false,
      reason: `Cannot transition from ${from} to ${to}. Valid targets: ${validTargets.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Apply a status transition to an experiment.
 *
 * @param experiment - The experiment to transition
 * @param to - Target status
 * @returns Updated experiment or error object
 */
export function applyTransition(
  experiment: Experiment,
  to: ExperimentStatus
): { success: true; experiment: Experiment } | { success: false; error: string } {
  const check = canTransition(experiment.status, to);

  if (!check.valid) {
    return { success: false, error: check.reason };
  }

  const updated: Experiment = {
    ...experiment,
    status: to,
    updatedAt: new Date().toISOString().split('T')[0],
  };

  return { success: true, experiment: updated };
}

/**
 * Get valid next statuses for a given status.
 *
 * @param status - Current status
 * @returns Array of valid next statuses
 */
export function getValidTransitions(status: ExperimentStatus): ExperimentStatus[] {
  return EXPERIMENT_STATUS_TRANSITIONS[status] ?? [];
}

/**
 * Get a human-readable description of a status.
 */
export function getStatusDescription(status: ExperimentStatus): string {
  const descriptions: Record<ExperimentStatus, string> = {
    planning: 'Experiment is being designed',
    running: 'Experiment is currently running',
    paused: 'Experiment is paused',
    completed: 'Experiment completed successfully',
    failed: 'Experiment failed or was abandoned',
    archived: 'Experiment is archived',
  };
  return descriptions[status] ?? 'Unknown';
}

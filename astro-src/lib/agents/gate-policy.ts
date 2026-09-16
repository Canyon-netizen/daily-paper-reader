/**
 * astro-src/lib/agents/gate-policy.ts
 *
 * Gate policy evaluation helper for R7 polish.
 */

export interface GatePolicyRule {
  metric: string;
  threshold: number;
  comparator: '>' | '>=' | '<' | '<=' | '==' | '!=';
}

export interface GatePolicyResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Evaluate a gate policy against scores.
 * @param policy - Array of policy rules
 * @param scores - Object of metric names to values
 * @returns Evaluation result with pass/fail and reasons
 */
export function evaluateGatePolicy(
  policy: GatePolicyRule[],
  scores: Record<string, number>
): GatePolicyResult {
  const reasons: string[] = [];

  for (const rule of policy) {
    const value = scores[rule.metric];

    if (value === undefined) {
      reasons.push(`Missing metric: ${rule.metric}`);
      continue;
    }

    const passed = compareValues(value, rule.threshold, rule.comparator);

    if (!passed) {
      reasons.push(
        `${rule.metric}: ${value} ${rule.comparator} ${rule.threshold} (failed)`
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Compare value against threshold using comparator.
 */
function compareValues(value: number, threshold: number, comparator: string): boolean {
  switch (comparator) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '==':
      return value === threshold;
    case '!=':
      return value !== threshold;
    default:
      return false;
  }
}

/**
 * astro-src/lib/agents/serialize.ts
 *
 * Proposal serialization helpers for R7 polish.
 * Stable JSON round-trip with sorted keys.
 */

export interface Proposal {
  id: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * Serialize a proposal to stable JSON.
 * Keys are sorted alphabetically for consistent output.
 * @param proposal - The proposal to serialize
 * @returns Stable JSON string
 */
export function serializeProposal(proposal: Proposal): string {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(proposal).sort();
  for (const key of keys) {
    sorted[key] = proposal[key];
  }
  return JSON.stringify(sorted, null, 2);
}

/**
 * Deserialize a proposal from JSON.
 * @param json - JSON string to parse
 * @returns Parsed proposal object
 */
export function deserializeProposal(json: string): Proposal {
  return JSON.parse(json);
}

/**
 * Compare two proposals for equality (order-independent).
 * @param a - First proposal
 * @param b - Second proposal
 * @returns True if proposals are equal
 */
export function proposalsEqual(a: Proposal, b: Proposal): boolean {
  const sortedA = JSON.stringify(a, Object.keys(a).sort());
  const sortedB = JSON.stringify(b, Object.keys(b).sort());
  return sortedA === sortedB;
}

// astro-src/lib/llm-budget/summary.ts
//
// Aggregation functions for library LLM budgets.

import { getCurrentMonth, getEntry, getMonthlyBudget } from './store';
import type { LibraryBudgetSummary } from './types';

/**
 * Get summary for a library in a specific month.
 */
export function getSummary(libraryId: string, month?: string): LibraryBudgetSummary | null {
  const m = month ?? getCurrentMonth();
  const entry = getEntry(libraryId, m);
  const monthlyBudget = getMonthlyBudget(libraryId, m);

  if (!entry && !monthlyBudget) return null;

  const promptTokens = entry?.promptTokens ?? 0;
  const completionTokens = entry?.completionTokens ?? 0;
  const usedTokens = promptTokens + completionTokens;
  const remainingTokens = monthlyBudget !== null ? Math.max(0, monthlyBudget - usedTokens) : null;
  const isExhausted = remainingTokens !== null && remainingTokens <= 0;

  return {
    libraryId,
    month: m,
    promptTokens,
    completionTokens,
    monthlyBudget,
    usedTokens,
    remainingTokens,
    isExhausted,
  };
}

/**
 * Get summary for current month.
 */
export function getCurrentSummary(libraryId: string): LibraryBudgetSummary | null {
  return getSummary(libraryId, getCurrentMonth());
}

/**
 * Format token count with thousands separator.
 */
export function formatTokens(n: number): string {
  return n.toLocaleString();
}

/**
 * Format as human-readable string.
 */
export function formatSummary(summary: LibraryBudgetSummary): string {
  const parts: string[] = [
    `已用 ${formatTokens(summary.usedTokens)} tokens`,
  ];
  if (summary.monthlyBudget !== null) {
    parts.push(`预算 ${formatTokens(summary.monthlyBudget)}`);
    if (summary.isExhausted) {
      parts.push('(已用尽)');
    } else {
      parts.push(`剩余 ${formatTokens(summary.remainingTokens!)}`);
    }
  }
  return parts.join(' / ');
}

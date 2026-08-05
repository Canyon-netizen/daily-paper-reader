// astro-src/lib/llm-budget/types.ts
//
// Per-library LLM token usage tracking. Mirrors Polaris library_budget model.

/** Single month's token usage for a library. */
export interface LibraryBudgetEntry {
  /** Library ID (or 'global' for untracked). */
  libraryId: string;
  /** Month in YYYY-MM format. */
  month: string;
  /** Tokens sent in prompts. */
  promptTokens: number;
  /** Tokens received in completions. */
  completionTokens: number;
  /** Last update timestamp (ms since epoch). */
  updatedAt: number;
}

/** Budget summary with optional monthly budget limit. */
export interface LibraryBudgetSummary extends Omit<LibraryBudgetEntry, 'updatedAt'> {
  /** Optional monthly budget (null if not set). */
  monthlyBudget: number | null;
  /** Total tokens used (prompt + completion). */
  usedTokens: number;
  /** Remaining budget (null if no budget set). */
  remainingTokens: number | null;
  /** Whether budget is exhausted. */
  isExhausted: boolean;
}

/** Stored document in localStorage. */
export interface LlmBudgetDoc {
  schemaVersion: number;
  entries: Record<string, LibraryBudgetEntry>; // key: `${libraryId}:${month}`
  budgets: Record<string, number>; // key: `${libraryId}:${month}` -> budget
}

/** Write result from store operations. */
export interface BudgetWriteResult {
  ok: boolean;
  reason?: 'unavailable' | 'quota';
  changed?: boolean;
}

export const LLM_BUDGET_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'dpr:llm-budget:v1';
export const GLOBAL_LIBRARY_ID = 'global';

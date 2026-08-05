// astro-src/lib/llm-budget/store.ts
//
// Single-write commit funnel for LLM token usage tracking.
// Mirrors the pattern from lib/user-libraries/store.ts.

import {
  LLM_BUDGET_SCHEMA_VERSION,
  STORAGE_KEY,
  GLOBAL_LIBRARY_ID,
  type LibraryBudgetEntry,
  type LlmBudgetDoc,
  type BudgetWriteResult,
} from './types';

/** Get current month in YYYY-MM format. */
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Check if localStorage is available. */
function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/** Create an empty doc. */
function emptyDoc(): LlmBudgetDoc {
  return { schemaVersion: LLM_BUDGET_SCHEMA_VERSION, entries: {}, budgets: {} };
}

/** Build storage key for an entry. */
function entryKey(libraryId: string, month: string): string {
  return `${libraryId}:${month}`;
}

/** Load doc from localStorage. */
export function loadBudgetDoc(): LlmBudgetDoc {
  if (!storageAvailable()) return emptyDoc();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return emptyDoc();
  }
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyDoc();
    const doc = parsed as Partial<LlmBudgetDoc>;
    if (doc.schemaVersion !== LLM_BUDGET_SCHEMA_VERSION) return emptyDoc();
    if (!doc.entries || typeof doc.entries !== 'object') return emptyDoc();
    if (!doc.budgets || typeof doc.budgets !== 'object') return emptyDoc();
    return {
      schemaVersion: doc.schemaVersion,
      entries: doc.entries,
      budgets: doc.budgets,
    };
  } catch {
    return emptyDoc();
  }
}

/** Persist doc to localStorage. Only commit() should call this. */
function persist(doc: LlmBudgetDoc): BudgetWriteResult {
  if (!storageAvailable()) return { ok: false, reason: 'unavailable' };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return { ok: true, changed: true };
  } catch {
    return { ok: false, reason: 'quota' };
  }
}

/**
 * Single-write commit funnel.
 * All mutations must go through this function.
 */
function commit(
  libraryId: string,
  month: string,
  mutate: (entry: LibraryBudgetEntry) => LibraryBudgetEntry | false,
): BudgetWriteResult {
  const doc = loadBudgetDoc();
  const key = entryKey(libraryId, month);
  const prev = doc.entries[key];
  const next = mutate(prev ? { ...prev } : {
    libraryId,
    month,
    promptTokens: 0,
    completionTokens: 0,
    updatedAt: 0,
  });

  if (next === false) return { ok: true, changed: false };

  // updatedAt from the funnel
  next.updatedAt = Date.now();

  // Check if unchanged
  if (prev && prev.promptTokens === next.promptTokens && prev.completionTokens === next.completionTokens) {
    return { ok: true, changed: false };
  }

  doc.entries[key] = next;
  return persist(doc);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record token usage for a library (or 'global' if not specified).
 */
export function recordUsage(
  libraryId: string,
  promptTokens: number,
  completionTokens: number,
): BudgetWriteResult {
  const month = getCurrentMonth();
  const lid = libraryId || GLOBAL_LIBRARY_ID;
  return commit(lid, month, (entry) => ({
    ...entry,
    promptTokens: entry.promptTokens + promptTokens,
    completionTokens: entry.completionTokens + completionTokens,
  }));
}

/**
 * Get a specific entry.
 */
export function getEntry(libraryId: string, month: string): LibraryBudgetEntry | undefined {
  const doc = loadBudgetDoc();
  const key = entryKey(libraryId, month);
  return doc.entries[key];
}

/**
 * Get all entries for a library.
 */
export function getAllForLibrary(libraryId: string): LibraryBudgetEntry[] {
  const doc = loadBudgetDoc();
  const out: LibraryBudgetEntry[] = [];
  for (const entry of Object.values(doc.entries)) {
    if (entry.libraryId === libraryId) {
      out.push(entry);
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Get all entries for a month across all libraries.
 */
export function getAllForMonth(month: string): LibraryBudgetEntry[] {
  const doc = loadBudgetDoc();
  const out: LibraryBudgetEntry[] = [];
  for (const entry of Object.values(doc.entries)) {
    if (entry.month === month) {
      out.push(entry);
    }
  }
  return out.sort((a, b) => a.libraryId.localeCompare(b.libraryId));
}

/**
 * Clear usage for a specific library and month.
 */
export function clearMonth(libraryId: string, month: string): BudgetWriteResult {
  const doc = loadBudgetDoc();
  const key = entryKey(libraryId, month);
  if (!doc.entries[key]) return { ok: true, changed: false };
  delete doc.entries[key];
  return persist(doc);
}

/**
 * Set monthly budget for a library.
 */
export function setMonthlyBudget(libraryId: string, month: string, budget: number): BudgetWriteResult {
  const doc = loadBudgetDoc();
  const key = entryKey(libraryId, month);
  doc.budgets[key] = budget;
  return persist(doc);
}

/**
 * Get monthly budget for a library.
 */
export function getMonthlyBudget(libraryId: string, month: string): number | null {
  const doc = loadBudgetDoc();
  const key = entryKey(libraryId, month);
  const budget = doc.budgets[key];
  return typeof budget === 'number' ? budget : null;
}

/**
 * Clear all budgets and entries (for testing).
 */
export function clearAll(): BudgetWriteResult {
  return persist(emptyDoc());
}

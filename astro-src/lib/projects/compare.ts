// astro-src/lib/projects/compare.ts
//
// Session storage for cross-paper compare set.
// Stores 2-4 paper IDs for side-by-side comparison view.
//
// SSR-safe: all functions return null / no-op when no window.

const STORAGE_KEY = 'dpr_compare_set_v1';
const MAX_COMPARE_SIZE = 4;

export interface CompareSet {
  arxivIds: string[];
  createdAt: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

function loadFromStorage(): CompareSet | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CompareSet>;
    if (!parsed || !Array.isArray(parsed.arxivIds) || parsed.arxivIds.length < 2) {
      return null;
    }
    return {
      arxivIds: parsed.arxivIds.filter((id): id is string => typeof id === 'string'),
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function saveToStorage(set: CompareSet | null): void {
  if (!isBrowser()) return;
  try {
    if (set === null) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(set));
    }
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Get current compare set, or null if empty/not in session.
 */
export function getCompareSet(): CompareSet | null {
  return loadFromStorage();
}

/**
 * Add a paper to compare set.
 * Returns the updated set, or null if full (already has MAX_COMPARE_SIZE).
 */
export function addToCompare(arxivId: string): CompareSet | null {
  if (!arxivId) return null;

  const current = loadFromStorage();
  const canonicalId = arxivId.trim();

  if (current) {
    // Already at max
    if (current.arxivIds.length >= MAX_COMPARE_SIZE) {
      return null;
    }
    // Already in set (dedup)
    if (current.arxivIds.includes(canonicalId)) {
      return current;
    }
    const updated: CompareSet = {
      arxivIds: [...current.arxivIds, canonicalId],
      createdAt: current.createdAt,
    };
    saveToStorage(updated);
    notifyChange(updated);
    return updated;
  }

  // Create new set
  const newSet: CompareSet = {
    arxivIds: [canonicalId],
    createdAt: new Date().toISOString(),
  };
  saveToStorage(newSet);
  notifyChange(newSet);
  return newSet;
}

/**
 * Remove a paper from compare set.
 */
export function removeFromCompare(arxivId: string): CompareSet | null {
  if (!arxivId) return getCompareSet();

  const current = loadFromStorage();
  if (!current) return null;

  const canonicalId = arxivId.trim();
  const filtered = current.arxivIds.filter((id) => id !== canonicalId);

  if (filtered.length === 0) {
    saveToStorage(null);
    notifyChange(null);
    return null;
  }

  if (filtered.length === current.arxivIds.length) {
    return current; // Not found
  }

  const updated: CompareSet = {
    arxivIds: filtered,
    createdAt: current.createdAt,
  };
  saveToStorage(updated);
  notifyChange(updated);
  return updated;
}

/**
 * Clear the entire compare set.
 */
export function clearCompareSet(): void {
  saveToStorage(null);
  notifyChange(null);
}

/**
 * Check if a paper is in the compare set.
 */
export function isInCompare(arxivId: string): boolean {
  const current = loadFromStorage();
  if (!current || !arxivId) return false;
  return current.arxivIds.includes(arxivId.trim());
}

/**
 * Subscribe to compare set changes.
 * Returns unsubscribe function.
 */
export function subscribeCompare(handler: (set: CompareSet | null) => void): () => void {
  if (!isBrowser()) {
    return () => {};
  }

  const wrapped = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      const newSet = loadFromStorage();
      handler(newSet);
    }
  };

  window.addEventListener('storage', wrapped);
  return () => {
    window.removeEventListener('storage', wrapped);
  };
}

/**
 * Notify subscribers of changes (for same-window updates).
 */
function notifyChange(set: CompareSet | null): void {
  if (!isBrowser()) return;
  // Dispatch a custom event for same-window listeners
  window.dispatchEvent(new CustomEvent('dpr-compare-change', { detail: set }));
}

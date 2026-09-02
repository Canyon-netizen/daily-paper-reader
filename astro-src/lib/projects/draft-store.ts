// astro-src/lib/projects/draft-store.ts
//
// IDB-backed draft persistence for project writing workspace.
// Supports autosave with 5s debounce and visibility change flush.
//
// SSR-safe: all async functions check for indexedDB availability.

export interface Draft {
  id: string;
  projectId: string;
  title: string;
  markdown: string;
  cursorOffset?: number;
  savedAt: number;
  wordCount: number;
}

export const DRAFT_DB = 'dpr_drafts_v1';
export const DRAFT_STORE = 'drafts';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function isBrowser(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDBImpl(): Promise<IDBDatabase | null> {
  if (!isBrowser()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DRAFT_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
          store.createIndex('byProject', 'projectId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = openDBImpl();
  return dbPromise;
}

function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Save a draft. Creates new if id not present, updates existing otherwise.
 */
export async function saveDraft(d: Draft): Promise<{ ok: boolean; reason?: 'quota' | 'unavailable' }> {
  const db = await openDb();
  if (!db) return { ok: false, reason: 'unavailable' };

  const draft: Draft = {
    ...d,
    id: d.id || generateId(),
    wordCount: countWords(d.markdown),
    savedAt: Date.now(),
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).put(draft);
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => resolve({ ok: false, reason: 'quota' });
    } catch {
      resolve({ ok: false, reason: 'quota' });
    }
  });
}

/**
 * Load a single draft by id.
 */
export async function loadDraft(id: string): Promise<Draft | null> {
  if (!id) return null;
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const req = tx.objectStore(DRAFT_STORE).get(id);
      req.onsuccess = () => resolve((req.result as Draft) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * List all drafts for a project, sorted by savedAt descending.
 */
export async function listDraftsByProject(projectId: string): Promise<Draft[]> {
  if (!projectId) return [];
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const index = tx.objectStore(DRAFT_STORE).index('byProject');
      const req = index.getAll(projectId);
      req.onsuccess = () => {
        const drafts = (req.result || []) as Draft[];
        drafts.sort((a, b) => b.savedAt - a.savedAt);
        resolve(drafts);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Delete a draft by id.
 */
export async function deleteDraft(id: string): Promise<void> {
  if (!id) return;
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Delete all drafts for a project.
 */
export async function purgeProjectDrafts(projectId: string): Promise<void> {
  if (!projectId) return;
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      const index = tx.objectStore(DRAFT_STORE).index('byProject');
      const req = index.openCursor(IDBKeyRange.only(projectId));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Create an autosave handler with debounced writes.
 *
 * @param getDraft - Function that returns draft data without savedAt/wordCount
 * @returns { schedule, flush, cancel }
 */
export function createAutosaveHandler(
  getDraft: () => Omit<Draft, 'savedAt' | 'wordCount'>,
): {
  schedule: () => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 5000;

  return {
    schedule: () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(async () => {
        timer = null;
        const draftData = getDraft();
        if (draftData.projectId && draftData.markdown) {
          await saveDraft(draftData as Draft);
        }
      }, DEBOUNCE_MS);
    },

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const draftData = getDraft();
      if (draftData.projectId && draftData.markdown) {
        await saveDraft(draftData as Draft);
      }
    },

    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Install automatic flush on visibility change (e.g., tab switch, page close).
 * Returns unsubscribe function.
 */
export function installVisibilityFlush(
  flushFn: () => Promise<void>,
): () => void {
  if (!isBrowser()) return () => {};

  const handler = () => {
    flushFn();
  };

  document.addEventListener('visibilitychange', handler);
  window.addEventListener('beforeunload', handler);

  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('beforeunload', handler);
  };
}

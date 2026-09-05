// astro-src/lib/projects/ideas.ts
//
// IDB-backed idea bank persistence for project research workspace.
// Supports CRUD operations with per-project FIFO trimming (max 200 ideas).
//
// SSR-safe: all async functions check for indexedDB availability.

export type IdeaStatus = 'proposed' | 'starred' | 'rejected' | 'promoted';

export interface ProjectIdea {
  id: string;
  projectId: string;
  status: IdeaStatus;
  title: string;
  hypothesis: string;
  method: string;
  expected_outcome: string;
  eval_design: string;
  novelty: number;
  feasibility: number;
  rationale: string;
  anchorArxivId?: string;
  topicSessionId?: string;
  citedArxivIds: string[];
  createdAt: number;
  updatedAt: number;
}

export const IDEAS_DB = 'dpr_project_ideas_v1';
export const IDEAS_STORE = 'ideas';
const MAX_IDEAS_PER_PROJECT = 200;

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
      const req = indexedDB.open(IDEAS_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDEAS_STORE)) {
          const store = db.createObjectStore(IDEAS_STORE, { keyPath: 'id' });
          store.createIndex('byProject', 'projectId', { unique: false });
          store.createIndex('byStatus', 'status', { unique: false });
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
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `idea_${timestamp}_${random}`;
}

function validateNoveltyFeasibility(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Save a new idea or update an existing one.
 * Enforces MAX_IDEAS_PER_PROJECT limit with FIFO trimming.
 */
export async function saveIdea(
  idea: Omit<ProjectIdea, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<{ ok: boolean; reason?: 'quota' | 'unavailable' | 'validation' }> {
  const db = await openDb();
  if (!db) return { ok: false, reason: 'unavailable' };

  const now = Date.now();
  const newIdea: ProjectIdea = {
    ...idea,
    id: idea.id || generateId(),
    createdAt: idea.id ? idea.createdAt : now,
    updatedAt: now,
  };

  if (!validateNoveltyFeasibility(newIdea.novelty) || !validateNoveltyFeasibility(newIdea.feasibility)) {
    return { ok: false, reason: 'validation' };
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readwrite');
      const store = tx.objectStore(IDEAS_STORE);

      // Get current count for this project
      const countReq = store.index('byProject').count(newIdea.projectId);
      countReq.onsuccess = () => {
        const currentCount = countReq.result;

        // If at capacity and this is a new idea, trim oldest proposed ideas
        if (!idea.id && currentCount >= MAX_IDEAS_PER_PROJECT) {
          const trimTx = db.transaction(IDEAS_STORE, 'readwrite');
          const trimStore = trimTx.objectStore(IDEAS_STORE);
          const index = trimStore.index('byProject');
          const getAllReq = index.getAll(newIdea.projectId);

          getAllReq.onsuccess = () => {
            const ideas = (getAllReq.result || []) as ProjectIdea[];
            // Sort by createdAt, oldest first
            ideas.sort((a, b) => a.createdAt - b.createdAt);

            // Find oldest proposed ideas to trim
            let trimmed = 0;
            const toTrim = currentCount - MAX_IDEAS_PER_PROJECT + 1;
            for (const existing of ideas) {
              if (trimmed >= toTrim) break;
              if (existing.status === 'proposed') {
                trimStore.delete(existing.id);
                trimmed++;
              }
            }
          };
        }

        // Put the idea
        store.put(newIdea);
      };

      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => resolve({ ok: false, reason: 'quota' });
    } catch {
      resolve({ ok: false, reason: 'quota' });
    }
  });
}

/**
 * Load a single idea by id.
 */
export async function loadIdea(id: string): Promise<ProjectIdea | null> {
  if (!id) return null;
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readonly');
      const req = tx.objectStore(IDEAS_STORE).get(id);
      req.onsuccess = () => resolve((req.result as ProjectIdea) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * List all ideas for a project, sorted by createdAt descending.
 */
export async function listIdeasByProject(projectId: string): Promise<ProjectIdea[]> {
  if (!projectId) return [];
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readonly');
      const index = tx.objectStore(IDEAS_STORE).index('byProject');
      const req = index.getAll(projectId);
      req.onsuccess = () => {
        const ideas = (req.result || []) as ProjectIdea[];
        ideas.sort((a, b) => b.createdAt - a.createdAt);
        resolve(ideas);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Update the status of an idea.
 */
export async function updateIdeaStatus(
  id: string,
  status: IdeaStatus,
): Promise<{ ok: boolean }> {
  if (!id) return { ok: false };

  const db = await openDb();
  if (!db) return { ok: false };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readwrite');
      const store = tx.objectStore(IDEAS_STORE);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const idea = getReq.result as ProjectIdea;
        if (idea) {
          idea.status = status;
          idea.updatedAt = Date.now();
          store.put(idea);
        }
      };

      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => resolve({ ok: false });
    } catch {
      resolve({ ok: false });
    }
  });
}

/**
 * Delete a single idea by id.
 */
export async function deleteIdea(id: string): Promise<void> {
  if (!id) return;
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readwrite');
      tx.objectStore(IDEAS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Delete all ideas for a project.
 */
export async function purgeProjectIdeas(projectId: string): Promise<void> {
  if (!projectId) return;
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readwrite');
      const index = tx.objectStore(IDEAS_STORE).index('byProject');
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
 * Get count of ideas for a project.
 */
export async function countIdeasByProject(projectId: string): Promise<number> {
  if (!projectId) return 0;
  const db = await openDb();
  if (!db) return 0;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDEAS_STORE, 'readonly');
      const index = tx.objectStore(IDEAS_STORE).index('byProject');
      const req = index.count(projectId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

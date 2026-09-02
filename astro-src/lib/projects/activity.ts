// astro-src/lib/projects/activity.ts
//
// IDB activity audit log for project workspace.
// Tracks stage changes, status changes, notes, stars, and completions.
//
// Data layer for Phase A: project workspace features.
// Uses IndexedDB for audit log (survives refresh, not synced to Gist).

import { canonicalArxivId } from '../arxiv';

export type ActivityKind =
  | 'added-to-stage'
  | 'removed-from-stage'
  | 'status-changed'
  | 'note-added'
  | 'starred'
  | 'completed';

export interface ActivityRow {
  id: string;
  projectId: string;
  arxivId: string;
  kind: ActivityKind;
  prevValue?: string;
  value?: string;
  at: number;
}

export const ACTIVITY_DB = 'dpr_project_activity_v1';
export const ACTIVITY_STORE = 'activity';
const PER_PROJECT_CAP = 5000;

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
      const req = indexedDB.open(ACTIVITY_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ACTIVITY_STORE)) {
          const store = db.createObjectStore(ACTIVITY_STORE, { keyPath: 'id' });
          store.createIndex('byProject', 'projectId', { unique: false });
          store.createIndex('byProjectAt', ['projectId', 'at'], { unique: false });
          store.createIndex('byProjectKind', ['projectId', 'kind'], { unique: false });
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
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Append a new activity row. Trims old rows if exceeding PER_PROJECT_CAP.
 */
export async function appendActivity(row: Omit<ActivityRow, 'id'>): Promise<void> {
  const db = await openDb();
  if (!db) return;

  const canonical = canonicalArxivId(row.arxivId);
  if (!canonical) return;

  const newRow: ActivityRow = {
    ...row,
    id: generateId(),
    arxivId: canonical,
  };

  // Debounced write queue
  writeQueue.push(newRow);
  if (writeTimer === null) {
    writeTimer = setTimeout(flushWrites, DEBOUNCE_MS);
  }
}

const DEBOUNCE_MS = 5000;
let writeQueue: ActivityRow[] = [];
let writeTimer: ReturnType<typeof setTimeout> | null = null;

async function flushWrites(): Promise<void> {
  const db = await openDb();
  if (!db) {
    writeQueue = [];
    writeTimer = null;
    return;
  }

  const rowsToWrite = writeQueue.splice(0);
  if (rowsToWrite.length === 0) {
    writeTimer = null;
    return;
  }

  const byProject = new Map<string, ActivityRow[]>();
  for (const row of rowsToWrite) {
    const existing = byProject.get(row.projectId) || [];
    existing.push(row);
    byProject.set(row.projectId, existing);
  }

  for (const [projectId, rows] of byProject) {
    await writeRowsForProject(db, projectId, rows);
  }

  writeTimer = null;
  if (writeQueue.length > 0) {
    writeTimer = setTimeout(flushWrites, DEBOUNCE_MS);
  }
}

async function writeRowsForProject(
  db: IDBDatabase,
  projectId: string,
  newRows: ActivityRow[],
): Promise<void> {
  const tx = db.transaction(ACTIVITY_STORE, 'readwrite');
  const store = tx.objectStore(ACTIVITY_STORE);
  const index = store.index('byProjectAt');
  const projectIdIndex = store.index('byProject');

  // Get existing count
  const countReq = projectIdIndex.count(IDBKeyRange.only(projectId));
  const existingCount = await new Promise<number>((resolve) => {
    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => resolve(0);
  });

  // Calculate how many to delete (FIFO)
  const totalAfter = existingCount + newRows.length;
  const deleteCount = Math.max(0, totalAfter - PER_PROJECT_CAP);

  // Delete oldest if over cap
  if (deleteCount > 0) {
    const deleteReq = index.openCursor(
      IDBKeyRange.bound([projectId, 0], [projectId, Date.now()]),
    );
    let deleted = 0;
    deleteReq.onsuccess = () => {
      const cursor = deleteReq.result;
      if (cursor && deleted < deleteCount) {
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    };
  }

  // Write new rows
  for (const row of newRows) {
    store.put(row);
  }
}

/**
 * Force flush pending writes (call on page unload).
 */
export async function flushActivityWrites(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  await flushWrites();
}

/**
 * List activities for a project, most recent first.
 */
export async function listByProject(projectId: string, limit = 100): Promise<ActivityRow[]> {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ACTIVITY_STORE, 'readonly');
      const store = tx.objectStore(ACTIVITY_STORE);
      const index = store.index('byProjectAt');
      const range = IDBKeyRange.bound(
        [projectId, 0],
        [projectId, Date.now()],
      );
      const req = index.openCursor(range, 'prev');
      const results: ActivityRow[] = [];

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.primaryKey as unknown as ActivityRow);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * List activities of a specific kind for a project since a timestamp.
 */
export async function listByKind(
  projectId: string,
  kind: ActivityKind,
  sinceMs?: number,
): Promise<ActivityRow[]> {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ACTIVITY_STORE, 'readonly');
      const store = tx.objectStore(ACTIVITY_STORE);
      const index = store.index('byProjectKind');
      const range = IDBKeyRange.bound(
        [projectId, kind],
        [projectId, kind],
      );
      const req = index.getAll(range);
      req.onsuccess = () => {
        let rows = (req.result || []) as ActivityRow[];
        if (sinceMs !== undefined) {
          rows = rows.filter((r) => r.at >= sinceMs);
        }
        rows.sort((a, b) => b.at - a.at);
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Purge all activity for a project.
 */
export async function purgeProject(projectId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ACTIVITY_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITY_STORE);
      const index = store.index('byProject');
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

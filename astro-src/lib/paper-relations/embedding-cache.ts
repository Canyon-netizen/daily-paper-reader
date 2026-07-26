// /lib/paper-relations/embedding-cache.ts — embedding 向量的 IndexedDB 持久化层。
//
// 单一职责:
//   - openIdb + readEmbeddingCache / writeEmbeddingCache / clearEmbeddingCache / embeddingCacheStats
//   - 全部容错:浏览器无 indexedDB / IDB 失败 / 字段类型异常 → 返回空,绝不抛。
//
// 设计要点:
//   - keyPath = `"{arxivId}|{embeddingModel}"` 字符串
//   - 失败语义绝不上抛 — paper-relations 的 UI 主流程容错,不依赖缓存的健壮性
//   - 服务端 SSR 跑到这里时 indexedDB === undefined,直接 short-circuit 返回空

export interface EmbeddingCacheRow {
  key: string;             // "{arxivId}|{embeddingModel}"
  vector: number[];
  at: number;              // Date.now()
}

/** 浏览器内打开 IndexedDB(失败时返回 null — Node SSR 不会跑到这里)。 */
function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open('dpr_paper_relations_v1', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('embeddings')) {
        // keyPath = 字符串 "{arxivId}|{embeddingModel}"
        db.createObjectStore('embeddings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** 读缓存:返回 Map<arxivId, vector>。失败/不可用 → 返回空 Map。 */
export async function readEmbeddingCache(
  arxivIds: string[],
  embeddingModel: string,
): Promise<Map<string, number[]>> {
  const db = await openIdb();
  if (!db) return new Map();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readonly');
      const store = tx.objectStore('embeddings');
      const out = new Map<string, number[]>();
      let pending = arxivIds.length;
      if (pending === 0) {
        db.close();
        resolve(out);
        return;
      }
      let failed = false;
      tx.oncomplete = () => {
        db.close();
        resolve(out);
      };
      tx.onerror = () => {
        failed = true;
        db.close();
        resolve(out);
      };
      for (const id of arxivIds) {
        const key = `${id}|${embeddingModel}`;
        const req = store.get(key);
        req.onsuccess = () => {
          if (failed) return;
          const row = req.result as EmbeddingCacheRow | undefined;
          if (row && Array.isArray(row.vector)) {
            out.set(id, row.vector);
          }
          pending--;
        };
        req.onerror = () => {
          failed = true;
          db.close();
          resolve(out);
        };
      }
    } catch {
      db.close();
      resolve(new Map());
    }
  });
}

/** 写缓存:批量 put,失败静默。 */
export async function writeEmbeddingCache(rows: EmbeddingCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readwrite');
      const store = tx.objectStore('embeddings');
      for (const r of rows) store.put(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
}

/** 清空 embedding 缓存。返回清理的条目数(尽力而为,失败返回 0)。 */
export async function clearEmbeddingCache(): Promise<number> {
  const db = await openIdb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readwrite');
      const store = tx.objectStore('embeddings');
      const countReq = store.count();
      let cleared = 0;
      countReq.onsuccess = () => { cleared = countReq.result || 0; };
      store.clear();
      tx.oncomplete = () => { db.close(); resolve(cleared); };
      tx.onerror = () => { db.close(); resolve(0); };
    } catch {
      db.close();
      resolve(0);
    }
  });
}

/** 缓存统计(供 settings 页展示)。失败返回 0。 */
export async function embeddingCacheStats(): Promise<{ count: number; oldestAt: number; newestAt: number }> {
  const empty = { count: 0, oldestAt: 0, newestAt: 0 };
  const db = await openIdb();
  if (!db) return empty;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readonly');
      const store = tx.objectStore('embeddings');
      const countReq = store.count();
      const out = { ...empty };
      countReq.onsuccess = () => { out.count = countReq.result || 0; };
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (cur) {
          const row = cur.value as EmbeddingCacheRow;
          if (typeof row.at === 'number') {
            if (!out.oldestAt || row.at < out.oldestAt) out.oldestAt = row.at;
            if (row.at > out.newestAt) out.newestAt = row.at;
          }
          cur.continue();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => { db.close(); resolve(out); };
    } catch {
      db.close();
      resolve(empty);
    }
  });
}
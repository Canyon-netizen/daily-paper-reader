// astro-src/lib/user-library/highlights.ts
//
// 全文高亮(Stage 12)—— 极简 v1 持久化层。
//
// 决策(plan §Stage 12):
//   - 不进 localStorage:一段 0.6-1.5 KB,610 篇 ×10 条 ≈ 6 MB,爆配额;
//   - 同源 dpr-fulltext 已在用 IDB,创建一个新 store 共享 db;
//   - 一条 = { id, text, note?, createdAt } —— **plan 决定砍掉 page/color**;
//     站点没有 PDF 阅读器可渲染,等真有 reader 时和渲染代码同 commit 加。
//   - 锚定靠 selected_text 文本匹配(Polaris 同思路),不做坐标。
//   - 不进 Gist:体积不可控 + 无冲突语义,设置页明示"高亮仅本机"。

import { canonicalArxivId } from '../arxiv';

const DB_NAME = 'dpr-user-library';
const STORE = 'highlights';
const VERSION = 1;

export interface Highlight {
  id: string;             // uuid
  canonicalId: string;    // 论文 canonical
  /** 选中的文本片段(用于锚定:页面 reload 后重新查找出现位置)。 */
  text: string;
  /** 用户给这条高亮写的注释。空 = 没有注释。 */
  note?: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function isBrowser(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (!isBrowser()) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // canonicalId → highlight[];我们也存 id 字段做单条定位/删除
          db.createObjectStore(STORE, { keyPath: 'id' });
          const cIdx = req.result.transaction.objectStore(STORE).createIndex('byCanonical', 'canonicalId');
          void cIdx;
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function id(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function addHighlight(
  rawId: string,
  text: string,
  note?: string,
): Promise<Highlight | null> {
  const canonicalId = canonicalArxivId(rawId);
  if (!canonicalId || !text.trim()) return null;
  const db = await openDB();
  if (!db) return null;
  const h: Highlight = {
    id: id(),
    canonicalId,
    text: text.trim(),
    note: note?.trim() || undefined,
    createdAt: Date.now(),
  };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(h);
      tx.oncomplete = () => resolve(h);
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteHighlight(highlightId: string): Promise<boolean> {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(highlightId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function listHighlights(rawId: string): Promise<Highlight[]> {
  const canonicalId = canonicalArxivId(rawId);
  if (!canonicalId) return [];
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('byCanonical');
      const req = idx.getAll(canonicalId);
      req.onsuccess = () => {
        const list = (req.result || []) as Highlight[];
        list.sort((a, b) => a.createdAt - b.createdAt);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** 全文文本中找一条高亮的所有命中位置(0-based 字符索引)。 */
export function locateHighlight(text: string, h: Highlight): number[] {
  const out: number[] = [];
  if (!h.text) return out;
  let i = 0;
  while (i <= text.length - h.text.length) {
    const idx = text.indexOf(h.text, i);
    if (idx < 0) break;
    out.push(idx);
    i = idx + h.text.length;
  }
  return out;
}
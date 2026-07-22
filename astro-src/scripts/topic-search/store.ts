// topic-search localStorage 会话存储 —— 从 topic-search.ts 抽出（模块化重构 step 4）。
//
// 唯一负责会话的读写 + 字节上限裁剪 + debounce 持久化。persistSession 是**唯一**的
// debounce 包装实例（各调用方共享同一个引用，不要各自再 debounce 一次）。
// 不持有 current（那是 orchestrator 的模块状态），所有函数按参数接收 TopicSession。

import { debounce } from '../../lib/dom-utils';
import type { SessionStore, TopicSession } from '../../lib/schemas';

export const SESSION_KEY = 'dpr_topic_session_v1';
export const SCHEMA_VERSION = 1;
// 总 sessions 字节上限(留 ~1MB 给别的 key)
export const TOTAL_BYTES_LIMIT = 4 * 1024 * 1024;
// 单会话字节上限
export const PER_SESSION_BYTES_LIMIT = 800 * 1024;
// 追问历史单篇上限(避免撑爆 context)。也被 render/chat 层用来裁剪。
export const MAX_QA_PER_PAPER = 50;
// 报告追问历史上限(报告对话相对单篇短,设小一些)。也被 render/chat 层用。
export const MAX_QA_FOR_REPORT = 20;

export function emptyStore(): SessionStore {
  return { version: SCHEMA_VERSION, currentId: null, sessions: {} };
}

export function loadStore(): SessionStore {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as SessionStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return emptyStore();
    // 版本迁移占位:目前只有 v1
    return { version: SCHEMA_VERSION, currentId: parsed.currentId ?? null, sessions: parsed.sessions ?? {} };
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: SessionStore): void {
  // 估算大小,超限就裁剪
  let payload = JSON.stringify(store);
  if (payload.length > TOTAL_BYTES_LIMIT) {
    // 按 updatedAt 升序裁掉旧 session,直到达标
    const ids = Object.values(store.sessions).sort((a, b) => a.updatedAt - b.updatedAt).map((s) => s.id);
    for (const id of ids) {
      if (payload.length <= TOTAL_BYTES_LIMIT * 0.9) break;
      // 不删当前 session
      if (id === store.currentId) continue;
      delete store.sessions[id];
      payload = JSON.stringify(store);
    }
  }
  try {
    localStorage.setItem(SESSION_KEY, payload);
  } catch (e) {
    // 配额满 — 极端兜底,清空
    console.warn('[topic] localStorage 写入失败,清空旧 sessions:', (e as Error).message);
    try {
      const keep = store.currentId ? store.sessions[store.currentId] : null;
      const fresh = emptyStore();
      if (keep) {
        fresh.currentId = keep.id;
        fresh.sessions[keep.id] = trimSessionToLimit(keep);
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
    } catch {
      /* ignore */
    }
  }
}

export function trimSessionToLimit(s: TopicSession): TopicSession {
  // 单会话超限 → 截断每个 paper 的 qa
  let copy: TopicSession = JSON.parse(JSON.stringify(s));
  for (const k of Object.keys(copy.chats)) {
    if (copy.chats[k].length > MAX_QA_PER_PAPER) {
      copy.chats[k] = copy.chats[k].slice(-MAX_QA_PER_PAPER);
    }
  }
  if (copy.reportChats && copy.reportChats.length > MAX_QA_FOR_REPORT) {
    copy.reportChats = copy.reportChats.slice(-MAX_QA_FOR_REPORT);
  }
  let ser = JSON.stringify(copy);
  if (ser.length <= PER_SESSION_BYTES_LIMIT) return copy;
  // 还不够 → 继续截断最早 qa
  for (let i = 0; i < 3 && ser.length > PER_SESSION_BYTES_LIMIT; i++) {
    for (const k of Object.keys(copy.chats)) {
      if (copy.chats[k].length > 8) {
        copy.chats[k] = copy.chats[k].slice(-Math.max(4, Math.floor(copy.chats[k].length / 2)));
      }
    }
    ser = JSON.stringify(copy);
  }
  return copy;
}

export const persistSession = debounce((s: TopicSession) => {
  s.updatedAt = Date.now();
  const store = loadStore();
  store.sessions[s.id] = trimSessionToLimit(s);
  store.currentId = s.id;
  saveStore(store);
}, 300);

export function deleteSession(s: TopicSession): void {
  const store = loadStore();
  delete store.sessions[s.id];
  if (store.currentId === s.id) store.currentId = null;
  saveStore(store);
}

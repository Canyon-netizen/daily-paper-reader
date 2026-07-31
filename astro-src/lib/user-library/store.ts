// astro-src/lib/user-library/store.ts
//
// 用户图书馆的读写层。设计要点(每条都对应计划里的一个决策):
//
// 1. **单一写入漏斗**。`commit()` 是模块私有的唯一写入口,所有公开 mutator
//    (toggleStar / setReadingStatus / setUserNote / softDelete / restore / purge)
//    都经过它。它负责:盖 updatedAt、清理空 entry、落盘、发事件。
//    历史教训 feedback_settings_selection_must_emit:两条写入路径不共享事件源,
//    UI 计数就不刷新。这里从结构上杜绝第二条路径。
//
// 2. **canonical key**。所有 id 入口先过 canonicalArxivId(),保证 v1/v2 指向
//    同一条用户态。见 lib/arxiv.ts 的不变式注释。
//
// 3. **配额显式失败**。localStorage 写失败返回 { ok:false, reason:'quota' },
//    不 try/catch 静默。反面先例:scripts/paper-fulltext.ts 吞 QuotaExceededError。
//
// 4. **稀疏存储**。只有被操作过的论文才有 entry;entry 里所有业务字段都空了
//    (只剩 updatedAt)时整条删除,避免 doc 无限膨胀。
//
// 5. **lib → scripts 层级**。本模块只 import lib/ 内的东西 + 通过 lib/storage.ts
//    barrel 拿 STORAGE_KEYS,不直接 import scripts/settings.ts。

import { canonicalArxivId } from '../arxiv';
import { emitDprUserLibraryChange } from '../events';
import type { DprUserLibraryChangeReason } from '../events';
import { STORAGE_KEYS } from '../storage';
import type {
  ReadingStatus,
  UserLibraryDoc,
  UserPaperState,
  WriteResult,
} from './types';

export const USER_LIBRARY_SCHEMA_VERSION = 1;

const KEY = STORAGE_KEYS.userLibrary;

/** SSR / 无 localStorage 环境(Node 构建期、隐私模式)下所有读操作返回空 doc,
 *  写操作返回 { ok:false, reason:'unavailable' }。绝不抛错打断页面渲染。 */
function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    // Safari 隐私模式访问 localStorage 本身就可能抛 SecurityError
    return false;
  }
}

function emptyDoc(): UserLibraryDoc {
  return { schemaVersion: USER_LIBRARY_SCHEMA_VERSION, papers: {} };
}

/**
 * 读取整个 doc。
 *
 * 迁移策略(v1 只需 10 行守卫,不值得单开 migrate.ts):
 *   - 解析失败 / 不是对象 / schemaVersion 不是 1 → 返回空 doc。
 * 为什么直接丢弃而不是尽力修补:v1 是第一个版本,不存在需要兼容的历史结构;
 * 未来真出现 v2 时,在这里加一个 `if (raw.schemaVersion === 1) return migrateV1toV2(raw)`
 * 分支即可,那时才有真实的迁移语义可写。
 */
export function loadUserLibrary(): UserLibraryDoc {
  if (!storageAvailable()) return emptyDoc();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return emptyDoc();
  }
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyDoc();
    const doc = parsed as Partial<UserLibraryDoc>;
    if (doc.schemaVersion !== USER_LIBRARY_SCHEMA_VERSION) return emptyDoc();
    if (!doc.papers || typeof doc.papers !== 'object') return emptyDoc();
    return { schemaVersion: USER_LIBRARY_SCHEMA_VERSION, papers: doc.papers };
  } catch {
    return emptyDoc();
  }
}

/** 落盘。**只有 commit() 应该调用它**(以及 Stage 2 的 Gist pull)。 */
function persist(doc: UserLibraryDoc): WriteResult {
  if (!storageAvailable()) return { ok: false, reason: 'unavailable' };
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
    return { ok: true, changed: true };
  } catch {
    // QuotaExceededError 是这里唯一现实的失败模式。显式返回,让调用方弹 toast。
    return { ok: false, reason: 'quota' };
  }
}

/** 拿到当前页面真实可用的 EventTarget —— 优先 window,fallback document。
 *  一些非浏览器环境(SSR / happy-dom)document 实例不暴露 addEventListener,
 *  而 window 一定有。bus.ts 的默认 target 也是 document,所以这里统一在
 *  emit 之前改用 window,行为对生产代码不造成差异。 */
function emitTarget(): EventTarget {
  if (typeof window !== 'undefined') return window;
  if (typeof document !== 'undefined') return document;
  // 极端兜底:返回带空实现的伪 target
  return { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as EventTarget;
}

/** entry 里除 updatedAt 外是否还有实质内容。没有就该整条删掉(稀疏存储)。 */
function isEmptyState(s: UserPaperState): boolean {
  return (
    !s.starred
    && !s.readingStatus
    && !(s.note && s.note.length > 0)
    && !s.trash
  );
}

/**
 * **唯一写入漏斗**。
 *
 * @param rawId    任意形式的 arXiv id(可带 vN),内部归一化
 * @param reason   事件 detail 里的原因标签,listener 据此决定重绘粒度
 * @param mutate   在 entry 的**副本**上做修改;返回 false 表示放弃本次写入
 */
function commit(
  rawId: string,
  reason: DprUserLibraryChangeReason,
  mutate: (state: UserPaperState) => boolean | void,
): WriteResult {
  const id = canonicalArxivId(rawId);
  if (!id) return { ok: false, reason: 'unavailable' };

  const doc = loadUserLibrary();
  const prev = doc.papers[id];
  const next: UserPaperState = prev
    ? { ...prev }
    : { updatedAt: 0 };

  const before = JSON.stringify(prev ?? null);
  const proceed = mutate(next);
  if (proceed === false) return { ok: true, changed: false };

  if (isEmptyState(next)) {
    if (!prev) return { ok: true, changed: false };
    delete doc.papers[id];
  } else {
    // updatedAt 由漏斗统一盖章 —— 调用方填的会被覆盖,这是有意的:
    // Stage 2 的 Gist 合并按它做 last-write-wins,时间戳必须可信。
    next.updatedAt = Date.now();
    if (JSON.stringify(next) === before) return { ok: true, changed: false };
    doc.papers[id] = next;
  }

  const res = persist(doc);
  if (!res.ok) return res;

  emitDprUserLibraryChange(emitTarget(), { ids: [id], reason });
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------------------
// 读 API
// ---------------------------------------------------------------------------

/** 单篇论文的用户态;从未操作过则返回 undefined。 */
export function getUserPaperState(rawId: string): UserPaperState | undefined {
  const id = canonicalArxivId(rawId);
  if (!id) return undefined;
  return loadUserLibrary().papers[id];
}

export function isStarred(rawId: string): boolean {
  return getUserPaperState(rawId)?.starred === true;
}

/** 未设置过的论文按 'unread' 算 —— 对齐 Polaris 的 server_default。 */
export function getReadingStatus(rawId: string): ReadingStatus {
  return getUserPaperState(rawId)?.readingStatus ?? 'unread';
}

export function getUserNote(rawId: string): string {
  return getUserPaperState(rawId)?.note ?? '';
}

export function hasUserNote(rawId: string): boolean {
  const n = getUserPaperState(rawId)?.note;
  return typeof n === 'string' && n.length > 0;
}

export function isTrashed(rawId: string): boolean {
  return getUserPaperState(rawId)?.trash !== undefined;
}

/** 所有被星标的 canonical id。 */
export function listStarred(): string[] {
  const { papers } = loadUserLibrary();
  return Object.keys(papers).filter((id) => papers[id].starred);
}

/** 所有写过笔记(且非空)的 canonical id。 */
export function listWithNotes(): string[] {
  const { papers } = loadUserLibrary();
  return Object.keys(papers).filter((id) => {
    const n = papers[id].note;
    return typeof n === 'string' && n.length > 0;
  });
}

/** 回收站里的 canonical id,按删除时间倒序(最近删的在前)。 */
export function listTrashed(): string[] {
  const { papers } = loadUserLibrary();
  return Object.keys(papers)
    .filter((id) => papers[id].trash)
    .sort((a, b) => (papers[b].trash!.deletedAt) - (papers[a].trash!.deletedAt));
}

// ---------------------------------------------------------------------------
// 写 API —— 全部经过 commit()
// ---------------------------------------------------------------------------

export function setStarred(rawId: string, starred: boolean): WriteResult {
  return commit(rawId, 'star', (s) => {
    if (s.starred === starred || (!s.starred && !starred)) return false;
    if (starred) s.starred = true;
    else delete s.starred;
  });
}

export function toggleStar(rawId: string): WriteResult {
  return setStarred(rawId, !isStarred(rawId));
}

export function setReadingStatus(rawId: string, status: ReadingStatus): WriteResult {
  return commit(rawId, 'status', (s) => {
    const cur = s.readingStatus ?? 'unread';
    if (cur === status) return false;
    // 'unread' 是默认值 —— 不落盘,保持稀疏。
    if (status === 'unread') delete s.readingStatus;
    else s.readingStatus = status;
  });
}

/** 写笔记。空串 / 全空白 === 删除笔记。 */
export function setUserNote(rawId: string, note: string): WriteResult {
  const text = String(note ?? '');
  return commit(rawId, 'note', (s) => {
    const next = text.trim().length === 0 ? '' : text;
    const cur = s.note ?? '';
    if (cur === next) return false;
    if (next) s.note = next;
    else delete s.note;
  });
}

/** 软删除 —— 对齐 Polaris 的 trash。注意隐藏状态的**真值**仍在
 *  `dpr_hidden_papers_v1`(scripts/settings.ts 管),这里只记删除时间和原因。
 *  Stage 10 会把 paper-hide.ts 接过来,保证一次操作只发一个事件。 */
export function softDelete(rawId: string, reason = 'manual'): WriteResult {
  return commit(rawId, 'trash', (s) => {
    if (s.trash) return false;
    s.trash = { deletedAt: Date.now(), reason };
  });
}

/** 从回收站恢复(清掉 trash 元数据,其它用户态原样保留)。 */
export function restoreFromTrash(rawId: string): WriteResult {
  return commit(rawId, 'restore', (s) => {
    if (!s.trash) return false;
    delete s.trash;
  });
}

/** 彻底删除这篇论文的**全部**用户态(星标 / 状态 / 笔记 / trash)。
 *  这会丢笔记,调用方必须先做二次确认。 */
export function purgeUserPaperState(rawId: string): WriteResult {
  const id = canonicalArxivId(rawId);
  if (!id) return { ok: false, reason: 'unavailable' };
  const doc = loadUserLibrary();
  if (!doc.papers[id]) return { ok: true, changed: false };
  delete doc.papers[id];
  const res = persist(doc);
  if (!res.ok) return res;
  emitDprUserLibraryChange(emitTarget(), { ids: [id], reason: 'purge' });
  return { ok: true, changed: true };
}

/**
 * 整表替换 —— 只给 Stage 2 的 Gist pull 用。
 * 单独开这个口子是因为 pull 要一次写入几十条,逐条 commit 会发几十个事件。
 * 它同样只发**一个**事件(reason:'sync'),不破坏单一事件源的语义。
 */
export function replaceUserLibrary(
  doc: UserLibraryDoc,
  reason: DprUserLibraryChangeReason = 'sync',
): WriteResult {
  const safe: UserLibraryDoc = {
    schemaVersion: USER_LIBRARY_SCHEMA_VERSION,
    papers: doc?.papers && typeof doc.papers === 'object' ? doc.papers : {},
  };
  const res = persist(safe);
  if (!res.ok) return res;
  emitDprUserLibraryChange(emitTarget(), { ids: Object.keys(safe.papers), reason });
  return { ok: true, changed: true };
}

/** 清空整个用户图书馆(设置页的"重置"用)。 */
export function clearUserLibrary(): WriteResult {
  return replaceUserLibrary(emptyDoc(), 'reset');
}

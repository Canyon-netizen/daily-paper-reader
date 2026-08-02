// astro-src/lib/user-libraries/store.ts
//
// 用户文献库的读写层。**完全镜像** lib/user-library/store.ts 的设计:
//
// 1. **单一写入漏斗**。`commit()` 是模块私有的唯一写入口,所有公开 mutator
//    (createLibrary / renameLibrary / updateStatement / deleteLibrary /
//     addPaper / removePaper / setHue)都经过它。它负责:盖 updatedAt、
//    清理空 entry、落盘、发事件。
//    历史教训 feedback_settings_selection_must_emit:两条写入路径不共享事件源,
//    UI 计数就不刷新。这里从结构上杜绝第二条路径。
//
// 2. **canonical key**(对 paperIds[] 里的每个 arxivId)。所有 id 入口
//    先过 canonicalArxivId(),保证 v1/v2 指向同一条成员关系。
//    见 lib/arxiv.ts 的不变式注释。
//
// 3. **配额显式失败**。localStorage 写失败返回 { ok:false, reason:'quota' },
//    不 try/catch 静默。反面先例:scripts/paper-fulltext.ts 吞 QuotaExceededError。
//
// 4. **稀疏存储**。library 删除时整条 entry 一起删;name/statement/paperIds
//    都为空时也算空 entry,自动清理,避免 doc 无限膨胀。
//
// 5. **lib → scripts 层级**。本模块只 import lib/ 内的东西 + 通过 lib/storage.ts
//    barrel 拿 STORAGE_KEYS,不直接 import scripts/settings.ts。

import { canonicalArxivId } from '../arxiv';
import { emitDprUserLibrariesChange } from '../events';
import type { DprUserLibrariesChangeReason } from '../events';
import { STORAGE_KEYS } from '../storage';
import type {
  LibraryHue,
  LibraryRubricItem,
  UserLibrary,
  UserLibrariesDoc,
  WriteResult,
} from './types';

export const USER_LIBRARIES_SCHEMA_VERSION = 1;

const KEY = STORAGE_KEYS.userLibraries;

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

function emptyDoc(): UserLibrariesDoc {
  return { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, libraries: {} };
}

function genId(): string {
  // 无后端,用浏览器原生 crypto.randomUUID()。fallback 用 Date.now + 随机数,
  // 覆盖 happy-dom / 旧 Safari / Node SSR(<18) 这类没 crypto 的环境。
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
export function loadUserLibraries(): UserLibrariesDoc {
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
    const doc = parsed as Partial<UserLibrariesDoc>;
    if (doc.schemaVersion !== USER_LIBRARIES_SCHEMA_VERSION) return emptyDoc();
    if (!doc.libraries || typeof doc.libraries !== 'object') return emptyDoc();
    // 兜底:每条 library 至少要有 id / name / statement / paperIds / timestamps
    const libs: Record<string, UserLibrary> = {};
    for (const [id, raw] of Object.entries(doc.libraries as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const l = raw as Partial<UserLibrary>;
      if (typeof l.id !== 'string' || typeof l.name !== 'string' || typeof l.statement !== 'string') continue;
      if (!Array.isArray(l.paperIds)) continue;
      libs[id] = {
        id: l.id,
        name: l.name,
        statement: l.statement,
        hue: (l.hue as LibraryHue) || 'emerald',
        paperIds: l.paperIds.filter((x): x is string => typeof x === 'string'),
        categories: sanitizeCategories(l.categories),
        inclusionKeywords: sanitizeKeywords(l.inclusionKeywords),
        exclusionKeywords: sanitizeKeywords(l.exclusionKeywords),
        rubric: sanitizeRubric(l.rubric),
        createdAt: typeof l.createdAt === 'number' ? l.createdAt : 0,
        updatedAt: typeof l.updatedAt === 'number' ? l.updatedAt : 0,
      };
    }
    return { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, libraries: libs };
  } catch {
    return emptyDoc();
  }
}

/** 落盘。**只有 commit() 应该调用它**(以及 gist.ts 的 sync pull)。 */
function persist(doc: UserLibrariesDoc): WriteResult {
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

/** entry 里除 updatedAt/createdAt/paperIds 外是否还有实质内容(name + statement 必填,
 *  只要 name 与 statement 同时为空就视为空)。 */
function isEmptyLibrary(l: UserLibrary): boolean {
  const hasName = typeof l.name === 'string' && l.name.trim().length > 0;
  const hasStatement = typeof l.statement === 'string' && l.statement.trim().length > 0;
  const hasPapers = Array.isArray(l.paperIds) && l.paperIds.length > 0;
  return !hasName && !hasStatement && !hasPapers;
}

/** 名字 / statement 长度校验。Polaris 强调 statement 必填;本仓库额外要求
 *  name + statement 都非空(避免「没起名」的空壳卡)。 */
function isValidName(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 32;
}
function isValidStatement(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 200;
}

/** 单个关键词的清洗:trim、长度限制、去大小写化(用 lowercase 留作大小写不敏感比对)。
 *  过长截断 32 字,空白折叠到单空格。空串直接丢弃。 */
function sanitizeKeyword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  if (!v) return null;
  return v.slice(0, 32);
}

/** 关键词列表:逐项清洗 + 去重(大小写不敏感) + 保序。空数组允许。 */
function sanitizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const v = sanitizeKeyword(raw);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** 学科分类 chip:清洗 + dedupe(大小写敏感,arXiv 大小写有含义 cs.cl 不对)。
 *  每个限制 1-16 字。空数组允许。 */
function sanitizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().replace(/\s+/g, '');
    if (!v) continue;
    if (v.length > 16) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 打分维度:只留 {name: 1-32 字非空} 的项,空数组允许。 */
function sanitizeRubric(input: unknown): LibraryRubricItem[] {
  if (!Array.isArray(input)) return [];
  const out: LibraryRubricItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const name = sanitizeKeyword((raw as { name?: unknown }).name);
    if (!name) continue;
    out.push({ name });
  }
  return out;
}

/** entry 上可选字段的统一清洗。任何一个键未传 / 不是数组 / 都不是「必填」字段
 *  —— Polaris 这几个字段都是「没填就跳过筛选」的语义,所以漏斗必须容忍空。 */
function sanitizeOptionalLists(entry: UserLibrary, patch: Partial<{
  categories: unknown;
  inclusionKeywords: unknown;
  exclusionKeywords: unknown;
  rubric: unknown;
}>): void {
  if ('categories' in patch) entry.categories = sanitizeCategories(patch.categories);
  if ('inclusionKeywords' in patch) entry.inclusionKeywords = sanitizeKeywords(patch.inclusionKeywords);
  if ('exclusionKeywords' in patch) entry.exclusionKeywords = sanitizeKeywords(patch.exclusionKeywords);
  if ('rubric' in patch) entry.rubric = sanitizeRubric(patch.rubric);
}

/**
 * **唯一写入漏斗**。
 *
 * @param id      library.id(由 genId() 产生,或者已有 id 走更新)
 * @param reason  事件 detail 里的原因标签,listener 据此决定重绘粒度
 * @param mutate  在 entry 的**副本**上做修改;返回 false 表示放弃本次写入
 */
function commit(
  id: string,
  reason: DprUserLibrariesChangeReason,
  mutate: (entry: UserLibrary, helpers: {
    setOptionalLists: (patch: Partial<{
      categories: unknown;
      inclusionKeywords: unknown;
      exclusionKeywords: unknown;
      rubric: unknown;
    }>) => void;
  }) => boolean | void,
): WriteResult {
  const doc = loadUserLibraries();
  const prev = doc.libraries[id];
  const next: UserLibrary = prev
    ? { ...prev, paperIds: prev.paperIds.slice() }
    : {
        id,
        name: '',
        statement: '',
        hue: 'emerald',
        paperIds: [],
        categories: [],
        inclusionKeywords: [],
        exclusionKeywords: [],
        rubric: [],
        createdAt: 0,
        updatedAt: 0,
      };

  const before = JSON.stringify(prev ?? null);
  const proceed = mutate(next, {
    setOptionalLists: (patch) => sanitizeOptionalLists(next, patch),
  });
  if (proceed === false) return { ok: true, changed: false };

  // 校验必填字段。name / statement 任何一项空了都拒写。
  if (!isValidName(next.name) || !isValidStatement(next.statement)) {
    return { ok: false, reason: 'invalid' };
  }

  if (isEmptyLibrary(next)) {
    if (!prev) return { ok: true, changed: false };
    delete doc.libraries[id];
  } else {
    // updatedAt 由漏斗统一盖章 —— 调用方填的会被覆盖,这是有意的:
    // Gist 合并按它做 last-write-wins,时间戳必须可信。
    const now = Date.now();
    if (!prev) next.createdAt = now;
    next.updatedAt = now;
    if (JSON.stringify(next) === before) return { ok: true, changed: false };
    doc.libraries[id] = next;
  }

  const res = persist(doc);
  if (!res.ok) return res;

  emitDprUserLibrariesChange(emitTarget(), { ids: [id], reason });
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------------------
// 读 API
// ---------------------------------------------------------------------------

/** 单个 library 的元数据;不存在则返回 undefined。 */
export function getUserLibrary(id: string): UserLibrary | undefined {
  if (!id) return undefined;
  return loadUserLibraries().libraries[id];
}

/** 全部 library,按 updatedAt 倒序(最近改的在前)。 */
export function listUserLibraries(): UserLibrary[] {
  const { libraries } = loadUserLibraries();
  return Object.values(libraries).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** 单个 library 包含的论文(已 canonical 化的 id 集合)。 */
export function listUserLibraryPaperIds(id: string): string[] {
  const lib = getUserLibrary(id);
  if (!lib) return [];
  return lib.paperIds.slice();
}

/** 给定论文 id,返回它所在的全部 library id。 */
export function listLibrariesContainingPaper(canonicalId: string): string[] {
  const cid = canonicalArxivId(canonicalId);
  if (!cid) return [];
  const { libraries } = loadUserLibraries();
  const out: string[] = [];
  for (const [id, lib] of Object.entries(libraries)) {
    if (lib.paperIds.includes(cid)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 写 API —— 全部经过 commit()
// ---------------------------------------------------------------------------

/** 新建文献库。返回新建的 id(失败时 id 为空串)。
 *
 *  categories / inclusionKeywords / exclusionKeywords / rubric 全是可选,
 *  都允许 undefined —— 漏斗不会强制要求。
 *  Polaris 的必填只有 name + statement;其余都是「没填 = 不过滤 / 不打分」的语义。 */
export function createLibrary(input: {
  name: string;
  statement: string;
  hue?: LibraryHue;
  paperIds?: string[];
  categories?: string[];
  inclusionKeywords?: string[];
  exclusionKeywords?: string[];
  rubric?: LibraryRubricItem[];
}): WriteResult & { id?: string } {
  const id = genId();
  const result = commit(id, 'create', (entry, { setOptionalLists }) => {
    entry.name = input.name.trim();
    entry.statement = input.statement.trim();
    entry.hue = input.hue || 'emerald';
    if (Array.isArray(input.paperIds)) {
      const seen = new Set<string>();
      entry.paperIds = [];
      for (const raw of input.paperIds) {
        const cid = canonicalArxivId(raw);
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        entry.paperIds.push(cid);
      }
    }
    setOptionalLists({
      categories: input.categories,
      inclusionKeywords: input.inclusionKeywords,
      exclusionKeywords: input.exclusionKeywords,
      rubric: input.rubric,
    });
  });
  if (result.ok) return { ...result, id };
  return result;
}

/** 重命名(name + statement 都允许改;允许单独改 name 不改 statement,
 *  反之亦然 —— 但漏斗会校验两者都非空)。
 *  其余 categories / keywords / rubric 也允许通过 patch 传入(部分更新)。 */
export function renameLibrary(
  id: string,
  patch: {
    name?: string;
    statement?: string;
    hue?: LibraryHue;
    categories?: string[];
    inclusionKeywords?: string[];
    exclusionKeywords?: string[];
    rubric?: LibraryRubricItem[];
  },
): WriteResult {
  return commit(id, patch.statement !== undefined ? 'statement' : patch.hue !== undefined ? 'hue' : 'rename', (entry, { setOptionalLists }) => {
    if (patch.name !== undefined) entry.name = patch.name.trim();
    if (patch.statement !== undefined) entry.statement = patch.statement.trim();
    if (patch.hue !== undefined) entry.hue = patch.hue;
    // 注意:只有字段在 patch 里出现(undefined 排除),才 setOptionalLists 同步覆盖。
    // 这样重命名时不会把已有的 keywords / rubric 误清空。
    const hasOptional =
      'categories' in patch ||
      'inclusionKeywords' in patch ||
      'exclusionKeywords' in patch ||
      'rubric' in patch;
    if (hasOptional) {
      setOptionalLists({
        categories: patch.categories,
        inclusionKeywords: patch.inclusionKeywords,
        exclusionKeywords: patch.exclusionKeywords,
        rubric: patch.rubric,
      });
    }
  });
}

/** 整库删除。 */
export function deleteLibrary(id: string): WriteResult {
  const doc = loadUserLibraries();
  if (!doc.libraries[id]) return { ok: true, changed: false };
  delete doc.libraries[id];
  const res = persist(doc);
  if (!res.ok) return res;
  emitDprUserLibrariesChange(emitTarget(), { ids: [id], reason: 'delete' });
  return { ok: true, changed: true };
}

/** 加论文。重复加直接 noop(去重,保序)。 */
export function addPaperToLibrary(libraryId: string, arxivId: string): WriteResult {
  const cid = canonicalArxivId(arxivId);
  if (!cid) return { ok: false, reason: 'invalid' };
  return commit(libraryId, 'addPaper', (entry) => {
    if (entry.paperIds.includes(cid)) return false;
    entry.paperIds.push(cid);
  });
}

/** 移除论文。 */
export function removePaperFromLibrary(libraryId: string, arxivId: string): WriteResult {
  const cid = canonicalArxivId(arxivId);
  if (!cid) return { ok: false, reason: 'invalid' };
  return commit(libraryId, 'removePaper', (entry) => {
    const idx = entry.paperIds.indexOf(cid);
    if (idx < 0) return false;
    entry.paperIds.splice(idx, 1);
  });
}

/** 改 hue。 */
export function setLibraryHue(libraryId: string, hue: LibraryHue): WriteResult {
  return commit(libraryId, 'hue', (entry) => {
    if (entry.hue === hue) return false;
    entry.hue = hue;
  });
}

/**
 * 整表替换 —— 只给 gist.ts 的 sync pull 用。
 * 单独开这个口子是因为 pull 要一次写入几十条,逐条 commit 会发几十个事件。
 * 它同样只发**一个**事件(reason:'sync'),不破坏单一事件源的语义。
 */
export function replaceUserLibraries(
  doc: UserLibrariesDoc,
  reason: DprUserLibrariesChangeReason = 'sync',
): WriteResult {
  const safe: UserLibrariesDoc = {
    schemaVersion: USER_LIBRARIES_SCHEMA_VERSION,
    libraries: doc?.libraries && typeof doc.libraries === 'object' ? doc.libraries : {},
  };
  const res = persist(safe);
  if (!res.ok) return res;
  emitDprUserLibrariesChange(emitTarget(), { ids: Object.keys(safe.libraries), reason });
  return { ok: true, changed: true };
}

/** 清空所有用户文献库(设置页的「重置」用)。 */
export function clearUserLibraries(): WriteResult {
  return replaceUserLibraries(emptyDoc(), 'reset');
}

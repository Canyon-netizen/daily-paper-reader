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
  LibraryAnchor,
  LibraryDefinition,
  LibraryHue,
  LibraryPaperMeta,
  LibraryPaperStatus,
  LibraryRubricItem,
  UserLibrary,
  UserLibrariesDoc,
  WriteResult,
} from './types';
import { defaultLibraryDefinition } from './types';

export const USER_LIBRARIES_SCHEMA_VERSION = 3;

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
 * 迁移策略:
 *   - v1 (无 definition):升级到 v2,把顶层字段拷进 definition 兜底。**不丢用户数据**。
 *   - schemaVersion 不匹配 / 解析失败 → 返回空 doc(老 v0 是裸结构,无任何兼容价值)。
 * 未来真出现 v3 时,在这里加一个 `if (doc.schemaVersion === 2) return migrateV2toV3(raw)`。
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
      const l = raw as Partial<UserLibrary> & { definition?: unknown };
      if (typeof l.id !== 'string' || typeof l.name !== 'string' || typeof l.statement !== 'string') continue;
      if (!Array.isArray(l.paperIds)) continue;
      const definition = sanitizeDefinition(l.definition, {
        statement: l.statement,
        categories: l.categories ?? [],
        inclusionKeywords: l.inclusionKeywords ?? [],
        exclusionKeywords: l.exclusionKeywords ?? [],
        rubric: l.rubric ?? [],
      });
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
        definition,
        visibility: l.visibility === 'personal' || l.visibility === 'pending' || l.visibility === 'public'
          ? l.visibility
          : 'personal',
        papers: sanitizePaperMetas(l.papers),
      };
    }
    return { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, libraries: libs };
  } catch {
    return emptyDoc();
  }
}

/** 兜底 definition —— 老 v1 doc 没有时,从顶层字段拷贝成默认。 */
function sanitizeDefinition(
  raw: unknown,
  fallback: {
    statement: string;
    categories: string[];
    inclusionKeywords: string[];
    exclusionKeywords: string[];
    rubric: LibraryRubricItem[];
  },
): LibraryDefinition {
  if (!raw || typeof raw !== 'object') return defaultLibraryDefinition(fallback.statement);
  const d = raw as Record<string, unknown>;
  const rawKw = (d.keywords && typeof d.keywords === 'object' ? d.keywords : {}) as {
    arxivCategories?: unknown;
    include?: unknown;
    exclude?: unknown;
  };
  return {
    statement: typeof d.statement === 'string' ? d.statement.slice(0, 500) : fallback.statement,
    cadence: d.cadence === 'daily' || d.cadence === 'weekly' || d.cadence === 'monthly' ? d.cadence : 'manual',
    anchors: sanitizeAnchors(d.anchors),
    keywords: {
      arxivCategories: sanitizeCategories(rawKw.arxivCategories ?? fallback.categories),
      include: sanitizeKeywords(rawKw.include ?? fallback.inclusionKeywords),
      exclude: sanitizeKeywords(rawKw.exclude ?? fallback.exclusionKeywords),
    },
    rubric: sanitizeRubric(d.rubric ?? fallback.rubric),
    goals: sanitizeSentences(d.goals, 3, 200),
    inScope: sanitizeSentences(d.inScope, 8, 80),
    outOfScope: sanitizeSentences(d.outOfScope, 8, 80),
    questions: sanitizeSentences(d.questions, 8, 200),
  };
}

/** 锚点列表清洗:kind 必须是 arxiv/doi/free;value 1-200 字;note 1-100 字。 */
function sanitizeAnchors(input: unknown): LibraryAnchor[] {
  if (!Array.isArray(input)) return [];
  const out: LibraryAnchor[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Partial<LibraryAnchor>;
    const kind = a.kind === 'arxiv' || a.kind === 'doi' || a.kind === 'free' ? a.kind : 'free';
    const value = typeof a.value === 'string' ? a.value.trim().slice(0, 200) : '';
    if (!value) continue;
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind,
      value,
      ...(typeof a.note === 'string' && a.note.trim() ? { note: a.note.trim().slice(0, 100) } : {}),
    });
  }
  return out;
}

/** 句子列表:每项 trim + 长度限制,空串丢弃。maxItems 兜底,避免恶意大数组。 */
function sanitizeSentences(input: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().replace(/\s+/g, ' ');
    if (!v) continue;
    out.push(v.slice(0, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 清洗 papers:Record<cx, LibraryPaperMeta>。Polaris library_papers 表镜像。 */
function sanitizePaperMetas(input: unknown): Record<string, LibraryPaperMeta> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, LibraryPaperMeta> = {};
  for (const [cx, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Partial<LibraryPaperMeta>;
    const status: LibraryPaperStatus =
      m.status === 'candidate' || m.status === 'scored' || m.status === 'included' ||
      m.status === 'excluded' || m.status === 'trashed'
        ? m.status : 'included';
    const entry: LibraryPaperMeta = {
      status,
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : 0,
    };
    if (typeof m.relevanceScore === 'number') {
      entry.relevanceScore = Math.max(0, Math.min(1, m.relevanceScore));
    }
    if (typeof m.relevanceReason === 'string' && m.relevanceReason.trim()) {
      entry.relevanceReason = m.relevanceReason.trim().slice(0, 200);
    }
    if (typeof m.tldrNote === 'string' && m.tldrNote.trim()) {
      entry.tldrNote = m.tldrNote.trim().slice(0, 500);
    }
    if (typeof m.trashReason === 'string' && m.trashReason.trim()) {
      entry.trashReason = m.trashReason.trim().slice(0, 80);
    }
    out[cx] = entry;
  }
  return out;
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
    ? { ...prev, paperIds: prev.paperIds.slice(), papers: { ...(prev.papers || {}) } }
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
        papers: {},
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
 *  Polaris 的必填只有 name + statement;其余都是「没填 = 不过滤 / 不打分」的语义。
 *
 *  v2 起:也接受可选 `definition`(完整 LibraryDefinition)和 `visibility`
 *  (personal / pending / public)。definition 不传时用 defaultLibraryDefinition。 */
export function createLibrary(input: {
  name: string;
  statement: string;
  hue?: LibraryHue;
  paperIds?: string[];
  categories?: string[];
  inclusionKeywords?: string[];
  exclusionKeywords?: string[];
  rubric?: LibraryRubricItem[];
  definition?: Partial<LibraryDefinition>;
  visibility?: 'personal' | 'pending' | 'public';
  papers?: Record<string, LibraryPaperMeta>;
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
    entry.definition = sanitizeDefinition(input.definition, {
      statement: entry.statement,
      categories: entry.categories,
      inclusionKeywords: entry.inclusionKeywords,
      exclusionKeywords: entry.exclusionKeywords,
      rubric: entry.rubric,
    });
    entry.visibility = input.visibility || 'personal';
    entry.papers = sanitizePaperMetas(input.papers);
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
 * 整表替换 definition。
 *
 * Polaris P8a:definition 是 JSONB 大字段,可以独立更新(不触发 statement / keywords
 * 改时的事件)。本仓库保留同样的「独立性」——definition 改完发 `'definition'` 事件,
 * 列表卡片不受影响,工作台 Govern tab 重渲染。
 */
export function updateLibraryDefinition(
  libraryId: string,
  patch: Partial<LibraryDefinition>,
): WriteResult {
  return commit(libraryId, 'definition', (entry) => {
    const cur = entry.definition || defaultLibraryDefinition(entry.statement);
    const next: LibraryDefinition = {
      ...cur,
      ...patch,
      keywords: patch.keywords ? { ...cur.keywords, ...patch.keywords } : cur.keywords,
      anchors: patch.anchors ?? cur.anchors,
      rubric: patch.rubric ?? cur.rubric,
      goals: patch.goals ?? cur.goals,
      inScope: patch.inScope ?? cur.inScope,
      outOfScope: patch.outOfScope ?? cur.outOfScope,
      questions: patch.questions ?? cur.questions,
    };
    entry.definition = next;
  });
}

/**
 * 切 visibility(personal / pending / public)。
 *
 * Polaris 是「申请-审批」状态机;DPR 单人静态站没有 admin,但保留字段语义:
 *   - personal → pending:用户点了「申请公开」,Gist 同步时让其它设备看到请求中。
 *   - pending → public / personal:用户自己取消 / 手动标 public(等于分享 Gist)。
 *
 * 浏览器**没有网络身份**,真正的公共审批是 Gist 跨设备同步时人工对齐,
 * 这里只是给本地 UI 一个状态信号。
 */
export function setLibraryVisibility(
  libraryId: string,
  visibility: 'personal' | 'pending' | 'public',
): WriteResult {
  return commit(libraryId, 'visibility', (entry) => {
    if (entry.visibility === visibility) return false;
    entry.visibility = visibility;
  });
}

/** 加锚点。重复 (kind, value) 直接 noop。 */
export function addLibraryAnchor(libraryId: string, anchor: LibraryAnchor): WriteResult {
  return commit(libraryId, 'anchor-add', (entry) => {
    const def = entry.definition || defaultLibraryDefinition(entry.statement);
    const exists = def.anchors.some((a) => a.kind === anchor.kind && a.value.toLowerCase() === anchor.value.toLowerCase());
    if (exists) return false;
    entry.definition = { ...def, anchors: [...def.anchors, anchor] };
  });
}

/** 删锚点(按 value)。 */
export function removeLibraryAnchor(libraryId: string, value: string): WriteResult {
  return commit(libraryId, 'anchor-remove', (entry) => {
    const def = entry.definition;
    if (!def) return false;
    const next = def.anchors.filter((a) => a.value !== value);
    if (next.length === def.anchors.length) return false;
    entry.definition = { ...def, anchors: next };
  });
}

/**
 * 设置单篇论文在某库内的元数据(status / relevance / reason / tldrNote)。
 * 对照 Polaris `library_papers` 单行写入(API: PATCH /libraries/{lid}/papers/{pid})。
 *
 * 调用场景:
 *  - LLM 批量打分后:scorePaperMeta(lib, cx, { relevanceScore, relevanceReason, status:'scored' })
 *  - 用户写本库 TL;DR:setLibraryPaperTldr(lib, cx, '本文在 agent 维度看...')
 *  - 用户手动排除:setLibraryPaperStatus(lib, cx, 'excluded', 'duplicate')
 *  - 候选论文刚被 ingest 拉进来:setLibraryPaperStatus(lib, cx, 'candidate')
 *
 * 不会**自动**把 paper 加进 paperIds[] —— paperIds 是 membership,本函数只
 * 设置元数据;caller 决定是否同时 addPaperToLibrary()(Polaris 后端也是分两张表)。
 */
export function setLibraryPaperMeta(
  libraryId: string,
  arxivId: string,
  patch: Partial<Omit<LibraryPaperMeta, 'updatedAt'>>,
): WriteResult {
  const cid = canonicalArxivId(arxivId);
  if (!cid) return { ok: false, reason: 'invalid' };
  return commit(libraryId, 'paper-meta', (entry) => {
    const cur = entry.papers[cid] || { status: 'included' as LibraryPaperStatus, updatedAt: 0 };
    const next: LibraryPaperMeta = { ...cur, ...patch };
    if (
      cur.status === next.status &&
      cur.relevanceScore === next.relevanceScore &&
      cur.relevanceReason === next.relevanceReason &&
      cur.tldrNote === next.tldrNote &&
      cur.trashReason === next.trashReason
    ) return false;
    entry.papers = { ...entry.papers, [cid]: next };
  });
}

/** 批量打分(LLM batch 跑完一次,把所有结果一次性 commit)。 */
export function batchSetLibraryPaperMeta(
  libraryId: string,
  items: Array<{ arxivId: string; meta: Partial<Omit<LibraryPaperMeta, 'updatedAt'>> }>,
): WriteResult {
  const doc = loadUserLibraries();
  const lib = doc.libraries[libraryId];
  if (!lib) return { ok: false, reason: 'unavailable' };
  const now = Date.now();
  const papers = { ...lib.papers };
  let changed = 0;
  for (const it of items) {
    const cid = canonicalArxivId(it.arxivId);
    if (!cid) continue;
    const cur = papers[cid] || { status: 'scored' as LibraryPaperStatus, updatedAt: 0 };
    papers[cid] = { ...cur, ...it.meta, updatedAt: now };
    changed++;
  }
  if (changed === 0) return { ok: true, changed: false };
  const next: UserLibrary = { ...lib, papers, updatedAt: now };
  doc.libraries[libraryId] = next;
  const res = persist(doc);
  if (!res.ok) return res;
  emitDprUserLibrariesChange(emitTarget(), { ids: [libraryId], reason: 'paper-meta' });
  return { ok: true, changed: true };
}

/** 移除某篇论文在本库内的元数据(被 paperIds 移走时调,免留垃圾)。 */
export function removeLibraryPaperMeta(libraryId: string, arxivId: string): WriteResult {
  const cid = canonicalArxivId(arxivId);
  if (!cid) return { ok: false, reason: 'invalid' };
  return commit(libraryId, 'paper-meta-remove', (entry) => {
    if (!(cid in entry.papers)) return false;
    const next = { ...entry.papers };
    delete next[cid];
    entry.papers = next;
  });
}

/** 读:某 library 内某论文的元数据(无则返回 undefined)。 */
export function getLibraryPaperMeta(
  libraryId: string,
  arxivId: string,
): LibraryPaperMeta | undefined {
  const cid = canonicalArxivId(arxivId);
  if (!cid) return undefined;
  return getUserLibrary(libraryId)?.papers[cid];
}

/** 读:整 library 的 paper metas(caller 自己 filter status)。 */
export function listLibraryPaperMetas(libraryId: string): Record<string, LibraryPaperMeta> {
  return getUserLibrary(libraryId)?.papers || {};
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

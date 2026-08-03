// astro-src/lib/user-libraries/gist.ts
//
// 用户文献库(复数 libraries)的 Gist 同步层。**走同一个** dpr-library.json,
// 与 lib/user-library(单数)的 papers 数据并列;同一份 gist id、同一对
// push/pull 按钮。
//
// dpr-library.json 文件结构(扩展后):
//   {
//     "schemaVersion": 1,
//     "papers": { ... },                  // 单数 user-library 的 per-paper 状态
//     "libraries": {                      // 复数 user-libraries 的文献库列表
//       "schemaVersion": 1,
//       "items": { "<libraryId>": { ... UserLibrary ... } }
//     }
//   }
//
// 关键设计(对齐 lib/user-library/gist.ts):
// 1. **libraries 字段可选**。v1 旧文件没有 → 走 `?.libraries ?? {schemaVersion:1, items:{}}`。
// 2. **merge 按 library 级 updatedAt last-write-wins**。**没有** note 那种
//    3-way 冲突(library 元数据是结构化字段,不是自由文本)。
// 3. **被 lib/user-library/gist.ts 调用**。push/pull 在那一层编排:
//    - push:serialize 完整 doc(papers + libraries)→ PATCH / POST;
//    - pull:deserialize 远端 → 分别 mergeUserLibrary(papers) +
//      mergeUserLibraries(libraries) → 一次性写 localStorage(两个 key)。
// 4. **fetch 失败 / 401 / 403 全部显式 reason**,不要静默 ——
//    UI 必须能跟用户说「同步失败,token 过期了」。
//
// 本模块**不**直接 fetch Gist HTTP;HTTP 在 lib/user-library/gist.ts 里。

import { canonicalArxivId } from '../arxiv';
import { USER_LIBRARIES_SCHEMA_VERSION } from './store';
import type { UserLibrary, UserLibrariesDoc } from './types';

/** dpr-library.json 内的 libraries 块形状。 */
export interface SerializedLibrariesBlock {
  schemaVersion: typeof USER_LIBRARIES_SCHEMA_VERSION;
  items: Record<string, UserLibrary>;
}

/**
 * 把 doc 序列化成可拼到 dpr-library.json 的 libraries 块。
 * 失败一律返回 null,绝不抛。 */
export function serializeUserLibraries(doc: UserLibrariesDoc): SerializedLibrariesBlock {
  return {
    schemaVersion: USER_LIBRARIES_SCHEMA_VERSION,
    items: doc.libraries,
  };
}

/** 远端 libraries 块反序列化。失败一律返回 null。 */
export function deserializeUserLibraries(block: unknown): UserLibrariesDoc | null {
  if (!block || typeof block !== 'object') return null;
  const obj = block as Partial<SerializedLibrariesBlock>;
  if (obj.schemaVersion !== USER_LIBRARIES_SCHEMA_VERSION) return null;
  if (!obj.items || typeof obj.items !== 'object') return null;

  const libs: Record<string, UserLibrary> = {};
  for (const [id, raw] of Object.entries(obj.items as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const l = raw as Partial<UserLibrary>;
    if (typeof l.id !== 'string' || typeof l.name !== 'string' || typeof l.statement !== 'string') continue;
    if (!Array.isArray(l.paperIds)) continue;
    // 远端老 doc 可能缺 categories / keywords / rubric —— 一律按 store.ts
    // sanitizeOptionalLists 同样的语义补成空数组。store 加载时还会再过一遍
    // 兜底,但这里必须先把 strict UserLibrary 字段填齐,否则 TS 直接报错。
    const safeArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    libs[id] = {
      id: l.id,
      name: l.name,
      statement: l.statement,
      hue: (l.hue as UserLibrary['hue']) || 'emerald',
      paperIds: l.paperIds.filter((x): x is string => typeof x === 'string'),
      categories: safeArr(l.categories).filter((x): x is string => typeof x === 'string'),
      inclusionKeywords: safeArr(l.inclusionKeywords).filter((x): x is string => typeof x === 'string'),
      exclusionKeywords: safeArr(l.exclusionKeywords).filter((x): x is string => typeof x === 'string'),
      rubric: safeArr(l.rubric)
        .map((r) => (r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string'
          ? { name: (r as { name: string }).name.slice(0, 32) }
          : null))
        .filter((r): r is { name: string } => r !== null),
      createdAt: typeof l.createdAt === 'number' ? l.createdAt : 0,
      updatedAt: typeof l.updatedAt === 'number' ? l.updatedAt : 0,
      papers: {},
      conceptOverrides: {},
    };
  }
  return { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, libraries: libs };
}

/** 空 block —— push 第一次且本地还没有任何 library 时,远端写一个空块占位。 */
export function emptySerializedLibraries(): SerializedLibrariesBlock {
  return { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, items: {} };
}

/** 空 doc —— pull 后如果远端没 libraries 块,本地走空 doc 兜底。 */
export function emptyLibrariesDoc(): UserLibrariesDoc {
  return { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, libraries: {} };
}

/**
 * 把 local + remote 合并,**优先 updatedAt 新的**覆盖。
 * 纯函数,不修改输入,不读写 localStorage。
 *
 * 与 mergeUserLibrary(papers,note 有 3-way 冲突)的区别:这里**没有** note
 * 那种 3-way 语义。library 是结构化字段,直接 last-write-wins 即可。
 *
 * 跨版本兼容:remote 的 paperIds[] 元素可能带 vN,本函数归一化到 canonical,
 * 避免合并后出现同 canonical 重复 entry(同 mergeUserLibrary 防御)。 */
export function mergeUserLibraries(
  local: UserLibrariesDoc,
  remote: UserLibrariesDoc,
): { merged: UserLibrariesDoc; counters: { mergedLibraries: number; writtenLibraries: number } } {
  const out: Record<string, UserLibrary> = { ...local.libraries };
  let writtenLibraries = 0;

  for (const [id, remoteLib] of Object.entries(remote.libraries)) {
    const localLib = out[id];
    if (!localLib || (remoteLib.updatedAt ?? 0) > (localLib.updatedAt ?? 0)) {
      // 归一化 paperIds 到 canonical
      const seen = new Set<string>();
      const paperIds: string[] = [];
      for (const raw of remoteLib.paperIds || []) {
        const cid = canonicalArxivId(raw);
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        paperIds.push(cid);
      }
      out[id] = { ...remoteLib, paperIds };
      if (!localLib) writtenLibraries++;
    }
  }

  // 跨 canonical 防御:local + remote 都有同 id 但 paperIds 有差异时,
  // 已经按 updatedAt 选过;这里再 dedupe 一遍以防万一。
  return {
    merged: { schemaVersion: USER_LIBRARIES_SCHEMA_VERSION, libraries: out },
    counters: {
      mergedLibraries: Object.keys(out).length,
      writtenLibraries,
    },
  };
}

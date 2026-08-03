// astro-src/lib/user-libraries/index.ts — 公开 API barrel。
//
// 外部一律从这里 import,不要深入子模块:
//   import { createLibrary, listUserLibraries } from '../lib/user-libraries';
//
// 子模块单向依赖:
//   types.ts     零依赖(纯 type)
//   store.ts     → types + lib/arxiv + lib/events + lib/storage
//   gist.ts      → types + store(只引用 USER_LIBRARIES_SCHEMA_VERSION)
//
// 注意:事件 emit/on 不在本 barrel 里重复导出 —— 它们属于 lib/events,
// 从两个地方导出同一个 emitter 正是 feedback_settings_selection_must_emit
// 那个 bug 的形态。订阅方直接:
//   import { onDprUserLibrariesChange } from '../lib/events';

export type {
  LibraryAnchor,
  LibraryDefinition,
  LibraryHue,
  LibraryRubricItem,
  UserLibrary,
  UserLibrariesDoc,
  WriteResult,
  ARXIV_CATEGORY_PRESETS,
} from './types';

export { LIBRARY_HUES, defaultLibraryDefinition } from './types';

export {
  USER_LIBRARIES_SCHEMA_VERSION,
  loadUserLibraries,
  getUserLibrary,
  listUserLibraries,
  listUserLibraryPaperIds,
  listLibrariesContainingPaper,
  createLibrary,
  renameLibrary,
  deleteLibrary,
  addPaperToLibrary,
  removePaperFromLibrary,
  setLibraryHue,
  updateLibraryDefinition,
  setLibraryVisibility,
  addLibraryAnchor,
  removeLibraryAnchor,
  replaceUserLibraries,
  clearUserLibraries,
} from './store';

export {
  serializeUserLibraries,
  deserializeUserLibraries,
  emptySerializedLibraries,
  emptyLibrariesDoc,
  mergeUserLibraries,
} from './gist';

export type { SerializedLibrariesBlock } from './gist';

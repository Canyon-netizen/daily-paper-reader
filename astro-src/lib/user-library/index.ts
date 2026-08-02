// astro-src/lib/user-library/index.ts — 公开 API barrel。
//
// 外部一律从这里 import,不要深入子模块:
//   import { toggleStar, getReadingStatus } from '../lib/user-library';
//
// 子模块单向依赖:
//   types.ts     零依赖(纯 type)
//   store.ts     → types + lib/arxiv + lib/events + lib/storage
//   snapshot.ts  → types + store + lib/arxiv + lib/storage
//
// 注意:事件 emit/on 不在本 barrel 里重复导出 —— 它们属于 lib/events,
// 从两个地方导出同一个 emitter 正是 feedback_settings_selection_must_emit
// 那个 bug 的形态。订阅方直接:
//   import { onDprUserLibraryChange } from '../lib/events';

export type {
  ReadingStatus,
  TrashMeta,
  UserPaperState,
  UserLibraryDoc,
  WriteResult,
  UserLibrarySnapshot,
  GistLibraryResult,
} from './types';

export {
  USER_LIBRARY_SCHEMA_VERSION,
  loadUserLibrary,
  getUserPaperState,
  isStarred,
  getReadingStatus,
  getUserNote,
  hasUserNote,
  isTrashed,
  listStarred,
  listWithNotes,
  listTrashed,
  setStarred,
  toggleStar,
  setReadingStatus,
  setUserNote,
  upsertPaperMeta,  // v2:LLM 评分写入(relevanceScore / tldr / concepts)
  softDelete,
  restoreFromTrash,
  purgeUserPaperState,
  replaceUserLibrary,
  clearUserLibrary,
} from './store';

export {
  buildUserLibrarySnapshot,
  emptyUserLibrarySnapshot,
} from './snapshot';

export {
  LIBRARY_GIST_FILENAME,
  getLibraryGistId,
  setLibraryGistId,
  serializeUserLibrary,
  deserializeUserLibrary,
  mergeUserLibrary,
  pullUserLibraryFromGist,
  pushUserLibraryToGist,
  syncUserLibraryFirstTime,
  wipeAllUserLibraryRemote,
} from './gist';

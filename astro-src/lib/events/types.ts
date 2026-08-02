// /lib/events/types.ts — CustomEvent detail 类型集中。
// 与 names.ts 一一对应,提供 emit / listen 时的类型推断。
//
// 用法:
//   import { emitDprThemeChange, onDprThemeChange } from '../lib/events';
//   emitDprThemeChange(document, { theme: 'dark' });
//   onDprThemeChange(document, ({ theme }) => { ... });

// Theme enum 列出实际应用支持的所有 theme name。
// scripts/theme.ts 用的是 'light' | 'dark' | 'contrast' 循环。
export type DprThemeName = 'light' | 'dark' | 'contrast' | 'auto';

export interface DprThemeChangeDetail {
  theme: DprThemeName;
}

export interface DprTopicFilterChangeDetail {
  topic: string | null;
}

export interface DprDailyDayOpenedDetail {
  /** YYYY-MM-DD */
  date: string;
}

/** paper-selection-change 的 detail 为空 —— selection 状态由 listener
 *  直接读 storage 拿,而不是塞进 event detail。 */
export type PaperSelectionChangeDetail = void;

/** 用户态写入的原因标签。listener 可以据此决定重绘粒度
 *  (例如 'note' 只需刷新笔记指示点,'bulk' 需要整表重排)。 */
export type DprUserLibraryChangeReason =
  | 'star'
  | 'status'
  | 'note'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'bulk'
  | 'sync'
  | 'reset'
  | 'meta';  // v2:LLM 评分结果写入(relevanceScore / tldr / concepts)

export interface DprUserLibraryChangeDetail {
  /** 受影响的 canonical arXiv id。'sync' / 'reset' 可能很多条。 */
  ids: string[];
  reason: DprUserLibraryChangeReason;
}

/** 工作台批量选择的 detail。**只放 id 集合** —— listener 自己调
 *  getBulkSelection() 读真值;detail 是"有变化"的提示,不是状态源。 */
export interface DprBulkSelectionChangeDetail {
  /** 当前批量选择中的 canonical arXiv id 集合(顺序=加入顺序)。 */
  ids: string[];
}

/** 用户文献库写入的原因标签。listener 可以据此决定重绘粒度
 * (例如 'addPaper' 只需刷新该 library 的成员行,'create' / 'sync' 需要整表重排)。 */
export type DprUserLibrariesChangeReason =
  | 'create'
  | 'rename'
  | 'statement'
  | 'delete'
  | 'addPaper'
  | 'removePaper'
  | 'sync'
  | 'reset'
  | 'hue';

export interface DprUserLibrariesChangeDetail {
  /** 受影响的 library id。'create' / 'sync' / 'reset' 可能很多条。 */
  ids: string[];
  reason: DprUserLibrariesChangeReason;
}
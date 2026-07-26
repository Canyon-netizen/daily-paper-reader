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
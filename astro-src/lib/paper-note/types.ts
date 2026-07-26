// /lib/paper-note/types.ts — paper-note 子模块的本地 DTO。
//
// 与 AnalysisResult(在 scripts/paper-analyzer.ts 内)和 DeepDiveResult 字段名 / 形状一致;
// 抽出子模块后这些 DTO 由 caller 提供,本模块只消费不定义。

import type { Categories } from '../taxonomies';

/** 与 paper-analyzer.AnalysisResult 兼容的最小子集。
 *  抽到这里是因为 buildFrontmatter / buildSpeedReadBody 只用这些字段,
 *  不需要把整个 AnalysisResult(定义在 scripts 里)导入 lib,避免 lib↔scripts 循环。
 *
 * categories 字段采用结构兼容策略 —— 旧 [string] / {domain, task, method} TopicTags
 * 与新 4-dim Categories 都识别。caller 传 narrow 后(由 normalize* 包过)的
 * AnalysisResult 直接通过结构兼容命中。 */
export interface NoteAnalysisInput {
  title?: string;
  title_en?: string;
  authors?: string;
  tldr?: string;
  motivation?: string;
  method?: string;
  result?: string;
  conclusion?: string;
  context?: string;
  categories?:
    | Categories
    | string[]
    | { domain?: string; task?: string; method?: string };
}

/** 与 paper-analyzer.DeepDiveResult 兼容的最小子集。 */
export interface DeepDiveMeta {
  markdown: string;
  truncated: boolean;
  pdfChars: number;
  contextTokens: number;
  /** 可选;空时 banner 省略"模型: x"段 */
  usedModel?: string;
}
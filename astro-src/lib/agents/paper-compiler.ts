/**
 * lib/agents/paper-compiler.ts — Typed mirror of paper-compiler.mjs (iter #61)
 *
 * 与项目 Phase A shim 策略一致(同 export-bundle.ts):.ts 是类型层 +
 * 重新 export 运行时(.mjs);Node CLI 与浏览器 ESM 都 import .mjs 拿实现,
 * 结构上杜绝双实现 drift。
 *
 * 职责:把 3 智能体循环撒在
 *   archive/<sid>/{drafts,reviews,experiments,paper_additions,rebuttals}/
 * 的碎片 markdown + synthesis/ 装配成一篇论文(markdown + 可编译 LaTeX + .bib)。
 *
 * 用法:
 *   import {
 *     buildPaperDraft, formatPaperLatex, formatPaperMarkdown,
 *     type PaperDraft,
 *   } from '../agents/paper-compiler';
 *
 * 跑法:node --test tests/test_agents_paper_compiler.mjs
 */

// ---------------------------------------------------------------------------
// 类型:论文装配数据契约
// ---------------------------------------------------------------------------

/** Modifier 写出的 deliverable 种类(与 writeDeliverable 的 kind 标签一致) */
export type DeliverableKind =
  | 'draft'
  | 'review'
  | 'experiment'
  | 'paper_addition'
  | 'rebuttal';

/** 论文章节 id */
export type PaperSectionId =
  | 'introduction'
  | 'related_work'
  | 'method'
  | 'results'
  | 'limitations';

/** 章节规格(PAPER_SECTIONS 的元素) */
export interface PaperSectionSpec {
  id: PaperSectionId;
  title: string;
  titleZh: string;
  /** 该章节吸收的 deliverable kind */
  sources: DeliverableKind[];
  /** 空章节时展示的解释文案 */
  blurb: string;
}

/** 调用方从盘上读进来的一份 deliverable(未解析) */
export interface DeliverableInput {
  kind: DeliverableKind;
  /** 原始 .md 全文(含 frontmatter) */
  raw: string;
  path?: string | null;
  round?: number | null;
  idx?: number;
}

/** 解析后进入某章节的一条目 */
export interface PaperSectionEntry {
  kind: DeliverableKind;
  path: string | null;
  round: number | null;
  idx: number;
  title: string;
  decision: string | null;
  relatedPapers: string[];
  /** 剥掉 frontmatter 与重复 H1 之后的正文 */
  body: string;
}

/** 装配后的章节 */
export interface PaperSection extends PaperSectionSpec {
  entries: PaperSectionEntry[];
  /** 由结构直接生成的正文(目前只有 introduction 用) */
  body: string;
  empty: boolean;
}

/** 一条引文 */
export interface BibEntry {
  /** 合法 BibTeX cite key */
  key: string;
  /** 规约后的 arXiv id */
  id: string;
  /** 引用了它的 proposal id */
  citedBy: string[];
  citations: number;
}

export interface SynthesisInput {
  idx: number;
  raw: string;
}

export interface PaperDraftStats {
  rounds: number;
  proposals: number;
  applied: number;
  deliverables: number;
  syntheses: number;
  references: number;
  sectionsWithContent: number;
}

export interface PaperDraft {
  sessionId: string;
  generatedAt: string;
  title: string;
  goal: string;
  abstract: string;
  meta: Record<string, unknown> | null;
  sections: PaperSection[];
  bibliography: BibEntry[];
  stats: PaperDraftStats;
}

export interface BuildPaperDraftInput {
  meta?: Record<string, unknown> | null;
  rounds?: Array<Record<string, unknown>>;
  deliverables?: DeliverableInput[];
  syntheses?: SynthesisInput[];
  /** 注入以保证输出可复现;缺省用当前时间 */
  generatedAt?: string;
}

export interface FormatPaperLatexOpts {
  documentclass?: string;
  bibResource?: string;
}

export interface StripFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

// ---------------------------------------------------------------------------
// 运行时:从 .mjs 镜像 re-export(单一真相源,无 drift 风险)
// ---------------------------------------------------------------------------

export {
  PAPER_SECTIONS,
  DELIVERABLE_DIRS,
  stripFrontmatter,
  extractMarkdownSection,
  collectBibliography,
  formatBibtex,
  buildPaperDraft,
  formatPaperMarkdown,
  escapeLatex,
  formatPaperLatex,
} from './paper-compiler.mjs';

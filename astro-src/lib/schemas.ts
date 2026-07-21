// 共用类型 / schema,集中放置由 LLM 构造或经 LLM 流过的对象,以消除多个文件的
// 接口重复,统一字段白名单 —— 把 [[feedback_subq_fields_whitelist]] 的踩坑点
// 一次性消掉:
//
//   1) extractBalancedJson / JSON.parse / callLLMRaw 出来的字段会"无声丢失",
//   2) TypeScript 的 `as` cast 加上对象字面量里漏字段不会报错,
//   3) regen / 部分拷字段路径("只拷 LLM 输出那 4 个字段,把自己手动加的不拷")
//      容易漏。
//
// 解决:这些类型的构造必须走这里提供的 builder —— 任何字段缺失都会编译期报错
// (required 字段)或显式默认值兜底(undefined 字段)。
//
// 用法:
//   import { buildSubQ, type SubQ, type SubQInput, ALLOWED_EXPLORATION_TYPES } from '../lib/schemas';
//
//   const sq: SubQ = buildSubQ({
//     ...rawLLMItem,
//     id: uid('q'),
//     source: 'manual',
//     label: rawLLMItem.label ?? 'fallback',
//   });

import type { AnalysisResult, ArxivEntry } from '../scripts/paper-analyzer';
import {
  buildCategories,
  type Categories,
  type CategoriesInput,
  categoriesToYamlInline,
} from './taxonomies';

export { buildCategories, categoriesToYamlInline };
export type { Categories, CategoriesInput };

// ============================================================================
// SubQ + 构造
// ============================================================================

/** 子方向的探索范式 (主题探索 Explore-from-Seeds 入口用) */
export type SubQExplorationType =
  | 'cross_domain'
  | 'method_transfer'
  | 'reverse'
  | 'combination';

/** 子方向的来源:区别手动输入 vs 来自已选论文种子 */
export type SubQSource = 'manual' | 'manual-with-seeds' | 'seeds';

/** SubQ 的"LLM 输出 + 派生"的并集字段。[[feedback_subq_fields_whitelist]] 提到的字段
 *  全列在这里,统一管理。新增字段时必须同时更新 SubQ / SubQInput / buildSubQ 三处。 */
export interface SubQ {
  id: string;
  label: string;
  query: string;
  reason: string;
  selected: boolean;
  explorationType?: SubQExplorationType;
  source?: SubQSource;
  /** 实测 arXiv 召回数 (validateAndRewriteSubqs 时异步填充) */
  hitCount?: number;
  /** 命中样本 (最多 3 条标题) */
  hitSamples?: string[];
  /** searchForDirection 主 query 抛错时的错误信息 */
  searchError?: string;
  /** arXiv 真实常见写法(去重 + 去中文字符) */
  aliases?: string[];
  /** 该子方向归属的研究维度 (facet) 的权威 id。decomposeIdea 解析对象时映射填充。 */
  facetId?: string;
  /** 派生缓存:归属 facet 的中文 label。渲染时优先按 facetId 查当前 facet 的最新 label,
   *  facetLabel 只在 facet 缺失 / 旧 session 时作 fallback,避免 facet 改名后显示过期值。 */
  facetLabel?: string;
}

/** buildSubQ 的输入形状。required 字段显式列出,LLM / UI / regen 三类构造方都要走这里。 */
export interface SubQInput {
  id: string;
  label: string;
  query: string;
  reason: string;
  selected?: boolean;
  explorationType?: SubQExplorationType | string;
  source?: SubQSource;
  aliases?: readonly unknown[];
  hitCount?: number;
  hitSamples?: readonly string[];
  searchError?: string;
  facetId?: string;
  facetLabel?: string;
}

/** SubQ 里 explorationType 的白名单 (LLM 偶发大小写或拼写错误要走这里收敛)。 */
export const ALLOWED_EXPLORATION_TYPES: ReadonlySet<SubQExplorationType> = new Set([
  'cross_domain',
  'method_transfer',
  'reverse',
  'combination',
]);

/** 单个 alias 的字符串化:接受 unknown,过滤空白和非 ASCII token 等。
 *  这是旧 normalizeQuery 的核心职责之一,集中到这里以免三处实现散落。 */
export function normalizeAliasToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  // 仅保留 ASCII token (字母/数字/空格/连字符/下划线),剥掉中文/标点。
  // 与 topic-search.ts 内 normalizeQuery 同步语义。
  return t.replace(/[^A-Za-z0-9 \-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** aliases 数组的标准化:每项过 normalizeAliasToken,去空,去重,剔除主 query 自己。 */
export function normalizeAliases(
  rawAliases: readonly unknown[] | undefined,
  primaryQuery: string,
): string[] {
  if (!Array.isArray(rawAliases)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const primaryClean = normalizeAliasToken(primaryQuery).toLowerCase();
  for (const a of rawAliases) {
    const t = normalizeAliasToken(a);
    if (!t) continue;
    const key = t.toLowerCase();
    if (key === primaryClean) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** 主 query 标准化:
 *   1) 去掉中文字符
 *   2) 仅保留字母/数字/空格/连字符/下划线
 *   3) 折叠空白
 *   4) 截前 6 个 token (arXiv all: 全文模式 6 个以内足够,过长会被噪声论文污染)
 * 沿用 topic-search.ts:normalizeQuery 原语义,集中到这里。 */
export function normalizeQuery(q: unknown): string {
  if (typeof q !== 'string') return '';
  let s = q.replace(/[一-鿿]+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/[^A-Za-z0-9 \-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const toks = s.split(' ').filter(Boolean);
  if (toks.length > 6) s = toks.slice(0, 6).join(' ');
  return s;
}

/** 构造 SubQ。所有 LLM-emitted 字段 (label/reason/aliases/explorationType) 必须
 *  在这里被白名单拷过,保证任何字段漏拷时 TypeScript 直接报缺 required。 */
export function buildSubQ(input: SubQInput): SubQ {
  const cleanedQuery = normalizeQuery(input.query);
  const out: SubQ = {
    id: input.id,
    label: String(input.label ?? '').slice(0, 60),
    query: cleanedQuery || (typeof input.query === 'string' ? input.query.trim() : ''),
    reason: String(input.reason ?? '').trim(),
    selected: input.selected !== false,
    source: input.source,
    explorationType: (() => {
      const raw = String(input.explorationType ?? '').trim().toLowerCase();
      return ALLOWED_EXPLORATION_TYPES.has(raw as SubQExplorationType)
        ? (raw as SubQExplorationType)
        : undefined;
    })(),
    aliases:
      input.aliases !== undefined
        ? normalizeAliases(input.aliases, cleanedQuery)
        : undefined,
    hitCount: typeof input.hitCount === 'number' ? input.hitCount : undefined,
    hitSamples: Array.isArray(input.hitSamples)
      ? input.hitSamples.filter((s): s is string => typeof s === 'string')
      : undefined,
    searchError: input.searchError ? String(input.searchError) : undefined,
    facetId: (() => {
      const t = String(input.facetId ?? '').trim().slice(0, 64);
      return t || undefined;
    })(),
    facetLabel: (() => {
      const t = String(input.facetLabel ?? '').trim().slice(0, 60);
      return t || undefined;
    })(),
  };
  return out;
}

/** regen 路径专用:从已有 SubQ + LLM 出的部分字段构造新值。
 *  与 buildSubQ 不同 —— 这条路径要"保留已有手动修改过的字段",只在合适时覆盖。 */
export function buildRegenSubQ(args: {
  base: SubQ;
  replacement: SubQ;
}): SubQ {
  const { base, replacement } = args;
  // label/query/reason:始终用 LLM 新出的(用户点 regen 本意就是"重写这些")
  // aliases/explorationType:若 base 已经有手动填的值则保留 base,只在 base 为空时用 LLM
  //                      新出的。这样用户手动改的优先级 > LLM 一次性产出。
  const keepAliases =
    base.aliases && base.aliases.length > 0
      ? base.aliases
      : replacement.aliases ?? base.aliases;
  return buildSubQ({
    id: base.id,
    label: replacement.label,
    query: replacement.query || base.query,
    reason: replacement.reason ?? base.reason,
    selected: base.selected,
    source: base.source,
    explorationType: replacement.explorationType ?? base.explorationType,
    aliases: keepAliases,
    hitCount: base.hitCount,
    hitSamples: base.hitSamples,
    searchError: base.searchError,
    // facet 归属:用户已有归属优先(regen 不应把子方向搬到别的维度),
    // 旧 session / base 无归属时才用 replacement 补齐。
    facetId: base.facetId ?? replacement.facetId,
    facetLabel: base.facetLabel ?? replacement.facetLabel,
  });
}

// ============================================================================
// Facet(研究维度)+ 构造 — 阶段 1 拆解的显式中间层
// ============================================================================

/** 研究维度分类。稳定英文枚举,UI 层再映射中文(见 FACET_CATEGORY_LABELS)。 */
export type FacetCategory =
  | 'method'
  | 'data_task'
  | 'structure_property'
  | 'application_transfer'
  | 'evaluation_benchmark';

export const ALLOWED_FACET_CATEGORIES: ReadonlySet<FacetCategory> = new Set([
  'method',
  'data_task',
  'structure_property',
  'application_transfer',
  'evaluation_benchmark',
]);

/** FacetCategory → 中文显示名。UI 渲染 chip / select 用。 */
export const FACET_CATEGORY_LABELS: Record<FacetCategory, string> = {
  method: '方法路线',
  data_task: '数据与任务',
  structure_property: '结构与性质',
  application_transfer: '应用与迁移',
  evaluation_benchmark: '评测与基准',
};

/** 一个研究维度。id 是权威归属键(subq.facetId 指向它)。 */
export interface Facet {
  id: string;
  label: string;
  category: FacetCategory;
  note: string;
}

export interface FacetInput {
  id: string;
  label: string;
  category?: FacetCategory | string;
  note?: string;
}

/** 构造 Facet。id/label/note 清洗 + 截断,category 非法 → 'method' 兜底。
 *  不负责去重 id / 校验 subq 映射(那需要 facets+subqs 全局上下文,在 decomposeIdea 解析层做)。 */
export function buildFacet(input: FacetInput): Facet {
  const rawCat = String(input.category ?? '').trim().toLowerCase();
  const category = ALLOWED_FACET_CATEGORIES.has(rawCat as FacetCategory)
    ? (rawCat as FacetCategory)
    : 'method';
  return {
    id: String(input.id ?? '').trim().slice(0, 64),
    label: String(input.label ?? '').trim().slice(0, 60),
    category,
    note: clampText(input.note, 180),
  };
}

/** 拆解阶段 facet 覆盖 / 重复自检结果。派生数据,不持久化。 */
export interface FacetCoverage {
  /** 没有任何 subq 归属的 facet id */
  uncoveredFacetIds: string[];
  /** 关联了 >1 个 subq 的 facet id(可能重复) */
  redundantFacetIds: string[];
  /** 没有有效 facetId 的 subq id */
  unassignedSubqIds: string[];
}

/** decomposeIdea 的返回形状:facets + subqs + 覆盖自检。 */
export interface TopicDecomposition {
  facets: Facet[];
  subqs: SubQ[];
  coverage: FacetCoverage;
}

/** LLM 拆解 response 的边界输入形状(解析后仍必须过 buildFacet / buildSubQ)。 */
export interface DecomposeLLMFacet {
  id?: string;
  label?: string;
  category?: string;
  note?: string;
}
export interface DecomposeLLMSubQ {
  label?: string;
  query?: string;
  aliases?: readonly unknown[];
  reason?: string;
  facetId?: string;
}
export interface DecomposeLLMResponse {
  facets?: readonly DecomposeLLMFacet[];
  subqs?: readonly DecomposeLLMSubQ[];
}

/** 计算 facet 覆盖 / 重复 / 未分配。纯代码,不调 LLM。 */
export function computeFacetCoverage(facets: Facet[], subqs: SubQ[]): FacetCoverage {
  const facetIds = new Set(facets.map((f) => f.id));
  const countByFacet = new Map<string, number>();
  const unassignedSubqIds: string[] = [];
  for (const sq of subqs) {
    if (sq.facetId && facetIds.has(sq.facetId)) {
      countByFacet.set(sq.facetId, (countByFacet.get(sq.facetId) ?? 0) + 1);
    } else {
      unassignedSubqIds.push(sq.id);
    }
  }
  const uncoveredFacetIds: string[] = [];
  const redundantFacetIds: string[] = [];
  for (const f of facets) {
    const n = countByFacet.get(f.id) ?? 0;
    if (n === 0) uncoveredFacetIds.push(f.id);
    else if (n > 1) redundantFacetIds.push(f.id);
  }
  return { uncoveredFacetIds, redundantFacetIds, unassignedSubqIds };
}

// ============================================================================
// Candidate / Summary / Chat
// ============================================================================

export interface Candidate {
  arxivId: string;
  entry: ArxivEntry;
  selected: boolean;
}

export interface Summary {
  arxivId: string;
  subqId: string;
  summary: AnalysisResult;
  generatedAt: number;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** localStorage 序列化的单个主题会话。 */
export interface TopicSession {
  id: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  /** 阶段 1 拆解出的研究维度(显式 facet 层)。旧 session 无此字段 → undefined,
   *  UI 检测到空则隐藏 facet panel。 */
  facets?: Facet[];
  subqs: SubQ[];
  candidatesBySubq: Record<string, Candidate[]>;
  /** 阶段 3 子方向 group 折叠状态:subqId → 是否展开。可选,老 session 缺这字段 → undefined,
   *  渲染时走 `?? {}` 默认全部折叠(避免一次性展开上百篇论文)。 */
  candGroupExpanded?: Record<string, boolean>;
  summaries: Summary[];
  chats: Record<string, ChatMsg[]>;
  /** 报告追问历史(阶段 5 报告生成后,用户与模型围绕报告的对话)。 */
  reportChats?: ChatMsg[];
  /** 主题报告(阶段 5 产物)。 */
  report?: TopicReport;
  /** 最近一次 doDecompose 拆解时参考的论文 ID。 */
  referenceSeedArxivIds?: string[];
}

/** localStorage schema 版本号 (topic-search.ts 内部使用) */
export interface SessionStore {
  version: number;
  currentId: string | null;
  sessions: Record<string, TopicSession>;
}

// ============================================================================
// TopicReport (LLM-emitted 主题报告)
// ============================================================================

export interface TopicReportDimensionPaper {
  arxivId: string;
  role: string;       // 截断 24
  key: string;        // 截断 120
  method?: string;    // 截断 120
  result?: string;    // 截断 120
  note?: string;      // 截断 120
}

export interface TopicReportDimension {
  name: string;                                  // 截断 30
  description?: string;                          // 截断 160
  papers: TopicReportDimensionPaper[];           // ≥ 1
}

export interface TopicReport {
  overview: string;                              // 截断 800
  dimensions: TopicReportDimension[];            // 2-6
  sharedFindings: string[];                      // 截断 120/条, 最长 8
  gaps: string[];                                // 截断 120/条, 最长 6
  nextSteps: string[];                           // 截断 120/条, 最长 6
  generatedAt: number;
  relatedArxivIds: string[];
  incrementallyAddedArxivIds?: string[];
}

/** validateAndRewriteSubqs 的子方向改写结果。
 *  仅包含 LLM 改写后的字段;调用方按外层 SubQ.id 找回原条目并替换。
 *  SubQRewrite 自身不强制 id,避免冗余。 */
export interface SubqRewrite {
  query: string;
  aliases: string[];
}

/** LLM-emitted 单条 topic dimension 文本安全收敛:长度截断 + 数组过滤。 */
export function clampText(s: unknown, max: number): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export function clampStringArray(raw: unknown, maxLen: number, eachMax: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const v = clampText(x, eachMax);
    if (v) out.push(v);
    if (out.length >= maxLen) break;
  }
  return out;
}

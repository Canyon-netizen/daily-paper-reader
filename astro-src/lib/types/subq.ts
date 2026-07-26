// /lib/types/subq.ts — SubQ(子方向)相关纯类型 + 纯函数 computeFacetCoverage。
//
// 强约束(参见 [[feedback_subq_fields_whitelist]]):
//   - SubQ 是 LLM-emit 字段 + 派生字段的并集
//   - SubQInput 与 SubQ 必须分离:LLM 输出边界用 SubQInput,持久化层用 SubQ
//   - 任何字段在 regen / 部分拷字段路径下被漏拷都会触发 Type 编译失败
//
// computeFacetCoverage 只依赖 Facet + SubQ 类型 + 纯逻辑,
// 放在这里(而非 llm-clean)以便未来被 server-side / 测试单独消费。

import type { Facet, FacetCoverage } from './facet';

/** 子方向的探索范式 (主题探索 Explore-from-Seeds 入口用) */
export type SubQExplorationType =
  | 'cross_domain'
  | 'method_transfer'
  | 'reverse'
  | 'combination';

/** 子方向的来源:区别手动输入 vs 来自已选论文种子 */
export type SubQSource = 'manual' | 'manual-with-seeds' | 'seeds';

/** SubQ 允许的 explorationType 白名单。 */
export const ALLOWED_EXPLORATION_TYPES: ReadonlySet<SubQExplorationType> = new Set([
  'cross_domain',
  'method_transfer',
  'reverse',
  'combination',
]);

/**
 * SubQ 的"LLM 输出 + 派生"的并集字段。新增字段时必须同步更新
 * SubQ / SubQInput / buildSubQ 三处,缺一处就编译失败。
 */
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
  /** 派生缓存:归属 facet 的中文 label。 */
  facetLabel?: string;
}

/** SubQ 的输入形状,与 SubQ 分离。 */
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
  hitSamples?: readonly unknown[];
  searchError?: string;
  facetId?: string;
  facetLabel?: string;
}

/** LLM 拆解 response 边界的 SubQ 形状。 */
export interface DecomposeLLMSubQ {
  label?: string;
  query?: string;
  aliases?: readonly unknown[];
  reason?: string;
  facetId?: string;
}

/** LLM 拆解 response 的整体边界。 */
export interface DecomposeLLMResponse {
  facets?: readonly import('./facet').DecomposeLLMFacet[];
  subqs?: readonly DecomposeLLMSubQ[];
}

/** validateAndRewriteSubqs 的子方向改写结果:只含 LLM 改写后的字段。 */
export interface SubqRewrite {
  query: string;
  aliases: string[];
}

/** decomposeIdea 的返回形状:facets + subqs + 覆盖自检。 */
export interface TopicDecomposition {
  facets: import('./facet').Facet[];
  subqs: SubQ[];
  coverage: import('./facet').FacetCoverage;
}

/**
 * 纯函数:计算 facet 覆盖 / 重复 / 未分配。不调 LLM,无副作用。
 * 放这里而不是 llm-clean,因为它本质是数据 shape 计算,
 * 不依赖任何 normalize / builder。
 */
export function computeFacetCoverage(facets: Facet[], subqs: import('./subq').SubQ[]): FacetCoverage {
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
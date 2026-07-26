// /lib/types/facet.ts — Facet(研究维度)相关纯类型。
// 零运行时:type / interface / const-only 元数据。
//
// 强约束(参见 [[feedback_subq_fields_whitelist]]):
//   - Facet 是持久化字段,UI 直接消费,不能在 lib 这层被静默改写
//   - 输入形状 FacetInput 与输出 Facet 必须分离,任何字段缺失 → 输入侧补,
//     由 buildFacet 负责(见 lib/llm-clean/builders.ts)

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

/** Facet 的输入形状,与输出分开。 */
export interface FacetInput {
  id: string;
  label: string;
  category?: FacetCategory | string;
  note?: string;
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

/** LLM 拆解 response 边界的 Facet 形状(可空,所有字段 optional)。 */
export interface DecomposeLLMFacet {
  id?: string;
  label?: string;
  category?: string;
  note?: string;
}
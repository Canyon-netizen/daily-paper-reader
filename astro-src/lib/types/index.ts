// /lib/types/index.ts — 公开 barrel。lib/types/ 的统一入口。
// 外部 import 仅 `'@lib/types'` 即可,子模块路径私有。
//
// 强约束(参见 [[feedback_subq_fields_whitelist]]):
//   - 任何字段添加必须同步 (type, builder, normalize) 三处;
//     /types 是 type-only 出口;builder 在 llm-clean/builders.ts;normalize 在 llm-clean/normalize.ts。

export type {
  FacetCategory,
  Facet,
  FacetInput,
  FacetCoverage,
  DecomposeLLMFacet,
} from './facet';
export { ALLOWED_FACET_CATEGORIES, FACET_CATEGORY_LABELS } from './facet';

export type {
  SubQExplorationType,
  SubQSource,
  SubQ,
  SubQInput,
  SubqRewrite,
  DecomposeLLMSubQ,
  DecomposeLLMResponse,
  TopicDecomposition,
} from './subq';
export { ALLOWED_EXPLORATION_TYPES, computeFacetCoverage } from './subq';

export type {
  Candidate,
  Summary,
  ChatMsg,
  TopicSession,
  SessionStore,
  DebateIdea,
  DebateProgress,
  TopicReport,
  TopicReportDimension,
  TopicReportDimensionPaper,
} from './topic';
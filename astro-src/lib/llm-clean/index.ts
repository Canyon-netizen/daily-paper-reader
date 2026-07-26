// /lib/llm-clean/index.ts — 公开 API barrel。
//
// 单一职责:LLM 输出边界的归一化 + 构造。
//  - normalize 模块:字符串清洗(clampText / clampStringArray / normalizeQuery / normalizeAliases / normalizeAliasToken)
//  - builders 模块:类型构造(buildSubQ / buildRegenSubQ / buildFacet)
//
// 子模块之间单向依赖:
//   normalize 零依赖(纯字符串)
//   builders  → types(只 type) + normalize(运行时)

export {
  clampText,
  clampStringArray,
  normalizeQuery,
  normalizeAliases,
  normalizeAliasToken,
} from './normalize';

export {
  buildSubQ,
  buildRegenSubQ,
  buildFacet,
} from './builders';

export {
  extractBalancedJson,
} from './balanced-json';
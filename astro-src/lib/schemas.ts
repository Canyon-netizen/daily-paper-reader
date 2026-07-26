// /lib/schemas.ts — 兼容 shim。
// 真实实现已拆到:
//   - ./types/         纯 TS 类型(Facet / SubQ / TopicSession / TopicReport …)
//   - ./llm-clean/     LLM 边界归一化与构造(builder + normalize + clamp)
//
// shim 策略说明:
//   本文件仅 re-export 所有公开类型、builder、normalize 给旧 caller。
//   新代码请直接 import:
//     - `'@lib/types'`        取纯 DTO
//     - `'@lib/llm-clean'`    取 builder / normalize / clamp
//
// 同时继续 re-export categories / paper-relations 之类的辅助 re-export,保持向后兼容。

export * from './types/index';
export * from './llm-clean/index';

// 老的 schemas.ts 还 re-export 了 taxonomies 的 helpers;保持原行为。
export {
  buildCategories,
  categoriesToYamlInline,
  type Categories,
  type CategoriesInput,
} from './taxonomies';
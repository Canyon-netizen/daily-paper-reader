// /lib/llm/index.ts — 公开 API。lib/llm/ 的统一入口,
// 外部 import 仅 `'@lib/llm'` 即可,子模块路径私有。
//
// 给 caller 的稳定 surface:
//   - callChatCompletion:协议层单次调用
//   - resolveRoute / invalidateRouteCache:路由层查询 + 失效
//   - REASONING_MODEL_PATTERN_WIDE:历史正则差异保留
//   - 类型 ChatMessage / CallChatOptions / ChatResponse / Route / LLMConfig
//
// 子模块之间绝不互相 import @lib/llm/index.ts ——
// chat.ts 与 route.ts 各自独立,通过 ./types 共用 DTO。

export {
  callChatCompletion,
  REASONING_MODEL_PATTERN_WIDE,
} from './chat';

export {
  resolveRoute,
  invalidateRouteCache,
} from './route';

export type {
  ChatMessage,
  CallChatOptions,
  ChatResponse,
  Route,
  RouteCacheEntry,
  LLMConfig,
} from './types';
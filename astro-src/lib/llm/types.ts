// /lib/llm/types.ts — 纯类型,零运行时。
// 协议层 + 路由层共享的 DTO;外部 caller 也通过这里导入,避免直接穿越子模块。

import type { LLMConfig } from '../../scripts/settings';

/** 单条 chat 消息。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** callChatCompletion 的可选参数(协议层细节)。 */
export interface CallChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  /** OpenAI `max_tokens` 上限。caller 通常传 4000–16000。 */
  maxTokens?: number;
  /** 与本调用层不耦合的可选额外字段 (response_format / tools / 等)。 */
  extra?: Record<string, unknown>;
  /** 用于 cancel 一个进行中的 fetch。 */
  signal?: AbortSignal;
  /** override URL 路径 (默认 `v1/chat/completions`)。 */
  urlPath?: string;
  /** reasoning model 检测的正则源。
   *  - paper-analyzer 旧实现: `/reasoner|reasoning|r1/i`(窄)
   *  - topic-search 旧实现:  `/reasoner|reasoning|r1|think/i`(宽)
   *  默认窄;宽者通过 `REASONING_MODEL_PATTERN_WIDE` 显式传。 */
  reasoningModelPattern?: RegExp;
}

/** callChatCompletion 的返回值。 */
export interface ChatResponse {
  /** 第一条 choice 的 message.content;choices 为空时返回空串。 */
  content: string;
  /** 第一条 choice 的 finish_reason;空时返回空串。 */
  finishReason: string;
  /** 完整原始 JSON,caller 需要其它字段(usage / 其他 choices)时使用。 */
  raw: any;
  /** 由 buildRequestBody 内部计算的派生 flag,方便 caller 决策。 */
  isDeepSeek: boolean;
  /** request 中是否触发了 thinking-disable(给 reasoning 模型)。 */
  reasoningDisabled: boolean;
}

/** 路由层返回的解析结果(stage → model/temperature/isStream)。 */
export interface Route {
  provider: string;
  model: string;
  temperature: number;
  /** 是否走流式(plan §6 stream_stages)。 */
  isStream?: boolean;
}

/** 路由层缓存条目(stage → route + cachedAt)。 */
export interface RouteCacheEntry {
  route: Route;
  cachedAt: number;
}

/** 让外部 caller 仍然可以 `import { LLMConfig } from '@lib/llm/types'`。 */
export type { LLMConfig };
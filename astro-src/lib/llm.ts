// /lib/llm.ts — 与 LLM API(OpenAI 兼容 /v1/chat/completions 端点)通信的纯
// 抽象。三处大型脚本 (paper-analyzer, topic-search) 之前每处都重复:
//
//   const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
//   const isDeepSeek = /^https?:\/\/api\.deepseek\.com/i.test(cfg.baseUrl);
//   const isReasoning = /reasoner|reasoning|r1|think?/i.test(cfg.model);
//   ...历史 caller 里 paper-analyzer + topic-search 1323/1407 全用窄正则
//   (不含 think), 只有 topic-search:654 callLLMRaw 用宽正则 (含 think)。
//   ...
//   const body = { model, messages, temperature, max_tokens, ... };
//   if (isDeepSeek && isReasoning) body.thinking = { type: 'disabled' };
//   const res = await fetch(url, { method:'POST', headers:..., body: JSON.stringify(body) });
//   if (!res.ok) {
//     const t = await res.text().catch(() => '');
//     throw new Error(`LLM API 错误 (${res.status}): ${t.slice(0, 200)}`);
//   }
//   const data = await res.json();
//   const content = data?.choices?.[0]?.message?.content ?? '';
//   const finishReason = data?.choices?.[0]?.finish_reason ?? '';
//
// (paper-analyzer × 2 + topic-search × 3 = 5 处, 全部字面相同的 35 行)。
// 抽到这里后, caller 只需要做"业务层" (reasoning strip / extractBalancedJson /
// budget doubling 等), 不再关心 HTTP 协议。

import type { LLMConfig } from '../scripts/settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  /** OpenAI `max_tokens` 上限. caller 通常传 4000–16000. */
  maxTokens?: number;
  /** 与本调用层不耦合的可选额外字段 (response_format / tools / 等). */
  extra?: Record<string, unknown>;
  /** 用于 cancel 一个进行中的 fetch;参考 topic-search 的 inFlightController. */
  signal?: AbortSignal;
  /** override URL 路径 (默认 `v1/chat/completions`). */
  urlPath?: string;
  /** reasoning model 检测的正则源。两处历史 caller 行为不同:
   *  - paper-analyzer 旧实现: /reasoner|reasoning|r1/i
   *  - topic-search 旧实现:  /reasoner|reasoning|r1|think/i
   * 默认后者(含 think)。paper-analyzer 通过 `REASONING_MODEL_PATTERN_NARROW`
   * 显式传入以保留它的旧行为。 */
  reasoningModelPattern?: RegExp;
}

export interface ChatResponse {
  /** 第一条 choice 的 message.content;若 choices 为空则空串。 */
  content: string;
  /** 第一条 choice 的 finish_reason;若空则空串。 */
  finishReason: string;
  /** 完整原始 JSON, 在 caller 需要其它字段(usage / 其他 choices)时使用。 */
  raw: any;
  /** 已识别的 provider flag —— 由 buildRequestBody 内部计算的派生,方便 caller 用 */
  isDeepSeek: boolean;
  /** request 中是否触发了 thinking-disable(给 reasoning 模型). */
  reasoningDisabled: boolean;
}

const DEEPSEEK_RE = /^https?:\/\/api\.deepseek\.com/i;
const REASONING_MODEL_RE = /reasoner|reasoning|r1/i;
const REASONING_MODEL_RE_TOPICSEARCH_DECOMPOSE = /reasoner|reasoning|r1|think/i;

/** topic-search 的 callLLMRaw(:654)历史上用了"宽"正则(含 think),其它 4 处
 *  caller(都在 topic-search 1323/1407 + paper-analyzer 1224/1468) 都是"窄"
 *  正则(只 reasoner/reasoning/r1)。默认使用窄正则;callLLMRaw 通过
 *  `REASONING_MODEL_PATTERN_WIDE` 显式传宽版本, 保留它的历史行为。 */
export const REASONING_MODEL_PATTERN_WIDE = REASONING_MODEL_RE_TOPICSEARCH_DECOMPOSE;

/** 调一次 OpenAI 兼容 /v1/chat/completions。返回 content + finishReason + 原始 raw JSON。
 *
 * 抛错时:
 * - 非 2xx → 包装为 Error(`LLM API 错误 (<status>): <body前200字符>`),
 *   与原行为字节级一致.
 * - JSON 解析失败 → 透传 SyntaxError.
 *
 * 这个 helper **不做** reasoning-strip / fence-strip / balanced-JSON
 * 提取 —— 那是 caller 的"业务层"。这样 paper-analyzer / topic-search 的
 * 业务差异不被这一层吞。
 */
export async function callChatCompletion(
  cfg: LLMConfig,
  opts: CallChatOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResponse> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/${(opts.urlPath ?? 'v1/chat/completions').replace(/^\/+/, '')}`;
  const isDeepSeek = DEEPSEEK_RE.test(cfg.baseUrl);
  const isReasoning = (opts.reasoningModelPattern ?? REASONING_MODEL_RE).test(cfg.model);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: opts.messages,
  };
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
  if (typeof opts.maxTokens === 'number') body.max_tokens = opts.maxTokens;
  if (opts.extra) Object.assign(body, opts.extra);
  if (isDeepSeek && isReasoning) {
    body.thinking = { type: 'disabled' };
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${t.slice(0, 200)}`);
  }
  const raw = await res.json();
  const choice = raw?.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? '',
    raw,
    isDeepSeek,
    reasoningDisabled: isDeepSeek && isReasoning,
  };
}

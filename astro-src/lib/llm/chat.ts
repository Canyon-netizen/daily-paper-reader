// /lib/llm/chat.ts — 协议层:OpenAI 兼容 /v1/chat/completions 单次调用的纯抽象。
//
// 之前 paper-analyzer / topic-search 各处重复 35 行字面相同的 fetch+parse 代码;
// 抽到这里后,caller 只关心业务层(reasoning strip / fence strip / balanced JSON
// 抽取 / budget doubling 等),不再关心 HTTP 协议。
//
// 调用约束:
//   - 不做 reasoning-strip / fence-strip / balanced-JSON 提取 — 那是 caller
//     的"业务层",这样两套历史业务差异不被本层吞。

import type { LLMConfig } from '../../scripts/settings';
import type { CallChatOptions, ChatResponse } from './types';

const DEEPSEEK_RE = /^https?:\/\/api\.deepseek\.com/i;
/** 窄正则:`reasoner | reasoning | r1`。历史 4 处 caller(paper-analyzer 1224/1468
 *  + topic-search 1323/1407)都用这个。 */
const REASONING_MODEL_RE = /reasoner|reasoning|r1/i;
const REASONING_MODEL_RE_TOPICSEARCH_DECOMPOSE = /reasoner|reasoning|r1|think/i;

/** topic-search 的 callLLMRaw(:654)历史上用了"宽"正则(含 think)。
 *  export 出去,call site 显式传,以保留它的历史行为。 */
export const REASONING_MODEL_PATTERN_WIDE = REASONING_MODEL_RE_TOPICSEARCH_DECOMPOSE;

/** 调一次 OpenAI 兼容 /v1/chat/completions。 */
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
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
import { recordUsage } from '../llm-budget';

const DEEPSEEK_RE = /^https?:\/\/api\.deepseek\.com/i;
/** 窄正则:`reasoner | reasoning | r1`。历史 4 处 caller(paper-analyzer 1224/1468
 *  + topic-search 1323/1407)都用这个。 */
const REASONING_MODEL_RE = /reasoner|reasoning|r1/i;
const REASONING_MODEL_RE_TOPICSEARCH_DECOMPOSE = /reasoner|reasoning|r1|think/i;

/** topic-search 的 callLLMRaw(:654)历史上用了"宽"正则(含 think)。
 *  export 出去,call site 显式传,以保留它的历史行为。 */
export const REASONING_MODEL_PATTERN_WIDE = REASONING_MODEL_RE_TOPICSEARCH_DECOMPOSE;

/** 读取 localStorage `dpr_llm_proxy_v1`(脚本 scripts/local-llm-proxy.mjs 的 URL)。
 *  SSR / Node 环境没有 localStorage,会返回空串。 */
function readLLMProxyOverride(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const v = (localStorage.getItem('dpr_llm_proxy_v1') || '').trim();
    if (!v) return '';
    // 容错:旧版本可能存的是裸 host(没协议头),这里补 http://(loopback 默认 http)
    return /^https?:\/\//i.test(v) ? v.replace(/\/+$/, '') : `http://${v.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/** 调一次 OpenAI 兼容 /v1/chat/completions。 */
export async function callChatCompletion(
  cfg: LLMConfig,
  opts: CallChatOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResponse> {
  // 2026-09-08:如果用户在 localStorage 设了 `dpr_llm_proxy_v1`(= scripts/local-llm-proxy.mjs 的 URL),
  // 把请求重定向到本地 proxy。proxy server-side 注入 API key,client 这里就不再发
  // Authorization header(避免明文 key 出现在浏览器 Network 面板 / DevTools)。
  const proxyUrl = readLLMProxyOverride();
  const effectiveBase = proxyUrl || cfg.baseUrl;
  const url = `${effectiveBase.replace(/\/+$/, '')}/${(opts.urlPath ?? 'v1/chat/completions').replace(/^\/+/, '')}`;
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (!proxyUrl && cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  // 走本地 proxy 时附一个调试 tag,便于在 logs/llm-proxy.jsonl 区分调用来源
  if (proxyUrl && opts.libraryId) {
    headers['X-LLM-Tag'] = opts.libraryId;
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM API 错误 (${res.status}): ${t.slice(0, 200)}`);
  }
  const raw = await res.json();
  const choice = raw?.choices?.[0];
  const response: ChatResponse = {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? '',
    raw,
    isDeepSeek,
    reasoningDisabled: isDeepSeek && isReasoning,
  };

  // Record token usage if available
  const usage = raw?.usage;
  if (usage) {
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    if (promptTokens > 0 || completionTokens > 0) {
      recordUsage(opts.libraryId ?? 'global', promptTokens, completionTokens);
    }
  }

  return response;
}
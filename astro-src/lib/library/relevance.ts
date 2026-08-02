// astro-src/lib/library/relevance.ts
//
// 论文相关度评分(对照 Polaris relevance.score_paper_relevance)。
// 浏览器侧调用 LLM,注入 library.relevance prompt pack,要求严格 JSON 输出。
// 结果写入 user-library store(可选),供 GraphTab 节点上色与排序复用。
//
// 为什么不直接调 Python 后端:
//   - DPR 是静态站点,没有 Polaris 那种后端 worker
//   - 用户自己的 LLM key 直连浏览器更快
//   - 与 paper-compile / paper-chat / paper-analyzer 走同一条 chat 通道

import type { LLMConfig } from '../../scripts/settings';
import { loadSettings } from '../../scripts/settings';
import {
  injectIntoPrompt,
  injectIntoPromptSync,
  preloadPacks,
} from '../../scripts/prompt-pack';
import { callChatCompletion } from '../llm/chat';
import { resolveRoute } from '../llm/route';
import {
  DEFAULT_LIBRARY_PACKS,
  withDefaultLibraryPacks,
} from '../../scripts/library-prompt-defaults';

export interface RelevanceScore {
  score: number; // 0-1
  reason: string;
  tldr: string;
}

/**
 * 构造 base prompt(对应 Polaris score_paper_relevance 的 user 段):
 *   - 库方向陈述
 *   - 论文标题 + 摘要
 * 让模型按"对照库方向评估"打分。
 */
export function buildRelevanceBasePrompt(args: {
  libraryName: string;
  libraryStatement: string;
  paperTitle: string;
  paperAbstract: string;
}): string {
  return `研究库: ${args.libraryName}
方向陈述: ${args.libraryStatement || '(无)'}

论文标题: ${args.paperTitle}
论文摘要: ${args.paperAbstract || '(无摘要)'}

按上述方向评估这篇论文,只输出 JSON。`;
}

const REASONING_MODEL_RE = /reasoner|reasoning|r1|think/i;

function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_RE.test(model);
}

/**
 * 调 LLM 给论文打相关度分。返回 RelevanceScore 或 null(失败 graceful)。
 *
 * 流程:
 *   1. 加载 settings;若无 key 直接返回 null
 *   2. preloadPacks 预热 library.relevance pack(失败不阻断)
 *   3. injectIntoPrompt 把 pack body 拼到 user prompt 前
 *   4. 调 callChatCompletion(配合 stage 路由的 temperature/maxTokens)
 *   5. 解析 JSON 失败 → 退化为 text 抠 JSON
 */
export async function scorePaperRelevance(
  args: {
    libraryName: string;
    libraryStatement: string;
    paperTitle: string;
    paperAbstract: string;
  },
  options: { config?: LLMConfig | null; signal?: AbortSignal } = {},
): Promise<RelevanceScore | null> {
  const cfg = options.config ?? loadSettings();
  if (!cfg?.apiKey) return null;
  await preloadPacks(cfg).catch(() => undefined);

  const basePrompt = buildRelevanceBasePrompt(args);
  const systemPrompt = injectIntoPromptSync('', 'library.relevance', cfg).trim()
    || '你是文献相关性评审,对照研究方向定义评估一篇论文。只输出一个 JSON 对象。';
  const userPrompt = await injectIntoPrompt(basePrompt, 'library.relevance', cfg);

  const route = resolveRoute('library_relevance');
  const model = cfg.model || route.model;
  const reasoningDisabled = isReasoningModel(model);

  let res;
  try {
    res = await callChatCompletion(cfg, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: route.temperature,
      maxTokens: 1024,
      signal: options.signal,
      reasoningModelPattern: REASONING_MODEL_RE,
    });
  } catch {
    return null;
  }

  return parseRelevanceFromText(res?.content || '');
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * 从 LLM 文本输出里抠 JSON {score, reason, tldr}。
 * 失败返回 null,绝不抛。
 */
export function parseRelevanceFromText(text: string): RelevanceScore | null {
  if (!text) return null;
  try {
    // 1) 尝试直接解析(可能 reasoning 残余剥完就是干净 JSON)
    const direct = tryParseRelevanceObject(text);
    if (direct) return direct;
    // 2) 抓 { ... } 区间
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return tryParseRelevanceObject(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function tryParseRelevanceObject(raw: string): RelevanceScore | null {
  try {
    const obj = JSON.parse(raw) as Partial<RelevanceScore>;
    if (typeof obj.score !== 'number' || typeof obj.tldr !== 'string') return null;
    return {
      score: clamp01(obj.score),
      reason: String(obj.reason || ''),
      tldr: obj.tldr.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * 把 default library.* pin 合到 settings(供 settings UI "启用 Polaris 提示词" 按钮)。
 * 不会覆盖用户已显式 pin 的 target。
 */
export function settingsWithLibraryDefaults(cfg: LLMConfig): LLMConfig {
  return withDefaultLibraryPacks(cfg);
}

export { DEFAULT_LIBRARY_PACKS };

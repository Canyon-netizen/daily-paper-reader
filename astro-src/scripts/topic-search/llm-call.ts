// topic-search LLM 调用层 —— 从 topic-search.ts 抽出（模块化重构 step 6）。
//
// callLLMRaw 是 /topic 页面所有 LLM 调用的入口（拆解 / AI 筛论文 / 主题报告 / 追问
// 都走它）。与 paper-analyzer.ts 的 callLLM 解耦 —— 这里用的是更轻量的 callChatCompletion
// + 自己负责 JSON 截断自愈（通过 ./json-heal.finalizeLLMJson）。
//
// AbortSignal 通过 S.getInFlight() 拿到当前在飞 controller 的 signal —— 这样
// 用户在 UI 点"停止"时，inflight controller 被 orchestrator 调 abort()，正在
// 飞的所有 callLLMRaw 请求都会一并中断。

import type { LLMConfig } from '../settings';
import { callChatCompletion, REASONING_MODEL_PATTERN_WIDE } from '../../lib/llm';
import { finalizeLLMJson } from './json-heal';
import { S } from './state';

export async function callLLMRaw(
  systemPrompt: string,
  userContent: string,
  cfg: LLMConfig,
  jsonOnly = true,
  maxTokens = 4000,
  expectedTopLevel?: '[' | '{',
): Promise<string> {
  // finish_reason=length(被输出预算截断)时,自动加倍预算重试一次。
  // 主要救推理模型:它会先输出一大段 reasoning,重任务思考很长,可能烧光整个 maxTokens,
  // 剥掉思考后正文为空。
  let budget = maxTokens;
  const MAX_BUDGET = 16000;
  for (let attempt = 0; ; attempt++) {
    const response = await callChatCompletion(
      cfg,
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        maxTokens: budget,
        signal: S.getInFlight()?.signal,
        reasoningModelPattern: REASONING_MODEL_PATTERN_WIDE,
      },
    );
    const content = response.content;
    const finishReason = response.finishReason;
    const stripped = content
      .replace(/<\/think>/gi, "")
      .replace(/<\/think[\s\S]*$/i, "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    if (
      finishReason === "length" &&
      stripped.length < 20 &&
      budget < MAX_BUDGET &&
      attempt < 3
    ) {
      budget = Math.min(budget * 2, MAX_BUDGET);
      continue;
    }
    return finalizeLLMJson(content, stripped, finishReason, jsonOnly, expectedTopLevel);
  }
}
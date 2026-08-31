// /lib/llm/route.ts — 浏览器侧 stage 路由(PR-3,与后端 src/llm_router.py 对齐)。
//
// 浏览器只关心 UI LLM 配置(settings.ts)。这里做 stage → (provider, model,
// temperature, isStream) 的轻量映射;后端 Actions 路由在 Python `src/llm_router.py`,
// 两者**不可互通**——本模块不依赖任何 SSR/Node 设施,纯前端缓存。
//
// 设计要点:
//   - 60s TTL 内存缓存(对齐 Polaris 60s / Python 60s)
//   - `provider` 不参与实际 HTTP 选端(settings.baseUrl 决定端点),
//     这里只是元数据,方便 caller 决定 thinking-disable / 流式等策略
//   - 不持有 fetch 副作用,与 chat.ts 完全解耦

import type { Route, RouteCacheEntry } from './types';

const ROUTE_CACHE_TTL_MS = 60_000; // ms

/** 浏览器侧 stage → (provider, model, temperature, isStream) 默认映射。
 *
 *  key 命名对齐后端 router(plan §4 — 8 个 stage):
 *    analyzer_system / analyzer_deepdive — paper-analyzer.ts
 *    topic_facet / topic_summary / topic_report / topic_cand / topic_explore
 *      — topic-search.ts */
const ROUTES: Record<string, Route> = {
  enrich: { provider: 'blt', model: 'gemini-3-flash-preview', temperature: 0.3 },
  analyzer_system: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
  analyzer_deepdive: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4, isStream: true },
  topic_facet: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4 },
  topic_summary: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 },
  topic_report: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.6, isStream: true },
  topic_cand: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 },
  topic_explore: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
  topic_chat: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4 },
  topic_report_chat: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4 },

  // ---- Polaris 文献库工作台 8 Tab 配套 stage (PR 阶段 1) ----
  // 编译 / 简报 / 对话:长输出,流式。
  // relevance / concept_def / figure / digest:JSON 结构化输出,非流式,温度偏低。
  library_compile: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4, isStream: true },
  library_relevance: { provider: 'deepseek', model: 'deepseek-reasoner', temperature: 0.2 },
  library_concept_def: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
  library_figure: { provider: 'deepseek', model: 'gemini-2.5-pro', temperature: 0.2 },
  library_digest: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 },
  library_digest_synth: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4, isStream: true },
  library_trend: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4, isStream: true },
  library_chat: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4, isStream: true },

  // 方法对比 (paper.method_debate)
  'paper.method_debate': { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },

  default: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
};

const _routeCache = new Map<string, RouteCacheEntry>();

/** 取一个 stage 的路由(带 60s 内存缓存)。 */
export function resolveRoute(stage: string): Route {
  const cached = _routeCache.get(stage);
  if (cached && Date.now() - cached.cachedAt < ROUTE_CACHE_TTL_MS) {
    return cached.route;
  }
  const route = ROUTES[stage] || ROUTES.default;
  _routeCache.set(stage, { route, cachedAt: Date.now() });
  return route;
}

/** 清空路由缓存。settings 改了之后调用。 */
export function invalidateRouteCache(): void {
  _routeCache.clear();
}
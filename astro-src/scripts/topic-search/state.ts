// topic-search 共享状态 holder —— 从 topic-search.ts 抽出（模块化重构 step 5）。
//
// 这是各 leaf 模块访问「当前会话 / 当前在飞 AbortController」的**统一入口**。
// 避免 leaf 直接 import orchestrator（会产生循环依赖）。
//
// 设计：state.ts 只定义 S 接口和占位 getter；orchestrator (../topic-search.ts) 在自己
// 的模块作用域内**实现**这些 getter（闭包持有真实的 current / inFlightController）。
// 这样 S 的契约先稳定下来，后续 leaf 步骤可以按统一模式写 S.getSession()，到 step 14
// 时再把真实 let 迁移到 state.ts 即可，leaf 调用方不需要再改。

import type { TopicSession } from '../../lib/schemas';

/** 当前会话 + 在飞控制器持有者的契约。orchestrator 在 init 时填充实现。 */
export interface State {
  /** 读当前会话（无会话时返回 null）。leaf 不应 mutate 返回的对象 —— 用 setSession。 */
  getSession(): TopicSession | null;
  /** 替换当前会话（通常搭配一次 persistSession 调用）。传 null 表示清空。 */
  setSession(s: TopicSession | null): void;
  /** 读当前在飞的 AbortController（无在飞时返回 null）。signal 给 fetch/LLM 调用。 */
  getInFlight(): AbortController | null;
  /** 写入当前在飞的 AbortController（启动新任务时由 leaf 创建、调用 setInFlight 存）。 */
  setInFlight(c: AbortController | null): void;
}

/** 默认未实现的 S — orchestrator 必须 init 时 setImplementation()。 */
export const S: State = {
  getSession: () => {
    throw new Error('[topic-search/state] S.getSession() called before orchestrator init');
  },
  setSession: () => {
    throw new Error('[topic-search/state] S.setSession() called before orchestrator init');
  },
  getInFlight: () => {
    throw new Error('[topic-search/state] S.getInFlight() called before orchestrator init');
  },
  setInFlight: () => {
    throw new Error('[topic-search/state] S.setInFlight() called before orchestrator init');
  },
};

/** orchestrator 调用此函数填充真实实现。step 14 时 real impl 会搬到 state.ts 自己。 */
export function setStateImplementation(impl: State): void {
  Object.assign(S, impl);
}
// /lib/events/bus.ts — 强类型的事件 emit / on API。
//
// 主要功能:
//   - 把 CustomEvent { detail: T } 包装成强类型函数,避免重复:
//     `new CustomEvent('dpr:xxx', { detail: {...} })`
//   - target 默认传 `document`;也可传 `window` / 任意 Element(局部事件)
//   - 让 UI 模块可以 `emitDprThemeChange({ theme: 'dark' })` 直接发,
//     不需要再拼字面量字符串。
//
// 兼容性:旧 `dpr-theme-change` / `dpr-topic-filter-change` / `daily-day-opened`
// (连字符、无前缀) 仍被旧代码监听。emit helper 同时 fire 新名 + legacy 名,
// 这样新代码可统一 `onDprThemeChange`,旧 listener 也能继续收到通知。
// 一旦所有 caller 切到 emit helper,移除 legacy aliases 即可,无需大改。
//
// 设计原则:
//   - 不维护内部订阅表,直接复用 `dispatchEvent / addEventListener`,
//     这样多次 dispatch 同一事件就有标准浏览器语义(bubbles / composed)
//   - 默认 target = document(全站广播场景最多);若需要 window 显式传
//     注意:Astro page 切换会 replace DOM,需要在 `astro:page-load` 重新订阅;
//     跨页面持久化事件(例如主题)用 `window`,局部 UI 状态用 `document` 即可。

import {
  DPR_THEME_CHANGE,
  DPR_THEME_CHANGE_LEGACY,
  DPR_TOPIC_FILTER_CHANGE,
  DPR_TOPIC_FILTER_CHANGE_LEGACY,
  DPR_DAILY_DAY_OPENED,
  DPR_DAILY_DAY_OPENED_LEGACY,
  PAPER_SELECTION_CHANGE,
  DPR_USER_LIBRARY_CHANGE,
  DPR_USER_LIBRARY_CHANGE_LEGACY,
} from './names';
import type {
  DprThemeChangeDetail,
  DprTopicFilterChangeDetail,
  DprDailyDayOpenedDetail,
  DprUserLibraryChangeDetail,
} from './types';

/** 通用 emit helper。target 默认 document。
 *  legacy?: 若提供,会再 emit 一个 legacy 字符串(给旧 listener 兜底)。
 *  在 type === 'theme' / 'topic-filter' / 'daily-day' 三种用得到。 */
function emit<T>(
  target: EventTarget,
  name: string,
  detail: T,
  legacyName?: string,
  init?: CustomEventInit,
): boolean {
  const opts: CustomEventInit = {
    detail,
    bubbles: init?.bubbles ?? false,
    composed: init?.composed ?? false,
    ...init,
  };
  if (legacyName) target.dispatchEvent(new CustomEvent(legacyName, opts));
  return target.dispatchEvent(new CustomEvent(name, opts));
}

/** 通用 on helper,返回 unsubscribe 函数。 */
function on<T>(
  target: EventTarget,
  name: string,
  handler: (detail: T) => void,
  init?: AddEventListenerOptions,
): () => void {
  const wrapped = (e: Event): void => {
    const ce = e as CustomEvent<T>;
    handler(ce.detail);
  };
  target.addEventListener(name, wrapped, init);
  return () => target.removeEventListener(name, wrapped, init);
}

// ---------------------------------------------------------------------------
// dpr:theme-change (legacy alias: dpr-theme-change)
// ---------------------------------------------------------------------------
export function emitDprThemeChange(
  target: EventTarget = document,
  detail: DprThemeChangeDetail,
): boolean {
  return emit(target, DPR_THEME_CHANGE, detail, DPR_THEME_CHANGE_LEGACY, { bubbles: true });
}
export function onDprThemeChange(
  target: EventTarget = document,
  handler: (detail: DprThemeChangeDetail) => void,
): () => void {
  return on(target, DPR_THEME_CHANGE, handler);
}

// ---------------------------------------------------------------------------
// dpr:topic-filter-change (legacy alias: dpr-topic-filter-change)
// ---------------------------------------------------------------------------
export function emitDprTopicFilterChange(
  target: EventTarget = document,
  detail: DprTopicFilterChangeDetail,
): boolean {
  return emit(target, DPR_TOPIC_FILTER_CHANGE, detail, DPR_TOPIC_FILTER_CHANGE_LEGACY, { bubbles: true });
}
export function onDprTopicFilterChange(
  target: EventTarget = document,
  handler: (detail: DprTopicFilterChangeDetail) => void,
): () => void {
  return on(target, DPR_TOPIC_FILTER_CHANGE, handler);
}

// ---------------------------------------------------------------------------
// dpr:daily-day-opened (legacy alias: daily-day-opened)
// ---------------------------------------------------------------------------
export function emitDprDailyDayOpened(
  target: EventTarget = window,
  detail: DprDailyDayOpenedDetail,
): boolean {
  return emit(target, DPR_DAILY_DAY_OPENED, detail, DPR_DAILY_DAY_OPENED_LEGACY, { bubbles: false });
}
export function onDprDailyDayOpened(
  target: EventTarget = window,
  handler: (detail: DprDailyDayOpenedDetail) => void,
): () => void {
  return on(target, DPR_DAILY_DAY_OPENED, handler);
}

// ---------------------------------------------------------------------------
// paper-selection-change
// ---------------------------------------------------------------------------
export function emitPaperSelectionChange(
  target: EventTarget = document,
): boolean {
  return emit(target, PAPER_SELECTION_CHANGE, undefined, undefined, { bubbles: true });
}
export function onPaperSelectionChange(
  target: EventTarget = document,
  handler: () => void,
): () => void {
  return on(target, PAPER_SELECTION_CHANGE, handler);
}

// ---------------------------------------------------------------------------
// dpr:user-library-change (legacy alias: dpr-user-library-change)
//
// 唯一合法 emit 方是 lib/user-library/store.ts 的私有写入漏斗。
// 其它模块只应该 on(...) 订阅 —— 见 names.ts 里关于单一 emit 源的说明。
// ---------------------------------------------------------------------------
export function emitDprUserLibraryChange(
  target: EventTarget = document,
  detail: DprUserLibraryChangeDetail,
): boolean {
  return emit(
    target,
    DPR_USER_LIBRARY_CHANGE,
    detail,
    DPR_USER_LIBRARY_CHANGE_LEGACY,
    { bubbles: true },
  );
}
export function onDprUserLibraryChange(
  target: EventTarget = document,
  handler: (detail: DprUserLibraryChangeDetail) => void,
): () => void {
  return on(target, DPR_USER_LIBRARY_CHANGE, handler);
}
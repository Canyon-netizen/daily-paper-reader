// 主题筛选桥 — index.astro(每行"只在日历看"按钮)与 DailyCalendar.astro
// (头部 chip)共用单一事件通道,避免双向 dispatch 循环。
//
// 用法:
//   import { setTopicFilter, onTopicFilterChange } from './topic-filter-bridge';
//   setTopicFilter('rl');           // 切到强化学习;同时写 #topic=rl + dispatch
//   setTopicFilter(null);            // 清除;同时清 #topic= + dispatch
//   setTopicFilter('mas', { silent: true });  // 只更新 chip active,不重 dispatch
//
//   onTopicFilterChange((key) => { ... });    // 订阅
//
// Hash 格式:同现有 #day=YYYY-MM-DD 共存('#topic=rl&day=2026-07-13')。

export const TOPIC_FILTER_EVENT = 'dpr-topic-filter-change';

export type TopicFilterHandler = (key: string | null) => void;

interface SetOptions {
  /** true = 不重 dispatch(用于接收方反向更新 UI)。默认 false。 */
  silent?: boolean;
  /** true = 不写 hash。默认 false。 */
  noHash?: boolean;
}

function readHash(): { topic: string | null; day: string | null } {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { topic: null, day: null };
  const parts = raw.split('&').filter(Boolean);
  let topic: string | null = null;
  let day: string | null = null;
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    const v = decodeURIComponent(rest.join('='));
    if (k === 'topic') topic = v || null;
    else if (k === 'day') day = v || null;
  }
  return { topic, day };
}

function writeHash(topic: string | null, day: string | null): void {
  const parts: string[] = [];
  if (topic) parts.push('topic=' + encodeURIComponent(topic));
  if (day) parts.push('day=' + day);
  const nextHash = parts.length ? '#' + parts.join('&') : '';
  const { pathname, search } = window.location;
  const target = nextHash ? pathname + search + nextHash : pathname + (search || '');
  if (window.location.href.endsWith(nextHash) || window.location.hash === nextHash) return;
  history.replaceState(null, '', target);
}

/**
 * 设置主题筛选。默认会:
 *   1) 写 hash(保留既有 #day=)
 *   2) dispatch TOPIC_FILTER_EVENT,detail = { topic }
 */
export function setTopicFilter(
  key: string | null,
  opts: SetOptions = {},
): void {
  const cur = readHash();
  const nextDay = cur.day;
  if (!opts.noHash) writeHash(key, nextDay);
  if (opts.silent) return;
  document.dispatchEvent(
    new CustomEvent(TOPIC_FILTER_EVENT, { detail: { topic: key } }),
  );
}

/** 与 setTopicFilter 同义,但 same key = toggle 关闭。 */
export function toggleTopicFilter(key: string, opts: SetOptions = {}): void {
  const cur = readHash().topic;
  setTopicFilter(cur === key ? null : key, opts);
}

/** 订阅事件,返回取消订阅函数。 */
export function onTopicFilterChange(handler: TopicFilterHandler): () => void {
  const wrapped: EventListener = (e) => {
    const ev = e as CustomEvent<{ topic: string | null }>;
    handler(ev.detail?.topic ?? null);
  };
  document.addEventListener(TOPIC_FILTER_EVENT, wrapped);
  return () => document.removeEventListener(TOPIC_FILTER_EVENT, wrapped);
}

/** 读当前 hash 中的 topic 段(只读,不 dispatch)。 */
export function readCurrentTopic(): string | null {
  return readHash().topic;
}

/** 读当前 hash 中的 day 段(只读)。 */
export function readCurrentDay(): string | null {
  return readHash().day;
}

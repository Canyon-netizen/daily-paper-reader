// /scripts/paper-library-filter-bridge.ts — 工作台筛选 ↔ URL hash 桥(Stage 10)。
//
// 关键设计:
//   - 筛选状态编进 URL hash(不写 query),方便分享与刷新复原;
//     hash 不会触发 SSR / 不会污染 CI 缓存。
//   - hash 编码:用 btoa(JSON.stringify(...)) 把整个 LibraryFilterOptions 对象
//     打包成一个段('#f=<base64>');多用户筛选不会与既有 #topic / #day 撞车
//     (那两个是 topic-filter-bridge 管的)。
//   - 解码失败 / 不存在 / 字段类型错 → 视为无筛选(不 throw)。
//   - emit 走 DPR_BULK_SELECTION_CHANGE 不合适 —— 那是批量选择的事件。
//     这里直接用 hashchange / popstate + DOM 自定义 dispatch:
//
//     const CHANGE = 'paper-library-filter-change'; // detail = LibraryFilterOptions
//
//     命名刻意避开 dpr: 前缀,因为 filter 状态完全本地 + 不会跨 tab 同步
//     (重新打开 tab 就是空筛选;筛选是会话级状态)。
//   - 应用流程:Page load → readLibraryFilters() → applyLibraryFilters → render;
//     任何 filter 变化 → writeLibraryFilters() → history.replaceState →
//     dispatchEvent → 列表重渲染。
//
// 复用:只复用 topic-filter-bridge 的 hash 编解码"风格",不 import 它(避免
// 一对桥互相依赖)。

import type {
  LibraryFilterOptions,
} from '../lib/paper-filter';
import type { ReadingStatus } from '../lib/user-library';

const CHANGE = 'paper-library-filter-change';

/** 自定义事件 detail。 */
export interface LibraryFilterChangeDetail {
  opts: LibraryFilterOptions;
}

/** 内部 hash 段 key,与 topic-filter-bridge 的 #topic= / #day= 不冲突。 */
const HASH_KEY = 'f';

function target(): EventTarget {
  if (typeof document !== 'undefined') return document;
  if (typeof window !== 'undefined') return window;
  return { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as EventTarget;
}

/** 把 opts 编码成可放进 hash 的紧凑形式。
 *  未启用字段**不写入**,减少 base64 体积。 */
function encode(opts: LibraryFilterOptions): string {
  const compact: Record<string, unknown> = {};
  if (opts.author) compact.a = opts.author;
  if (opts.venue) compact.v = opts.venue;
  if (opts.yearRange) compact.y = opts.yearRange;
  if (opts.starred) compact.s = 1;
  if (opts.readingStatus && opts.readingStatus !== 'unread') compact.r = opts.readingStatus;
  if (opts.hasNote) compact.n = 1;
  if (opts.userTag) compact.u = opts.userTag;
  if (Object.keys(compact).length === 0) return '';
  const json = JSON.stringify(compact);
  // btoa 需要字符串输入,中文走 encodeURIComponent 兜底防 Latin1 异常。
  const safe = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(json)))
    : '';
  return safe;
}

/** 解码。失败 / 空 → 空 opts(等于无筛选)。 */
function decode(raw: string): LibraryFilterOptions {
  if (!raw) return {};
  try {
    const json = typeof atob === 'function'
      ? decodeURIComponent(escape(atob(raw)))
      : '';
    const obj = JSON.parse(json) as Record<string, unknown>;
    return normalize(obj);
  } catch {
    return {};
  }
}

/** 把未知对象规整为 LibraryFilterOptions,字段类型错就丢弃该字段(白名单)。 */
function normalize(obj: Record<string, unknown>): LibraryFilterOptions {
  const out: LibraryFilterOptions = {};
  if (typeof obj.a === 'string') out.author = obj.a;
  if (typeof obj.v === 'string') out.venue = obj.v;
  if (obj.y && typeof obj.y === 'object') {
    const y = obj.y as Record<string, unknown>;
    const from = typeof y.from === 'number' ? y.from : undefined;
    const to = typeof y.to === 'number' ? y.to : undefined;
    if (from !== undefined || to !== undefined) {
      out.yearRange = { from, to };
    }
  }
  if (obj.s === 1 || obj.s === true) out.starred = true;
  if (typeof obj.r === 'string') {
    const r = obj.r;
    if (r === 'unread' || r === 'reading' || r === 'read') {
      out.readingStatus = r as ReadingStatus;
    }
  }
  if (obj.n === 1 || obj.n === true) out.hasNote = true;
  if (obj.u && typeof obj.u === 'object') {
    const u = obj.u as Record<string, unknown>;
    if (typeof u.kind === 'string' && typeof u.label === 'string') {
      out.userTag = { kind: u.kind, label: u.label };
    }
  }
  return out;
}

/** 从当前 window.location.hash 解析 f= 段,转成 LibraryFilterOptions。 */
export function readLibraryFilters(): LibraryFilterOptions {
  if (typeof window === 'undefined') return {};
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return {};
  for (const part of raw.split('&')) {
    const [k, ...rest] = part.split('=');
    if (k === HASH_KEY) return decode(rest.join('='));
  }
  return {};
}

/** 写筛选到 hash(不影响 #topic / #day 等其它段),然后 dispatch 事件。 */
export function writeLibraryFilters(opts: LibraryFilterOptions): void {
  if (typeof window === 'undefined') return;
  const encoded = encode(opts);
  const raw = window.location.hash.replace(/^#/, '');
  const parts = raw ? raw.split('&').filter((p) => !p.startsWith(`${HASH_KEY}=`)) : [];
  if (encoded) parts.push(`${HASH_KEY}=${encoded}`);
  const nextHash = parts.length ? '#' + parts.join('&') : '';
  const { pathname, search } = window.location;
  const targetUrl = nextHash ? pathname + search + nextHash : pathname + (search || '');
  if (window.location.hash === nextHash && window.location.pathname === pathname) {
    // 没变化也 dispatch,因为 caller 可能 in-place 改了 opts 字段值(罕见但可能)
  } else {
    history.replaceState(null, '', targetUrl);
  }
  target().dispatchEvent(new CustomEvent(CHANGE, { detail: { opts } }));
}

/** 订阅筛选变化(页面 mount 时挂一次)。返回 unsubscribe。 */
export function onLibraryFilterChange(
  handler: (detail: LibraryFilterChangeDetail) => void,
): () => void {
  const t = target();
  const wrapped = (e: Event): void => {
    const ce = e as CustomEvent<LibraryFilterChangeDetail>;
    handler(ce.detail);
  };
  t.addEventListener(CHANGE, wrapped);
  // hashchange 也触发(用户手改 URL 或浏览器前进/后退)
  const onHash = (): void => {
    handler({ opts: readLibraryFilters() });
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', onHash);
    return () => {
      t.removeEventListener(CHANGE, wrapped);
      window.removeEventListener('hashchange', onHash);
    };
  }
  return () => {
    t.removeEventListener(CHANGE, wrapped);
  };
}

/** 把 opts 序列化成可分享的 URL(纯函数,用于"复制筛选链接"按钮)。 */
export function buildFilterShareUrl(base: string, opts: LibraryFilterOptions): string {
  const enc = encode(opts);
  if (!enc) return base;
  const sep = base.indexOf('#') >= 0 ? '&' : '#';
  return `${base}${sep}${HASH_KEY}=${enc}`;
}
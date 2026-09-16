// astro-src/lib/search/cache.ts
//
// R7 H.1.3: 客户端搜索结果缓存(query → SearchResult,5 分钟 TTL)。
//
// 设计要点:
//   - key 是规范化后的 query(trim + lowercase),避免同一查询大小写不同 cache miss
//   - TTL 默认 5 分钟,过期自动清
//   - 弱引用 WeakMap 不行(键是 string),直接用 Map + 手动清理
//   - 超过 maxEntries 时按 LRU 淘汰(插入序)
//
// 用法(在调用 searchPapers 前/后包一层):
//   import { getCachedSearchResult, setCachedSearchResult } from './cache';
//   const cached = getCachedSearchResult(query);
//   if (cached) return cached;
//   const result = await searchPapers(query);
//   setCachedSearchResult(query, result);

import type { SearchResult } from './types';

export interface SearchCacheEntry {
  result: SearchResult;
  /** 缓存写入时刻(epoch ms) */
  ts: number;
  /** 用于调试的 query(只显示用,key 用规范化的) */
  displayQuery: string;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;       // 5 分钟
const DEFAULT_MAX_ENTRIES = 64;             // 防止大搜索场景下内存膨胀

const cache = new Map<string, SearchCacheEntry>();

function normalizeKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 取缓存:命中且未过期 → 返回 SearchResult;否则 null。 */
export function getCachedSearchResult(
  query: string,
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): SearchResult | null {
  const key = normalizeKey(query);
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.ts > ttlMs) {
    cache.delete(key);
    return null;
  }
  // LRU bump:重新插入以刷新"最近使用"
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

/** 写缓存。命中 maxEntries 时淘汰最老。 */
export function setCachedSearchResult(
  query: string,
  result: SearchResult,
  now: number = Date.now(),
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): void {
  const key = normalizeKey(query);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { result, ts: now, displayQuery: query.trim() });
  // 超过上限淘汰最早插入
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 清空缓存(测试 / 强制 reload 用)。 */
export function clearSearchCache(): void {
  cache.clear();
}

/** 当前缓存大小(只读)。 */
export function searchCacheSize(): number {
  return cache.size;
}

/** 过期清理(给空闲时调用)。返回清理掉的条数。 */
export function purgeExpiredSearchCache(
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): number {
  let removed = 0;
  for (const [k, v] of cache) {
    if (now - v.ts > ttlMs) {
      cache.delete(k);
      removed++;
    }
  }
  return removed;
}

/** 分页辅助:把 hits 切成 top-N + offset-N 增量。
 *  用于"前 50 条先展示,滚动加载更多"模式。 */
export function paginateHits(
  result: SearchResult,
  page: number = 1,
  pageSize: number = 50,
): { items: typeof result.hits; hasMore: boolean; total: number } {
  const start = (Math.max(1, page) - 1) * pageSize;
  const items = result.hits.slice(start, start + pageSize);
  return {
    items,
    hasMore: start + pageSize < result.hits.length,
    total: result.hits.length,
  };
}
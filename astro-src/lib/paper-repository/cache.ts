// /lib/paper-repository/cache.ts — 进程内 list / read 缓存层。
//
// 缓存粒度:
//   - list 缓存 key = JSON.stringify({ ...opts, base, repoBase }),hash 后字符串。
//     同一进程同一组合的 list options 命中。
//   - read 缓存 key = paper id(strings)。命中回收 readPaper 的 I/O。
//
// TTL:默认 60 秒,PTTL 过了立刻 re-scan。SSR build 期 + dev 启动期都比较短,
// 60s 既能命中同一个 page 上多次 list 的重复,也不会让生产的长跑 dev server
// 拿到陈旧 paper(数据是 GitHub Actions 每日 commit 重写的)。
//
// 只做进程内缓存,不做持久化(持久化会让 build 之间互串,SSR 阶段反而危险)。

import type { CacheEntry } from './types';

export class TtlCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.cachedAt > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V): void {
    this.map.set(key, { value, cachedAt: Date.now() });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

/** 简易 FNV-1a 32-bit hash,把任意结构化 key 收敛到 8-char 字符串。 */
export function hashOptions(opts: unknown): string {
  const s = JSON.stringify(opts);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
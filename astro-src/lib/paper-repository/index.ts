// /lib/paper-repository/index.ts — PaperRepository 工厂与公开 API barrel。
//
// 设计原则(高内聚 / 低耦合):
//   - 仓库本身是**无副作用**的状态对象(只持有缓存 + 计数器),
//     真正的 I/O 仍走 lib/paper 的 listPapers / readPaper,保证单一事实。
//   - 缓存 key 算法来自 ./cache,业务逻辑来自 ./stats。
//   - 不在内部直接 import 其它 lib/*(避免循环),只 type-import 需要的数据形状。
//   - 公开工厂 `createPaperRepository(opts?)` 让 caller 决定要不要开缓存。
//
// 不动 lib/paper:这是新增路径,不是替换。老 caller 不受影响。

import {
  listPapers,
  readPaper as readPaperLib,
  resolveTaskKey,
  type PaperListItem,
  type Paper,
  type ListOptions,
} from '../paper';
import type {
  PaperRepository as PaperRepositoryI,
  PaperRepositoryOptions,
  RepositoryStats,
} from './types';
import { TtlCache, hashOptions } from './cache';

const DEFAULT_TTL_MS = 60_000;

/** 构造一个 PaperRepository 实例。
 *  - 单进程单实例即可(状态都封在闭包里);多个 page 共享 import 的同一对象就行
 *  - SSR build 阶段每 build 全新进程,缓存自动作废;dev 启动一次持续运行 */
export function createPaperRepository(
  options: PaperRepositoryOptions = {},
): PaperRepositoryI {
  const ttlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
  const repoBase = options.base ?? '/';
  const enableCache = options.enableCache ?? false;

  const listCache = new TtlCache<PaperListItem[]>(ttlMs);
  const readCache = new TtlCache<Paper | null>(ttlMs);
  const stats: RepositoryStats = {
    scannedPapers: 0,
    dedupPasses: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  /** 合并 list options:repoBase 当默认 base。 */
  function mergeOpts(opts: ListOptions): ListOptions {
    return { ...opts, base: opts.base ?? repoBase };
  }

  /** 用一个稳定 hash 作为缓存 key,把"为了拼 thumb URL 的 base"也吃进去,否则
   *  不同 base 下同一组 options 应该缓存命中(只是 thumb URL 不同),会渲错 base 的图。 */
  async function list(opts: ListOptions = {}): Promise<PaperListItem[]> {
    const merged = mergeOpts(opts);
    const key = enableCache ? hashOptions(merged) : '';
    if (enableCache) {
      const hit = listCache.get(key);
      if (hit) {
        stats.cacheHits++;
        return hit;
      }
      stats.cacheMisses++;
    }

    const result = await listPapers(merged);
    stats.scannedPapers += result.length;
    if (merged.dedup !== false) stats.dedupPasses += 1;

    if (enableCache) listCache.set(key, result);
    return result;
  }

  /** listAll — 全量全集,等于 listPapers({}) 但语义清晰。 */
  async function listAll(): Promise<PaperListItem[]> {
    return list({ dedup: true });
  }

  async function read(id: string): Promise<Paper | null> {
    if (enableCache) {
      const hit = readCache.get(id);
      if (hit !== undefined) {
        stats.cacheHits++;
        return hit;
      }
      stats.cacheMisses++;
    }
    const result = await readPaperLib(id);
    if (enableCache) readCache.set(id, result);
    return result;
  }

  /** 按 task 维度桶分,统一首页 / papers 库主题视图的桶定义。 */
  async function groupByTask(): Promise<Map<string, PaperListItem[]>> {
    const all = await list({ sortBy: 'score' });
    const byTag = new Map<string, PaperListItem[]>();
    for (const p of all) {
      const key = resolveTaskKey(p);
      if (!byTag.has(key)) byTag.set(key, []);
      byTag.get(key)!.push(p);
    }
    return byTag;
  }

  function getStats(): RepositoryStats {
    return { ...stats };
  }

  function invalidate(): void {
    listCache.clear();
    readCache.clear();
  }

  return {
    list,
    listAll,
    read,
    groupByTask,
    stats: getStats,
    invalidate,
  };
}

/** 进程内默认实例:关闭缓存,行为与 lib/paper 直接调等价。
 *  用于 caller 想用 repository 签名但不在乎缓存(debug / SSR build 临时)。 */
export const defaultPaperRepository: PaperRepositoryI = createPaperRepository();

/** 让外部 caller 在已经有 instance 的场景下,可以用 `fromCacheKey(...)` 检查命中率。 */
export { TtlCache, hashOptions } from './cache';
export type {
  PaperRepository,
  PaperRepositoryOptions,
  RepositoryStats,
} from './types';
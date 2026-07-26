// /lib/paper-repository/types.ts — PaperRepository 公开 DTO。
//
// 设计目标:为 page frontmatter 阶段(audit / settings / 未来 feature)提供一个
// 有进/出策略 + 可观察缓存 + 订阅通知的统一入口,而不是每个 caller 自己
// `await listPapers(...)` 重扫一遍磁盘。
//
// 与现有 lib/paper 的关系:
//   - lib/paper.ts(686 行)继续存在,所有老 caller 不动 — 老路径仍然是事实标准
//   - PaperRepository 走 lib/paper 的 listPapers + readPaper,而非另起炉灶读盘,
//     保证同源(SRR 单一事实)

import type { PaperListItem, Paper } from '../paper';
import type { ListOptions } from '../paper';
import type {
  RepositoryChangeReason,
  Subscriber,
} from './subscription';

/** 仓库一次"会话"内可观察的统计。 */
export interface RepositoryStats {
  /** 本会话内已扫描的 paper 数(不区分 dedup) */
  scannedPapers: number;
  /** 本会话内已 dedup 的次数(dedupByCanonicalArxivId 调用) */
  dedupPasses: number;
  /** 本会话内命中缓存的 listPapers 调用次数 */
  cacheHits: number;
  /** 本会话内穿透(走真实 I/O)的 listPapers 调用次数 */
  cacheMisses: number;
  /** 本会话内已广播的 notifyChange 次数 */
  notifyFires: number;
  /** 当前活跃订阅数 */
  subscriberCount: number;
}

/** 仓库构造参数。 */
export interface PaperRepositoryOptions {
  /** 全局默认 base(部署子路径);在 listPaper 调用没传 base 时兜底。 */
  base?: string;
  /**
   * 同一进程内同一组 list options 是否复用结果。
   * - false(默认):每次调用都 re-scan 盘,跟 listPapers 当前行为一致,适合 debug
   * - true:对相同 key 命中复用,大幅减少多次 listPapers 的 I/O 成本
   * 缓存键 = JSON.stringify({ ...opts, base, repoBase })。读 / 写盘数据有 TTL = 60s。
   */
  enableCache?: boolean;
  /** TTL 毫秒。默认 60_000。 */
  cacheTtlMs?: number;
}

/** Repository 公开 method 签名集合。
 *
 *  - list(opts):等同于 lib/paper.listPapers() 但带缓存
 *  - listAll():等同于 listPapers() 全量全集
 *  - read(id):等同于 lib/paper.readPaper() 但带缓存
 *  - groupByTask():按 task 维度桶分
 *  - stats():观察仓库本身的性能指标
 *  - invalidate():强制下一次 list() 重读盘
 *  - subscribe(reason, handler):订阅一个 reason(Phase H)
 *  - notifyChange(reason):广播 reason + invalidate cache(Phase H)
 */
export interface PaperRepository {
  list(opts?: ListOptions): Promise<PaperListItem[]>;
  listAll(): Promise<PaperListItem[]>;
  read(id: string): Promise<Paper | null>;
  groupByTask(): Promise<Map<string, PaperListItem[]>>;
  stats(): RepositoryStats;
  invalidate(): void;
  subscribe(handler: Subscriber): () => void;
  notifyChange(reason: RepositoryChangeReason): void;
}

/** 缓存条目:key = JSON.stringify(options),value = 命中时刻 + 结果。 */
export interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

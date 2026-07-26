// astro-src/lib/paper-filter.ts
// 论文列表的过滤 / 排序 / 投影逻辑 —— 从 paper.ts 的 listPapers 抽出,
// 让 listPapers 只负责"读盘 + 拼图 + 调用 pipeline"这一层,
// 业务规则(过滤 / 排序 / 限条)集中在此,便于单元测试与多 entry-point 复用。
//
// 关键不变式:
//   - 这是纯函数模块,不持有任何外部状态;
//   - 输入是 ProjectItem 数组,输出是 ProjectItem 数组;
//   - dedup 由 ./arxiv 提供,集中配置,避免散落实现。

import type { PaperListItem } from './paper';
import { flattenCategories } from './paper';
import { dedupByCanonicalArxivId } from './arxiv';

export type SortBy = 'date' | 'score';
export type SortOrder = 'asc' | 'desc';

/** 论文过滤选项。listPapers 的 ListOptions 是它的超集
 *  (多了 base / skipBroken 等 I/O 字段),这里只放纯数据规则。 */
export interface PaperFilterOptions {
  /** 单个 'dim:label' token 或 group key (e.g. 'task:rl' 或 'rl')。 */
  tag?: string;
  /** 标题 / 中文标题 / tldr 子串命中(lower-case)。 */
  search?: string;
  /** 只看最近 N 天的论文(按 frontmatter date)。N <= 0 时不过滤。 */
  sinceDays?: number;
  /** 默认 true:同 arXiv canonical id 只保留最高 v#。 */
  dedup?: boolean;
  /** 排序键(date 倒序 / score 倒序)。 */
  sortBy?: SortBy;
  /** 升降序。默认 'desc'。 */
  sortOrder?: SortOrder;
  /** 截断前 N 条。 */
  limit?: number;
}

/** 按 tag filter —— 兼容 "task:rl" 与 "rl" 两种 label 写法。 */
export function filterByTag(items: PaperListItem[], tag: string): PaperListItem[] {
  if (!tag) return items;
  return items.filter((p) => flattenCategories(p.categories).some(
    (t) => t === tag || t.endsWith(`:${tag}`),
  ));
}

/** 按关键词搜索:title / title_zh / tldr 任一字段包含(大小写不敏感)。 */
export function filterBySearch(items: PaperListItem[], search: string): PaperListItem[] {
  if (!search) return items;
  const q = search.toLowerCase();
  return items.filter((p) =>
    (p.title || '').toLowerCase().includes(q) ||
    (p.title_zh || '').toLowerCase().includes(q) ||
    (p.tldr || '').toLowerCase().includes(q),
  );
}

/** 按时间窗口过滤 —— 失败(parse 错/缺 date)直接被淘汰。 */
export function filterBySinceDays(items: PaperListItem[], sinceDays: number): PaperListItem[] {
  if (typeof sinceDays !== 'number' || sinceDays <= 0) return items;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return items.filter((p) => {
    if (!p.date) return false;
    const t = new Date(p.date).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

/** 按 sortBy / sortOrder 排序,可选 limit。limit <= 0 表示不截断。 */
export function sortAndLimit(
  items: PaperListItem[],
  sortBy: SortBy,
  sortOrder: SortOrder = 'desc',
  limit?: number,
): PaperListItem[] {
  const copy = items.slice();
  copy.sort((a, b) => {
    let av = 0, bv = 0;
    if (sortBy === 'date') {
      av = a.date ? new Date(a.date).getTime() : 0;
      bv = b.date ? new Date(b.date).getTime() : 0;
    } else if (sortBy === 'score') {
      av = a.score || 0;
      bv = b.score || 0;
    }
    return sortOrder === 'asc' ? av - bv : bv - av;
  });
  return limit && limit > 0 ? copy.slice(0, limit) : copy;
}

/**
 * 完整列表过滤+排序 pipeline。listPapers 把 options 映射成本函数的参数。
 *
 * @param items   已经从盘读出来的全集
 * @param opts    过滤 / 排序 / 限条
 */
export function applyPaperFilters(
  items: PaperListItem[],
  opts: PaperFilterOptions,
): PaperListItem[] {
  let filtered = items;
  if (opts.tag) filtered = filterByTag(filtered, opts.tag);
  if (opts.search) filtered = filterBySearch(filtered, opts.search);
  if (typeof opts.sinceDays === 'number') filtered = filterBySinceDays(filtered, opts.sinceDays);
  if (opts.dedup !== false) filtered = dedupByCanonicalArxivId(filtered);

  const sorted = sortAndLimit(
    filtered,
    opts.sortBy ?? 'date',
    opts.sortOrder ?? 'desc',
    opts.limit,
  );

  // 兜底:sinceDays 严过滤导致不足 limit 条时,从源池补齐。
  // 用原始 items + 同样的 dedup / sort / limit 规则重排一次。
  if (
    typeof opts.sinceDays === 'number'
    && opts.sinceDays > 0
    && opts.limit
    && sorted.length < opts.limit
  ) {
    const base = opts.dedup !== false ? dedupByCanonicalArxivId(items) : items;
    return sortAndLimit(base, opts.sortBy ?? 'date', opts.sortOrder ?? 'desc', opts.limit);
  }
  return sorted;
}
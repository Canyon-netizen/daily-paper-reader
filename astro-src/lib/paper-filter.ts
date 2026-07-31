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
import type { ReadingStatus, UserLibrarySnapshot } from './user-library';

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
  /** BM25 + 笔记命中给出的 rankedId 顺序(canonicalArxivId);
   *  提供时覆盖 sortBy/sortOrder,未命中项按 fallback 排到末尾。
   *  Stage 5:接 lib/search/index.ts 的 SearchResult.hits,见 applyPaperFilters / applyRankedOrder。 */
  rankedIds?: readonly string[];
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
  // substring 通道:当 opts.rankedIds 未设 或 opts.search 为非空字符串时跑
  // (BM25 命中 + 笔记命中时 rankedIds 接管排序,不再走 stringy contains)。
  if (opts.search && !opts.rankedIds) filtered = filterBySearch(filtered, opts.search);
  if (typeof opts.sinceDays === 'number') filtered = filterBySinceDays(filtered, opts.sinceDays);
  if (opts.dedup !== false) filtered = dedupByCanonicalArxivId(filtered);

  let sorted = filtered;
  if (opts.rankedIds && opts.rankedIds.length > 0) {
    sorted = applyRankedOrder(sorted, opts.rankedIds);
  } else {
    sorted = sortAndLimit(
      sorted,
      opts.sortBy ?? 'date',
      opts.sortOrder ?? 'desc',
      opts.limit,
    );
  }

  // 兜底:sinceDays 严过滤导致不足 limit 条时,从源池补齐。
  if (
    typeof opts.sinceDays === 'number'
    && opts.sinceDays > 0
    && opts.limit
    && sorted.length < opts.limit
  ) {
    const base = opts.dedup !== false ? dedupByCanonicalArxivId(items) : items;
    if (opts.rankedIds && opts.rankedIds.length > 0) {
      return applyRankedOrder(base, opts.rankedIds);
    }
    return sortAndLimit(base, opts.sortBy ?? 'date', opts.sortOrder ?? 'desc', opts.limit);
  }
  return sorted;
}

/**
 * 按 rankedIds 顺序输出命中项;未在 rankedIds 中出现的项 append 到末尾,
 * 保留原有的 sortBy/sortOrder 兜底。
 *
 * 入参 rankedIds 是 canonicalArxivId[];PaperListItem.canonicalArxivId 是
 * 同一字段,所以直接比对(不去 vN)。
 *
 * @param items    已过滤后的列表
 * @param rankedIds 按命中顺序排列的 canonicalId;不在 rankedIds 的项按 fallback 排
 * @param fallback 可选:兜底排序函数,默认按 date desc;传 ()=>0 = 保留原序
 */
export function applyRankedOrder(
  items: PaperListItem[],
  rankedIds: readonly string[],
  fallback?: (a: PaperListItem, b: PaperListItem) => number,
): PaperListItem[] {
  if (!rankedIds.length) return items;
  const ids = new Set(rankedIds);
  const rank = new Map<string, number>();
  for (let i = 0; i < rankedIds.length; i++) rank.set(rankedIds[i], i);
  const fb = fallback || ((a, b) => {
    const av = a.date ? new Date(a.date).getTime() : 0;
    const bv = b.date ? new Date(b.date).getTime() : 0;
    return bv - av;
  });
  return items.slice().sort((a, b) => {
    const aHit = ids.has(a.canonicalArxivId);
    const bHit = ids.has(b.canonicalArxivId);
    if (aHit && !bHit) return -1;
    if (!aHit && bHit) return 1;
    if (aHit && bHit) {
      const ai = rank.get(a.canonicalArxivId) ?? 0;
      const bi = rank.get(b.canonicalArxivId) ?? 0;
      return ai - bi;
    }
    return fb(a, b);
  });
}

// ===========================================================================
// Stage 10 — 工作台筛选层(用户态)
// ---------------------------------------------------------------------------
// 关键设计:
//   - 本模块是**纯函数**——不 import localStorage,不 emit 事件。
//     状态(星标 / 阅读状态 / 笔记 / 回收站 / 标签)以 UserLibrarySnapshot 形式
//     由 caller 注入。这样 SSR / 单测 / 浏览器三处可以共用同一份筛选逻辑,
//     也避免 lib → scripts 反向依赖。
//   - applyLibraryFilters 是**独立**入口,不是 applyPaperFilters 的第三个
//     可选位参。理由:缺 lib 时应编译期可见,且工作台筛选和"列表 SSR 管线"
//     是两套心智模型(后者关心 tag / sinceDays / sort,前者关心 starred /
//     hasNote / userTag),合在一起会让签名越来越宽。
//
// 谓词列表(7 个):
//   - filterByAuthor     按 authors 子串
//   - filterByVenue      按 categories.venue 精确匹配
//   - filterByYearRange  按 frontmatter.date 的 [from, to] 年份区间,空 date 跳过
//   - filterByStarred    snapshot.starred 命中
//   - filterByReadingStatus  snapshot.status 命中
//   - filterByHasNote    notes 长度 > 0(用 Map.has 判定)
//   - filterByUserTag    snapshot.userTags 命中 (kind,label)
// ===========================================================================

/** 按作者名(子串匹配,大小写不敏感;空 name 视为不过滤)。 */
export function filterByAuthor(items: PaperListItem[], name: string): PaperListItem[] {
  const q = (name || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((p) => (p.authors || '').toLowerCase().includes(q));
}

/** 按会议 venue 精确匹配(p.categories.venue)。
 *  空 venue 视为不过滤;candidate venue 含空格(ICML 2025)按原样比对,
 *  不做模糊 —— 避免 "ICML" 命中 "ICML 2025"。 */
export function filterByVenue(items: PaperListItem[], venue: string): PaperListItem[] {
  const v = (venue || '').trim();
  if (!v) return items;
  return items.filter((p) => {
    const venues = p.categories?.venue || [];
    return venues.includes(v);
  });
}

/** 按年份区间过滤 —— 论文 frontmatter.date(YYYY-MM-DD)取年份。
 *  没有 date 的论文**直接跳过**(语义同 filterBySinceDays 的"失败 parse
 *  直接淘汰"),保证区间收窄时不会出现幽灵条目。
 *  from/to 任一为空视为该边不设限。 */
export function filterByYearRange(
  items: PaperListItem[],
  range: { from?: number; to?: number },
): PaperListItem[] {
  const from = typeof range.from === 'number' ? range.from : null;
  const to = typeof range.to === 'number' ? range.to : null;
  if (from === null && to === null) return items;
  return items.filter((p) => {
    if (!p.date) return false;
    const y = Number(p.date.slice(0, 4));
    if (!Number.isFinite(y)) return false;
    if (from !== null && y < from) return false;
    if (to !== null && y > to) return false;
    return true;
  });
}

/** 星标筛选 —— 用 snapshot.starred。
 *  不传 starredSet 或快照为空,等于"不过滤"(0 选 = 全部)。 */
export function filterByStarred(
  items: PaperListItem[],
  snapshot: UserLibrarySnapshot,
): PaperListItem[] {
  if (snapshot.starred.size === 0) return items;
  return items.filter((p) => p.canonicalArxivId && snapshot.starred.has(p.canonicalArxivId));
}

/** 按阅读状态过滤 —— status === 'unread' 是默认,不在 snapshot.status Map 里;
 *  传 'unread' + 空 snapshot.status → 不过滤,等同"未设限"。 */
export function filterByReadingStatus(
  items: PaperListItem[],
  status: ReadingStatus,
  snapshot: UserLibrarySnapshot,
): PaperListItem[] {
  if (status === 'unread' && snapshot.status.size === 0) return items;
  return items.filter((p) => {
    const id = p.canonicalArxivId;
    if (!id) return status === 'unread';
    return (snapshot.status.get(id) || 'unread') === status;
  });
}

/** "有笔记"筛选 —— 用 snapshot.notes 里**长度 > 0**的条目做判定。
 *  这里**不**判 Map.has 的"值是否为空串":store 只把 length>0 的 note 写进
 *  snapshot,所以 .has() 与 .get()!==undefined 等价;但 .has() 语义更直白。 */
export function filterByHasNote(
  items: PaperListItem[],
  snapshot: UserLibrarySnapshot,
): PaperListItem[] {
  if (snapshot.notes.size === 0) return items;
  return items.filter((p) => p.canonicalArxivId && snapshot.notes.has(p.canonicalArxivId));
}

/** 按用户标签筛选 —— kind + label 都须匹配(同 user-library snapshot 形态)。 */
export function filterByUserTag(
  items: PaperListItem[],
  kind: string,
  label: string,
  snapshot: UserLibrarySnapshot,
): PaperListItem[] {
  const k = (kind || '').trim();
  const l = (label || '').trim();
  if (!k || !l) return items;
  return items.filter((p) => {
    const id = p.canonicalArxivId;
    if (!id) return false;
    const tags = snapshot.userTags.get(id);
    if (!tags) return false;
    return tags.some((t) => t.kind === k && t.label === l);
  });
}

/** 工作台筛选选项。**所有字段都可空**;空字段 = 不筛选(等价于不过滤这一维)。
 *  与 applyPaperFilters 的语义刻意对齐,方便上层 listPapers 同时组合两套。 */
export interface LibraryFilterOptions {
  author?: string;
  venue?: string;
  yearRange?: { from?: number; to?: number };
  starred?: boolean;
  readingStatus?: ReadingStatus;
  hasNote?: boolean;
  userTag?: { kind: string; label: string };
}

/** 工作台筛选 pipeline —— 与 applyPaperFilters 同形态,但走的是用户态维度。
 *  各谓词彼此**独立可组合**,顺序不影响结果(filter 都是 AND 短路)。
 *  caller 负责在调之前 buildUserLibrarySnapshot()(610 篇一遍遍历 < 1ms)。 */
export function applyLibraryFilters(
  items: PaperListItem[],
  snapshot: UserLibrarySnapshot,
  opts: LibraryFilterOptions = {},
): PaperListItem[] {
  let out = items;
  if (opts.author) out = filterByAuthor(out, opts.author);
  if (opts.venue) out = filterByVenue(out, opts.venue);
  if (opts.yearRange) out = filterByYearRange(out, opts.yearRange);
  if (opts.starred) out = filterByStarred(out, snapshot);
  if (opts.readingStatus) out = filterByReadingStatus(out, opts.readingStatus, snapshot);
  if (opts.hasNote) out = filterByHasNote(out, snapshot);
  if (opts.userTag) out = filterByUserTag(out, opts.userTag.kind, opts.userTag.label, snapshot);
  return out;
}
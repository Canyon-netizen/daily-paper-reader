// astro-src/lib/library-freshness.ts
//
// R7 D.2.4: Library freshness indicator.
//
// 给定"库最近一次更新的时间戳"或"最近一篇命中论文的日期",
// 返回一个颜色编码的展示对象(用于 UI badge / 卡片角落)。
//
// 阈值:
//   <= 1d    -> green   "今天更新"
//   <= 7d    -> green   "N 天前"
//   <= 30d   -> yellow  "N 天前"
//   <= 90d   -> orange  "N 个月前"
//   > 90d    -> red     "N 个月前"
//   无数据    -> gray    "空库" / "—"
//
// 用法:
//   getLibraryFreshness({ updatedAt: number }) -> 浏览器 localStorage 用户库
//   getLibraryFreshnessByLatestDate('2026-09-10') -> 库的最新论文日期
//   getLibraryFreshnessForDigest({ paperCount, newestDate }) -> 派生 freshness

export type FreshnessColor = 'green' | 'yellow' | 'orange' | 'red' | 'gray';

export interface Freshness {
  daysAgo: number;          // -1 表示"无数据"
  label: string;
  color: FreshnessColor;
}

export function freshnessFromTimestamp(updatedAt: number, now: number = Date.now()): Freshness {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return { daysAgo: -1, label: '空库', color: 'gray' };
  }
  const daysAgo = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
  return freshnessFromDays(daysAgo);
}

export function freshnessFromLatestDate(
  latestDate: string | null | undefined,
  now: Date = new Date(),
): Freshness {
  if (!latestDate || !/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) {
    return { daysAgo: -1, label: '空库', color: 'gray' };
  }
  const latest = new Date(latestDate + 'T00:00:00Z');
  const daysAgo = Math.floor((now.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAgo < 0) {
    // future date (paper fetch race) — treat as "today"
    return { daysAgo: 0, label: '今天更新', color: 'green' };
  }
  return freshnessFromDays(daysAgo);
}

export function freshnessFromDays(daysAgo: number): Freshness {
  if (daysAgo < 0) return { daysAgo: -1, label: '空库', color: 'gray' };
  if (daysAgo <= 1) return { daysAgo, label: '今天更新', color: 'green' };
  if (daysAgo <= 7) return { daysAgo, label: `${daysAgo} 天前`, color: 'green' };
  if (daysAgo <= 30) return { daysAgo, label: `${daysAgo} 天前`, color: 'yellow' };
  if (daysAgo <= 90) return { daysAgo, label: `${Math.floor(daysAgo / 30)} 个月前`, color: 'orange' };
  return { daysAgo, label: `${Math.floor(daysAgo / 30)} 个月前`, color: 'red' };
}
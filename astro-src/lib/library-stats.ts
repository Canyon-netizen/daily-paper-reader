// astro-src/lib/library-stats.ts
//
// R7 D.2.3: Library stats helper.
//
// 给定一个 Library + 全集论文(从 listPapers 拉的 PaperListItem[]),
// 计算:
//   - paperCount: 命中论文数
//   - avgRelevanceScore: 这些论文 frontmatter score 的平均(0..1 或 0..10,自动判别)
//   - recentCount: 最近 30 天内的命中论文数
//   - categoryDistribution: paper.categories.* 各 dim:label 出现次数
//   - topAuthors: top 5 高频作者(从 paper frontmatter authors 字段)
//
// 设计要点:
//   - 纯函数(无 IO),SSR 安全,build time 跑一次。
//   - score 平均同时报告 mean(归一化到 0..1)和 scale(原 scale),让 UI 选择呈现。
//   - categoryDistribution 用 "dim:label" 形式 key,与 flattenTags 口径一致。

import type { Library } from './libraries';

export interface LibraryStats {
  paperCount: number;
  avgRelevanceScore: number;   // 0..1 归一化(原 score > 1 时除以 10)
  rawAvgScore: number;         // 原始 mean(可能 > 1)
  scoreScale: 1 | 10;          // 推断出的原 scale
  recentCount: number;         // 近 30 天内的命中数
  categoryDistribution: Record<string, number>;  // dim:label -> count
  topAuthors: string[];        // top 5
  oldestDate: string | null;   // YYYY-MM-DD or null
  newestDate: string | null;   // YYYY-MM-DD or null
}

/** 通用 paper frontmatter shape(只读我们关心的字段)。 */
export interface PaperListItemLike {
  id: string;
  date?: string;
  score?: number | string | null;
  authors?: string[];
  categories?: Record<string, string[] | undefined> | null;
  tags?: string[];
}

function detectScale(score: number): 1 | 10 {
  return score > 1 ? 10 : 1;
}

function flattenTags(p: PaperListItemLike): string[] {
  const out: string[] = [];
  const cats = (p.categories || {}) as Record<string, string[] | undefined>;
  for (const dim of ['venue', 'task', 'method', 'type'] as const) {
    for (const label of cats[dim] || []) out.push(`${dim}:${label}`);
  }
  return out;
}

function selectPapers(items: PaperListItemLike[], lib: Library): PaperListItemLike[] {
  return items.filter((p) => flattenTags(p).some((t) => lib.tags.includes(t)));
}

export function computeLibraryStats(
  items: PaperListItemLike[],
  lib: Library,
  opts: { now?: Date; recentDays?: number } = {},
): LibraryStats {
  const recentDays = opts.recentDays ?? 30;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000);
  const papers = selectPapers(items, lib);

  // score aggregation (scale-aware)
  let rawSum = 0;
  let scoreCount = 0;
  let inferredScale: 1 | 10 = 1;
  for (const p of papers) {
    const s = typeof p.score === 'string' ? parseFloat(p.score) : p.score;
    if (s == null || !Number.isFinite(s)) continue;
    rawSum += s;
    scoreCount++;
    if (detectScale(s) === 10) inferredScale = 10;
  }
  const rawAvg = scoreCount > 0 ? rawSum / scoreCount : 0;
  const avgRelevanceScore = inferredScale === 10 ? rawAvg / 10 : rawAvg;

  // recent papers (last 30d)
  let recentCount = 0;
  for (const p of papers) {
    if (!p.date) continue;
    const d = new Date(p.date + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime()) && d >= cutoff) recentCount++;
  }

  // category distribution
  const dist: Record<string, number> = {};
  for (const p of papers) {
    for (const tag of flattenTags(p)) {
      dist[tag] = (dist[tag] || 0) + 1;
    }
  }

  // top authors (first 3 of each paper)
  const authorCounts: Record<string, number> = {};
  for (const p of papers) {
    for (const a of (p.authors || []).slice(0, 3)) {
      if (!a) continue;
      authorCounts[a] = (authorCounts[a] || 0) + 1;
    }
  }
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([a]) => a);

  // date range
  const dates = papers
    .map((p) => p.date)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const oldestDate = dates[0] ?? null;
  const newestDate = dates.length ? dates[dates.length - 1] : null;

  return {
    paperCount: papers.length,
    avgRelevanceScore,
    rawAvgScore: rawAvg,
    scoreScale: inferredScale,
    recentCount,
    categoryDistribution: dist,
    topAuthors,
    oldestDate,
    newestDate,
  };
}
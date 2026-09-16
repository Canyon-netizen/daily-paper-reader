// astro-src/lib/concepts/version.ts
//
// R7 G.1.3: 概念版本快照 + 变更检测。
//
// 用途:每天 build 概念索引时,把每个 concept 的「display_name / category /
// paper_count / novelty / centrality」拍成 snapshot 存到 in-memory 历史列表
// (生产可选择落盘到 docs/concepts/<slug>/history/<date>.json)。
//
// 设计:
//   - ConceptSnapshot 是不可变记录:{date, display_name, category, paper_count, ...}
//   - snapshotConceptState(state, date?) 把当前 state 拍成 snapshot
//   - detectChanges(history) 对比最近两条,产出 ConceptChange[] (added/removed/
//     paper_count_delta/renamed/category_changed)
//   - 这层是纯函数,不依赖文件系统;调用方决定要不要落盘
//
// 调用方:
//   - lib/concepts-index.ts :: buildConceptIndex 末尾把当前 state 推入 history
//   - pages/wiki/concepts/[slug].astro :: 读 history → 渲染"近 90 天趋势"

import type { ConceptIndexEntry } from '../types/concept';

/** 一个时间点的概念状态快照 */
export interface ConceptSnapshot {
  /** ISO date YYYY-MM-DD */
  date: string;
  display_name: string;
  category: string;
  paper_count: number;
  novelty: number;
  centrality: number;
  /** 这个快照时,concept 关联的 paper ids (有序,便于 diff) */
  paper_ids: string[];
}

/** 单条变更 — 从 snapshot A → snapshot B */
export interface ConceptChange {
  type:
    | 'paper_added'
    | 'paper_removed'
    | 'paper_count_changed'
    | 'renamed'
    | 'category_changed'
    | 'novelty_changed'
    | 'centrality_changed'
    | 'recreated';
  /** 人类可读描述 */
  detail: string;
  /** 受影响的 paper ids(若有) */
  paper_ids?: string[];
}

/** 当前 concept state 拍成 snapshot。 */
export function snapshotConceptState(
  entry: Pick<ConceptIndexEntry, 'display_name' | 'category' | 'paper_count' | 'novelty' | 'centrality' | 'paper_ids'>,
  date: string = todayISO(),
): ConceptSnapshot {
  return {
    date,
    display_name: entry.display_name,
    category: entry.category,
    paper_count: entry.paper_count,
    novelty: entry.novelty,
    centrality: entry.centrality,
    paper_ids: entry.paper_ids.slice().sort(),
  };
}

/** 检测两组 snapshot 之间的变更。返回按字母排序的变更数组。 */
export function detectChanges(
  prev: ConceptSnapshot,
  next: ConceptSnapshot,
): ConceptChange[] {
  const out: ConceptChange[] = [];

  // 整体重建(同一 date 但 paper_count = 0)→ recreated
  if (prev.date === next.date && prev.paper_count === 0 && next.paper_count > 0) {
    out.push({
      type: 'recreated',
      detail: '从空状态恢复,所有 paper 为新增',
      paper_ids: next.paper_ids,
    });
    return out;
  }

  if (prev.display_name !== next.display_name) {
    out.push({
      type: 'renamed',
      detail: `${prev.display_name} → ${next.display_name}`,
    });
  }

  if (prev.category !== next.category) {
    out.push({
      type: 'category_changed',
      detail: `${prev.category} → ${next.category}`,
    });
  }

  // paper diff
  const prevSet = new Set(prev.paper_ids);
  const nextSet = new Set(next.paper_ids);
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of next.paper_ids) if (!prevSet.has(id)) added.push(id);
  for (const id of prev.paper_ids) if (!nextSet.has(id)) removed.push(id);

  if (added.length > 0) {
    out.push({
      type: 'paper_added',
      detail: `+${added.length} 篇 paper`,
      paper_ids: added,
    });
  }
  if (removed.length > 0) {
    out.push({
      type: 'paper_removed',
      detail: `-${removed.length} 篇 paper`,
      paper_ids: removed,
    });
  }
  if (added.length === 0 && removed.length === 0 && prev.paper_count !== next.paper_count) {
    out.push({
      type: 'paper_count_changed',
      detail: `paper_count ${prev.paper_count} → ${next.paper_count}`,
    });
  }

  if (prev.novelty !== next.novelty) {
    out.push({
      type: 'novelty_changed',
      detail: `novelty ${prev.novelty} → ${next.novelty}`,
    });
  }
  if (prev.centrality !== next.centrality) {
    out.push({
      type: 'centrality_changed',
      detail: `centrality ${prev.centrality} → ${next.centrality}`,
    });
  }

  out.sort((a, b) => a.type.localeCompare(b.type));
  return out;
}

/** 把多个 snapshot 收尾相连 → 完整变更轨迹(从老到新每两个一组)。 */
export function historyChanges(
  history: readonly ConceptSnapshot[],
): ConceptChange[] {
  if (history.length < 2) return [];
  const out: ConceptChange[] = [];
  for (let i = 1; i < history.length; i++) {
    out.push(...detectChanges(history[i - 1], history[i]));
  }
  return out;
}

/** 最近 N 天的 snapshot(默认 90),按时间升序。 */
export function recentSnapshots(
  history: readonly ConceptSnapshot[],
  days: number = 90,
  now: Date = new Date(),
): ConceptSnapshot[] {
  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  return history
    .filter((s) => new Date(s.date + 'T00:00:00Z').getTime() >= cutoffMs)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 把 paper_count 序列化成 SVG polyline points,用于「热度趋势」小图。 */
export function sparklinePoints(
  history: readonly ConceptSnapshot[],
  width: number = 300,
  height: number = 60,
): string {
  if (history.length === 0) return '';
  const maxCount = Math.max(...history.map((s) => s.paper_count), 1);
  const step = history.length === 1 ? 0 : width / (history.length - 1);
  return history
    .map((s, i) => {
      const x = i * step;
      const y = height - (s.paper_count / maxCount) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
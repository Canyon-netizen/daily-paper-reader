// /scripts/paper-bulk.ts — 工作台批量选择(Stage 10)。
//
// 关键设计:
//   1) **内存态,不落 localStorage**。批量选择是单页面会话内的工作流
//      (批量隐藏 / 加标签 / 导出),刷新即丢是**预期行为** —— 用户不想让
//      "今天凑的 80 篇批量操作"在明天刷新时还在那里等着误触发。
//      这与 topic 种子选择(dpr_paper_selection_v1,落盘,软上限 8)是
//      **两套完全独立的体系**,不能复用同一份存储 / 事件源。
//   2) **单一 emit 源**:本模块是 dpr:bulk-selection-change 的唯一 emit 方。
//      任何增删改都立刻 dispatch 一次,无防抖;listener 自己 rAF 合并重绘。
//   3) **硬上限 100**。超过直接拒,不静默丢。理由:列表 610 行,误把全列表
//      选中 = 后续批量操作要遍历 610 个 commit,UI 卡顿 + 配额爆炸。
//   4) **id 是 canonical arXiv id**。从 paper-library 的 byId / 列表 dataset
//      读 arxivId 后**内部归一化**(canonicalArxivId),保证 v1/v2 不会
//      被算成两篇。
//
// 接入:工作台列表行 checkbox(由 PaperLibrary 客户端按 isBulkMode 切)
// → addBulk(id) / removeBulk(id) → 这里 → emit → 列表重绘 checkbox +
// 底部 bulk action bar 更新计数。

import { canonicalArxivId } from '../lib/arxiv';
import { emitDprBulkSelectionChange } from '../lib/events';

/** 硬上限。>100 直接拒,UI 应在 95+ 时显高亮提示。 */
export const BULK_HARD_CAP = 100;

/** 模块私有的当前选择集合(顺序 = 加入顺序)。 */
let selected: string[] = [];

function target(): EventTarget {
  if (typeof window !== 'undefined') return window;
  if (typeof document !== 'undefined') return document;
  return { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as EventTarget;
}

function emit(): void {
  emitDprBulkSelectionChange(target(), { ids: selected.slice() });
}

/** 当前选择快照(返回新数组,调用方不要 mutate)。 */
export function getBulkSelection(): string[] {
  return selected.slice();
}

export function isBulkSelected(id: string): boolean {
  const cid = canonicalArxivId(id);
  if (!cid) return false;
  return selected.indexOf(cid) >= 0;
}

export function getBulkCount(): number {
  return selected.length;
}

/**
 * 加入批量选择。
 * @returns true 表示真的新增,false 表示已在列表中或已达上限。
 */
export function addBulk(id: string): boolean {
  const cid = canonicalArxivId(id);
  if (!cid) return false;
  if (selected.indexOf(cid) >= 0) return false;
  if (selected.length >= BULK_HARD_CAP) return false;
  selected.push(cid);
  emit();
  return true;
}

/** 移除单条;不在选择中则返回 false。 */
export function removeBulk(id: string): boolean {
  const cid = canonicalArxivId(id);
  if (!cid) return false;
  const idx = selected.indexOf(cid);
  if (idx < 0) return false;
  selected.splice(idx, 1);
  emit();
  return true;
}

/** 切换:已选则移除,否则加入。返回新的"是否已选"。 */
export function toggleBulk(id: string): boolean {
  if (isBulkSelected(id)) {
    removeBulk(id);
    return false;
  }
  addBulk(id);
  return isBulkSelected(id);
}

/** 整批加入(批量隐藏 / 加标签用)。超过上限时只加入前 N 条,
 *  返回被忽略的 id 数量 —— 让 UI 弹 toast 而不是静默吞。 */
export function addBulkMany(ids: string[]): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const raw of ids) {
    const cid = canonicalArxivId(raw);
    if (!cid) { skipped++; continue; }
    if (selected.indexOf(cid) >= 0) { skipped++; continue; }
    if (selected.length >= BULK_HARD_CAP) { skipped++; continue; }
    selected.push(cid);
    added++;
  }
  if (added > 0) emit();
  return { added, skipped };
}

/** 清空。 */
export function clearBulk(): void {
  if (selected.length === 0) return;
  selected = [];
  emit();
}

/** 替换整个集合(从 URL hash 恢复等场景用)。
 *  同样有上限保护 —— 给 200 个就只取前 100。 */
export function replaceBulk(ids: string[]): { kept: number; skipped: number } {
  const next: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of ids) {
    const cid = canonicalArxivId(raw);
    if (!cid || seen.has(cid)) { skipped++; continue; }
    if (next.length >= BULK_HARD_CAP) { skipped++; continue; }
    seen.add(cid);
    next.push(cid);
  }
  selected = next;
  emit();
  return { kept: next.length, skipped };
}
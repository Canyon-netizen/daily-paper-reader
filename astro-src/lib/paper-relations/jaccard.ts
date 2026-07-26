// /lib/paper-relations/jaccard.ts — Jaccard 边算法。
// 纯函数:无副作用,可独立单测。

import type { PaperListItem } from '../paper';
import type { RelationEdge } from './types';
import { tagSet } from './edges-util';

/**
 * 计算 Jaccard 边。
 * 权重 = |A ∩ B| / |A ∪ B|。
 * 论文 0 标签时取空集,Jaccard 永远为 0 — 自动跳过。
 *
 * @param papers listPapers({dedup:true}) 的结果
 * @param minWeight 低于此值的边丢弃
 * @returns 边列表(已去重 source<target,无向图规范化)
 */
export function computeJaccardEdges(
  papers: PaperListItem[],
  minWeight = 0,
): RelationEdge[] {
  const tagSets = papers.map(tagSet);
  const out: RelationEdge[] = [];
  for (let i = 0; i < papers.length; i++) {
    const Ai = tagSets[i];
    if (Ai.size === 0) continue;
    for (let j = i + 1; j < papers.length; j++) {
      const Aj = tagSets[j];
      if (Aj.size === 0) continue;
      // 求交
      let inter = 0;
      const shared: string[] = [];
      for (const t of Ai) {
        if (Aj.has(t)) {
          inter++;
          shared.push(t);
        }
      }
      if (inter === 0) continue;
      const union = Ai.size + Aj.size - inter;
      const w = inter / union;
      if (w < minWeight) continue;
      out.push({
        source: papers[i].id,
        target: papers[j].id,
        weight: w,
        type: 'jaccard',
        sharedTags: shared,
      });
    }
  }
  return out;
}
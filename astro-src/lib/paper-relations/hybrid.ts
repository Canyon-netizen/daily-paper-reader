// /lib/paper-relations/hybrid.ts — multi-algorithm 边合并 + 归一化。

import type { RelationEdge } from './types';

/**
 * 把三种算法的边合并到统一 (source, target) key。
 * 权重按 hybridWeights 加权求和,再按 maxW 归一化到 [0,1]。
 *
 * 归一化策略:用所有边 maxWeight 缩放 — 简单且单调,保序。
 * cytoscape 渲染时强边权值靠前即可。
 */
export function mergeHybridEdges(
  jaccard: RelationEdge[],
  tfidf: RelationEdge[],
  embedding: RelationEdge[],
  weights: { jaccard: number; tfidf: number; embedding: number },
): RelationEdge[] {
  type Bucket = { source: string; target: string; w: number; sharedTags: string[] };
  const map = new Map<string, Bucket>();

  const add = (e: RelationEdge, wType: number): void => {
    const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const k = `${a}|${b}`;
    const cur = map.get(k);
    if (cur) {
      cur.w += e.weight * wType;
      if (e.type === 'jaccard') {
        for (const t of e.sharedTags) {
          if (!cur.sharedTags.includes(t)) cur.sharedTags.push(t);
        }
      }
    } else {
      map.set(k, {
        source: a,
        target: b,
        w: e.weight * wType,
        sharedTags: e.sharedTags.slice(),
      });
    }
  };

  for (const e of jaccard) add(e, weights.jaccard);
  for (const e of tfidf) add(e, weights.tfidf);
  for (const e of embedding) add(e, weights.embedding);

  const buckets = Array.from(map.values());
  const maxW = buckets.reduce((m, b) => Math.max(m, b.w), 0);
  const norm = maxW > 0 ? 1 / maxW : 1;
  return buckets.map((b) => ({
    source: b.source,
    target: b.target,
    weight: b.w * norm,
    type: 'jaccard',        // hybrid 边无单一类型,占位 — UI 按 weight 渲染即可
    sharedTags: b.sharedTags,
  }));
}
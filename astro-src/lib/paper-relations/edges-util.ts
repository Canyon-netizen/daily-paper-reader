// /lib/paper-relations/edges-util.ts — 三种算法共用的边处理工具。
//  - buildNodes:PaperListItem[] → RelationNode[]
//  - topKEdges:按 source 分组裁剪
//  - tagSet:取单篇 paper 的有效 tag 集合(Jaccard/TF-IDF 都依赖)

import type { PaperListItem } from '../paper';
import { flattenCategories } from '../paper';
import type { RelationNode, RelationEdge } from './types';

/** 按 paper id(用作"图节点 id")建节点数组。 */
export function buildNodes(papers: PaperListItem[]): RelationNode[] {
  return papers.map((p) => ({
    id: p.id,
    arxivId: p.arxivId,
    title: p.title || p.title_zh || p.id,
    // 拍平 categories (e.g. ['venue:ICML 2025','task:rl']) 供 Jaccard / UI 共用。
    // 4-dim 比历史的 string[] tags 含的信息更密;map 不去重,flattenCategories 已去重。
    tags: flattenCategories(p.categories),
  }));
}

/** 边按 weight 降序裁剪到 topK(per node:每节点最多 topK 条出边)。 */
export function topKEdges(edges: RelationEdge[], k: number): RelationEdge[] {
  if (!k || k <= 0) return edges;
  // 按 source 分组,每组按 weight 降序,前 k 条留下
  const bySource = new Map<string, RelationEdge[]>();
  for (const e of edges) {
    const arr = bySource.get(e.source);
    if (arr) arr.push(e);
    else bySource.set(e.source, [e]);
  }
  const out: RelationEdge[] = [];
  for (const arr of bySource.values()) {
    arr.sort((a, b) => b.weight - a.weight);
    for (const e of arr.slice(0, k)) {
      // 不去重 — hybrid 模式会显式合并。
      out.push(e);
    }
  }
  return out;
}

/** 提取论文的有效 tag 集合。
 *  - flattenCategories 输出形如 'dim:label'(e.g. 'task:rl','venue:ICML 2025'),
 *    已带 dim 前缀 — 旧 `query:<label>` 前缀约定彻底删除;
 *  - 去重由 flattenCategories 完成。 */
export function tagSet(p: PaperListItem): Set<string> {
  return new Set(flattenCategories(p.categories));
}
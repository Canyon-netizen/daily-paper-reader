// astro-src/lib/projects/highlights.ts
//
// 项目级高亮聚合 —— 把"分布在各篇论文的高亮"按项目维度聚拢。
//
// 数据模型沿用 astro-src/lib/user-library/highlights.ts:
//   - 单条高亮存 IDB,字段 { id, canonicalId, text, note?, createdAt }
//   - 高亮**全局**,不在高亮上写 projectId —— 因为同一段高亮可能跨项目复用
//     (用户可能把同一篇论文同时加到"近期精读"和"未来工作"两个项目里),
//     强行绑项目会让用户在 A 项目删了 B 项目也跟着没了,反而违反直觉。
//
// 聚合方式:给定项目里的 paperIds 集合,从 IDB 拉每个 paper 的所有高亮,
//          按 createdAt desc 拍平。**不去重**(同一段文字多次高亮保留多条)。
//
// 为什么不去重:
//   1. 同段文字第二次高亮往往意味着用户特别标记 / 改主意 / 想分类,
//      保留 2 条比合并 1 条更准确。
//   2. 去重需要 hash 文本,在 IDB 查询端成本不低。
//   3. UI 侧可以按 (canonicalId + text) 折叠显示,留给 UI 决定。

import { listHighlights, type Highlight } from '../user-library/highlights';

export interface AggregatedHighlight extends Highlight {
  /** 项目内第几个 paper(便于 UI 分组显示) */
  paperIdx?: number;
}

/** 给定项目的 paperIds(已 canonical) → 全部高亮(按 createdAt desc)。 */
export async function aggregateProjectHighlights(
  paperIds: readonly string[],
): Promise<AggregatedHighlight[]> {
  if (!paperIds.length) return [];
  const buckets = await Promise.all(paperIds.map((id) => listHighlights(id)));
  const flat: AggregatedHighlight[] = [];
  for (let i = 0; i < buckets.length; i++) {
    for (const h of buckets[i]) flat.push({ ...h, paperIdx: i });
  }
  flat.sort((a, b) => b.createdAt - a.createdAt);
  return flat;
}

/** 过滤高亮(搜索框用)—— 大小写不敏感,匹配 text + note 任一子串。 */
export function filterHighlights(
  list: readonly AggregatedHighlight[],
  query: string,
): AggregatedHighlight[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((h) => {
    const t = (h.text || '').toLowerCase();
    const n = (h.note || '').toLowerCase();
    return t.includes(q) || n.includes(q);
  });
}

/** 高亮统计 —— 给 tab 头显示用。 */
export interface HighlightsStats {
  total: number;
  byPaper: number;   // 有高亮的 paper 数
  withNotes: number; // 带注释的条数
}

export function computeHighlightsStats(list: readonly AggregatedHighlight[]): HighlightsStats {
  const papers = new Set<string>();
  let withNotes = 0;
  for (const h of list) {
    papers.add(h.canonicalId);
    if (h.note && h.note.trim()) withNotes++;
  }
  return { total: list.length, byPaper: papers.size, withNotes };
}

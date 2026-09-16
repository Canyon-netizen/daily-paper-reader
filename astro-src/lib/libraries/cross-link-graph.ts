// astro-src/lib/libraries/cross-link-graph.ts
//
// R7 H.3.2: library detail 页 cross-link 网络图。
//
// 从库的论文集合里,基于 crosslink/resource_tier 字段构建节点-边数据,
// 供 cytoscape.js 或原生 SVG 渲染。数据形状兼容 cytoscape.js。
//
// 节点:
//   - paper: 论文节点,label = title (truncated)
//   - library: 目标库节点,label = library title
// 边:
//   - crosslink: 两篇论文之间的交叉引用,weight = 引用强度(0-1)
//   - resource_tier: 论文→库的层级关系(核心/扩展/背景)

import type { Library } from '../libraries';
import type { PaperListItem } from '../paper';

/** cytoscape 兼容的节点数据。 */
export interface CrossLinkNode {
  id: string;
  /** 节点显示文字 */
  label: string;
  /** 节点类型 */
  kind: 'paper' | 'library';
  /** 节点大小(默认 1.0) */
  size?: number;
  /** 颜色(用于区分) */
  color?: string;
}

/** cytoscape 兼容的边数据。 */
export interface CrossLinkEdge {
  source: string;
  target: string;
  /** 边权重,0-1 */
  weight: number;
  /** 边类型 */
  kind: 'crosslink' | 'resource_tier';
}

/** cross-link 图完整结构。 */
export interface CrossLinkGraph {
  nodes: CrossLinkNode[];
  edges: CrossLinkEdge[];
}

/** 从库的论文列表构建 cross-link 网络图。
 *
 * @param library 当前库(用于生成 library 节点)
 * @param papers 库内所有论文(PaperListItem)
 * @param allLibraries 全部库配置(用于生成其他库节点)
 *
 * 节点生成规则:
 *   - 每篇论文 → paper 节点,id = arxivId
 *   - 论文的 resource_tier 指向的库 → library 节点
 *
 * 边生成规则:
 *   - crosslink: 论文 A.bibliography 包含 B.arxivId → A→B 边,weight=1
 *   - resource_tier: 论文的 resource_tier 数组 → paper→library 边,weight 按层级:
 *       core=1.0, extended=0.6, background=0.3
 */
export function buildCrossLinkGraph(
  library: Library,
  papers: PaperListItem[],
  allLibraries: Library[] = [],
): CrossLinkGraph {
  const nodes: CrossLinkNode[] = [];
  const edges: CrossLinkEdge[] = [];

  // 1. 当前库节点
  nodes.push({
    id: `lib:${library.id}`,
    label: library.title,
    kind: 'library',
    size: 2.0,
    color: getLibraryColor(library.id, allLibraries),
  });

  // 2. 论文节点 + resource_tier 边
  const paperIdsInLibrary = new Set<string>();
  const tierWeight: Record<string, number> = { core: 1.0, extended: 0.6, background: 0.3 };

  for (const p of papers) {
    const arxivId = p.arxivId || p.id;
    if (!arxivId) continue;
    paperIdsInLibrary.add(arxivId);

    // 论文节点
    nodes.push({
      id: `paper:${arxivId}`,
      label: truncateTitle(p.title || 'Untitled'),
      kind: 'paper',
      size: 1.0,
    });

    // resource_tier 边:论文→库
    const tiers = (p as { resource_tier?: string[] }).resource_tier;
    if (tiers && Array.isArray(tiers)) {
      for (const tierStr of tiers) {
        const [libId, tier] = tierStr.split(':');
        if (!libId) continue;
        const w = tierWeight[tier] ?? 0.5;

        // 确保目标库节点存在
        if (!nodes.find((n) => n.id === `lib:${libId}`)) {
          const lib = allLibraries.find((l) => l.id === libId);
          nodes.push({
            id: `lib:${libId}`,
            label: lib?.title ?? libId,
            kind: 'library',
            size: 1.5,
            color: getLibraryColor(libId, allLibraries),
          });
        }

        edges.push({
          source: `paper:${arxivId}`,
          target: `lib:${libId}`,
          weight: w,
          kind: 'resource_tier',
        });
      }
    }
  }

  // 3. crosslink 边:论文→论文
  const paperMap = new Map(papers.map((p) => [p.arxivId || p.id, p]));

  for (const p of papers) {
    const srcId = p.arxivId || p.id;
    if (!srcId) continue;

    const bibliography = (p as { bibliography?: string[] }).bibliography;
    if (!bibliography || !Array.isArray(bibliography)) continue;

    for (const citedId of bibliography) {
      // 只画库内论文之间的边
      if (!paperIdsInLibrary.has(citedId)) continue;
      // 避免双向重复边:只画 src < target 的
      if (srcId < citedId) {
        edges.push({
          source: `paper:${srcId}`,
          target: `paper:${citedId}`,
          weight: 1.0,
          kind: 'crosslink',
        });
      }
    }
  }

  return { nodes, edges };
}

/** 简单哈希得到库颜色。 */
function getLibraryColor(libId: string, libs: Library[]): string {
  const lib = libs.find((l) => l.id === libId);
  if (lib?.hue) {
    const colors: Record<string, string> = {
      orange: '#f97316',
      cyan: '#06b6d4',
      purple: '#a855f7',
      emerald: '#10b981',
      blue: '#3b82f6',
      rose: '#f43f5e',
    };
    return colors[lib.hue] ?? '#6b7280';
  }
  // fallback: deterministic gray
  let h = 0;
  for (let i = 0; i < libId.length; i += 1) {
    h = ((h << 5) - h + libId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h % 360);
  return `hsl(${hue}, 60%, 50%)`;
}

/** 截断标题(太长 cytoscape 显示不下)。 */
function truncateTitle(title: string, maxLen = 40): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + '…';
}

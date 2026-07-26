// /lib/paper-relations/index.ts — 公开 API barrel + 算法 orchestrator。
//
// computeRelations 是唯一公开的 orchestrator,根据 options.algorithm
// 选择 jaccard / tfidf / embedding / hybrid 路径。
//
// 子模块之间单向依赖:
//   types          ← 所有子模块
//   edges-util     ← 算法模块
//   jaccard / tfidf  ← 纯算法
//   embedding-cache  ← IDB 持久化(独立可单测)
//   embedding      ← 调用 embedding-cache + defaultProvider
//   hybrid         ← 多算法合并
//   index(本文件) ← 编排,公开 barrel
//
// 各子模块之间绝不互相 import @lib/paper-relations/index。

import type { PaperListItem } from '../paper';
import type { ComputeOptions, ComputeResult, EdgeType, RelationEdge } from './types';
import { buildNodes, topKEdges } from './edges-util';
import { computeJaccardEdges } from './jaccard';
import { computeTfIdfEdges } from './tfidf';
import { computeEmbeddingEdges } from './embedding';
import { mergeHybridEdges } from './hybrid';

export type {
  RelationNode,
  RelationEdge,
  EdgeType,
  EmbeddingProvider,
  ComputeOptions,
  ComputeResult,
} from './types';

export {
  clearEmbeddingCache,
  embeddingCacheStats,
} from './embedding-cache';

export { computeJaccardEdges } from './jaccard';
export { computeTfIdfEdges } from './tfidf';
export { computeEmbeddingEdges, defaultProvider } from './embedding';
export { mergeHybridEdges } from './hybrid';

/**
 * 计算论文相关性图谱(nodes + edges)。
 *
 * 用法:
 * ```ts
 * import { listPapers } from '@lib/paper';
 * import { computeRelations } from '@lib/paper-relations';
 *
 * const papers = await listPapers({ dedup: true });
 * const graph = await computeRelations(papers, {
 *   algorithm: 'jaccard',
 *   topK: 5,
 *   minWeight: 0.1,
 * });
 * // graph.nodes / graph.edges 喂给 cytoscape.js
 * ```
 *
 * @param papers  PaperListItem 数组(建议先 dedup: true)
 * @param opts    算法 + 阈值
 * @returns       ComputeResult
 */
export async function computeRelations(
  papers: PaperListItem[],
  opts: ComputeOptions,
): Promise<ComputeResult> {
  const topK = opts.topK ?? 8;
  const minWeight = opts.minWeight ?? 0;
  const hybridWeights = opts.hybridWeights ?? { jaccard: 0.25, tfidf: 0.35, embedding: 0.4 };

  const nodes = buildNodes(papers);

  const edgeCounts: Record<EdgeType, number> = { jaccard: 0, tfidf: 0, embedding: 0 };
  let llmCalls = 0;
  let llmFailures = 0;

  let jEdges: RelationEdge[] = [];
  let tEdges: RelationEdge[] = [];
  let eEdges: RelationEdge[] = [];

  if (opts.algorithm === 'jaccard' || opts.algorithm === 'hybrid') {
    jEdges = computeJaccardEdges(papers, minWeight);
    edgeCounts.jaccard = jEdges.length;
  }
  if (opts.algorithm === 'tfidf' || opts.algorithm === 'hybrid') {
    tEdges = computeTfIdfEdges(papers, topK, minWeight);
    edgeCounts.tfidf = tEdges.length;
  }
  if (opts.algorithm === 'embedding' || opts.algorithm === 'hybrid') {
    const r = await computeEmbeddingEdges(
      papers,
      opts.llmProvider,
      topK,
      minWeight,
      opts.onProgress,
    );
    eEdges = r.edges;
    llmCalls = r.llmCalls;
    llmFailures = r.llmFailures;
    edgeCounts.embedding = eEdges.length;
  }

  let edges: RelationEdge[];
  if (opts.algorithm === 'hybrid') {
    const merged = mergeHybridEdges(jEdges, tEdges, eEdges, hybridWeights);
    edges = topKEdges(merged, topK);
  } else if (opts.algorithm === 'jaccard') {
    edges = topKEdges(jEdges, topK);
  } else if (opts.algorithm === 'tfidf') {
    edges = tEdges;          // topK 已在内部裁过
  } else {
    edges = eEdges;          // topK 已在内部裁过
  }

  return {
    nodes,
    edges,
    meta: {
      algorithm: opts.algorithm,
      edgeCounts,
      llmCalls,
      llmFailures,
    },
  };
}
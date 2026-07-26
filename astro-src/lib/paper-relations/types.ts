// /lib/paper-relations/types.ts — paper-relations 公开 DTO。
//
// 路径既会被 paper-relations 内部算法 (jaccard/tfidf/embedding/hybrid) 引用,
// 也会被 React/cytoscape 渲染层 `import type { RelationEdge }` 引用 — 所以放
// types.ts 让 type-only import 不携带运行时副作用。

import type { PaperListItem } from '../paper';

/** Cytoscape.js 兼容的节点(本模块只输出最小字段,渲染层可补 data.*)。 */
export interface RelationNode {
  id: string;            // paper id(= PaperListItem.id)
  arxivId: string;
  title: string;
  tags: string[];
}

/** 边权重:0~1 之间的浮点,语义依 type 而定。 */
export type EdgeType = 'jaccard' | 'tfidf' | 'embedding';

export interface RelationEdge {
  source: string;        // paper id
  target: string;        // paper id
  weight: number;        // 0~1
  type: EdgeType;
  /** jaccard 边附带具体共享的 tags 列表,UI 可悬浮展示;其他类型为空数组。 */
  sharedTags: string[];
}

export interface ComputeOptions {
  algorithm: 'jaccard' | 'tfidf' | 'embedding' | 'hybrid';
  /** 每节点最多保留多少条边(按 weight 降序裁剪,hybrid 模式同样适用)。default 8 */
  topK?: number;
  /** 低于此权重的边直接丢弃。 */
  minWeight?: number;
  /** 边权求和权重(仅 hybrid 生效,默认 jaccard:0.25 / tfidf:0.35 / embedding:0.4)。 */
  hybridWeights?: {
    jaccard: number;
    tfidf: number;
    embedding: number;
  };
  /** embedding 边的 LLM 配置;不传时回退到 loadSettings() + LLM_DEFAULTS。 */
  llmProvider?: EmbeddingProvider;
  /** UI 进度回调(embedding 阶段逐条调用,失败/跳过时跳过即可)。 */
  onProgress?: (msg: string) => void;
}

export interface ComputeResult {
  nodes: RelationNode[];
  edges: RelationEdge[];
  meta: {
    algorithm: ComputeOptions['algorithm'];
    /** 每种算法实际产出的边数(无论是否被 topK/minWeight 裁剪)。 */
    edgeCounts: Record<EdgeType, number>;
    /** 调 LLM 次数(embedding 缓存命中算 0 次)。 */
    llmCalls: number;
    /** 调 LLM 失败次数(网络/解析错),失败论文在 embedding 阶段被跳过。 */
    llmFailures: number;
  };
}

/** LLM embedding 接口 — 与 paper-analyzer 的 LLMConfig 兼容,
 *  单独定义避免 lib↔scripts 循环依赖。 */
export interface EmbeddingProvider {
  apiKey: string;
  baseUrl: string;
  /** chat 模型,仅供 fallback / 错误信息用;embeddings 端点用同 baseUrl。 */
  model: string;
  /** OpenAI 兼容 /v1/embeddings 端的 embedding 模型,默认 text-embedding-3-small。 */
  embeddingModel?: string;
}

/** 让外部 `import type { PaperListItem } from '@lib/paper-relations/types'` 也能拿到原始 DTO。 */
export type { PaperListItem };
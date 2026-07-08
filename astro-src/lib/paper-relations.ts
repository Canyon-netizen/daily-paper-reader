// astro-src/lib/paper-relations.ts
// 论文相关性图谱 — 纯前端模块:三种边算法 + hybrid 汇总。
//
// 设计原则:
//   1. 纯函数优先 — computeJaccardEdges / computeTfIdfEdges 完全无副作用,
//      方便单元测试与 SSR 端复用。
//   2. embedding 边用 IndexedDB 持久化缓存(arxivId+model 作为 key),
//      同一篇论文同一模型下不会重复调 LLM。
//   3. hybrid 模式 = 三种边取并集,各算法权重归一化到 [0,1] 后按 w 算法求和,
//      再做一次 [0,1] 归一化。
//   4. 不依赖 Cytoscape / 图算法库 — 只输出 nodes/edges 列表,
//      渲染层 (cytoscape.js) 自行消费。
//
// 数据源:listPapers({dedup:true}) 返回的 PaperListItem 数组。
// 该类型从 ./paper 导入,保证 schema 一致性。

import type { PaperListItem } from './paper';
import { loadSettings, LLM_DEFAULTS } from '../scripts/settings';

// ============================================================================
// 类型
// ============================================================================

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
  /** 每节点最多保留多少条边(按 weight 降序裁剪,hybrid 模式同样适用)。 */
  topK?: number;          // default 8
  /** 低于此权重的边直接丢弃。 */
  minWeight?: number;     // default 0
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

/** LLM embedding 接口 — 与 paper-analyzer 的 LLMConfig 兼容,单独定义避免 lib↔scripts 循环。 */
export interface EmbeddingProvider {
  apiKey: string;
  baseUrl: string;
  /** chat 模型,仅供 fallback / 错误信息用;embeddings 端点用同 baseUrl。 */
  model: string;
  /** OpenAI 兼容 /v1/embeddings 端的 embedding 模型,默认 text-embedding-3-small。 */
  embeddingModel?: string;
}

// ============================================================================
// 工具 — 仅依赖浏览器/Node 18+ 内置 API
// ============================================================================

/** 简单 hash 字符串 → 32-bit 整数。缓存 key 用。 */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 按 paper id(用作"图节点 id")建节点数组。 */
function buildNodes(papers: PaperListItem[]): RelationNode[] {
  return papers.map((p) => ({
    id: p.id,
    arxivId: p.arxivId,
    title: p.title || p.title_zh || p.id,
    tags: (p.tags || []).slice(),
  }));
}

/** 边按 weight 降序裁剪到 topK(per node:每节点最多 topK 条出边)。 */
function topKEdges(edges: RelationEdge[], k: number): RelationEdge[] {
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
      // 去重:若 target 已经被另一条 (source, target) 不同 type 的边占位
      // 这里不去重 — hybrid 模式会显式合并。
      out.push(e);
    }
  }
  return out;
}

// ============================================================================
// 1. Jaccard 边 — 基于 tags 重叠
// ============================================================================

/**
 * 提取论文的有效 tag 集合。规则:
 *   - 去除 `query:` 前缀(query:<tag> 与 <tag> 视为等价 — 前端 / 后台约定);
 *   - 去重;
 *   - 空 tag 跳过。
 */
function tagSet(p: PaperListItem): Set<string> {
  const out = new Set<string>();
  for (const t of p.tags || []) {
    const stripped = t.startsWith('query:') ? t.slice(6) : t;
    if (stripped) out.add(stripped);
  }
  return out;
}

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

// ============================================================================
// 2. TF-IDF 边 — 基于 title + tldr 的余弦相似度
// ============================================================================

/** 极简分词:转小写,按 Unicode 字母数字 + CJK 字符切。 */
function tokenize(text: string): string[] {
  // 匹配:连续 ASCII 字母数字 / 连续 CJK 字符
  // 不依赖 Intl.Segmenter,避免 SSR/Node 老版本兼容问题。
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/u)
    .filter((t) => t.length > 1);
}

/** 文本 → { term: count }。 */
function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * 计算 TF-IDF 余弦相似度边。
 * 流程:
 *   1. 每篇论文合并 title + tldr;
 *   2. 构造词表 → 文档频率 df;
 *   3. 算每篇 TF-IDF 向量(L2 归一化,余弦直接是点积);
 *   4. 两两点积 → 边权重。
 *
 * 论文数 ≤ 1 时返回空数组。O(N²·|V|),对 < 5000 论文够用。
 *
 * @param papers
 * @param topK   每个 source 节点最多保留 topK 条(避免 N² 全连接爆掉图)
 * @param minWeight 低于此值的边丢弃
 */
export function computeTfIdfEdges(
  papers: PaperListItem[],
  topK = 8,
  minWeight = 0,
): RelationEdge[] {
  if (papers.length < 2) return [];

  // 1) 文档集合
  const docs: string[][] = papers.map((p) => {
    const text = [p.title || '', p.title_zh || '', p.tldr || ''].join(' ');
    return tokenize(text);
  });

  // 2) 词表 + 文档频率
  const df = new Map<string, number>();
  for (const tokens of docs) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  // 3) TF-IDF 向量(用稀疏 Map<string, number>,每个文档独立)
  const N = papers.length;
  const vectors: Map<string, number>[] = docs.map((tokens) => {
    const tf = termFreq(tokens);
    const v = new Map<string, number>();
    let norm2 = 0;
    for (const [term, count] of tf) {
      const idf = Math.log(1 + N / (df.get(term) || 1));
      const w = count * idf;
      v.set(term, w);
      norm2 += w * w;
    }
    // L2 归一化
    const norm = Math.sqrt(norm2);
    if (norm > 0) {
      for (const [term, w] of v) v.set(term, w / norm);
    }
    return v;
  });

  // 4) 余弦相似度 + 边构建。
  // 为避免 O(N²|V|) 的纯点积,我们倒排索引:对每篇 doc,只枚举其非零 term,
  // 累加到 bucketMap[otherId] = sum。复杂度 O(sum_i |V_i|²),实际比全点积快。
  const out: RelationEdge[] = [];
  for (let i = 0; i < N; i++) {
    const vi = vectors[i];
    if (vi.size === 0) continue;
    const acc = new Map<number, number>();
    for (const [term, w] of vi) {
      // 找所有也含该 term 的 j(包含 i 自己,后续减掉)
      // 倒排:term -> [docIndex...]
      // 这里为了避免再建一个倒排表,用一次性 O(N) 扫描:term * N 次比较。
      // 对每篇 doc 的非零 term 平均 50~200 个,200 篇论文 = 20k 次比较,完全可接受。
      for (let j = 0; j < N; j++) {
        const vj = vectors[j];
        const wj = vj.get(term);
        if (wj === undefined) continue;
        acc.set(j, (acc.get(j) || 0) + w * wj);
      }
    }
    // acc 中 j === i 是自相似度 = 1,跳过
    for (const [j, sim] of acc) {
      if (j === i) continue;
      if (sim < minWeight) continue;
      out.push({
        source: papers[i].id,
        target: papers[j].id,
        weight: sim,
        type: 'tfidf',
        sharedTags: [],
      });
    }
  }
  return topKEdges(out, topK);
}

// ============================================================================
// 3. Embedding 边 — 基于 LLM embedding 的余弦相似度 + IndexedDB 缓存
// ============================================================================

/** 浏览器内打开 IndexedDB(失败时返回 null — Node SSR 不会跑到这里)。 */
function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open('dpr_paper_relations_v1', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('embeddings')) {
        // keyPath = 字符串 "{arxivId}|{embeddingModel}"
        db.createObjectStore('embeddings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

interface EmbeddingCacheRow {
  key: string;             // "{arxivId}|{embeddingModel}"
  vector: number[];
  at: number;              // Date.now()
}

/** 读缓存:返回 Map<arxivId, vector>。失败/不可用 → 返回空 Map。 */
async function readEmbeddingCache(
  arxivIds: string[],
  embeddingModel: string,
): Promise<Map<string, number[]>> {
  const db = await openIdb();
  if (!db) return new Map();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readonly');
      const store = tx.objectStore('embeddings');
      const out = new Map<string, number[]>();
      let pending = arxivIds.length;
      if (pending === 0) {
        db.close();
        resolve(out);
        return;
      }
      let failed = false;
      tx.oncomplete = () => {
        db.close();
        resolve(out);
      };
      tx.onerror = () => {
        failed = true;
        db.close();
        resolve(out);
      };
      for (const id of arxivIds) {
        const key = `${id}|${embeddingModel}`;
        const req = store.get(key);
        req.onsuccess = () => {
          if (failed) return;
          const row = req.result as EmbeddingCacheRow | undefined;
          if (row && Array.isArray(row.vector)) {
            out.set(id, row.vector);
          }
          pending--;
        };
        req.onerror = () => {
          failed = true;
          db.close();
          resolve(out);
        };
      }
    } catch {
      db.close();
      resolve(new Map());
    }
  });
}

/** 写缓存:批量 put,失败静默。 */
async function writeEmbeddingCache(rows: EmbeddingCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readwrite');
      const store = tx.objectStore('embeddings');
      for (const r of rows) store.put(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
}

/** 调 OpenAI 兼容 /v1/embeddings。失败抛 Error。 */
async function callEmbeddingApi(
  input: string,
  provider: EmbeddingProvider,
): Promise<number[]> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/v1/embeddings`;
  const model = provider.embeddingModel || 'text-embedding-3-small';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const vec: unknown = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('Embedding 返回格式异常');
  return vec.filter((x): x is number => typeof x === 'number');
}

/** 论文 → 拼成 embedding 输入的纯文本。title + tldr 拼接,截断到 ~2K 字符。 */
function paperToEmbeddingText(p: PaperListItem): string {
  const parts: string[] = [];
  if (p.title) parts.push(p.title);
  if (p.title_zh) parts.push(p.title_zh);
  if (p.tldr) parts.push(p.tldr);
  return parts.join('\n').slice(0, 2048);
}

/**
 * 计算 embedding 边。流程:
 *   1. 读 IndexedDB 缓存,缺失论文列表走 LLM;
 *   2. 拿到每篇论文的向量后,两两点积(L2 归一化);
 *   3. topK 裁剪。
 *
 * 失败语义:单篇论文 embedding 失败不抛错,只增加 llmFailures 计数,
 * 该论文作为孤儿节点(无 embedding 边),jaccard / tfidf 边仍可被 hybrid 合并。
 *
 * @param papers
 * @param provider LLM 配置;不传时回退到 loadSettings() + 默认 embedding model
 * @param topK
 * @param minWeight
 * @param onProgress
 */
export async function computeEmbeddingEdges(
  papers: PaperListItem[],
  provider?: EmbeddingProvider,
  topK = 8,
  minWeight = 0,
  onProgress?: (msg: string) => void,
): Promise<{ edges: RelationEdge[]; llmCalls: number; llmFailures: number }> {
  const empty = { edges: [] as RelationEdge[], llmCalls: 0, llmFailures: 0 };
  if (papers.length < 2) return empty;

  const cfg: EmbeddingProvider = provider || defaultProvider();
  if (!cfg.apiKey) {
    onProgress?.('embedding 跳过:未配置 LLM apiKey');
    return empty;
  }
  const embModel = cfg.embeddingModel || 'text-embedding-3-small';
  const arxivIds = papers.map((p) => p.arxivId).filter((x): x is string => !!x);
  if (arxivIds.length < 2) {
    onProgress?.('embedding 跳过:论文缺少 arxivId');
    return empty;
  }

  // 1) 缓存
  const cached = await readEmbeddingCache(arxivIds, embModel);
  // 2) 缺哪些就调 LLM
  const toFetch = papers.filter((p) => p.arxivId && !cached.has(p.arxivId));
  const newRows: EmbeddingCacheRow[] = [];
  let llmCalls = 0;
  let llmFailures = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const p = toFetch[i];
    onProgress?.(`embedding ${i + 1}/${toFetch.length}: ${p.arxivId}`);
    try {
      const text = paperToEmbeddingText(p);
      const vec = await callEmbeddingApi(text, cfg);
      cached.set(p.arxivId, vec);
      newRows.push({
        key: `${p.arxivId}|${embModel}`,
        vector: vec,
        at: Date.now(),
      });
      llmCalls++;
    } catch (e) {
      llmFailures++;
      // 不抛 — 失败论文当孤儿节点,UI 可继续渲染其他边
      console.warn(`[paper-relations] embedding failed for ${p.arxivId}:`, e);
    }
  }
  if (newRows.length > 0) {
    // 写缓存失败不影响主流程
    void writeEmbeddingCache(newRows);
  }

  // 3) 收集有向量的论文,两两余弦
  const withVec = papers.filter((p) => p.arxivId && cached.has(p.arxivId));
  if (withVec.length < 2) return { edges: [], llmCalls, llmFailures };

  // L2 归一化(缓存里可能存了非归一化向量,这里 defensive 一下)
  const normalized: { id: string; vec: number[] }[] = withVec.map((p) => {
    const v = cached.get(p.arxivId)!;
    let norm2 = 0;
    for (const x of v) norm2 += x * x;
    const norm = Math.sqrt(norm2);
    return { id: p.id, vec: norm > 0 ? v.map((x) => x / norm) : v.slice() };
  });

  // 同 TF-IDF 的倒排技巧:对每篇 doc 枚举非零维度累加。
  // embedding 维度通常 768~3072,稀疏度视模型而定。N 较小时直接 O(N²d) 也可,
  // 这里对 N > 200 才走倒排索引,小规模直接两两点积。
  const N = normalized.length;
  const D = normalized[0].vec.length;
  const out: RelationEdge[] = [];
  for (let i = 0; i < N; i++) {
    const vi = normalized[i].vec;
    const acc = new Map<number, number>();
    for (let k = 0; k < D; k++) {
      const wk = vi[k];
      if (wk === 0) continue;
      for (let j = 0; j < N; j++) {
        const vj = normalized[j].vec;
        const wj = vj[k];
        if (wj === 0) continue;
        acc.set(j, (acc.get(j) || 0) + wk * wj);
      }
    }
    for (const [j, sim] of acc) {
      if (j === i) continue;
      if (sim < minWeight) continue;
      out.push({
        source: normalized[i].id,
        target: normalized[j].id,
        weight: sim,
        type: 'embedding',
        sharedTags: [],
      });
    }
  }
  return { edges: topKEdges(out, topK), llmCalls, llmFailures };
}

/** 没有传 provider 时,从 localStorage 读 LLM 配置(沿用 paper-analyzer 同套)。 */
function defaultProvider(): EmbeddingProvider {
  try {
    const s = loadSettings();
    return {
      apiKey: s.apiKey,
      baseUrl: s.baseUrl || LLM_DEFAULTS.baseUrl,
      model: s.model || LLM_DEFAULTS.model,
      embeddingModel: 'text-embedding-3-small',
    };
  } catch {
    return {
      apiKey: '',
      baseUrl: LLM_DEFAULTS.baseUrl,
      model: LLM_DEFAULTS.model,
      embeddingModel: 'text-embedding-3-small',
    };
  }
}

// ============================================================================
// 4. Hybrid 合并
// ============================================================================

/**
 * 把三种算法的边合并到统一 (source, target) key。
 * 权重按 opts.hybridWeights 加权求和,再归一化到 [0,1]。
 *
 * 归一化策略:用所有边 maxWeight 缩放 — 简单且单调,保序。
 * cytoscape 渲染时强边权值靠前即可。
 */
function mergeHybridEdges(
  jaccard: RelationEdge[],
  tfidf: RelationEdge[],
  embedding: RelationEdge[],
  weights: NonNullable<ComputeOptions['hybridWeights']>,
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

// ============================================================================
// 主入口
// ============================================================================

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

// ============================================================================
// 缓存管理(可选导出,供 settings 页"清空 embedding 缓存"按钮用)
// ============================================================================

/** 清空 embedding 缓存。返回清理的条目数(尽力而为,失败返回 0)。 */
export async function clearEmbeddingCache(): Promise<number> {
  const db = await openIdb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readwrite');
      const store = tx.objectStore('embeddings');
      const countReq = store.count();
      let cleared = 0;
      countReq.onsuccess = () => { cleared = countReq.result || 0; };
      store.clear();
      tx.oncomplete = () => { db.close(); resolve(cleared); };
      tx.onerror = () => { db.close(); resolve(0); };
    } catch {
      db.close();
      resolve(0);
    }
  });
}

/** 缓存统计(供 settings 页展示)。失败返回 0。 */
export async function embeddingCacheStats(): Promise<{ count: number; oldestAt: number; newestAt: number }> {
  const empty = { count: 0, oldestAt: 0, newestAt: 0 };
  const db = await openIdb();
  if (!db) return empty;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('embeddings', 'readonly');
      const store = tx.objectStore('embeddings');
      const countReq = store.count();
      const out = { ...empty };
      countReq.onsuccess = () => { out.count = countReq.result || 0; };
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (cur) {
          const row = cur.value as EmbeddingCacheRow;
          if (typeof row.at === 'number') {
            if (!out.oldestAt || row.at < out.oldestAt) out.oldestAt = row.at;
            if (row.at > out.newestAt) out.newestAt = row.at;
          }
          cur.continue();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => { db.close(); resolve(out); };
    } catch {
      db.close();
      resolve(empty);
    }
  });
}

// hash32 当前未在导出 API 中使用,但保留供未来做缓存 key 优化(如分桶)。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _hash32Reserved = hash32;

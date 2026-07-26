// /lib/paper-relations/embedding.ts — embedding 边算法 + LLM provider 默认值。
//
// 失败语义:单篇论文 embedding 失败不抛错,只增加 llmFailures 计数,
// 该论文作为孤儿节点(无 embedding 边),jaccard / tfidf 边仍可被 hybrid 合并。
//
// 模块之间不互相 import @lib/paper-relations/index,
// embedding-cache 走子目录相对路径,types 走 './types'。

import type { PaperListItem } from '../paper';
import { loadSettings, LLM_DEFAULTS } from '../storage';
import type { RelationEdge, EmbeddingProvider } from './types';
import { topKEdges } from './edges-util';
import {
  readEmbeddingCache,
  writeEmbeddingCache,
  type EmbeddingCacheRow,
} from './embedding-cache';

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

/** 没有传 provider 时,从 localStorage 读 LLM 配置(沿用 paper-analyzer 同套)。 */
export function defaultProvider(): EmbeddingProvider {
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

/**
 * 计算 embedding 边。流程:
 *   1. 读 IndexedDB 缓存,缺失论文列表走 LLM;
 *   2. 拿到每篇论文的向量后,两两点积(L2 归一化);
 *   3. topK 裁剪。
 *
 * @param papers
 * @param provider LLM 配置;不传时回退到 defaultProvider()
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
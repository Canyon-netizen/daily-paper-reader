// /lib/paper-relations/tfidf.ts — TF-IDF 边算法。
// 纯函数:无副作用,可独立单测。
// 论文数 ≤ 1 时返回空数组。O(N²·|V|),对 < 5000 论文够用。

import type { PaperListItem } from '../paper';
import type { RelationEdge } from './types';
import { topKEdges } from './edges-util';

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

  // 4) 余弦相似度 + 边构建 — 倒排索引省 N² 扫描
  const out: RelationEdge[] = [];
  for (let i = 0; i < N; i++) {
    const vi = vectors[i];
    if (vi.size === 0) continue;
    const acc = new Map<number, number>();
    for (const [term, w] of vi) {
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
// /lib/concept-detail.ts — 概念详情 SSR 模块。
//
// 把 getStaticPaths / 数据加载 / 模板拼装拆出来,让 [slug].astro 尽量薄。
// 真值来自 docs/papers/ frontmatter 的 concepts 段(Stage 9 §阶段 9 真值来源)。

import {
  buildConceptIndex,
  getConceptEntry,
  getRelatedConcepts,
} from './concepts-index';
import { readPaper } from './paper';
import type {
  ConceptIndexEntry,
  RelatedConcept,
} from './types/concept';

export interface ConceptDetail {
  entry: ConceptIndexEntry;
  related: RelatedConcept[];
  /** 引用此概念的论文 id + 标题,按 centrality 降序(中心度高的排前)。 */
  citingPapers: Array<{
    id: string;
    title: string;
    title_zh?: string;
    canonicalArxivId: string;
    centrality: number;
  }>;
}

export async function getAllConceptSlugs(): Promise<string[]> {
  const idx = await buildConceptIndex();
  return [...idx.bySlug.keys()];
}

export async function getConceptDetail(slug: string): Promise<ConceptDetail | null> {
  const idx = await buildConceptIndex();
  const entry = getConceptEntry(idx, slug);
  if (!entry) return null;
  const related = getRelatedConcepts(idx, slug);

  // 拉每篇论文的最小信息(id + 标题) — paper 内没存 per-concept centrality,
  // 这里取整篇论文的"概念 centrality 加权" = 该 slug 在该 paper concepts 数组里的 centrality。
  const citingPapersRaw: Array<{
    id: string;
    canonicalArxivId: string;
    title?: string;
    title_zh?: string;
    centrality: number;
  }> = [];

  for (const pid of entry.paper_ids) {
    let centrality = entry.centrality; // fallback
    try {
      const paper = await readPaper(pid);
      if (paper) {
        const refs = paper.concepts;
        if (Array.isArray(refs)) {
          for (const r of refs) {
            if (r && typeof r === 'object' && (r as { slug?: unknown }).slug === slug) {
              const c = (r as { centrality?: unknown }).centrality;
              if (typeof c === 'number' && Number.isFinite(c)) centrality = c;
              break;
            }
          }
        }
        citingPapersRaw.push({
          id: paper.id,
          canonicalArxivId: paper.canonicalArxivId || '',
          title: paper.title,
          title_zh: paper.title_zh,
          centrality,
        });
        continue;
      }
    } catch {
      // fall through with id only
    }
    // readPaper 失败时仍然保留 id,以便不漏掉引用
    citingPapersRaw.push({
      id: pid,
      canonicalArxivId: '',
      centrality,
    });
  }

  citingPapersRaw.sort((a, b) => {
    if (b.centrality !== a.centrality) return b.centrality - a.centrality;
    return (a.title_zh || a.title || a.id).localeCompare(b.title_zh || b.title || b.id);
  });

  return {
    entry,
    related,
    citingPapers: citingPapersRaw.map((p) => ({
      id: p.id,
      title: p.title || '',
      title_zh: p.title_zh,
      canonicalArxivId: p.canonicalArxivId,
      centrality: p.centrality,
    })),
  };
}
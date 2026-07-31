// /lib/types/concept.ts — 概念层类型集中出口。
//
// 真值来源:docs/papers/*.md 的 frontmatter `concepts:` 段。
// 每篇论文 0..N 个 concept refs,ConceptRef 含 slug/display_name/category/novelty/centrality。
// Stage 9 起,概念页和 chips 都从这些 ref 派生,不依赖 gitignored 的 wiki/concepts/。

export interface ConceptRef {
  /** wiki-friendly slug,ConceptIndex 的 key。 */
  slug: string;
  /** 人类可读名,如 "Activation Steering"。 */
  display_name: string;
  /** 概念分类,如 "method" / "problem" / "methodology"。 */
  category: string;
  /** 0..1,论文自身新颖度,论文视角。 */
  novelty?: number;
  /** 0..1,论文内该概念的中心度。 */
  centrality?: number;
}

/** 单篇论文的 concepts 数组经过 normalize 后的 DTO。 */
export interface PaperConcepts {
  refs: ConceptRef[];
}

/** 概念索引条目:build-time 派生自全 docs/papers/,供 SSR 消费。 */
export interface ConceptIndexEntry {
  slug: string;
  display_name: string;
  category: string;
  /** 引用此概念的论文数(去重)。 */
  paper_count: number;
  /** 所有论文对该概念的 novelty 取均值(0..1)。 */
  novelty: number;
  /** 所有论文对该概念的 centrality 取均值(0..1)。 */
  centrality: number;
  /** 引用此概念的论文 id 列表(papers/<YYYY>/<MM>/<arxivid>)。
   *  SSR-only,不进浏览器。 */
  paper_ids: string[];
}

/** 共现相关概念。 */
export interface RelatedConcept {
  slug: string;
  display_name: string;
  category: string;
  /** 共现论文数(同时引用这两个概念的论文)。 */
  co_count: number;
  paper_count: number;
}

/** 完整概念索引:`Map<slug, ConceptIndexEntry>` + `RelatedConcept[]` 按 slug 索引。 */
export interface ConceptIndex {
  /** 按 slug 索引。 */
  bySlug: Map<string, ConceptIndexEntry>;
  /** 共现图:`slug → related[]`。 */
  relatedBySlug: Map<string, RelatedConcept[]>;
  /** 总论文数(有 concepts 字段的)。 */
  totalPapersWithConcepts: number;
  /** 总论文数(全 docs/papers)。 */
  totalPapers: number;
}
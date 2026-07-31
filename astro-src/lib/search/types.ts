// astro-src/lib/search/types.ts — search pipeline types (TypeScript-only, zero runtime).
//
// 该契约是 build-search-corpus.mjs 写盘产物 与 lib/search/* 客户端消费侧的**唯一**衔接点:
//   - SearchCorpus.fields 必须逐位匹配 SEARCH_FIELDS,否则 searchPapers() 直接拒绝建索引并降级 substring
//   - SearchMode / SearchDegradeReason / SearchResult 是 UI 工具栏"模式胶囊"显示口径
//
// 设计原则:不引用任何 node:* 模块,文件零 runtime,可被 SSR 与客户端两侧同时 type-only import。

/** 顺序即位掩码位序,append-only,永不重排。
 *  build-search-corpus.mjs 与 index.ts 都引用此常量,若新增字段必须同步改 build script 的 g[] 投影。 */
export const SEARCH_FIELDS = [
  'title',
  'title_zh',
  'tldr',
  'segments',
  'authors',
  'concepts',
  'categories',
] as const;

export type SearchFieldName = (typeof SEARCH_FIELDS)[number];

/** 一行语料。各字段宽度尽量短:i=x=cx 是 id 系;t/z/l/s/a/d/c 是文本;k/g 是数组。
 *  s 是为 BM25 在客户端现建倒排而合并出的"长字段",用作第二层 fallback。
 *  g 是 'dim:label' 形如 'task:rl',与 flattenCategories 一致。 */
export interface SearchCorpusRow {
  i: string;          // paper id (= docs 相对路径,无 .md)
  x: string;          // arxivId 带版本
  cx: string;         // canonicalArxivId —— join user-library / paper-relations 的键
  t: string;          // title
  z: string;          // title_zh
  l: string;          // tldr
  s: string;          // segments:motivation + method + result + conclusion 拼成一条
  a: string;          // authors 原串
  k: string[];        // concept display_name[]
  g: string[];        // 'dim:label' 类目
  d: string;          // date YYYY-MM-DD,空串表示缺
  c: number;          // score(论文评分);0/NaN 表示无
}

/** 语料产物形态。 */
export interface SearchCorpus {
  v: 1;
  generatedAt: string;
  fields: readonly string[];       // 必须等于 SEARCH_FIELDS
  conceptCoverage: number;        // 实测今天 = 334/610 = 0.547;UI 据此提示
  rows: SearchCorpusRow[];
}

/**
 * 搜索模式。'empty' = 没输入查询时不跑 retrieval,直接返回全集(作为 UI initial state)。
 *
 * 渐进式降级链:
 *   bm25+notes (有 BM25 命中 + 笔记命中)
 *     └→ bm25       (BM25 命中,笔记索引不可用或无笔记命中)
 *         └→ substring (没拉到语料 / 字段对不上 / < 2 字 CJK 查询)
 *             └→ empty (没输入)
 */
export type SearchMode = 'bm25' | 'bm25+notes' | 'substring' | 'empty';

/** 降级原因。UI 看到 degradedFrom 字段时,工具栏给出可读的失败原因胶囊。 */
export type SearchDegradeReason =
  | 'corpus-fetch-failed'        // fetch /search-corpus.json 失败 / 404
  | 'corpus-schema-mismatch'     // 语料 fields 与编译期常量不符
  | 'no-tokens'                  // query 被 tokenize 成空集(全停用词 / < 2 字 CJK)
  | 'no-hits';                   // BM25 全 0,UI 应降级到 substring 试一遍

/** 单条命中。canonicalId 是 join user-library 的键;noteScore>0 时 noteOnly 决定是否显示「笔记」徽章。 */
export interface SearchHit {
  id: string;
  canonicalId: string;
  score: number;
  corpusScore: number;
  noteScore: number;
  matchedFields: string[];
  noteOnly: boolean;
}

/** searchPapers() 返回值。UI 据此画模式胶囊 + degrade 提示。
 *  stats 字段全部上 hop,方便做 perf log 与调试面板。 */
export interface SearchResult {
  hits: SearchHit[];
  mode: SearchMode;
  degradedFrom?: SearchMode;
  degradeReason?: SearchDegradeReason;
  stats: {
    tookMs: number;
    totalHits: number;
    noteHits: number;
    indexedDocs: number;
    notesSearched: boolean;
  };
}

/** 客户端现建倒排的最小 BM25 索引形态。
 *  由 lib/search/index.ts 在 fetch 后构造,不存盘。
 *  字段精简为最小 perf needs:term→posting list,以及 per-doc 长度。 */
export interface Bm25Index {
  /** avgdl,O(1) 取 */
  avgDl: number;
  /** doc id 数组,与 posting 对齐 */
  docs: { canonicalId: string; id: string; dl: number }[];
  /** term → Uint32Array(docIdx, ...) 紧凑编码。32 位整数足以覆盖 610 篇。
   *  因 bigram 后 term 数量极大,稀疏字典 + 每 term 平铺数组的 posture 在浏览器上是
   *  可接受的;真要做极致 perf 可换 typed array,但 v1 不上。 */
  postings: Map<string, Uint32Array>;
  /** 反查用:docIdx → dl;与 docs[].dl 重,但 map 速度更快 */
  dl?: Map<number, number>;
}

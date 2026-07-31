// astro-src/lib/search/index.ts — searchPapers(query, opts) 客户端 orchestrator.
//
// 阶段 4 BM25(STUB 桩):paper-retrieval-core.mjs::buildBm25Index / scoreBm25 还没合入。
// 本文件先用一个**最简 okapi BM25 + bigram + fieldBoost-MAX** 自带实现跑通,
// 等 Stage 4 合入后切到 paper-retrieval-core.mjs 共享实现(swap 一处即可)。
//
// 设计目标(plan "阶段 5/6 数据契约"):
//   - searchPapers 是唯一公开 entry;UI 不直接调 corpus / index.ts 内部实现。
//   - 渐进式降级:bm25+notes → bm25 → substring → empty,每步生成 SearchResult.stats。
//   - 字段一致性 guard:与 corpus.ts 联动,fields 不符拒建索引。
//   - opts.notesSnapshot:notes:ReadonlyMap<canonicalId, noteText>;为空时不跑笔记通道,降级到 bm25。
//
// 性能基线(今天):288 KB gz 语料 + 79 rows;browser 内 buildBm25Index 一次性 ~30ms,40 query 60fps。
//
// 复用 plan 关键决策:① CJK overlap-bigram,不用单字;② fieldBoost 取命中位 **MAX**,
//  否则长字段重复命中会双吃分抵消 b 归一化;③ idf = ln(1+(N-df+0.5)/(df+0.5));④ <2 字纯
//  CJK 查询直接 no-tokens → substring。

import { SEARCH_FIELDS, type Bm25Index, type SearchCorpusRow, type SearchMode, type SearchResult } from './types';
import { fetchSearchCorpus, pickField } from './corpus';

export interface SearchPapersOptions {
  /** 笔记语料:canonicalId → 笔记 markdown。undefined/空 时不跑笔记通道。 */
  notesSnapshot?: ReadonlyMap<string, string>;
  /** baseUrl,默认 '' (与 Astro 的 fetch 一致)。 */
  baseUrl?: string;
  /** 命中后 cap;0 = 不限。默认 200。 */
  topK?: number;
  /** notes 通道权重系数;默认 0.35。 */
  noteBlend?: number;
  /** 调试钩子:期间不返回,直接 console.warn 命中数。 */
  debug?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Tokenize (CJK overlap-bigram + ASCII 词;共用 tokenize 与 BM25)
// ────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set<string>([
  'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'for', 'is', 'are',
  'with', 'that', 'this', 'as', 'by', 'we', 'our', 'it', 'be',
  '的', '了', '在', '是', '和', '与', '或', '把', '被', '我', '你', '他', '她', '它',
]);

/** tokenize 一个查询。返回 bm25 token 列表(已过滤停用词 + 长度 ≥ 2)。
 *  CJK 部分走 overlap-bigram,其它走空格分词。 */
export function tokenizeBm25(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // CJK 段 → overlap-bigram
  const cjkMatches = text.match(/[一-鿿]+/g) || [];
  for (const seg of cjkMatches) {
    if (seg.length < 2) continue;
    for (let i = 0; i < seg.length - 1; i++) {
      const bi = seg.slice(i, i + 2);
      if (!STOP_WORDS.has(bi)) out.push(bi);
    }
  }
  // ASCII 段
  const asciiMatches = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of asciiMatches) {
    if (w.length < 2) continue;
    if (STOP_WORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

/** 把字符串字段做同样 tokenize。 */
function tokenizeFieldString(s: string): string[] {
  if (!s) return [];
  const out: string[] = [];
  const cjkMatches = s.match(/[一-鿿]+/g) || [];
  for (const seg of cjkMatches) {
    if (seg.length < 2) continue;
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  }
  const asciiMatches = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of asciiMatches) {
    if (w.length < 2) continue;
    out.push(w);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// BM25 index build / score
// ────────────────────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;

interface IndexedDoc {
  canonicalId: string;
  id: string;
  /** per-field token 数组(已经 tokenize,扁平) */
  fields: string[][];
  /** 总 token 数(算 length norm) */
  dl: number;
  /** 全部 term 的出现计数 — 不存全 tf,只在 score 时按字段取 max tf。 */
  tfSum: Map<string, number>;
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 2.0,
  title_zh: 2.0,
  tldr: 1.2,
  segments: 1.0,
  authors: 0.6,
  // Stage 9 bump: 1.5 → 2.5,概念层已真渲染(阶段 9 真值来自 docs/papers/ frontmatter,
  // 实测 334/610 论文带 concepts)。Stage 5 时压 1.5 是因为覆盖率不到 50% 会让 45% 论文
  // 系统性沉底;现在 chips + 概念页都接好了,提到 2.5 让 concept 命中明显往上拉。
  concepts: 2.5,
  categories: 0.8,
};

/** 给定一行 + 一个 query token 列表 → 各字段命中数与权重(MAX boost)。 */
function fieldHitsAndMaxBoost(
  fields: string[][],
  tokens: string[],
): { df: number; fieldMax: number } {
  let df = 0;
  let fieldMax = 0;
  for (let f = 0; f < fields.length; f++) {
    const fieldTokens = fields[f];
    if (!fieldTokens.length) continue;
    // 该字段对每个 token 的命中数
    let fieldHit = 0;
    for (const t of tokens) {
      let cnt = 0;
      for (const tt of fieldTokens) if (tt === t) cnt++;
      fieldHit = Math.max(fieldHit, cnt);  // MAX inside field
    }
    if (fieldHit > 0) {
      df++;
      const boost = (FIELD_WEIGHTS[SEARCH_FIELDS[f]] ?? 1) * fieldHit;
      if (boost > fieldMax) fieldMax = boost;
    }
  }
  return { df, fieldMax };
}

/** 从语料建 BM25 倒排。返回 IndexedDoc[] + postings map。 */
export function buildBm25Index(rows: SearchCorpusRow[]): {
  docs: IndexedDoc[];
  postings: Map<string, number[]>;  // term → docIdx list
} {
  const docs: IndexedDoc[] = [];
  const postings = new Map<string, number[]>();
  for (let di = 0; di < rows.length; di++) {
    const row = rows[di];
    const fields: string[][] = [];
    for (const f of SEARCH_FIELDS) {
      const v = pickField(row, f);
      if (typeof v === 'string') fields.push(tokenizeFieldString(v));
      else fields.push(v.slice());  // string[] (concepts / categories) — 直接用,不再 tokenize
    }
    const tfSum = new Map<string, number>();
    let dl = 0;
    for (const ft of fields) {
      for (const t of ft) {
        tfSum.set(t, (tfSum.get(t) || 0) + 1);
        dl++;
      }
    }
    docs.push({
      canonicalId: row.cx,
      id: row.i,
      fields,
      dl,
      tfSum,
    });
    for (const t of tfSum.keys()) {
      const arr = postings.get(t);
      if (arr) arr.push(di);
      else postings.set(t, [di]);
    }
  }
  return { docs, postings };
}

// ────────────────────────────────────────────────────────────────────────────
// Notes index + blending
// ────────────────────────────────────────────────────────────────────────────

interface NotesIndex {
  docs: { canonicalId: string; tokens: string[] }[];
  /** 笔记文本经 stripMarkdown + wikilink 剥后的 tokens */
  tfSum: Map<string, number>;
  postings: Map<string, number[]>;
}

/** 简单剥 markdown / wikilink;只服务于 BM25 倒排,不追求高保真。 */
function stripNoteMarkdown(s: string): string {
  return s
    .replace(/\[\[([^\]]+)\]\]/g, '$1')  // wikilink [[display]] → display
    .replace(/!\[\[[^\]]+\]\]/g, ' ')       // embed ![[...]] 删
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](href) → text
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function buildNotesIndex(notesSnapshot: ReadonlyMap<string, string>): NotesIndex {
  const docs: { canonicalId: string; tokens: string[] }[] = [];
  const tfSum = new Map<string, number>();
  const postings = new Map<string, number[]>();
  let di = 0;
  for (const [canonicalId, raw] of notesSnapshot) {
    if (!raw || !raw.trim()) continue;
    const stripped = stripNoteMarkdown(raw);
    const tokens = tokenizeFieldString(stripped);
    if (!tokens.length) continue;
    const local: Map<string, number> = new Map();
    for (const t of tokens) {
      local.set(t, (local.get(t) || 0) + 1);
      tfSum.set(t, (tfSum.get(t) || 0) + 1);
    }
    docs.push({ canonicalId, tokens });
    for (const t of local.keys()) {
      const arr = postings.get(t);
      if (arr) arr.push(di);
      else postings.set(t, [di]);
    }
    di++;
  }
  return { docs, tfSum, postings };
}

function scoreNotesBm25(
  ni: NotesIndex,
  tokens: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!tokens.length || ni.docs.length === 0) return out;
  const N = ni.docs.length;
  // 平均 dl
  let totalLen = 0;
  for (const d of ni.docs) totalLen += d.tokens.length;
  const avgDl = totalLen / Math.max(1, N);
  for (const t of tokens) {
    const docIdxs = ni.postings.get(t);
    if (!docIdxs) continue;
    const df = docIdxs.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const idx of docIdxs) {
      const doc = ni.docs[idx];
      const tf = countOccurrences(doc.tokens, t);
      const dlNorm = 1 - BM25_B + BM25_B * (doc.tokens.length / Math.max(1, avgDl));
      const inc = idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * dlNorm));
      out.set(doc.canonicalId, (out.get(doc.canonicalId) || 0) + inc);
    }
  }
  return out;
}

function countOccurrences(arr: string[], target: string): number {
  let n = 0;
  for (const x of arr) if (x === target) n++;
  return n;
}

// ────────────────────────────────────────────────────────────────────────────
// Min-max normalization → [0, 1]
// ────────────────────────────────────────────────────────────────────────────

function minMaxNorm(values: Map<string, number>): Map<string, number> {
  if (values.size === 0) return values;
  let min = Infinity, max = -Infinity;
  for (const v of values.values()) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) {
    // 全相等 — 平局给 0(没有 winner);UI 不应该显示降级提示
    const out = new Map<string, number>();
    for (const k of values.keys()) out.set(k, 0);
    return out;
  }
  const out = new Map<string, number>();
  for (const [k, v] of values) out.set(k, (v - min) / (max - min));
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level: searchPapers
// ────────────────────────────────────────────────────────────────────────────

/**
 * 单 entry 检索。
 *
 * 模式优先级:
 *   1. 空 query → mode 'empty',hits = 0,UI 不跑 ranking。
 *   2. 拉不到语料 / schema-mismatch → mode 'substring',且 notesSnapshot 也为 undefined;
 *      UI 回退到历史 substring filter(paper-filter.filterBySearch)。
 *   3. token 为 0 → mode 'substring' + degradeReason='no-tokens'。
 *   4. token 跑 BM25,0 命中 → mode 'substring' + degradeReason='no-hits'。
 *   5. BM25 命中(notes 缺/无)→ mode 'bm25'。
 *   6. BM25 + 笔记命中 → mode 'bm25+notes'。
 */
export async function searchPapers(
  query: string,
  opts: SearchPapersOptions = {},
): Promise<SearchResult> {
  const t0 = performance.now();
  const topK = opts.topK ?? 200;
  const noteBlend = opts.noteBlend ?? 0.35;
  const baseUrl = opts.baseUrl ?? '';
  const notesSnapshot = opts.notesSnapshot;

  const q = (query || '').trim();

  // 1) empty
  if (!q) {
    return {
      hits: [],
      mode: 'empty',
      stats: {
        tookMs: Math.round(performance.now() - t0),
        totalHits: 0,
        noteHits: 0,
        indexedDocs: 0,
        notesSearched: false,
      },
    };
  }

  const corpus = await fetchSearchCorpus(baseUrl);
  if (!corpus) {
    return {
      hits: [],
      mode: 'substring',
      degradedFrom: 'bm25',
      degradeReason: 'corpus-fetch-failed',
      stats: {
        tookMs: Math.round(performance.now() - t0),
        totalHits: 0,
        noteHits: 0,
        indexedDocs: 0,
        notesSearched: false,
      },
    };
  }

  const tokens = tokenizeBm25(q);
  const indexedDocs = corpus.rows.length;

  if (tokens.length === 0) {
    return {
      hits: [],
      mode: 'substring',
      degradedFrom: 'bm25',
      degradeReason: 'no-tokens',
      stats: {
        tookMs: Math.round(performance.now() - t0),
        totalHits: 0,
        noteHits: 0,
        indexedDocs,
        notesSearched: false,
      },
    };
  }

  // BM25 主搜
  const { docs, postings } = buildBm25Index(corpus.rows);
  const corpusScores = new Map<string, number>();
  if (docs.length > 0) {
    let totalLen = 0;
    for (const d of docs) totalLen += d.dl;
    const avgDl = totalLen / docs.length;
    const N = docs.length;
    for (let di = 0; di < docs.length; di++) {
      const d = docs[di];
      let s = 0;
      for (const t of tokens) {
        const docIdxs = postings.get(t);
        if (!docIdxs || docIdxs.indexOf(di) < 0) continue;
        const df = docIdxs.length;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        const tf = d.tfSum.get(t) ?? 0;
        if (tf === 0) continue;
        const { fieldMax } = fieldHitsAndMaxBoost(d.fields, [t]);
        const dlNorm = 1 - BM25_B + BM25_B * (d.dl / Math.max(1, avgDl));
        s += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * dlNorm)) * fieldMax;
      }
      if (s > 0) corpusScores.set(d.canonicalId, s);
    }
  }

  // 笔记通道(可选)
  let noteScores: Map<string, number> = new Map();
  let notesSearched = false;
  if (notesSnapshot && notesSnapshot.size > 0) {
    notesSearched = true;
    const ni = buildNotesIndex(notesSnapshot);
    const raw = scoreNotesBm25(ni, tokens);
    noteScores = minMaxNorm(raw);
  }

  const corpusNorm = minMaxNorm(corpusScores);

  // 合并 final 分数; noteOnly = true if corpusScore === 0
  const merged = new Map<string, { canonicalId: string; id: string; corpus: number; note: number; final: number; matchedFields: string[]; noteOnly: boolean }>();

  for (const [cx, c] of corpusNorm) {
    const row = corpus.rows.find((r) => r.cx === cx);
    if (!row) continue;
    const n = noteScores.get(cx) ?? 0;
    const final = c + noteBlend * n;
    if (final <= 0) continue;
    merged.set(cx, {
      canonicalId: cx,
      id: row.i,
      corpus: corpusScores.get(cx) ?? 0,
      note: noteScores.get(cx) ?? 0,
      final,
      matchedFields: [],
      noteOnly: false,
    });
  }
  // 仅命中笔记的也入榜
  for (const [cx, n] of noteScores) {
    if (merged.has(cx)) continue;
    const row = corpus.rows.find((r) => r.cx === cx);
    if (!row) continue;
    if (n <= 0) continue;
    const final = noteBlend * n;
    merged.set(cx, {
      canonicalId: cx,
      id: row.i,
      corpus: 0,
      note: n,
      final,
      matchedFields: [],
      noteOnly: true,
    });
  }

  let hits = Array.from(merged.values()).sort((a, b) => b.final - a.final);
  if (topK > 0) hits = hits.slice(0, topK);

  const totalHits = hits.length;
  const noteHits = hits.filter((h) => h.noteOnly || h.note > 0).length;
  const anyNote = noteScores.size > 0;

  // 0 命中 → 降级到 substring(给 UI 兜底)
  if (totalHits === 0) {
    return {
      hits: [],
      mode: 'substring',
      degradedFrom: 'bm25',
      degradeReason: 'no-hits',
      stats: {
        tookMs: Math.round(performance.now() - t0),
        totalHits: 0,
        noteHits: 0,
        indexedDocs,
        notesSearched,
      },
    };
  }

  // 6) 模式判断
  let mode: SearchMode;
  if (anyNote && noteHits > 0) mode = 'bm25+notes';
  else mode = 'bm25';

  const result: SearchResult = {
    hits: hits.map((h) => ({
      id: h.id,
      canonicalId: h.canonicalId,
      score: h.final,
      corpusScore: h.corpus,
      noteScore: h.note,
      matchedFields: h.matchedFields,
      noteOnly: h.noteOnly,
    })),
    mode,
    stats: {
      tookMs: Math.round(performance.now() - t0),
      totalHits,
      noteHits,
      indexedDocs,
      notesSearched,
    },
  };
  if (opts.debug) {
    // eslint-disable-next-line no-console
    console.log('[search] q=', q, 'mode=', mode, 'hits=', totalHits, 'noteHits=', noteHits);
  }
  return result;
}

// 论文 RAG 检索核心算法 — 纯 ESM、无浏览器依赖。
//
// 抽出来是为了让 Python 端到端测试能直接 spawn `node paper-retrieval-core.mjs`
// 验证,不依赖 tsx/TypeScript 编译管线。
//
// 提供:
//   - segmentText(txt): 把论文纯文本切块并标记每块首行是否像标题
//   - findSectionBlock(blocks, ref): 找 §X.Y / 关键词对应段起点
//   - collectSection(blocks, startIdx, maxChars): 拿到下一标题为止
//   - rankSegmentsByQuery(segments, query, topK): TF 排序
//   - withNeighborhood(topHits, segments): 加前后 1 段上下文并排序
//
// paper-fulltext.ts 的 getSection / searchInTxt 只是这些纯逻辑 +
// loadLocalTxt loadLocal 的薄壳。

// ---------------------------------------------------------------------------
// 段切分 + 标题识别
// ---------------------------------------------------------------------------

/**
 * 把论文文本按双换行(\n\s*\n)切成段落块,识别每块首行是否像标题。
 *
 * @param {string} txt
 * @returns {{ text: string, heading: string | null }[]}
 */
export function segmentText(txt) {
  const blocks = txt.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((text) => {
    const firstLine = text.split('\n')[0].trim();
    return { text, heading: isHeadingLine(firstLine) ? firstLine : null };
  });
}

/**
 * 启发式判断一行是否像 LaTeX/PDF 章节标题。
 * 规则:不要太长、不以句末标点结尾,匹配编号 / § / 全大写短行。
 */
export function isHeadingLine(l) {
  if (l.length < 3 || l.length > 140) return false;
  if (/[.!?。！？]\s*$/.test(l)) return false;
  // 编号开头 1. / 1.1 / §3 / 3.2
  if (/^([0-9]+\.)+[0-9]*\s+\S/.test(l)) return true;
  // 单编号 + 标题词 "4 Experiments" / "5 Conclusion" / "6 Appendix"
  // ar5iv 经常把 chapter 渲染成无小数点格式,这里补回来。
  if (/^\d+\s+[A-Z][A-Za-z]/.test(l)) return true;
  // 罗马数字 "IV. Conclusion"
  if (/^[IVX]+\.\s+\S/.test(l)) return true;
  // § 编号 "§3" / "§3.2"
  if (/^§\s*\d+/.test(l)) return true;
  // 全大写短行("EXPERIMENTS" / "RELATED WORK")
  const words = l.split(/\s+/).filter(Boolean);
  if (words.length > 12) return false;
  if (l === l.toUpperCase() && /[A-Z]/.test(l)) return true;
  return false;
}

/**
 * 在 segmented 数组里找 ref 对应的段起点。
 * 两种策略:数字编号精确匹配 → 子串回退。
 *
 * @param {{heading: string|null}[]} blocks
 * @param {string} ref "3.2" / "§3" / "Training Pipeline" / "Hypernetwork"
 * @returns {number} startIdx, -1 = 没找到
 */
export function findSectionBlock(blocks, ref) {
  const refNorm = ref.replace(/^§/, '').trim().toLowerCase();
  const refIsNumeric = /^\d+(\.\d+)*$/.test(ref);

  if (refIsNumeric) {
    const prefix = ref + ' ';
    const i = blocks.findIndex(
      (b) => b.heading && b.heading.toLowerCase().startsWith(prefix),
    );
    if (i >= 0) return i;
  }

  // 子串回退:ref 在 heading 里命中(忽略大小写 + 标点)
  const refClean = refNorm.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  return blocks.findIndex((b) => {
    if (!b.heading) return false;
    const hClean = b.heading.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
    return hClean.includes(refClean) || refClean.includes(hClean);
  });
}

/**
 * 从 startIdx 开始收集段落,直到下一个 heading(简单策略:任意 heading 都停)。
 *
 * @param {{text: string}[]} blocks
 * @param {number} startIdx
 * @param {number} maxChars
 * @returns {string}
 */
export function collectSection(blocks, startIdx, maxChars) {
  if (startIdx < 0 || startIdx >= blocks.length) return '';
  const out = [];
  let bytes = 0;
  for (let i = startIdx; i < blocks.length; i++) {
    if (i > startIdx && blocks[i].heading !== null) break;
    const blockText = blocks[i].text;
    if (bytes + blockText.length > maxChars) {
      out.push(blockText.slice(0, maxChars - bytes));
      out.push('\n[...该章节已截断...]');
      break;
    }
    out.push(blockText);
    bytes += blockText.length;
  }
  return out.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// 关键词检索 — TF 排序
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'for', 'is', 'are',
  'with', 'that', 'this', 'as', 'by', 'we', 'our', 'it', 'be',
  '的', '了', '在', '是', '和', '与', '或', '把', '被',
]);

/**
 * 把查询切成有意义 token(过滤停用词 + 长度 < 2)。
 */
export function tokenize(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * 对每段按 token 命中数排序。长段降权避免"长段落靠量取胜"。
 *
 * @param {string[]} segments
 * @param {string} query
 * @param {number} topK
 * @returns {{idx: number, score: number}[]}
 */
export function rankSegmentsByQuery(segments, query, topK) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const hits = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();
    let score = 0;
    for (const t of tokens) {
      const matches = seg.split(t).length - 1;
      score += matches * (300 / Math.max(80, segments[i].length));
    }
    if (score > 0) hits.push({ idx: i, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

/**
 * 给 top hits 加前后 1 段上下文,按文档原序排好。
 *
 * @param {{idx: number}[]} topHits
 * @param {string[]} segments
 * @returns {{ idx: number, isPrimary: boolean }[]}
 */
export function withNeighborhood(topHits, segments) {
  const seen = new Set();
  const ordered = [];
  for (const h of topHits) {
    for (let j = Math.max(0, h.idx - 1); j <= Math.min(segments.length - 1, h.idx + 1); j++) {
      if (!seen.has(j)) {
        seen.add(j);
        ordered.push({ idx: j, isPrimary: false });
      }
    }
  }
  ordered.sort((a, b) => a.idx - b.idx);
  for (const it of ordered) {
    if (topHits.some((h) => h.idx === it.idx)) it.isPrimary = true;
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// BM25 打分器(Stage 4) — 全字段 CJK 重叠 bigram + Latin word
// ---------------------------------------------------------------------------
//
// 设计要点(plan §阶段/Stage 4):
//   - CJK 用「重叠 bigram」(强化 → 强化/化学)而不是单字(否则「学习」会命中
//     任何含「学」的论文)。Latin 用 word,沿用现有 [a-z0-9一-鿿] 思路但不分
//     出数字。
//   - per-field BM25 公式:
//
//         idf(t)     = ln(1 + (N - df + 0.5) / (df + 0.5))         // 恒正
//         tfScore(d) = tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl/avgdl))
//         fieldScore = idf * tfScore
//
//     命中多个字段 → 取 MAX(不是 SUM),否则长字段(segments)重复命中双吃分。
//   - BM25_K1 / BM25_B 为可调常量,与现有 Python src/2.1.retrieval_papers_bm25.py
//     的 1.5/0.75 对齐 — 客户端不需要两套常数。
//   - < 2 字纯 CJK 查询直接返回 {empty: true};UI 层据此降级到 substring。
//
// 调用方约定(rows 形态):
//   [
//     { id, fields: { title, tldr, segments, authors, concepts, ... } },
//     ...
//   ]
// fieldsIndex 把 "field 名 → 在 row 上的 getter" 抽出来,避免循环时反射。
// ---------------------------------------------------------------------------

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/** 默认字段权重:title/tldr 给得高,concepts 中等,segments 抑制长字段权重。 */
export const DEFAULT_FIELD_WEIGHTS = Object.freeze({
  title: 2.0,
  title_zh: 2.0,
  tldr: 1.5,
  segments: 1.0,
  authors: 0.8,
  concepts: 1.5,
  categories: 0.6,
});

const CJK_CHAR_RE = /[㐀-鿿]/;
// word: latin 字母数字串 / 数字串;CJK: 单个 CJK 字符(Latin 词在 bigram 阶段不参与)
// bigram 阶段把连续 CJK 切成 2-gram 串,过滤掉跨标点 bigram。
const WORD_RE = /[A-Za-z][A-Za-z0-9_]*|\d+/g;

/**
 * 把文本切成 token:
 *   - CJK 连续段 → 重叠 bigram(去掉跨标点的 bigram)
 *   - Latin 词 → 整个 word(原大小写保留,比较时小写化)
 *   - 数字串 → 整个数字串(权重 0;生产环境一般会去掉)
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeBM25(text) {
  if (!text) return [];
  const tokens = [];
  // 先抽出所有 Latin 词及其位置
  const latinSpans = [];
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text)) !== null) {
    latinSpans.push([m.index, m.index + m[0].length, m[0]]);
  }
  // 找出所有 CJK 区间(latin 词之间的连续 CJK 段)
  let cursor = 0;
  for (const [start, end, word] of latinSpans) {
    _emitCjkBigrams(text, cursor, start, tokens);
    tokens.push(word);
    cursor = end;
  }
  _emitCjkBigrams(text, cursor, text.length, tokens);
  // 去空 + 过滤停用词(大小写不敏感:CJK bigram 不命中英文停用词表)
  const out = [];
  for (const t of tokens) {
    if (!t) continue;
    if (STOP_WORDS.has(t.toLowerCase())) continue;
    out.push(t);
  }
  return out;
}

function _emitCjkBigrams(text, from, to, outTokens) {
  // 抽 [from, to) 内连续 CJK 字符,切成 bigram
  let segmentStart = -1;
  for (let i = from; i < to; i++) {
    const c = text.charAt(i);
    if (CJK_CHAR_RE.test(c)) {
      if (segmentStart === -1) segmentStart = i;
    } else {
      if (segmentStart !== -1) {
        _sliceBigrams(text, segmentStart, i, outTokens);
        segmentStart = -1;
      }
    }
  }
  if (segmentStart !== -1) {
    _sliceBigrams(text, segmentStart, to, outTokens);
  }
}

function _sliceBigrams(text, from, to, outTokens) {
  for (let i = from; i < to - 1; i++) {
    outTokens.push(text.substring(i, i + 2));
  }
}

/**
 * 检查 query 是否「纯 CJK 且长度 < 2」。这种情况大到无法形成 bigram,直接判 no-tokens。
 *
 * @param {string} query
 * @returns {boolean}
 */
export function isPureCjkShortQuery(query) {
  if (!query) return false;
  let hasCjk = false;
  let cjkCount = 0;
  for (const ch of query) {
    if (CJK_CHAR_RE.test(ch)) {
      hasCjk = true;
      cjkCount++;
    }
  }
  return hasCjk && cjkCount < 2 && query.replace(/[A-Za-z0-9\s]/g, "") === query.replace(/\s/g, "");
}

/**
 * 构建 BM25 倒排索引。
 *
 * @param {Array<{id: string}>} rows
 * @param {Record<string, string[]|((row: any) => string)>} fieldsIndex
 *        field 名 → 一个 getter:
 *          - 函数 (row) => string:最灵活,调用方自定义取值;
 *          - string[]:dotted path 数组(每项是 row 上的 key 路径,会被合并);
 *          - string:单 key 路径(取 row[k])。
 *        CLI 走 string[] 形态,因为 JSON 不能传函数;浏览器侧也推荐走 path 形态,
 *        只有需要复杂拼接(如 `title + " " + title_zh`)时才用函数。
 * @returns {{
 *   postings: Map<string, number[]>,
 *   docLen: number[],
 *   avgdl: number,
 *   N: number,
 *   fieldMasks: Map<string, number[]>,
 *   fieldTf: Map<string, Map<number, Map<string, number>>>,
 *   rows: Array<{id: string}>
 * }}
 *        postings: term → [docIdx, docIdx, ...] 全局倒排(每个字段的命中合并后唯一)
 *        fieldMasks: field → boolean 数组(是否命中),供 MAX 聚合用
 *        fieldTf:   field → docIdx → term → tf(scoreBm25 用它算 BM25 tf 项,无需
 *                   再 tokenize 原文)
 */
export function buildBm25Index(rows, fieldsIndex) {
  const N = rows.length;
  /** @type {Map<string, number[]>} */
  const postings = new Map();
  /** @type {Map<string, number[]>} */
  const fieldMasks = new Map();
  /** @type {Map<string, Map<number, Map<string, number>>>} */
  const fieldTf = new Map();
  const docLen = new Array(N).fill(0);
  let totalLen = 0;

  for (let d = 0; d < N; d++) {
    const row = rows[d];
    let rowLen = 0;
    for (const [field, getter] of Object.entries(fieldsIndex)) {
      const raw = String(_resolveFieldGetter(getter)(row) || "");
      const tokens = tokenizeBM25(raw);
      const seenInField = new Map();
      for (const tok of tokens) {
        seenInField.set(tok, (seenInField.get(tok) || 0) + 1);
        rowLen++;
      }
      let mask = fieldMasks.get(field);
      if (!mask) {
        mask = new Array(N).fill(0);
        fieldMasks.set(field, mask);
      }
      if (seenInField.size > 0) mask[d] = 1;
      // fieldTf: field → docIdx → term → tf
      if (seenInField.size > 0) {
        let perDoc = fieldTf.get(field);
        if (!perDoc) {
          perDoc = new Map();
          fieldTf.set(field, perDoc);
        }
        perDoc.set(d, seenInField);
      }
      for (const tok of seenInField.keys()) {
        let arr = postings.get(tok);
        if (!arr) {
          arr = [];
          postings.set(tok, arr);
        }
        arr.push(d);
      }
    }
    docLen[d] = rowLen;
    totalLen += rowLen;
  }
  const avgdl = N > 0 ? totalLen / N : 0;
  return { postings, docLen, avgdl, N, fieldMasks, fieldTf, rows };
}

function _resolveFieldGetter(getter) {
  if (typeof getter === "function") return getter;
  if (Array.isArray(getter)) {
    return (row) => getter.map((k) => _dig(row, k)).filter(Boolean).join(" ");
  }
  if (typeof getter === "string") {
    return (row) => _dig(row, getter);
  }
  return () => "";
}

function _dig(obj, dotted) {
  if (!obj || !dotted) return "";
  let cur = obj;
  for (const part of String(dotted).split(".")) {
    if (cur == null) return "";
    cur = cur[part];
  }
  if (cur == null) return "";
  if (Array.isArray(cur)) return cur.join(" ");
  return String(cur);
}

/**
 * 对单个 query 计算 BM25 分数。
 *
 * @param {ReturnType<typeof buildBm25Index>} index
 * @param {string} query
 * @param {{
 *   k1?: number, b?: number,
 *   fieldWeights?: Record<string, number>,
 * }} [opts]
 * @returns {{
 *   scores: number[],
 *   matchedFields: string[][],
 *   perFieldScores: Record<string, number[]>,
 *   empty?: true,
 *   reason?: 'no-tokens' | 'pure-cjk-short'
 * }}
 */
export function scoreBm25(index, query, opts = {}) {
  const k1 = opts.k1 ?? BM25_K1;
  const b = opts.b ?? BM25_B;
  const fieldWeights = { ...DEFAULT_FIELD_WEIGHTS, ...(opts.fieldWeights || {}) };

  if (isPureCjkShortQuery(query)) {
    return { scores: [], matchedFields: [], perFieldScores: {}, empty: true, reason: "pure-cjk-short" };
  }
  const queryTokens = tokenizeBM25(query);
  if (!queryTokens.length) {
    return { scores: [], matchedFields: [], perFieldScores: {}, empty: true, reason: "no-tokens" };
  }

  const { postings, docLen, avgdl, N, fieldMasks, fieldTf } = index;
  const scores = new Array(N).fill(0);
  /** @type {string[][]} */
  const matchedFields = new Array(N).fill(null).map(() => []);

  /** @type {Record<string, number[]>} */
  const perFieldScores = {};
  for (const field of fieldMasks.keys()) {
    perFieldScores[field] = new Array(N).fill(0);
  }

  for (const t of queryTokens) {
    const docs = postings.get(t);
    if (!docs || !docs.length) continue;
    const df = docs.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const d of docs) {
      const dl = docLen[d];
      if (dl === 0) continue;
      for (const [field, mask] of fieldMasks.entries()) {
        if (!mask[d]) continue;
        const perDoc = fieldTf.get(field);
        if (!perDoc) continue;
        const tfMap = perDoc.get(d);
        if (!tfMap) continue;
        const tf = tfMap.get(t);
        if (!tf) continue;
        const denom = tf + k1 * (1 - b + b * dl / avgdl);
        const tfScore = (tf * (k1 + 1)) / denom;
        const weight = fieldWeights[field] ?? 1.0;
        const contribution = idf * tfScore * weight;
        if (contribution > perFieldScores[field][d]) {
          perFieldScores[field][d] = contribution;
        }
        matchedFields[d].push(field);
      }
    }
  }
  for (let d = 0; d < N; d++) {
    let best = 0;
    for (const field of fieldMasks.keys()) {
      if (perFieldScores[field][d] > best) best = perFieldScores[field][d];
    }
    scores[d] = best;
    matchedFields[d] = Array.from(new Set(matchedFields[d]));
  }
  return { scores, matchedFields, perFieldScores };
}

/**
 * 给定 tokenize/buildBm25Index/scoreBm25 的入口壳:接收 rows+fieldsIndex 一次,
 * 之后可以反复对不同 query 调 score。
 *
 * @param {Array<{id: string}>} rows
 * @param {Record<string, string[]|((row: any) => string)>} fieldsIndex
 */
export function createBm25Scorer(rows, fieldsIndex) {
  const index = buildBm25Index(rows, fieldsIndex);
  return {
    index,
    score(query, opts) {
      return scoreBm25(index, query, opts);
    },
  };
}

/**
 * CLI 入口 — Python 测试 spawn `node` 调这个:
 *   echo '{"text":"强化学习 reward"}' | node paper-retrieval-core.mjs tokenize
 *   echo '{"rows":[...],"fieldsIndex":{...},"query":"..."}' | node paper-retrieval-core.mjs bm25
 *   echo '{"txt":"...","ref":"3.2"}' | node paper-retrieval-core.mjs getSection
 *   echo '{"txt":"...","query":"foo","topK":4}' | node paper-retrieval-core.mjs search
 *
 * 输出 JSON:
 *   tokenize → { tokens: string[] }
 *   bm25    → { scores: number[], matchedFields: string[][], empty?: true, reason?: string }
 *   getSection → { result: "<text>" | null }
 *   search → { result: string[] | null }
 */
async function main() {
  const [, , cmd] = process.argv;
  if (!cmd) {
    console.error(
      "usage: node paper-retrieval-core.mjs <getSection|search|tokenize|bm25>",
    );
    process.exit(2);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  if (cmd === "getSection") {
    const blocks = segmentText(input.txt);
    const startIdx = findSectionBlock(blocks, input.ref);
    const text = startIdx < 0 ? null : collectSection(blocks, startIdx, input.maxChars || 6000);
    process.stdout.write(JSON.stringify({ result: text }));
    return;
  }
  if (cmd === "search") {
    const segments = input.txt.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const hits = rankSegmentsByQuery(segments, input.query, input.topK || 4);
    if (!hits.length) {
      process.stdout.write(JSON.stringify({ result: null }));
      return;
    }
    const ordered = withNeighborhood(hits, segments);
    const result = ordered.map(
      (it) => `${it.isPrimary ? "★ " : "  "}${segments[it.idx]}`,
    );
    process.stdout.write(JSON.stringify({ result }));
    return;
  }
  if (cmd === "tokenize") {
    const tokens = tokenizeBM25(input.text || "");
    process.stdout.write(JSON.stringify({ tokens }));
    return;
  }
  if (cmd === "bm25") {
    const rows = input.rows || [];
    const fieldsIndex = input.fieldsIndex || {};
    const scorer = createBm25Scorer(rows, fieldsIndex);
    const out = scorer.score(input.query || "", input.opts || {});
    process.stdout.write(JSON.stringify(out));
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

// 仅在直接执行时跑 main,import 时不跑。
// 动态 import('node:url') 而非静态 import — Vite/Astro 在 bundle 浏览器侧模块
// 时会把静态 `node:url` externalize 成 stub,触发 fileURLToPath 报错;
// node:url 只在 CLI 直接跑这个 .mjs 时用,SSR 侧不会触碰。
const { fileURLToPath } = await import('node:url');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}

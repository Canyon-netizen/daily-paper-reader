// astro-src/lib/paper-relations/core.mjs
//
// 纯 ESM,零依赖,jaccard + tfidf 数学下沉。Stage 7 决策:
// 算法只有一份实现,TS 端(jaccard.ts / tfidf.ts / hybrid.ts)做类型化包装;
// prebuild build-search-corpus.mjs 动态 import 这个文件,在 node 进程里跑
// 610 篇 jaccard + tfidf → 输出 public/paper-relations.json(8 KB gz)。
//
// 为什么不直接 import TS 文件:
//   - .mjs 独立 node 跑(不走 Vite/Astro 编译管线),必须 mjs 格式。
//   - 把数学下沉成纯函数 + Node 可直接 require,TS 层是 facade,不会双份漂移。
//   - 漂移路径:注释钉不住,但 import 同源代码钉得住。
//
// 输入/输出都是无副作用的:{ rows: [{id, g:[...]}, ...], edges } 这种 JSON
// 友好形状,不直接吃 PaperListItem 类型(那个有 lib/paper 依赖)。

const CATEGORY_DIMS = ['venue', 'task', 'method', 'type'];

/**
 * 把 4-dim categories 拍平为 'dim:label' 字符串数组。
 * 与 lib/paper.ts:flattenCategories 行为一致,但不 import 那个模块以避免
 * 拖入 lib/taxonomies 链路。
 */
export function flattenCategories(c) {
  const out = [];
  const seen = new Set();
  if (!c) return out;
  for (const dim of CATEGORY_DIMS) {
    for (const label of c[dim] || []) {
      const k = `${dim}:${label}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Jaccard 边。无向(source<target),按交集/并集。 */
export function jaccardEdges(rows, minWeight = 0) {
  const tagSets = rows.map((r) => new Set(r.g || []));
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const Ai = tagSets[i];
    if (Ai.size === 0) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const Aj = tagSets[j];
      if (Aj.size === 0) continue;
      let inter = 0;
      const shared = [];
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
        source: rows[i].id,
        target: rows[j].id,
        weight: w,
        type: 'jaccard',
        shared,
      });
    }
  }
  return out;
}

/** 极简分词:CJK 块 + ASCII 字母数字块,与 lib/paper-relations/tfidf.ts 一致。 */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/u)
    .filter((t) => t.length > 1);
}

/** TF-IDF 余弦边。topK 每节点出边裁剪。minWeight 阈值。 */
export function tfidfEdges(rows, topK = 8, minWeight = 0) {
  if (rows.length < 2) return [];
  const docs = rows.map((r) =>
    tokenize([r.t || '', r.z || '', r.l || ''].join(' ')),
  );
  const df = new Map();
  for (const tokens of docs) {
    const seen = new Set();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const N = docs.length;
  const idf = new Map();
  for (const [t, d] of df.entries()) {
    idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  }
  const vectors = docs.map((tokens) => {
    const v = new Map();
    for (const t of tokens) {
      const tf = tokens.filter((x) => x === t).length;
      v.set(t, tf * (idf.get(t) || 0));
    }
    let norm = 0;
    for (const x of v.values()) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return { v, norm };
  });
  const edges = [];
  for (let i = 0; i < rows.length; i++) {
    const candidates = [];
    for (let j = i + 1; j < rows.length; j++) {
      let dot = 0;
      const smaller = vectors[i].v.size < vectors[j].v.size ? vectors[i].v : vectors[j].v;
      const larger = smaller === vectors[i].v ? vectors[j].v : vectors[i].v;
      for (const [t, w] of smaller) {
        const x = larger.get(t);
        if (x) dot += w * x;
      }
      const w = dot / (vectors[i].norm * vectors[j].norm);
      if (w >= minWeight) candidates.push({ target: rows[j].id, w });
    }
    candidates.sort((a, b) => b.w - a.w);
    for (const c of candidates.slice(0, topK)) {
      edges.push({
        source: rows[i].id,
        target: c.target,
        weight: c.w,
        type: 'tfidf',
      });
    }
  }
  return edges;
}

/**
 * Stage 7 入口:接收 rows(id + g + t + z + l),
 * 返回 { ids, edges } —— 与 public/paper-relations.json 的 schema 对齐。
 *
 * 边按源分组,每节点 topK(默认 8);mask:1=jaccard 2=tfidf 3=both。
 * weight 存 ×1000 整数,客户端统一 ÷ 1000。
 */
export function computeRelations(rows, opts = {}) {
  const topK = opts.topK ?? 8;
  const minWeight = opts.minWeight ?? 0;
  const j = jaccardEdges(rows, minWeight);
  const t = tfidfEdges(rows, topK, minWeight);
  const bySrc = new Map();
  for (const e of j) {
    const cur = bySrc.get(e.source) || [];
    cur.push({ ...e, mask: 1 });
    bySrc.set(e.source, cur);
  }
  for (const e of t) {
    const cur = bySrc.get(e.source) || [];
    const exist = cur.find((x) => x.target === e.target);
    if (exist) {
      exist.mask |= 2;
      exist.weight = (exist.weight + e.weight) / 2;
    } else {
      cur.push({ ...e, mask: 2 });
    }
    bySrc.set(e.source, cur);
  }
  const ids = rows.map((r) => r.id);
  const idxOf = new Map(ids.map((id, i) => [id, i]));
  const edges = {};
  for (const [src, arr] of bySrc.entries()) {
    arr.sort((a, b) => b.weight - a.weight);
    const top = arr.slice(0, topK);
    const list = [];
    for (const e of top) {
      const ti = idxOf.get(e.target);
      if (ti == null) continue;
      list.push([ti, Math.round(e.weight * 1000), e.mask]);
    }
    if (list.length > 0) edges[idxOf.get(src)] = list;
  }
  return { ids, edges };
}
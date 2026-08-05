// astro-src/scripts/build-search-corpus.mjs
// Build public/search-corpus.json + public/paper-relations.json.
//
// 设计要点:
//   - 跟 scripts/build-arxiv-index.mjs 风格同构 —— 用 ID_RE 过滤天然跳过
//     topic-seeds-*.md 等非论文文件,不写手维护 skip list。
//   - 与 lib/taxonomies 隔离:taxonomies.ts 走 Vite 静态 import(Vite 解析得到是 JSON),
//     但这条路径在 .mjs 独立 `node` 跑时是空白,build script 不引它,
//     只是字面量展开 categories 4 个 dim = task/method/type 的合法值集合
//     (从 config/taxonomies.json 直读,既避开 Vite 又避开 node:fs 客户端泄漏)。
//   - rows=0 而 docs 有 .md 时**非零退出**(fail-fast,不重演 333 篇 0 概念的静默坑)。
//
// 走法:  node astro-src/scripts/build-search-corpus.mjs
//     或: bun astro-src/scripts/build-search-corpus.mjs
//
// 输出:
//   public/search-corpus.json   (Stage 5;浏览器 BM25 源)
//   public/paper-relations.json (Stage 7;论文详情页"内容相似"卡的源)

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, 'docs');
const OUT_CORPUS = join(ROOT, 'public', 'search-corpus.json');
const OUT_RELATIONS = join(ROOT, 'public', 'paper-relations.json');

// 与 build-arxiv-index.mjs 同步 —— 不能两份正则在版本约定上漂。
//
// 双轨:arXiv id (YYMM.NNNNN) 优先;biorxiv/medrxiv/chemrxiv/topic/conference
// 退化为整文件名作 id(arxivId 留空)。这是论文库主索引,不能漏任何来源。
const ID_RE = /^(\d{4}\.\d{4,5})(?:v\d+)?/;
const NON_ARXIV_PREFIX_RE = /^(biorxiv|medrxiv|chemrxiv|topic|conference)/;

/** 与 lib/arxiv.ts 的 canonicalArxivId 等价 —— 但 build-time .mjs 不能跨 lib/ TS,
 *  只剥尾部 vN 这一件事,inline 实现。 */
function canonicalArxivId(arxivId) {
  return String(arxivId || '').trim().replace(/v\d+$/i, '');
}

/** 把 '2506.04455v2' 这类带版本号规范成 'YYMM.NNNNN vN' 形态,失败回空串。
 *  与 paper.ts:extractArxivIdFromPaperId 行为一致:版本号可选,捕获失败给空串不报错。 */
function extractArxivIdFromPaperId(id) {
  const m = id.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (!m) return '';
  return m[2] ? `${m[1]}${m[2]}` : m[1];
}

/** 4-dim categories → 'dim:label' 字符串,与 lib/paper.ts:flattenCategories 行为对齐。
 *  build 侧不复用 flattenCategories 是因为不想把 lib/ 反向拉 .mjs。 */
const DIM_NAMES = ['venue', 'task', 'method', 'type'];
function flattenCategories(c) {
  if (!c || typeof c !== 'object') return [];
  const out = [];
  const seen = new Set();
  for (const dim of DIM_NAMES) {
    const arr = c[dim];
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (!t) continue;
      const k = `${dim}:${t}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** score 归一到 0–1,缺分 → 0。
 *
 *  必须与 lib/paper-frontmatter/parse.ts:normalizeScore 保持同一规则:
 *  legacy `score: 8.0`(0–10 刻度)与现行 `score: 0.8`(0–1)混存,不归一会让
 *  BM25 打分里的 `c` 字段量纲不一致。此处是 .mjs 构建脚本,无法 import 那份
 *  .ts,规则改动时两边必须同步。
 */
function normalizeScore(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  const n = v > 1 ? v / 10 : v;
  return n > 1 ? 1 : n;
}

/** 标题轻量剥 TeX 标记 —— settings "已隐藏论文" 面板已经在用,这里再借一次。 */
function stripTitleMarkupLite(value) {
  let text = String(value || '');
  text = text.replace(/\$+/g, ' ');
  text = text.replace(/\\([A-Za-z]+)/g, '$1');
  text = text.replace(/[{}^_~]/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** 取 frontmatter:gray-matter 解析 + 容错(损坏文件不要让整个 build 挂)。 */
function readDoc(absPath) {
  try {
    const raw = readFileSync(absPath, 'utf-8');
    return matter(raw);
  } catch {
    return null;
  }
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (name.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

function pickPlainTitle(d) {
  const zh = d.title_zh_plain || (d.title_zh ? stripTitleMarkupLite(d.title_zh) : '');
  const en = d.title_plain || (d.title ? stripTitleMarkupLite(d.title) : '');
  return { zh: zh || '', en: en || '' };
}

function conceptsToNames(d) {
  if (!Array.isArray(d.concepts)) return [];
  const out = [];
  const seen = new Set();
  for (const c of d.concepts) {
    const n = c && typeof c === 'object' ? (c.display_name || c.name) : null;
    if (!n || typeof n !== 'string') continue;
    const t = n.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  const files = walk(DOCS_DIR);
  if (!files.length) {
    console.error('[search-corpus] no .md files under docs/ — refusing to emit empty corpus');
    process.exit(2);
  }

  const filesByCanonical = new Map();
  let matched = 0;
  for (const f of files) {
    const base = f.split(/[\\/]/).pop();
    const m = base.match(ID_RE);
    let canonical;
    let arxivId = '';
    if (m) {
      arxivId = m[1];
      canonical = canonicalArxivId(arxivId);
    } else if (NON_ARXIV_PREFIX_RE.test(base)) {
      // bioRxiv / medRxiv / chemRxiv / topic / conference —— 整文件名作 id
      canonical = base.replace(/\.md$/, '');
    } else {
      continue;  // README.md / path-spec.md / zotero-usage.md
    }
    matched++;
    const verMatch = arxivId.match(/v(\d+)$/);
    const version = verMatch ? Number(verMatch[1]) : 0;
    const parsed = readDoc(f);
    if (!parsed) continue;
    const cur = filesByCanonical.get(canonical);
    const fileRel = relative(ROOT, f).replace(/\\/g, '/');
    const entry = { version, file: f, rel: fileRel, fm: parsed.data || {}, body: parsed.content || '', arxivId };
    if (!cur || entry.version > cur.version) {
      filesByCanonical.set(canonical, entry);
    }
  }

  const rows = [];
  let conceptsCount = 0;
  for (const [canonicalId, ent] of filesByCanonical.entries()) {
    const d = ent.fm;
    const titles = pickPlainTitle(d);
    const arxivId = extractArxivIdFromPaperId(ent.rel.replace(/\.md$/, ''));
    const segments = [d.motivation || '', d.method || '', d.result || '', d.conclusion || '']
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(' • ');
    const concepts = conceptsToNames(d);
    if (concepts.length) conceptsCount++;
    rows.push({
      i: ent.rel.replace(/\.md$/, ''),
      x: arxivId,
      cx: canonicalId,
      t: titles.en,
      z: titles.zh,
      l: d.tldr || '',
      s: segments,
      a: d.authors || '',
      k: concepts,
      g: flattenCategories(d.categories),
      d: d.date || '',
      c: normalizeScore(d.score),
    });
  }

  // fail-fast:docs 里明明有论文(>0)却 rows=0,说明 ID_RE / path 解析坏了,坚决不写空文件挂掉。
  if (files.length > 0 && rows.length === 0) {
    console.error(
      `[search-corpus] matched ${matched}/${files.length} files but produced 0 rows — ` +
      'path / id regex drifted? aborting.',
    );
    process.exit(3);
  }

  rows.sort((a, b) => a.cx.localeCompare(b.cx));

  const corpus = {
    v: 1,
    generatedAt: new Date().toISOString(),
    fields: ['title', 'title_zh', 'tldr', 'segments', 'authors', 'concepts', 'categories'],
    conceptCoverage: rows.length ? conceptsCount / rows.length : 0,
    rows,
  };

  writeFileSync(OUT_CORPUS, JSON.stringify(corpus));
  const dt = Date.now() - startedAt;
  console.log(
    `[search-corpus] rows=${rows.length} matched=${matched} ` +
    `concepts=${conceptsCount} coverage=${(corpus.conceptCoverage * 100).toFixed(1)}% ` +
    `took=${dt}ms -> public/search-corpus.json`,
  );
  if (rows.length && rows.length < 5) {
    console.log(`  sample cx: ${rows.slice(0, 5).map((r) => r.cx).join(', ')}`);
  }

  // Stage 7 —— 同一份 walk 多产出 paper-relations.json。
  // 数学下沉到 astro-src/lib/paper-relations/core.mjs,这里动态 import
  // (避免 Vite 把它拖进客户端 chunk)。
  await writePaperRelations(rows, startedAt);
}

async function writePaperRelations(rows, startedAt) {
  const core = await import(pathToFileURL(join(ROOT, 'astro-src', 'lib', 'paper-relations', 'core.mjs')).href);
  // 构造 relations 算法输入:{ id, g, t, z, l }。
  const relRows = rows.map((r) => ({ id: r.i, g: r.g, t: r.t, z: r.z, l: r.l }));
  const rel = core.computeRelations(relRows, { topK: 8, minWeight: 0 });
  const artifact = {
    v: 1,
    algorithm: 'hybrid',
    generatedAt: new Date().toISOString(),
    ids: rel.ids,
    edges: rel.edges,
  };
  writeFileSync(OUT_RELATIONS, JSON.stringify(artifact));
  let edgeCount = 0;
  for (const arr of Object.values(rel.edges)) edgeCount += arr.length;
  console.log(
    `[paper-relations] ids=${rel.ids.length} edges=${edgeCount} ` +
    `topK=8 -> public/paper-relations.json`,
  );
}

main();

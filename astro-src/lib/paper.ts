// astro-src/lib/paper.ts
// Paper MD file reader (bypasses Astro content collection to handle broken YAML).
//
// 论文 frontmatter 字段全集(从 docs 中抽样):
//   title / title_zh / authors / date / generated_at / pdf / categories /
//   score / evidence / tldr / source / selection_source / figures_json /
//   tables_json / motivation / method / result / conclusion
//
// 注意:不要在此文件顶层 `import` 任何 node:* 模块 —— Vite 会把整个模块编进
// 客户端 bundle,触发 `node:fs / node:path is not exported by __vite-browser-external`。
// 需要读盘的逻辑全部走 `./paper-disk.mjs`(动态 import)。
// 见 astro.config.mjs:diskExternalForClientOnly plugin 把 disk.mjs 只在
// client 端 externalize,SSR 端会被 Vite 编进 chunk,运行时自包含。

import yaml from 'js-yaml';
import { buildCategories, type Categories } from './taxonomies';
import { extractVenue } from './venue';
import { stripTitleMarkup } from './title';

const EXCLUDED_DIRS = new Set(['tutorial', 'assets', 'plans']);
const PREFIX_SKIP_DIR = '_';

export interface PaperFrontmatter {
  title?: string;
  title_zh?: string;
  /** 纯文本标题(剥掉 inline TeX),用于 <title>/列表/搜索/a11y。
   *  缺失时 reader 用 stripTitleMarkup(title) 兜底。 */
  title_plain?: string;
  title_zh_plain?: string;
  authors?: string;
  date?: string;          // YYYY-MM-DD (after normalization)
  generated_at?: string;
  pdf?: string;
  /** 4-dim 分类 {venue, task, method, type} — 取代旧 string[] tags 字段。
   *  parser 对缺字段宽容:parseFrontmatter 会 normalize 成全部 []。 */
  categories?: Categories;
  score?: number;
  evidence?: string;
  tldr?: string;
  source?: string;        // 论文数据来源 ID(arxiv / biorxiv / icml-openreview 等)
  venue?: string;         // 人类可读会议名,如 "ICML 2025"。re-derived from source at read time。
  accepted?: boolean;     // 是否被会议接收(仅会议论文有值)
  selection_source?: string;
  figures_json?: string;
  tables_json?: string;
  motivation?: string;
  method?: string;
  result?: string;
  conclusion?: string;
  [key: string]: unknown;
}

export interface Paper extends PaperFrontmatter {
  id: string;
  slug: string;
  yearMonth: string;
  day: string;
  arxivId: string;
  body: string;
  isBroken: boolean;
  brokenReason?: string;
  figures?: FigureEntry[];
  tables?: FigureEntry[];
}

export interface FigureEntry {
  url: string;
  caption?: string;
  page?: number;
  index?: number;
  width?: number;
  height?: number;
  extractor?: string;
}

function parseFigureList(raw: unknown): FigureEntry[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      try {
        arr = JSON.parse(s.replace(/\\"/g, '"'));
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((item, i) => normalizeFigureEntry(item, i)).filter((e): e is FigureEntry => e !== null);
}

function normalizeFigureEntry(item: unknown, fallbackIndex: number): FigureEntry | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!url) return null;
  return {
    url,
    caption: typeof obj.caption === 'string' ? obj.caption : '',
    page: typeof obj.page === 'number' ? obj.page : 0,
    index: typeof obj.index === 'number' ? obj.index : fallbackIndex + 1,
    width: typeof obj.width === 'number' ? obj.width : 0,
    height: typeof obj.height === 'number' ? obj.height : 0,
    extractor: typeof obj.extractor === 'string' ? obj.extractor : '',
  };
}

/**
 * 兜底:frontmatter `figures_json` 缺失或为空时,从
 * `docs/assets/figures/arxiv/<arxivId>/meta.json` 读 figures 列表。
 * 主要防 backfill 漏写 + 跨版本 frontmatter 漂移;disk miss 时返回 undefined。
 */
async function loadFiguresFromAssetMeta(arxivId: string): Promise<FigureEntry[] | undefined> {
  if (!arxivId) return undefined;
  const disk = await import('./paper-disk.mjs');
  const metaPath = disk.joinPath(disk.DOCS_DIR, 'assets', 'figures', 'arxiv', arxivId, 'meta.json');
  let text: string;
  try {
    text = await disk.readTextFile(metaPath);
  } catch {
    return undefined;
  }
  try {
    const meta = JSON.parse(text) as { figures?: unknown };
    if (!Array.isArray(meta.figures)) return undefined;
    const out: FigureEntry[] = [];
    meta.figures.forEach((item, i) => {
      const entry = normalizeFigureEntry(item, i);
      if (entry) out.push(entry);
    });
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function normalizeDate(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const s = String(v).padStart(8, '0');
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(4 + 2, 4 + 4)}`;
  }
  if (typeof v === 'string') return v;
  return undefined;
}

function normalizeCategories(raw: unknown): Categories {
  if (!raw || typeof raw !== 'object') {
    return buildCategories({});
  }
  const obj = raw as Record<string, unknown>;
  return buildCategories({
    venue: Array.isArray(obj.venue) ? (obj.venue as unknown[]) : undefined,
    task: Array.isArray(obj.task) ? (obj.task as unknown[]) : undefined,
    method: Array.isArray(obj.method) ? (obj.method as unknown[]) : undefined,
    type: Array.isArray(obj.type) ? (obj.type as unknown[]) : undefined,
  });
}

function parseFrontmatter(text: string): { data: PaperFrontmatter; body: string } | { error: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { error: 'no frontmatter' };
  try {
    const raw = (yaml.load(m[1]) as PaperFrontmatter) || {};
    const data: PaperFrontmatter = {
      ...raw,
      date: normalizeDate(raw.date),
      categories: normalizeCategories(raw.categories),
    };
    return { data, body: m[2] };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 100) };
  }
}

export async function readPaper(id: string): Promise<Paper | null> {
  const disk = await import('./paper-disk.mjs');
  const mdPath = disk.joinPath(disk.DOCS_DIR, `${id}.md`);
  let text: string;
  try {
    text = await disk.readTextFile(mdPath);
  } catch {
    return null;
  }
  const parsed = parseFrontmatter(text);
  if ('error' in parsed) {
    const arxivMatch = id.match(/(\d{4}\.\d{4,5}v\d+)/);
    const arxivId = arxivMatch ? arxivMatch[1] : '';
    return {
      id,
      slug: id.split('/').pop() || '',
      yearMonth: arxivId ? arxivId.split('.')[0] : '',
      day: '',
      arxivId,
      body: '',
      isBroken: true,
      brokenReason: parsed.error,
    };
  }
  const arxivMatch = id.match(/(\d{4}\.\d{4,5}v\d+)/);
  const arxivId = arxivMatch ? arxivMatch[1] : '';
  const yearMonth = arxivId ? arxivId.split('.')[0] : '';
  const day = parsed.data.date && typeof parsed.data.date === 'string'
    ? parsed.data.date.slice(8, 10)
    : '';
  const { venue, accepted } = extractVenue(parsed.data.source);
  const categories = backfillVenueDim(parsed.data.categories, parsed.data.source);
  const fmFigures = parseFigureList(parsed.data.figures_json);
  // 兜底:frontmatter 缺 figures_json 时,从 assets meta.json 读
  const figures = fmFigures.length > 0
    ? fmFigures
    : (await loadFiguresFromAssetMeta(arxivId)) ?? [];
  return {
    ...parsed.data,
    id,
    slug: id.split('/').pop() || '',
    yearMonth,
    day,
    arxivId,
    venue,
    accepted,
    categories,
    // 纯文本标题:优先 frontmatter 预算字段,缺失时运行时剥标记兜底。
    title_plain: (parsed.data.title_plain as string) || stripTitleMarkup(parsed.data.title || ''),
    title_zh_plain: (parsed.data.title_zh_plain as string) || stripTitleMarkup(parsed.data.title_zh || ''),
    body: parsed.body,
    isBroken: false,
    figures,
    tables: parseFigureList(parsed.data.tables_json),
  };
}

/** 当 frontmatter 没有 `categories.venue` 但 `source` 是会议源时,
 *  从 source 重推一遍,保证 venue 维度总是有值(如果论文是会议论文)。
 *  这一步只补 venue — 不动 task/method/type,因为 LLM 上下文不允许凭空编造。 */
function backfillVenueDim(c: Categories | undefined, source: string | undefined): Categories {
  const cur = c || buildCategories({});
  if (cur.venue.length > 0 || !source) return cur;
  const v = extractVenue(source);
  if (!v.venue) return cur;
  return { ...cur, venue: [v.venue] };
}

export interface PaperListItem {
  id: string;
  title?: string;
  title_zh?: string;
  title_plain?: string;
  title_zh_plain?: string;
  authors?: string;
  date?: string;
  pdf?: string;
  categories?: Categories;
  score?: number;
  evidence?: string;
  tldr?: string;
  slug: string;
  yearMonth: string;
  day: string;
  arxivId: string;
  source?: string;
  venue?: string;
  accepted?: boolean;
  tags?: string[];
  /** first figure url (已拼好 base),用于列表卡片缩略图。 */
  thumbnail?: string;
  /** 完整 figure 列表(未拼 base),供需要展示多图的场景(展开抽屉等)。 */
  figures?: FigureEntry[];
}

/**
 * 把 figures_json 里的 url 解析成可访问的图片 src。
 *  - http(s) 绝对 URL:原样返回
 *  - 以 / 开头(站点绝对路径):原样返回
 *  - 其他(相对路径):拼 base
 */
export function figureUrlToAbsolute(url: string, base: string = '/'): string {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/')) return url;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const u = url.startsWith('./') ? url.slice(2) : url;
  return `${b}/${u}`;
}

async function walk(dir: string, out: string[]): Promise<void> {
  const disk = await import('./paper-disk.mjs');
  const entries = await disk.readDirEntries(dir);
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name) || e.name.startsWith(PREFIX_SKIP_DIR)) continue;
      const p = disk.joinPath(dir, e.name);
      await walk(p, out);
      continue;
    }
    if (e.name.endsWith('.md') && !e.name.startsWith('_') && e.name !== 'README.md'
        && e.name !== 'path-spec.md' && e.name !== 'zotero-usage.md') {
      const p = disk.joinPath(dir, e.name);
      const rel = disk.relativeTo(disk.DOCS_DIR, p);
      const id = rel.replace(/\.md$/, '');
      out.push(id);
    }
  }
}

export async function listAllPaperIds(): Promise<string[]> {
  const out: string[] = [];
  const disk = await import('./paper-disk.mjs');
  await walk(disk.DOCS_DIR, out);
  return out;
}

export interface ListOptions {
  limit?: number;
  sortBy?: 'date' | 'score';
  sortOrder?: 'asc' | 'desc';
  /** 按单个 'dim:label' token (e.g. 'task:rl') 或 group key (e.g. 'rl') 过滤。
   *  categories 4-dim 拍平后形如 ['venue:ICML 2025', 'task:rl', ...],共 consumer 一致语义。 */
  tag?: string;
  search?: string;
  skipBroken?: boolean;
  dedup?: boolean;
  sinceDays?: number;
  /** 拼缩略图 URL 时的 base(部署子路径)。listPapers 给 PaperListItem.thumbnail
   *  填的就是 base + 相对 url 的拼结果,默认 '/' 部署根路径。 */
  base?: string;
}

function dedupByCanonicalArxivId(items: PaperListItem[]): PaperListItem[] {
  const byKey = new Map<string, PaperListItem>();
  const ARXIV_RE = /^(\d{4}\.\d{4,5})v(\d+)$/;
  const keyOf = (p: PaperListItem): string => {
    const m = ARXIV_RE.exec(p.arxivId || '');
    return m ? `arxiv:${m[1]}` : `id:${p.id}`;
  };
  const verOf = (p: PaperListItem): number => {
    const m = ARXIV_RE.exec(p.arxivId || '');
    return m ? parseInt(m[2], 10) : 0;
  };
  for (const p of items) {
    const k = keyOf(p);
    const existing = byKey.get(k);
    if (!existing || verOf(p) > verOf(existing)) {
      byKey.set(k, p);
    }
  }
  return Array.from(byKey.values());
}

/** 把 categories 拍平为 'dim:label' 字符串数组,供列表过滤 / Jaccard 图 / UI 共用。
 *  与历史 `tags: ["query:rl"]` 的区别是每个 token 都带 dim 前缀,不再混用 `query:`。 */
export function flattenCategories(c: Categories | undefined | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dim of ['venue', 'task', 'method', 'type'] as const) {
    for (const label of c[dim] || []) {
      const k = `${dim}:${label}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export async function listPapers(opts: ListOptions = {}): Promise<PaperListItem[]> {
  const ids = await listAllPaperIds();
  const base = opts.base || '/';
  const items: PaperListItem[] = [];
  for (const id of ids) {
    const p = await readPaper(id);
    if (!p) continue;
    if (opts.skipBroken !== false && p.isBroken) continue;
    items.push({
      id: p.id,
      title: p.title,
      title_zh: p.title_zh,
      title_plain: p.title_plain,
      title_zh_plain: p.title_zh_plain,
      authors: p.authors,
      date: p.date,
      pdf: p.pdf,
      categories: p.categories,
      score: p.score,
      evidence: p.evidence,
      tldr: p.tldr,
      slug: p.slug,
      yearMonth: p.yearMonth,
      day: p.day,
      arxivId: p.arxivId,
      source: p.source,
      venue: p.venue,
      accepted: p.accepted,
      tags: p.tags as string[] | undefined,
      thumbnail: p.figures && p.figures.length > 0 ? figureUrlToAbsolute(p.figures[0].url, base) : undefined,
      figures: p.figures,
    });
  }
  let filtered = items;
  if (opts.tag) {
    filtered = filtered.filter((p) => flattenCategories(p.categories).some(
      (t) => t === opts.tag || t.endsWith(`:${opts.tag}`),
    ));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter((p) =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.title_zh || '').toLowerCase().includes(q) ||
      (p.tldr || '').toLowerCase().includes(q),
    );
  }
  if (typeof opts.sinceDays === 'number' && opts.sinceDays > 0) {
    const cutoff = Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((p) => {
      if (!p.date) return false;
      const t = new Date(p.date).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  if (opts.dedup !== false) {
    filtered = dedupByCanonicalArxivId(filtered);
  }
  const sortBy = opts.sortBy || 'date';
  const sortOrder = opts.sortOrder || 'desc';
  const sortItems = (src: PaperListItem[]): PaperListItem[] => {
    const copy = src.slice();
    copy.sort((a, b) => {
      let av: number = 0, bv: number = 0;
      if (sortBy === 'date') {
        av = a.date ? new Date(a.date).getTime() : 0;
        bv = b.date ? new Date(b.date).getTime() : 0;
      } else if (sortBy === 'score') {
        av = a.score || 0;
        bv = b.score || 0;
      }
      return sortOrder === 'asc' ? av - bv : bv - av;
    });
    return opts.limit ? copy.slice(0, opts.limit) : copy;
  };
  const sorted = sortItems(filtered);
  if (
    typeof opts.sinceDays === 'number'
    && opts.sinceDays > 0
    && opts.limit
    && sorted.length < opts.limit
  ) {
    const fallback = opts.dedup !== false
      ? dedupByCanonicalArxivId(items)
      : items;
    return sortItems(fallback);
  }
  return sorted;
}

/** 老格式 paper 的 tag 前缀(`tags: ["query:rl"]` → 主题 key = "rl")。
 *  历史 frontmatter 用 tags 数组 + query: 前缀表示主题;新版改用 categories.task。
 *  迁移期两种格式并存,resolveTaskKey 会优先 categories.task 再回退到 tags[0] 剥前缀。 */
export const LEGACY_TAG_PREFIX = 'query:';

/** 取一篇 paper 的主题 key,供按主题分桶/筛选用。
 *  口径:categories.task[0] 优先;无 task 时回退老格式 tags[0] 剥 `query:` 前缀;
 *  都没有则返回 '其他'。
 *  listAllPapersByTag 与首页日历视图的 dailyLean.task 共用此 helper,保证
 *  "按主题分类" 段与日历主题 select 看到的桶/计数完全一致。 */
export function resolveTaskKey(p: PaperListItem): string {
  const taskList = p.categories?.task || [];
  let key = taskList[0];
  if (!key) {
    const oldTag = p.tags?.[0];
    if (oldTag && oldTag.startsWith(LEGACY_TAG_PREFIX)) {
      key = oldTag.slice(LEGACY_TAG_PREFIX.length);
    }
  }
  return key || '其他';
}

/** 按 task 维度桶分论文(resolveTaskKey 取桶 key)。
 *  注意:不能用 flattenCategories[0] 当 key — flattenCategories 按 venue→task→
 *  method→type 顺序拍,一篇 venue 不为空的 paper 会先匹配 venue 名,被分到 venue
 *  桶而不是 task 桶,导致首页"按主题分类"看不到这些 paper(会进 "其他")。
 *  这里显式取 categories.task[0],保证每篇 paper 按它真正的主题归类。 */
export async function listAllPapersByTag(): Promise<Map<string, PaperListItem[]>> {
  const all = await listPapers({ sortBy: 'score' });
  const byTag = new Map<string, PaperListItem[]>();
  for (const p of all) {
    const key = resolveTaskKey(p);
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key)!.push(p);
  }
  return byTag;
}

export { renderMarkdownBody } from './markdown';
export type { RenderOptions } from './markdown';

// astro-src/lib/paper.ts
// Paper MD file reader (bypasses Astro content collection to handle broken YAML).
//
// 论文 frontmatter 字段全集(从 docs 中抽样):
//   title / title_zh / authors / date / generated_at / pdf / tags / score /
//   evidence / tldr / source / selection_source / figures_json / tables_json /
//   motivation / method / result / conclusion

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import yaml from 'js-yaml';

const PROJECT_ROOT = process.cwd();
const DOCS_DIR = join(PROJECT_ROOT, 'docs');

/**
 * Directories skipped by walk() so their MD files don't enter the
 * paper index. Three flavors of skip:
 *
 *   - explicit dir name (`EXCLUDED_DIRS`): known non-paper dirs by
 *     exact name. New top-level plan/scratch-style dirs must add
 *     themselves here rather than rely on prefix heuristics.
 *   - prefix `_` (PREFIX_SKIP_DIR): historical — `_sidebar.md`,
 *     `_404.md`, etc. live next to papers and the prefix marks
 *     "this is not a paper".
 *
 * Keep this constant local to paper.ts; if a second walker emerges
 * (e.g. for tutorial pages), extract to a shared module rather than
 * duplicating the rule.
 */
const EXCLUDED_DIRS = new Set(['tutorial', 'assets', 'plans']);
// `papers/` is the canonical paper directory. Do NOT add it here — the walk()
// falls through into it and treats every .md inside as a paper.
const PREFIX_SKIP_DIR = '_';

export interface PaperFrontmatter {
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;          // YYYY-MM-DD (after normalization)
  generated_at?: string;
  pdf?: string;
  tags?: string[];
  score?: number;
  evidence?: string;
  tldr?: string;
  source?: string;        // 论文数据来源 ID(arxiv / biorxiv / icml-openreview 等)
  venue?: string;         // 人类可读会议名,如 "ICML 2025"。非会议论文为空字符串,前端不渲染。
  accepted?: boolean;     // 是否被会议接收(仅会议论文有值)
  selection_source?: string;
  figures_json?: string;
  tables_json?: string;
  motivation?: string;
  method?: string;
  result?: string;
  conclusion?: string;
  [key: string]: unknown;  // forward-compatible for unknown fields
}

export interface Paper extends PaperFrontmatter {
  id: string;             // "papers/2606.15576v1-localizing-..."
  slug: string;           // "2606.15576v1-localizing-..."
  yearMonth: string;      // derived from arxivId (e.g. "2606"); not from path
  day: string;            // derived from frontmatter.date (e.g. "04"); '' when absent
  arxivId: string;        // "2606.15576v1"
  body: string;           // markdown body (frontmatter stripped)
  isBroken: boolean;      // true if frontmatter failed to parse
  brokenReason?: string;
  figures?: FigureEntry[];  // 解析自 frontmatter figures_json(2026-07 激活存量图)
  tables?: FigureEntry[];   // 解析自 frontmatter tables_json
}

export interface FigureEntry {
  url: string;
  caption?: string;
  page?: number;
  index?: number;
  width?: number;
  height?: number;
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
      // 兼容 YAML 把整个数组当字符串塞进去、含未转义引号的情况
      try {
        arr = JSON.parse(s.replace(/\\"/g, '"'));
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: FigureEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url.trim() : '';
    if (!url) continue;
    out.push({
      url,
      caption: typeof obj.caption === 'string' ? obj.caption : '',
      page: typeof obj.page === 'number' ? obj.page : 0,
      index: typeof obj.index === 'number' ? obj.index : out.length + 1,
      width: typeof obj.width === 'number' ? obj.width : 0,
      height: typeof obj.height === 'number' ? obj.height : 0,
    });
  }
  return out;
}

function normalizeDate(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const s = String(v).padStart(8, '0');
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  if (typeof v === 'string') return v;
  return undefined;
}

function parseFrontmatter(text: string): { data: PaperFrontmatter; body: string } | { error: string } {
  // CRLF-tolerant
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { error: 'no frontmatter' };
  try {
    const raw = (yaml.load(m[1]) as PaperFrontmatter) || {};
    return {
      data: {
        ...raw,
        date: normalizeDate(raw.date),
      },
      body: m[2],
    };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 100) };
  }
}

export async function readPaper(id: string): Promise<Paper | null> {
  // id 格式: "papers/2606.15576v1-localizing-..."
  const mdPath = join(DOCS_DIR, `${id}.md`);
  let text: string;
  try {
    text = await readFile(mdPath, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parseFrontmatter(text);
  if ('error' in parsed) {
    // Broken paper: synthesize a placeholder Paper so the page still renders
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
  const { venue, accepted } = deriveVenue(parsed.data.source);
  return {
    ...parsed.data,
    id,
    slug: id.split('/').pop() || '',
    yearMonth,
    day,
    arxivId,
    venue,
    accepted,
    body: parsed.body,
    isBroken: false,
    figures: parseFigureList(parsed.data.figures_json),
    tables: parseFigureList(parsed.data.tables_json),
  };
}

/**
 * Derive a human-readable venue label from a paper's raw `source` field.
 *
 * Mirrors `astro-src/lib/venue.ts::extractVenue` for the front-end path; the
 * pure function lives in venue.ts so the Python backfill tool
 * (`scripts/backfill_paper_venue.py`) can call it via a Node subprocess.
 * Keep both implementations in sync.
 */
function deriveVenue(rawSource: string | undefined): { venue: string; accepted: boolean } {
  if (!rawSource) return { venue: '', accepted: false };
  const source = String(rawSource).trim();
  if (!source) return { venue: '', accepted: false };
  // Tagged value like "ICML-2025-Accepted" or "NeurIPS-2023-Poster".
  // Allow mixed-case tag (NeurIPS contains lowercase s).
  const tagged = source.match(/^([A-Za-z]+)-(\d{4})-(.+)$/);
  if (tagged) {
    const [, tag, year, status] = tagged;
    const labels: Record<string, string> = {
      AAAI: 'AAAI',
      ACL: 'ACL',
      EMNLP: 'EMNLP',
      ICLR: 'ICLR',
      ICML: 'ICML',
      NIPS: 'NeurIPS',
      NEURIPS: 'NeurIPS',
    };
    const label = labels[String(tag).toUpperCase()];
    if (label) {
      const accepted = ['accepted', 'oral', 'poster', 'spotlight'].includes(
        status.toLowerCase(),
      );
      return { venue: `${label} ${year}`, accepted };
    }
  }
  // Plain source-id (e.g. "icml-openreview" or "icml_openreview").
  const normalized = source.toLowerCase().replace(/-/g, '_');
  const plain: Record<string, string> = {
    aaai: 'AAAI',
    acl: 'ACL',
    emnlp: 'EMNLP',
    iclr_openreview: 'ICLR',
    icml_openreview: 'ICML',
    neurips_openreview: 'NeurIPS',
  };
  const label = plain[normalized];
  if (label) return { venue: label, accepted: false };
  return { venue: '', accepted: false };
}

export interface PaperListItem {
  id: string;
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;
  pdf?: string;
  tags?: string[];
  score?: number;
  evidence?: string;
  tldr?: string;
  slug: string;          // 文件名部分(用于 URL),从 id 末段派生
  yearMonth: string;
  day: string;
  arxivId: string;
  source?: string;       // 论文数据来源 ID(arxiv / biorxiv / icml-openreview 等)
  venue?: string;        // 人类可读会议名,如 "ICML 2025"。非会议论文为空字符串,前端不渲染。
  accepted?: boolean;    // 是否被会议接收(仅会议论文有值)
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name) || e.name.startsWith(PREFIX_SKIP_DIR)) continue;
      const p = join(dir, e.name);
      await walk(p, out);
      continue;
    }
    if (e.name.endsWith('.md') && e.name !== 'README.md') {
      const p = join(dir, e.name);
      const rel = relative(DOCS_DIR, p).replace(/\\/g, '/');
      const id = rel.replace(/\.md$/, '');
      out.push(id);
    }
  }
}

export async function listAllPaperIds(): Promise<string[]> {
  const out: string[] = [];
  await walk(DOCS_DIR, out);
  return out;
}


export interface ListOptions {
  limit?: number;
  sortBy?: 'date' | 'score';
  sortOrder?: 'asc' | 'desc';
  tag?: string;
  search?: string;
  skipBroken?: boolean;  // default true
  /**
   * 当同一 arxiv id 有多个 v (v1/v2/...) 的 .md 共存时,只保留版本号最高的那篇。
   * 默认 true —— 这样首页 Top6 / 各 tag 桶都不会出现 v1+v2 同框。
   * 关闭:显式传 dedup:false(用于科研 debug 或特定页需要全版本)。
   */
  dedup?: boolean;  // default true
  /**
   * 把筛选窗口限定到「最近 N 天」内的论文(按 frontmatter.date 算)。
   * 用于首页「编辑精选」只显示近一周热门,避免几个月前的论文霸榜。
   * 默认 undefined = 不限时间。窗口内论文数 < limit 时,会回退到「不限时间」的同排序结果,
   * 避免空集(冷启动时尤其重要)。
   */
  sinceDays?: number;
}

/**
 * 把同一 canonical arxiv id 的多版本 (v1/v2/...) 合并,保留**版本号最高**的
 * 那一篇。处理 bioRxiv / medRxiv / ChemRxiv 等非 arxiv numeric id 时按 id
 * 整体保留(不合并),避免误跨仓库去重。
 *
 * 例子:
 *   id `2606.31737v1-...`  ->  arxiv:2606.31737
 *   id `2606.31737v2-...`  ->  arxiv:2606.31737 (取这个,丢弃 v1)
 *   id `biorxiv-10-1101-...-v3`  ->  id:biorxiv-10-1101-...-v3 (整体 key,不归并)
 */
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

export async function listPapers(opts: ListOptions = {}): Promise<PaperListItem[]> {
  const ids = await listAllPaperIds();
  const items: PaperListItem[] = [];
  for (const id of ids) {
    const p = await readPaper(id);
    if (!p) continue;
    if (opts.skipBroken !== false && p.isBroken) continue;
    items.push({
      id: p.id,
      title: p.title,
      title_zh: p.title_zh,
      authors: p.authors,
      date: p.date,
      pdf: p.pdf,
      tags: p.tags,
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
    });
  }
  // Filter
  let filtered = items;
  if (opts.tag) {
    filtered = filtered.filter((p) => (p.tags || []).some((t) => t === opts.tag || t.startsWith(`query:${opts.tag}`)));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter((p) =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.title_zh || '').toLowerCase().includes(q) ||
      (p.tldr || '').toLowerCase().includes(q)
    );
  }
  // 时间窗:仅筛 frontmatter.date 在 sinceDays 内的论文;窗口外的不进入排序候选。
  // 若窗口内不足 limit,后续在「不限时间」结果中按相同排序回退补齐,避免空集。
  if (typeof opts.sinceDays === 'number' && opts.sinceDays > 0) {
    const cutoff = Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((p) => {
      if (!p.date) return false;
      const t = new Date(p.date).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  // Dedup by canonical arxiv id (drop older versions, keep highest v)
  if (opts.dedup !== false) {
    filtered = dedupByCanonicalArxivId(filtered);
  }
  // Sort + limit
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
  // 时间窗内不足 limit 时,回退到「不限时间」的同排序结果补齐,避免空集。
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

export async function listAllPapersByTag(): Promise<Map<string, PaperListItem[]>> {
  const all = await listPapers({ sortBy: 'score' });
  const byTag = new Map<string, PaperListItem[]>();
  for (const p of all) {
    const tag = (p.tags || [])[0] || '其他';
    const key = tag.startsWith('query:') ? tag.slice(6) : tag;
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key)!.push(p);
  }
  return byTag;
}


// ============================================================================
// Re-exports — 老的 import 路径仍然有效。
// 真正的 markdown 渲染逻辑位于 lib/markdown.ts;新代码请直接 import 它。
// 注意:本文件上方已定义自己的 FigureEntry 接口(与 markdown.ts 的 FigureEntry 字段一致),
// 不再重复 re-export,避免 TS2484(Export declaration conflicts)错误。
// ============================================================================
export { renderMarkdownBody } from './markdown';
export type { RenderOptions } from './markdown';

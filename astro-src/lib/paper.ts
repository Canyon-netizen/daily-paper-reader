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
  source?: string;
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
  return {
    ...parsed.data,
    id,
    slug: id.split('/').pop() || '',
    yearMonth,
    day,
    arxivId,
    body: parsed.body,
    isBroken: false,
    figures: parseFigureList(parsed.data.figures_json),
    tables: parseFigureList(parsed.data.tables_json),
  };
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

// ============================================================================
// Markdown body → HTML rendering (极简,不引外部依赖)
// 支持:标题 (# / ## / ###)、强调 (*xxx* / **xxx**)、行内 LaTeX ($...$),
//       引用 ([text](url))、真段落(空行分段)。
// 不依赖 npm 包,避免改动 package.json / lockfile。
// ============================================================================
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // 行内 LaTeX: $...$  → 包成 <code class="math inline"> 包内公式字符
  out = out.replace(/\$([^$\n]+?)\$/g, (_m, expr) => {
    return `<code class="math math-inline">${expr}</code>`;
  });
  // Markdown 图片: ![alt](url) — 用于精读里 LLM 插入的 figure 引用
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    return `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  // [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) => {
    return `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`;
  });
  // **bold** / __bold__
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  // *italic* / _italic_
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
  // `code`
  out = out.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return out;
}

// 把 figures_json 的 url 解析成实际可访问的图片 src
//  - 已经是 http(s) 的绝对 URL:直接用
//  - 以 / 开头的:直接用(部署到根路径)
//  - 否则:拼上 base(部署到子路径)
function figureUrlToSrc(url: string, base: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/')) return url;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const u = url.startsWith('./') ? url.slice(2) : url;
  return `${b}/${u}`;
}

export interface RenderOptions {
  // 论文 frontmatter figures_json 解析后的图片列表;若非空,会在 body 开头插入 "论文图表" 区块
  figures?: FigureEntry[];
  // 站点 base URL(用于拼接相对路径),如 '/' 或 '/daily-paper-reader/'
  base?: string;
}

export function renderMarkdownBody(md: string, opts: RenderOptions = {}): string {
  if (!md) return '';

  // 论文图表区块:把 figures_json 里的所有图拼在 body 开头(摘要之前)
  // 默认折叠,避免首屏渲染过多 DOM
  const figures = (opts.figures || []).filter((f) => f.url);
  let prefix = '';
  if (figures.length > 0) {
    const base = opts.base || '/';
    const parts: string[] = [];
    parts.push(`<h2>📊 论文图表（共 ${figures.length} 张）</h2>`);
    parts.push('<details class="paper-figures-wrap">');
    parts.push(`<summary>展开查看 ${figures.length} 张图</summary>`);
    parts.push('<div class="paper-figures">');
    for (const fig of figures) {
      const src = figureUrlToSrc(fig.url, base);
      const alt = escapeHtml(fig.caption || `Figure ${fig.index}`);
      parts.push(`<figure><img src="${src}" loading="lazy" alt="${alt}" />`);
      if (fig.caption) {
        parts.push(`<figcaption>${alt}</figcaption>`);
      }
      parts.push('</figure>');
    }
    parts.push('</div>');
    parts.push('</details>');
    parts.push('<hr />');
    prefix = parts.join('\n');
  }

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length) {
      out.push(`<ul>${listItems.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      listItems = [];
    }
    inList = false;
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // 标题
    if (line.startsWith('### ')) { flushList(); out.push(`<h3>${renderInline(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('## '))  { flushList(); out.push(`<h2>${renderInline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('# '))   { flushList(); out.push(`<h1>${renderInline(line.slice(2))}</h1>`); continue; }

    // 分隔线
    if (/^---+\s*$/.test(line)) { flushList(); out.push('<hr />'); continue; }

    // 列表
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      inList = true;
      listItems.push(renderInline(listMatch[1]));
      continue;
    }

    // 空行 = 段落分隔(flush 未结束的 list,段落 <p> 已在下面累计)
    if (line.trim() === '') { flushList(); continue; }

    // 普通段落行:收集,直到下一个空行/标题/列表
    flushList();
    let para = line;
    out.push(`<p>${renderInline(para)}</p>`);
  }

  flushList();

  return prefix + (out.length ? '\n' + out.join('\n') : '');
}

export interface ListOptions {
  limit?: number;
  sortBy?: 'date' | 'score';
  sortOrder?: 'asc' | 'desc';
  tag?: string;
  search?: string;
  skipBroken?: boolean;  // default true
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
  // Sort
  const sortBy = opts.sortBy || 'date';
  const sortOrder = opts.sortOrder || 'desc';
  filtered.sort((a, b) => {
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
  // Limit
  if (opts.limit) {
    return filtered.slice(0, opts.limit);
  }
  return filtered;
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

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
//
// Phase I 拆分:本文件只剩 orchestrator(readPaper / listPapers)+ 类型定义 + 部分
// 纯函数(flattenCategories / figureUrlToAbsolute 等)。frontmatter 解析纯函数
// 已下沉到 lib/paper-frontmatter/。

import { buildCategories, type Categories } from './taxonomies';
import type { ConceptRef } from './types/concept';
import { extractVenue } from './venue';
import { stripTitleMarkup } from './title';
import { applyPaperFilters } from './paper-filter';
import { canonicalArxivId } from './arxiv';
import {
  parseFrontmatter,
  parseFigureList,
  loadFiguresFromAssetMeta,
  extractWikiArticle,
  extractWikiArticleStrict,
} from './paper-frontmatter';

const EXCLUDED_DIRS = new Set(['tutorial', 'assets', 'plans']);
const PREFIX_SKIP_DIR = '_';

/** 从论文 id / 文件名里提取 arXiv id。
 *
 *  Stage 0 修复:旧正则是 `/(\d{4}\.\d{4,5}v\d+)/` —— **要求** `vN` 后缀,导致
 *  文件名不带版本号的论文(实测 5 篇,如 `2305.16291-voyager.md`)`arxivId`
 *  变成空串。空串会连带触发两个下游问题:
 *    1. 这些论文无法被收藏 / 记笔记(用户态以 arxivId 为键);
 *    2. `data-arxiv-id=""` 在 Astro 里渲染成无值 boolean 属性
 *       (见记忆 feedback_astro_empty_data_attr)。
 *  现在版本号是可选捕获组,两种文件名都能正确提取。 */
function extractArxivIdFromPaperId(id: string): string {
  const m = id.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (!m) return '';
  return m[2] ? `${m[1]}${m[2]}` : m[1];
}

/** Paper 静态路由参数(URL basename)—— 全路径或 basename 都接受。
 *  Paper.id 在仓库内两种表示都存在:
 *    - 全路径: "papers/2026/07/17/2607.14171v1-branch-..."
 *    - basename: "2607.14171v1-branch-..."
 *  静态路由 [arxiv].astro 的 getStaticPaths 用 basename 作 params.arxiv,
 *  URL 形如 /papers/<basename>/。所有跳转必须用 basename,否则双 prefix
 *  404(命中 dist/papers/papers/2026/... 而那个目录不存在)。 */
export function paperBasename(id: string): string {
  return id.split('/').pop() || id;
}

/** 拼论文页 URL(SSR 侧:需要拼上 base;客户端侧:走 url() 包装)。
 *  hash 可选(例如 '#paper-compile-section')。 */
export function paperHref(id: string, base: string, hash?: string): string {
  const name = paperBasename(id);
  const tail = hash ? `/${hash}` : '/';
  return `${base.replace(/\/$/, '')}/papers/${name}${tail}`;
}

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
  /** Stage 9 概念层 — 从 frontmatter `concepts:` 段解析,概念页 / chips / wikilink 三处共用的真值来源。 */
  concepts?: ConceptRef[];
  /** 方法对比 pros/cons:每个方法名映射到其优点数组和缺点数组。
   *  由 paper.method_debate LLM 生成,键为方法名(如 "Transformer", "CNN"),值为 {pros, cons}。 */
  method_pros_cons?: Record<string, { pros: string[]; cons: string[] }>;
  /** 方法对比跨方法总结:1-2 句概括各方法的优劣对比。 */
  method_comparison?: string;
  /** 方法对比生成时间(ISO 8601 时间戳)。 */
  method_debate_generated_at?: string;
  /** 方法对比使用的模型(如 "deepseek/deepseek-chat")。 */
  method_debate_model?: string;
  /** 深入追问:3-5 个引导性问题,帮助读者深入探索这篇论文。 */
  follow_up_questions?: string[];
  /** 深度抽取:指标/数据集/算力需求/局限性/可复现性评分。由 paper.deep_extract LLM 生成。 */
  deep_extract?: {
    reported_metrics: Array<{ name: string; value: string; context?: string }>;
    datasets: Array<{ name: string; role: string; size?: string }>;
    compute_requirements: { params?: string; gpu_hours?: string; model_size?: string; flops?: string };
    limitations: string[];
    replicability_score: number;
    replicability_reason: string;
    deep_extract_model?: string;
    deep_extract_generated_at?: string;
  };
  [key: string]: unknown;
}

export interface Paper extends PaperFrontmatter {
  id: string;
  slug: string;
  yearMonth: string;
  day: string;
  /** arXiv id,**带**版本号(若文件名里有),如 `2607.00483v2`。用于展示 / 拉 PDF。 */
  arxivId: string;
  /** arXiv id,**永不带**版本号,如 `2607.00483`。
   *  这是用户态(星标/阅读状态/笔记/回收站)的唯一 storage key —— 见 lib/arxiv.ts
   *  的 canonicalArxivId 注释里的不变式说明。 */
  canonicalArxivId: string;
  body: string;
  isBroken: boolean;
  brokenReason?: string;
  figures?: FigureEntry[];
  tables?: FigureEntry[];
  /** Polaris 风格 5 节中文解读(TL;DR / 研究背景与动机 / 方法 / 实验与结果 /
   *  讨论与可借鉴点)。由 translate_polaris.py 写入 .md 之后,parseFrontmatter
   *  + extractWikiArticle 抽出来。workbench 右侧详情面板就地展示。 */
  wikiContent?: string;
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

// frontmatter 解析纯函数(parseFigureList / normalizeFigureEntry / normalizeDate /
// normalizeCategories / parseFrontmatter / loadFiguresFromAssetMeta)已抽到
// lib/paper-frontmatter/,本文件顶部已 import 它们。

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
    const arxivId = extractArxivIdFromPaperId(id);
    return {
      id,
      slug: id.split('/').pop() || '',
      yearMonth: arxivId ? arxivId.split('.')[0] : '',
      day: '',
      arxivId,
      canonicalArxivId: canonicalArxivId(arxivId),
      body: '',
      isBroken: true,
      brokenReason: parsed.error,
    };
  }
  const arxivId = extractArxivIdFromPaperId(id);
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
    canonicalArxivId: canonicalArxivId(arxivId),
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
    // Polaris 5 节中文解读(translate_polaris.py 写入),undefined = 旧论文没编译过。
// 优先用 strict 版(5 节齐全才显示),退到老 4 节 / 不完整版本 —— workbench
// 详情面板 / library 工作台就地展示 wiki,严格优先避免展示「半截翻译」。
wikiContent: extractWikiArticleStrict(parsed.body) || extractWikiArticle(parsed.body) || undefined,
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
  /** 带版本号(若有),用于展示 / PDF 链接。 */
  arxivId: string;
  /** 永不带版本号 —— 用户态 storage key。见 lib/arxiv.ts:canonicalArxivId。 */
  canonicalArxivId: string;
  source?: string;
  venue?: string;
  accepted?: boolean;
  tags?: string[];
  /** 论文 frontmatter `concepts:` 段(Stage 9 派生,用于卡片/工作台统计与 chips)。
   *  listPapers 不强制读 frontmatter,这里 optional —— 概念计数会跳过缺字段的论文。 */
  concepts?: ConceptRef[];
  /** first figure url (已拼好 base),用于列表卡片缩略图。 */
  thumbnail?: string;
  /** 完整 figure 列表(未拼 base),供需要展示多图的场景(展开抽屉等)。 */
  figures?: FigureEntry[];
  /** Polaris 5 节中文解读(wiki_content 镜像)。workbench 右侧详情面板就地展示。 */
  wikiContent?: string;
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

// dedup 逻辑已抽到 ./arxiv,过滤/排序/限条已抽到 ./paper-filter。
// listPapers 只负责"读盘 + 拼 PaperListItem + 调用 pipeline"。

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

/** 全 build process 内的 listPapers 缓存。
 *  关键动机(2026-09-03):astro build 单进程跑全 700+ /papers/[arxiv]/ 静态页时,
 *  每页都调 listPapers({limit:500}) 走一遍 readPaper × 500 = 35万 次 fs+yaml parse,
 *  是 build 时间大头(~7 min)。缓存 unfiltered 全列表后,所有带 limit/sortBy 的调用
 *  派生同一份数据 — O(1) 重复 + 一次性 N 次 read。Cloudflare Pages 20 min 上限可以
 *  从逼近压到 12-15 min 留出余量。
 *  SSR (Node) build 进程内有效,客户端 bundle 不进(Vite tree-shake 掉 if 永不被 import)。
 */
let _fullListCache: PaperListItem[] | null = null;
let _fullListBase = '/';

export async function listPapers(opts: ListOptions = {}): Promise<PaperListItem[]> {
  const base = opts.base || '/';
  // 全列表缓存命中 → 直接派生
  if (_fullListCache && _fullListBase === base && !opts.pathPrefix && !opts.dedup) {
    return applyPaperFilters(_fullListCache, opts);
  }
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
      canonicalArxivId: p.canonicalArxivId,
      source: p.source,
      venue: p.venue,
      accepted: p.accepted,
      tags: p.tags as string[] | undefined,
      // 把 Paper 的 concepts 字段透出(Stage 9 派生),让 listPapers 走概念
      // 计数 / chips / 工作台时不用再走 getPaperFull。
      concepts: p.concepts,
      thumbnail: p.figures && p.figures.length > 0 ? figureUrlToAbsolute(p.figures[0].url, base) : undefined,
      figures: p.figures,
      // Polaris 5 节中文解读(Polaris wiki_content 镜像)
      wikiContent: p.wikiContent,
    });
  }
  // 过滤+排序+限条 + dedup 全部委托给 paper-filter(纯数据 pipeline)
  return applyPaperFilters(items, {
    tag: opts.tag,
    search: opts.search,
    sinceDays: opts.sinceDays,
    dedup: opts.dedup,
    sortBy: opts.sortBy,
    sortOrder: opts.sortOrder,
    limit: opts.limit,
  });
  // 写入全列表缓存(无 dedup/pathPrefix 的下次调用 O(1))
  if (!opts.pathPrefix && !opts.dedup) {
    _fullListCache = items;
    _fullListBase = base;
  }
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
// Re-export arxiv dedup for callers that previously imported from paper.ts.
// 内部 listPapers 已经间接使用,但保留向后兼容以免打破 scripts/* 等外部 import。
export { dedupByCanonicalArxivId, canonicalArxivId } from './arxiv';

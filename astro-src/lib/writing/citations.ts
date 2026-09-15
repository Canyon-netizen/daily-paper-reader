// astro-src/lib/writing/citations.ts
//
// R7 E.3.3: citation management — BibTeX 生成 + arXiv metadata lookup helpers。
//
// 设计:UI 拿到一篇 arXiv paper,生成对应的 BibTeX entry 写入 writing 的
// citedPapers 列表。后端 fetch arXiv API 在这里做一个最小的封装(注意是
// 浏览器 fetch,不是 CLI;CLI 路径下使用 astro-src/scripts/arxiv-fetch.mjs)。

import type { PaperRef } from './types';

/** 一个结构化 citation 的最小集 — 字段名跟 BibTeX entry 一一对应。 */
export interface Citation {
  /** BibTeX key,例如 "vaswani2017attention"。必须 unique。 */
  key: string;
  /** arXiv ID,带 vN 后缀可选(在 BibTeX 里通常省略) */
  arxivId: string;
  /** 论文标题 */
  title: string;
  /** 作者列表(每项 "Last, First" 或者 "First Last") */
  authors: string[];
  /** 发表年份(4 位数字) */
  year: number;
  /** 期刊/会议/类别,默认 arXiv preprint */
  journal?: string;
  /** 预印本类别,例如 cs.LG / cs.CL */
  primaryClass?: string;
  /** 已生成的 BibTeX(避免每次都重新拼) */
  bibtex?: string;
}

/**
 * 把 citation 对象渲染成一个 BibTeX entry。
 *   @article{key,
 *     title = {...},
 *     author = {Last1, First1 and Last2, First2 and ...},
 *     year = {2024},
 *     eprint = {2401.01234},
 *     archivePrefix = {arXiv},
 *     primaryClass = {cs.LG}
 *   }
 *
 * escape:title 里的特殊字符(BibTeX 用 { } 包起来更稳),author 也按
 * BibTeX 习惯用 ` and ` 连接。
 */
export function generateBibtex(c: Citation): string {
  const safeTitle = escapeBibtex(c.title);
  const safeAuthors = c.authors.map((a) => escapeBibtex(a)).join(' and ');
  const lines: string[] = [];
  lines.push(`@article{${c.key},`);
  lines.push(`  title = {${safeTitle}},`);
  lines.push(`  author = {${safeAuthors}},`);
  lines.push(`  year = {${c.year}},`);
  if (c.journal) lines.push(`  journal = {${escapeBibtex(c.journal)}},`);
  lines.push(`  eprint = {${c.arxivId.replace(/v\d+$/, '')}},`);
  lines.push(`  archivePrefix = {arXiv}`);
  if (c.primaryClass) lines.push(`  primaryClass = {${c.primaryClass}}`);
  lines.push(`}`);
  return lines.join('\n') + '\n';
}

/** BibTeX 字段里要 escape 的字符(最少集):{ } \ */
function escapeBibtex(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, '\\$&');
}

/**
 * 从作者列表 + 年份推导默认 BibTeX key。
 * 规则:第一作者 last name 全小写 + 年份 →  "smith2024"。
 * 中文作者也能用「第一作者全名」兜底,因为拼音不一定容易得到。
 *
 * 用户随后可手动改 key(如果撞名)。
 */
export function deriveBibtexKey(authors: readonly string[], year: number): string {
  const first = authors[0] || 'anon';
  // 优先 "Last, First" 格式里的 Last
  const m = first.match(/^([^,，]+)[,，]\s*(.+)$/);
  const lastName = (m ? m[1] : first).toLowerCase().replace(/[^a-z0-9一-龥]/g, '');
  return `${lastName}${year}`;
}

/**
 * 把 arxivId 里的 `vN` 后缀去掉(arXiv 官方 BibTeX 默认不带 version,
 * 但用户记录里常带 → 统一归一化)。
 */
export function stripArxivVersion(arxivId: string): string {
  return arxivId.replace(/v\d+$/, '');
}

/** 把现有 citedPaper refs 转成完整的 Citation (带 bibtex)。 */
export function buildCitationFromRef(ref: PaperRef, fallback: Partial<Citation> = {}): Citation {
  const arxivId = stripArxivVersion(ref.arxivId);
  const year = typeof fallback.year === 'number' ? fallback.year : new Date().getFullYear();
  const authors = Array.isArray(fallback.authors) && fallback.authors.length > 0
    ? fallback.authors
    : ['Anonymous'];
  const title = (fallback.title || `arXiv:${arxivId}`).trim();
  const key = fallback.key || deriveBibtexKey(authors, year);
  const c: Citation = {
    key,
    arxivId,
    title,
    authors,
    year,
    journal: fallback.journal,
    primaryClass: fallback.primaryClass,
  };
  c.bibtex = generateBibtex(c);
  return c;
}

/**
 * 把 citedPapers 列表渲染成一个完整的 .bib 文件内容(BibTeX library)。
 * 单个 entry 用空行分隔。
 */
export function renderBibtexLibrary(citations: readonly Citation[]): string {
  return citations.map((c) => c.bibtex || generateBibtex(c)).join('\n');
}

/**
 * 把 PaperRef 列表渲染成 markdown 形式的参考文献列表 —— 不需要 BibTeX
 * 时的快速替代。格式:
 *   - Vaswani et al., 2017. *Attention Is All You Need*. arXiv:1706.03762
 *   - Smith, 2024. *Foo*. arXiv:2401.01234
 */
export function renderMarkdownBibliography(refs: readonly PaperRef[], citations: readonly Citation[]): string {
  const byId = new Map(citations.map((c) => [stripArxivVersion(c.arxivId), c]));
  const lines: string[] = [];
  for (const ref of refs) {
    const id = stripArxivVersion(ref.arxivId);
    const c = byId.get(id);
    if (c) {
      lines.push(`- ${c.authors[0] || 'Anon'} et al., ${c.year}. *${escapeMd(c.title)}*. arXiv:${id}`);
    } else {
      lines.push(`- arXiv:${id}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}\[\]()#+|>])/g, '\\$1');
}
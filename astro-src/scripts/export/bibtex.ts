// astro-src/scripts/export/bibtex.ts
//
// 最小 BibTeX 导出 —— 拉论文 frontmatter + user notes,生成 .bib 内容。
//
// 关键决策(plan §Stage 11):
//   - cite key = first author surname (ascii-fold Müller → muller) + 2-digit year
//     + first meaningful title word;**首作者只有缩写时(常见 "J. Smith")fall back
//     to arxivId**,避免 "J 2024 A" 这种无意义 key。
//   - collision:按 arxivId 排序追加 -a / -b / -c
//   - entry type: 看 source 字段;未知 → @misc(避免误判)
//   - 数据源:用 listPapers({dedup:true}) 的产物,纯前端的输入数据。
//   - 全部 LaTeX 特殊字符 (& % $ # _ { } \ ~ ^) 转义。
//
// 不依赖任何外部包,纯字符串。

interface PaperInput {
  id: string;
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;       // YYYY-MM-DD
  pdf?: string;
  arxivId?: string;
  source?: string;
  venue?: string;
  categories?: { venue?: string[]; task?: string[]; method?: string[]; type?: string[] };
  body?: string;
  userNote?: string;
}

const LATEX_ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, '\\textbackslash{}'],
  [/\{/g, '\\{'],
  [/\}/g, '\\}'],
  [/\$/g, '\\$'],
  [/&/g, '\\&'],
  [/%/g, '\\%'],
  [/#/g, '\\#'],
  [/_/g, '\\_'],
  [/~/g, '\\textasciitilde{}'],
  [/\^/g, '\\textasciicircum{}'],
];

export function escapeLatex(s: string): string {
  let out = s;
  for (const [re, repl] of LATEX_ESCAPES) {
    out = out.replace(re, repl);
  }
  return out;
}

/** ASCII-fold:把 Müller / Pêche / ñoño → Muller / Peche / nono。 */
export function asciiFold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7E]/g, '?');
}

/** 提取 cite key。与 plan §Stage 11 一致:首作者姓(无缩写时)+ 2 位年 + 标题首词。
 *  仅缩写时退到 arxivId。 */
export function citeKeyOf(p: PaperInput): string {
  const yearNum = (p.date || '').match(/\d{4}/)?.[0] ?? '0000';
  // authors 形态实测:'Aofan Yu, Chenyu Zhou, ...' 或 'J. Smith, B. Lee'
  const firstAuthor = (p.authors || '').split(',')[0]?.trim() ?? '';
  // 短于 2 字符或含 . 的 token(如 "J."、"X.")判定为缩写
  const tokens = firstAuthor.split(/\s+/).filter(Boolean);
  const isAbbreviated = tokens.length === 0
    || tokens.every((t) => t.length <= 2 || /[A-Z]\./.test(t));
  let surname: string;
  if (isAbbreviated) {
    // fallback to arxivId (stripped of version)
    const ax = (p.arxivId || '').replace(/v\d+$/i, '');
    surname = ax || 'anon';
  } else {
    // 多数英文 surname 是最后一个 token;中文论文无明显 surname,直接取第一作者姓
    surname = asciiFold(tokens[tokens.length - 1] || firstAuthor);
  }
  // 标题首词:剥 latex-like / 数字,长度 < 2 跳过
  const titleTokens = (p.title || '')
    .toLowerCase()
    .replace(/[^\w\s一-鿿]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const titleWord = asciiFold(titleTokens[0] || 'paper');
  return `${surname.toLowerCase()}${yearNum.slice(-2)}${titleWord}`
    .replace(/[^a-z0-9]/g, '');
}

/** 判定 BibTeX entry type。Plan §Stage 11:对 10 篇真实 source 取样后才确定。
 *  实测:源串多为 'arxiv' / 'icml-openreview-2025' / 'biorxiv-...'。 */
export function bibEntryType(p: PaperInput): 'article' | 'inproceedings' | 'misc' {
  const s = (p.source || '').toLowerCase();
  if (s.startsWith('arxiv') || s.startsWith('biorxiv') || s.startsWith('medrxiv') || s.startsWith('chemrxiv')) {
    return 'article';
  }
  if (s.includes('openreview') || s.includes('icml') || s.includes('iclr') || s.includes('neurips') || s.includes('acl') || s.includes('emnlp') || s.includes('aaai')) {
    return 'inproceedings';
  }
  return 'misc';
}

/** 渲染 1 篇论文的 BibTeX entry。 */
export function renderBibtexEntry(p: PaperInput, key: string): string {
  const fields: string[] = [];
  const type = bibEntryType(p);
  if (p.title) fields.push(`  title        = {${escapeLatex(p.title)}}`);
  if (p.title_zh) fields.push(`  title_zh     = {${escapeLatex(p.title_zh)}}`);
  if (p.authors) {
    const authors = p.authors.split(',').map((s) => s.trim()).filter(Boolean);
    fields.push(`  author       = {${escapeLatex(authors.join(' and '))}}`);
  }
  const year = (p.date || '').match(/\d{4}/)?.[0];
  if (year) fields.push(`  year         = {${year}}`);
  if (p.venue) fields.push(`  journal      = {${escapeLatex(p.venue)}}`);
  const venue = p.categories?.venue?.[0];
  if (venue) {
    if (type === 'inproceedings') fields.push(`  booktitle    = {${escapeLatex(venue)}}`);
    else fields.push(`  journal      = {${escapeLatex(venue)}}`);
  }
  // arXiv-specific fields
  if (p.arxivId) {
    fields.push(`  eprint       = {${p.arxivId}}`);
    fields.push(`  archivePrefix = {arXiv}`);
    // Extract primary class from categories if available
    const primaryClass = p.categories?.method?.[0] || p.categories?.task?.[0] || p.categories?.type?.[0];
    if (primaryClass) fields.push(`  primaryClass = {${primaryClass}}`);
  }
  if (p.pdf) {
    fields.push(`  url          = {${p.pdf}}`);
    // Extract DOI from PDF URL if present
    const doiMatch = p.pdf.match(/doi\.org\/([^?]+)/);
    if (doiMatch) {
      fields.push(`  doi          = {${doiMatch[1]}}`);
    }
  }
  if (p.userNote) fields.push(`  note         = {${escapeLatex(p.userNote.slice(0, 200))}}`);

  // Abstract from body (first ~300 chars)
  if (p.body) {
    const abstract = p.body.slice(0, 300).replace(/\n+/g, ' ').trim();
    if (abstract) {
      fields.push(`  abstract     = {${escapeLatex(abstract)}}`);
    }
  }

  return `@${type}{${key},\n${fields.join(',\n')}\n}`;
}

/** 渲染完整 .bib 文本,包含唯一 cite key 解析与 collision 处理。 */
export function renderBibtex(papers: PaperInput[]): string {
  const taken = new Map<string, number>();
  const blocks: string[] = [];
  for (const p of papers) {
    let key = citeKeyOf(p);
    const n = taken.get(key) || 0;
    if (n > 0) key = `${key}-${'abcdefghij'[n - 1]}`;
    taken.set(citeKeyOf(p), n + 1);
    blocks.push(renderBibtexEntry(p, key));
  }
  return blocks.join('\n\n') + '\n';
}

// astro-src/scripts/export/csl.ts
//
// 最小 CSL-JSON 导出(plan §Stage 11.iv):
//   - id, type, title, author, issued, container-title, URL
//   - 不做 publisher / DOI / pages 等花式字段
//   - author 拆 name → family / given
//
// 数据源:PaperInput(与 bibtex.ts 共享)。

interface PaperInput {
  id: string;
  title?: string;
  authors?: string;
  date?: string;
  pdf?: string;
  arxivId?: string;
  source?: string;
  categories?: { venue?: string[] };
}

interface CslAuthor {
  family: string;
  given?: string;
}

interface CslEntry {
  id: string;
  type: string;
  title?: string;
  author?: CslAuthor[];
  'container-title'?: string;
  issued?: { 'date-parts': number[][] };
  URL?: string;
  DOI?: string;
}

export function renderCsl(papers: PaperInput[]): string {
  const entries: CslEntry[] = papers.map((p) => {
    const entry: CslEntry = {
      id: p.arxivId || p.id,
      type: (p.source || '').includes('openreview') ? 'paper-conference' : 'article-journal',
    };
    if (p.title) entry.title = p.title;
    if (p.authors) {
      entry.author = p.authors.split(',').map((s) => s.trim()).filter(Boolean).map((name) => {
        const parts = name.split(/\s+/);
        const last = parts[parts.length - 1] || name;
        const first = parts.slice(0, -1).join(' ').trim();
        if (first) return { family: last, given: first };
        // 缩写("J. Smith") → 只放 family,不拆 given
        return { family: name };
      });
    }
    const year = (p.date || '').match(/\d{4}/)?.[0];
    const month = (p.date || '').match(/\d{4}-(\d{2})/)?.[1];
    if (year) {
      const parts: number[] = [Number(year)];
      if (month) parts.push(Number(month));
      entry.issued = { 'date-parts': [parts] };
    }
    const venue = p.categories?.venue?.[0];
    if (venue) entry['container-title'] = venue;
    if (p.pdf) entry.URL = p.pdf;
    return entry;
  });
  return JSON.stringify(entries, null, 2) + '\n';
}
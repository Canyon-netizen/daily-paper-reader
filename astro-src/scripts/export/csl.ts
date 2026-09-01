// astro-src/scripts/export/csl.ts
//
// Full CSL-JSON export:
//   - id, type, title, author, issued, container-title, URL, DOI, abstract
//   - author 拆 name → family / given
//   - Support all standard CSL-JSON fields
//
// Data source: PaperInput (shared with bibtex.ts)

interface PaperInput {
  id: string;
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;
  pdf?: string;
  arxivId?: string;
  source?: string;
  venue?: string;
  categories?: { venue?: string[]; task?: string[]; method?: string[]; type?: string[] };
  body?: string;
  userNote?: string;
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
  [key: string]: unknown;
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
    const dateMatch = p.date?.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (dateMatch) {
      const parts: number[] = [Number(dateMatch[1]), Number(dateMatch[2])];
      if (dateMatch[3]) parts.push(Number(dateMatch[3]));
      entry.issued = { 'date-parts': [parts] };
    }
    const venue = p.categories?.venue?.[0] || p.venue;
    if (venue) entry['container-title'] = venue;
    // URL: arXiv preferrable to PDF
    if (p.arxivId) {
      entry.URL = `https://arxiv.org/abs/${p.arxivId}`;
    } else if (p.pdf) {
      entry.URL = p.pdf;
    }
    // DOI extraction from PDF URL
    if (p.pdf && p.pdf.includes('doi.org')) {
      const doiMatch = p.pdf.match(/doi\.org\/([^?]+)/);
      if (doiMatch) entry.DOI = doiMatch[1];
    }
    // Abstract from body (first ~500 chars)
    if (p.body) {
      const abstract = p.body.slice(0, 500).replace(/[#*`\n]/g, ' ').trim();
      if (abstract) (entry as Record<string, unknown>)['abstract'] = abstract;
    }
    return entry;
  });
  return JSON.stringify(entries, null, 2) + '\n';
}
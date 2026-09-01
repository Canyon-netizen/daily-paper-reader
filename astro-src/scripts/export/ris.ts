// astro-src/scripts/export/ris.ts
//
// RIS format export for Zotero/Mendeley compatibility.
// RIS is a tag-based format widely supported by reference managers.
//
// Reference: https://en.wikipedia.org/wiki/RIS_(file_format)

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

/** Escape RIS field content (newlines become literal \n, pipes become \-). */
function escapeRis(s: string): string {
  return s.replace(/\|/g, '\\-').replace(/\n/g, '\\n');
}

/** Parse authors string into RIS AU fields. */
function formatAuthors(authors: string): string[] {
  if (!authors) return [];
  return authors.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Render a single paper to RIS format. */
function renderRisEntry(p: PaperInput): string {
  const lines: string[] = [];

  // TY - Type
  const isArxiv = (p.source || '').toLowerCase().startsWith('arxiv');
  const isConference = (p.source || '').toLowerCase().includes('openreview') ||
    (p.source || '').toLowerCase().includes('icml') ||
    (p.source || '').toLowerCase().includes('iclr') ||
    (p.source || '').toLowerCase().includes('neurips') ||
    (p.source || '').toLowerCase().includes('acl');

  if (isArxiv) {
    lines.push('TY  - EPRINT');
  } else if (isConference) {
    lines.push('TY  - CONF');
  } else {
    lines.push('TY  - JOUR');
  }

  // AU - Authors (multiple lines)
  for (const author of formatAuthors(p.authors || '')) {
    lines.push(`AU  - ${escapeRis(author)}`);
  }

  // TI - Title
  if (p.title) {
    lines.push(`TI  - ${escapeRis(p.title)}`);
  }

  // PY - Publication Year
  const year = (p.date || '').match(/\d{4}/)?.[0];
  if (year) {
    lines.push(`PY  - ${year}`);
  }

  // DA - Date (YYYY/MM/DD)
  if (p.date) {
    const dateMatch = p.date.match(/(\d{4})-(\d{2})(-(\d{2}))?/);
    if (dateMatch) {
      const fullDate = dateMatch[4]
        ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[4]}`
        : `${dateMatch[1]}/${dateMatch[2]}`;
      lines.push(`DA  - ${fullDate}`);
    }
  }

  // JO - Journal/Container
  const venue = p.categories?.venue?.[0] || p.venue;
  if (venue) {
    lines.push(`JO  - ${escapeRis(venue)}`);
  }

  // AB - Abstract (from body if available)
  if (p.body) {
    // Extract first ~500 chars as abstract proxy
    const abstract = p.body.slice(0, 500).replace(/[#*`\n]/g, ' ').trim();
    if (abstract) {
      lines.push(`AB  - ${escapeRis(abstract)}`);
    }
  }

  // UR - URL
  if (p.arxivId) {
    lines.push(`UR  - https://arxiv.org/abs/${p.arxivId}`);
  } else if (p.pdf) {
    lines.push(`UR  - ${p.pdf}`);
  }

  // DO - DOI (try to extract from pdf URL or source)
  if (p.pdf && p.pdf.includes('doi.org')) {
    const doiMatch = p.pdf.match(/doi\.org\/([^?]+)/);
    if (doiMatch) {
      lines.push(`DO  - ${doiMatch[1]}`);
    }
  }

  // ER - End of Record
  lines.push('ER  -');

  return lines.join('\n');
}

/** Render all papers to RIS format string. */
export function renderRis(papers: PaperInput[]): string {
  return papers.map(renderRisEntry).join('\n\n') + '\n';
}

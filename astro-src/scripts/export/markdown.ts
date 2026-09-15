// astro-src/scripts/export/markdown.ts
//
// D.1.4: Markdown export for libraries.
//
// Format:
//   # <paper title>
//
//   **Authors:** ...
//   **Date:** YYYY-MM-DD
//   **arXiv:** [NNNN.NNNNN](https://arxiv.org/abs/NNNN.NNNNN)
//
//   > <first ~200 chars of body or tldr>
//
//   ---

interface PaperInput {
  id: string;
  title?: string;
  title_zh?: string;
  authors?: string;
  date?: string;
  pdf?: string;
  arxivId?: string;
  source?: string;
  tldr?: string;
  body?: string;
}

function escapeMd(s: string): string {
  // 只 escape 真正会破坏 markdown 解析的字符,避免误伤常见标点(.,! 等)。
  return s.replace(/([\\`*_{}\[\]()#+|>])/g, '\\$1');
}

export function renderMarkdown(papers: PaperInput[]): string {
  const sections: string[] = [];
  for (const p of papers) {
    const title = (p.title_zh || p.title || p.id || '').trim();
    const lines: string[] = [];
    lines.push(`# ${escapeMd(title)}`);
    lines.push('');
    if (p.authors) {
      lines.push(`**Authors:** ${escapeMd(p.authors)}`);
    }
    if (p.date) {
      lines.push(`**Date:** ${p.date}`);
    }
    if (p.arxivId) {
      const url = `https://arxiv.org/abs/${p.arxivId}`;
      lines.push(`**arXiv:** [${p.arxivId}](${url})`);
    }
    lines.push('');
    // Quote: prefer tldr, fall back to first ~200 chars of body
    const quote = p.tldr?.trim()
      || (p.body ? p.body.slice(0, 200).replace(/\s+/g, ' ').trim() : '');
    if (quote) {
      lines.push(`> ${quote}`);
      lines.push('');
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n---\n\n') + '\n';
}
// astro-src/scripts/compare-page.ts
//
// Cross-paper comparison page orchestrator and renderers.
// Pure TS - works in browser, builds rows from PaperListItem data.

import type { PaperListItem } from '../lib/paper';
import type { RelationEdge } from '../lib/paper-relations';

export interface CompareRow {
  label: string;
  values: Array<{ arxivId: string; html: string; paper: PaperListItem }>;
}

export interface CompareTableData {
  rows: CompareRow[];
  paperIds: string[];
}

/**
 * Build table data from paper list.
 * Computes pairwise relations between selected papers.
 */
export async function buildCompareRows(papers: PaperListItem[]): Promise<CompareTableData> {
  if (papers.length < 2) {
    return { rows: [], paperIds: [] };
  }

  const paperIds = papers.map((p) => p.canonicalArxivId || p.arxivId);

  // Compute pairwise relations for "共同引用" row
  const relations = await computePairwiseRelations(papers);

  const rows: CompareRow[] = [
    buildTitleRow(papers),
    buildArxivIdRow(papers),
    buildTaskRow(papers),
    buildMethodRow(papers),
    buildVenueRow(papers),
    buildDateRow(papers),
    buildAuthorsRow(papers),
    buildMethodComparisonRow(papers, relations),
    buildSharedCitationsRow(papers, relations),
    buildConceptsRow(papers),
    buildMetricsRow(papers),
    buildRelevanceRow(papers, relations),
  ];

  return { rows, paperIds };
}

/**
 * Render the comparison table into a DOM element.
 * Returns cleanup function.
 */
export function renderCompareTable(
  root: HTMLElement,
  papers: PaperListItem[],
): () => void {
  let mounted = true;

  // Render immediately with papers data
  doRender(root, papers);

  return () => {
    mounted = false;
    root.innerHTML = '';
  };
}

function doRender(root: HTMLElement, papers: PaperListItem[]): void {
  if (papers.length < 2) {
    root.innerHTML = `
      <div class="compare-empty">
        <p>请先选择至少 2 篇论文进行对比</p>
        <p>在论文页面点击「➕ 加入对比」按钮</p>
      </div>
    `;
    return;
  }

  root.style.setProperty('--compare-paper-count', String(papers.length));

  // Build table HTML
  const html = buildTableHtml(papers);
  root.innerHTML = html;

  // Attach event listeners
  attachEventListeners(root, papers);
}

function buildTableHtml(papers: PaperListItem[]): string {
  const labels = [
    '标题',
    'arXiv ID',
    '任务',
    '方法',
    '会议 / 来源',
    '日期',
    '作者',
    '方法对比',
    '共同引用',
    '概念',
    '评估指标',
    '相关度',
  ];

  let html = `
    <div class="compare-grid" style="display: contents;">
  `;

  // Header row: paper titles
  html += `<div class="compare-cell compare-cell--label"></div>`;
  for (const paper of papers) {
    const title = paper.title_zh || paper.title || paper.arxivId;
    const truncated = title.length > 40 ? title.slice(0, 40) + '...' : title;
    html += `
      <div class="compare-cell compare-cell--paper">
        <strong>${escapeHtml(truncated)}</strong>
      </div>
    `;
  }

  // Data rows
  const rowData = getRowData(papers);

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const cells = rowData[i];

    html += `<div class="compare-cell compare-cell--label">${escapeHtml(label)}</div>`;
    for (const cell of cells) {
      html += `<div class="compare-cell compare-cell--paper">${cell}</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function getRowData(papers: PaperListItem[]): string[][] {
  const rows: string[][] = [];

  // Title row
  rows.push(papers.map((p) => {
    const title = p.title_zh || p.title || '';
    const slug = p.slug || p.arxivId;
    return `<a href="/papers/${encodeURIComponent(slug)}/" target="_blank">${escapeHtml(title)}</a>`;
  }));

  // arXiv ID row
  rows.push(papers.map((p) => {
    const id = p.arxivId || p.canonicalArxivId || '';
    const slug = p.slug || id;
    return `<a href="/papers/${encodeURIComponent(slug)}/" class="compare-arxiv-link">${escapeHtml(id)}</a>`;
  }));

  // Task row
  rows.push(papers.map((p) => {
    const tasks = p.categories?.task || [];
    return tasks.length > 0 ? tasks.map((t) => `<span class="compare-chip">${escapeHtml(t)}</span>`).join(' ') : '—';
  }));

  // Method row
  rows.push(papers.map((p) => {
    const methods = p.categories?.method || [];
    return methods.length > 0 ? methods.map((m) => `<span class="compare-chip">${escapeHtml(m)}</span>`).join(' ') : '—';
  }));

  // Venue row
  rows.push(papers.map((p) => {
    const venues = p.categories?.venue || [];
    return venues.length > 0 ? venues.map((v) => {
      const accepted = p.accepted ? ' venue-badge--accepted' : '';
      return `<span class="venue-badge${accepted}">${escapeHtml(v)}</span>`;
    }).join(' ') : '—';
  }));

  // Date row
  rows.push(papers.map((p) => p.date || '—'));

  // Authors row (truncated)
  rows.push(papers.map((p) => {
    const authors = p.authors || '';
    return `<span class="compare-authors" title="${escapeHtml(authors)}">${escapeHtml(authors)}</span>`;
  }));

  // Method comparison row (pros/cons from method_pros_cons)
  rows.push(papers.map((p) => {
    // method_pros_cons would need to be fetched - for now show placeholder
    return `<div class="compare-method-debate">
      <p class="compare-empty-small">点击论文页面查看方法对比</p>
    </div>`;
  }));

  // Shared citations row
  rows.push(papers.map((_p) => '<span class="compare-empty-small">—</span>'));

  // Concepts row
  rows.push(papers.map((p) => {
    const concepts = p.concepts || [];
    if (concepts.length === 0) return '—';
    return `<div class="compare-concepts">${concepts.slice(0, 5).map((c) =>
      `<span class="compare-chip">${escapeHtml(c.label || c.name || '')}</span>`
    ).join('')}</div>`;
  }));

  // Metrics row (type dimension as proxy)
  rows.push(papers.map((p) => {
    const types = p.categories?.type || [];
    return types.length > 0 ? types.map((t) => `<span class="compare-chip">${escapeHtml(t)}</span>`).join(' ') : '—';
  }));

  // Relevance row (relative to first paper)
  rows.push(papers.map((p, idx) => {
    if (idx === 0) return '<span class="compare-relevance-self">基准</span>';
    return '<span class="compare-empty-small">—</span>';
  }));

  return rows;
}

function attachEventListeners(root: HTMLElement, _papers: PaperListItem[]): void {
  // Clear button
  const clearBtn = document.getElementById('compare-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      import('../lib/projects/compare').then((mod) => {
        mod.clearCompareSet();
        window.location.href = '/papers/';
      });
    });
  }
}

/**
 * Compute pairwise relations between selected papers.
 * Returns a map: key = "id1|id2" (sorted), value = edge data.
 */
async function computePairwiseRelations(
  papers: PaperListItem[]
): Promise<Map<string, { weight: number; edge: RelationEdge }>> {
  const relations = new Map<string, { weight: number; edge: RelationEdge }>();

  if (papers.length < 2) return relations;

  try {
    // Dynamic import to avoid SSR issues
    const { computeRelations } = await import('../lib/paper-relations');

    const result = await computeRelations(papers, {
      algorithm: 'hybrid',
      topK: 4,
    });

    // Build paper ID set for quick lookup
    const paperIds = new Set(papers.map((p) => p.canonicalArxivId || p.arxivId));

    // Filter edges to only those between selected papers
    for (const edge of result.edges) {
      if (paperIds.has(edge.source) && paperIds.has(edge.target)) {
        const key = [edge.source, edge.target].sort().join('|');
        relations.set(key, { weight: edge.weight, edge });
      }
    }
  } catch (err) {
    console.warn('computeRelations failed:', err);
  }

  return relations;
}

// Row builders (for future use with full data)
function buildTitleRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '标题',
    values: papers.map((p) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: `<a href="/papers/${encodeURIComponent(p.slug || p.arxivId)}/">${escapeHtml(p.title_zh || p.title || '')}</a>`,
      paper: p,
    })),
  };
}

function buildArxivIdRow(papers: PaperListItem[]): CompareRow {
  return {
    label: 'arXiv ID',
    values: papers.map((p) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: `<a href="/papers/${encodeURIComponent(p.slug || p.arxivId)}/">${escapeHtml(p.arxivId || '')}</a>`,
      paper: p,
    })),
  };
}

function buildTaskRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '任务',
    values: papers.map((p) => {
      const tasks = p.categories?.task || [];
      const html = tasks.length > 0
        ? tasks.map((t) => `<span class="compare-chip">${escapeHtml(t)}</span>`).join(' ')
        : '—';
      return { arxivId: p.canonicalArxivId || p.arxivId, html, paper: p };
    }),
  };
}

function buildMethodRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '方法',
    values: papers.map((p) => {
      const methods = p.categories?.method || [];
      const html = methods.length > 0
        ? methods.map((m) => `<span class="compare-chip">${escapeHtml(m)}</span>`).join(' ')
        : '—';
      return { arxivId: p.canonicalArxivId || p.arxivId, html, paper: p };
    }),
  };
}

function buildVenueRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '会议 / 来源',
    values: papers.map((p) => {
      const venues = p.categories?.venue || [];
      const html = venues.length > 0
        ? venues.map((v) => {
            const accepted = p.accepted ? ' venue-badge--accepted' : '';
            return `<span class="venue-badge${accepted}">${escapeHtml(v)}</span>`;
          }).join(' ')
        : '—';
      return { arxivId: p.canonicalArxivId || p.arxivId, html, paper: p };
    }),
  };
}

function buildDateRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '日期',
    values: papers.map((p) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: p.date || '—',
      paper: p,
    })),
  };
}

function buildAuthorsRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '作者',
    values: papers.map((p) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: `<span class="compare-authors" title="${escapeHtml(p.authors || '')}">${escapeHtml(p.authors || '—')}</span>`,
      paper: p,
    })),
  };
}

function buildMethodComparisonRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '方法对比',
    values: papers.map((p) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: `<a href="/papers/${encodeURIComponent(p.slug || p.arxivId)}/#method-debate-section">查看详情 →</a>`,
      paper: p,
    })),
  };
}

function buildSharedCitationsRow(
  papers: PaperListItem[],
  _relations: Map<string, { weight: number; edge: RelationEdge }>
): CompareRow {
  return {
    label: '共同引用',
    values: papers.map((p) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: '<span class="compare-empty-small">—</span>',
      paper: p,
    })),
  };
}

function buildConceptsRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '概念',
    values: papers.map((p) => {
      const concepts = p.concepts || [];
      const html = concepts.length > 0
        ? `<div class="compare-concepts">${concepts.slice(0, 5).map((c) =>
            `<span class="compare-chip">${escapeHtml(c.label || c.name || '')}</span>`
          ).join('')}</div>`
        : '—';
      return { arxivId: p.canonicalArxivId || p.arxivId, html, paper: p };
    }),
  };
}

function buildMetricsRow(papers: PaperListItem[]): CompareRow {
  return {
    label: '评估指标',
    values: papers.map((p) => {
      const types = p.categories?.type || [];
      const html = types.length > 0
        ? types.map((t) => `<span class="compare-chip">${escapeHtml(t)}</span>`).join(' ')
        : '—';
      return { arxivId: p.canonicalArxivId || p.arxivId, html, paper: p };
    }),
  };
}

function buildRelevanceRow(
  papers: PaperListItem[],
  _relations: Map<string, { weight: number; edge: RelationEdge }>
): CompareRow {
  return {
    label: '相关度',
    values: papers.map((p, idx) => ({
      arxivId: p.canonicalArxivId || p.arxivId,
      html: idx === 0 ? '<span class="compare-relevance-self">基准</span>' : '<span class="compare-empty-small">—</span>',
      paper: p,
    })),
  };
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Parse paper IDs from URL query parameter.
 * @param idsParam - comma-separated IDs or null
 * @returns array of valid paper IDs (max 4)
 */
export function parseIdsFromUrl(idsParam: string | null): string[] {
  if (!idsParam) return [];
  return idsParam
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{4}\.\d{4,5}(v\d+)?$/.test(id))
    .slice(0, 4);
}

/**
 * Mount a floating button at bottom-right showing compare set count.
 * Clicking navigates to /papers/compare/?ids=...
 * Returns cleanup function.
 */
export function mountCompareFloatingButton(): () => void {
  if (typeof window === 'undefined') return () => {};

  const containerId = 'compare-floating-container';
  let container = document.getElementById(containerId);

  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.innerHTML = `
      <a href="/papers/compare/" class="compare-floating-btn" id="compare-floating-link">
        <span class="compare-floating-count">0</span>
        <span class="compare-floating-label">对比</span>
      </a>
    `;
    document.body.appendChild(container);
  }

  const link = document.getElementById('compare-floating-link') as HTMLAnchorElement;
  const countEl = container.querySelector('.compare-floating-count') as HTMLSpanElement;

  function updateButton(): void {
    // Dynamic import to avoid SSR issues
    import('../lib/projects/compare').then((mod) => {
      const set = mod.getCompareSet();
      const count = set?.arxivIds.length ?? 0;

      countEl.textContent = String(count);

      if (count >= 2) {
        link.href = `/papers/compare/?ids=${set!.arxivIds.join(',')}`;
        link.style.display = 'flex';
      } else {
        link.style.display = 'none';
      }
    }).catch(() => {
      link.style.display = 'none';
    });
  }

  // Listen for compare set changes
  const handler = () => updateButton();
  window.addEventListener('dpr-compare-change', handler);
  window.addEventListener('storage', handler);

  // Initial update
  updateButton();

  // Return cleanup
  return () => {
    window.removeEventListener('dpr-compare-change', handler);
    window.removeEventListener('storage', handler);
  };
}

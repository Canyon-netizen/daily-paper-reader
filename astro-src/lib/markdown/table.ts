// /lib/markdown/table.ts — markdown 表格渲染。纯函数。
// GFM 风格:支持 `:---:` / `:---` / `---:` / `---` 四种 align。

import { renderInline } from './inline';

type Align = 'left' | 'center' | 'right';

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_ALIGN_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

/** 行是否是 `| ... | ... |` 这种表格行(首尾必须有 | 包裹)。 */
export function isTableRow(s: string): boolean {
  return TABLE_ROW_RE.test(s);
}

/** 行是否是 `| --- | --- |` / `:---:` 这种对齐分隔行。 */
export function isAlignRow(s: string): boolean {
  return TABLE_ALIGN_RE.test(s);
}

/** 解析对齐行,得到每列的 align。 */
function parseAlign(alignLine: string): Align[] {
  const cells = alignLine.split('|').filter((c) => c.trim().length > 0);
  return cells.map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center' as const;
    if (t.endsWith(':')) return 'right' as const;
    return 'left' as const;
  });
}

function renderCell(c: string, a: Align): string {
  return `<td style="text-align:${a}">${renderInline(c)}</td>`;
}

function renderTableRow(line: string, align: Align[]): string {
  // 去掉首尾 | 再按 | 切
  const stripped = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  const cells = stripped.split('|').map((c) => c.trim());
  return (
    '<tr>' +
    cells.map((c, i) => renderCell(c, align[i] || 'left')).join('') +
    '</tr>'
  );
}

function renderTableHeader(headerLine: string, align: Align[]): string {
  const headerCells = headerLine
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
  return (
    '<tr>' +
    headerCells.map((c, i) => {
      const a = align[i] || 'left';
      return `<th style="text-align:${a}">${renderInline(c)}</th>`;
    }).join('') +
    '</tr>'
  );
}

/** 渲染一个完整的 markdown 表格。 */
export function renderTable(
  headerLine: string,
  alignLine: string,
  dataLines: string[],
): string {
  const align = parseAlign(alignLine);
  const headerHtml = renderTableHeader(headerLine, align);
  const bodyHtml = dataLines.map((l) => renderTableRow(l, align)).join('');
  return `<table class="paper-md-table"><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table>`;
}
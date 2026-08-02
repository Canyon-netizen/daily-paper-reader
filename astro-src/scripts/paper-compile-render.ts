// astro-src/scripts/paper-compile-render.ts
//
// 把 LLM 流式产出的 markdown 实时渲染成 HTML,替换 ![[fig:N]] / [[table:N]]
// 标记为实际 <figure>/<table> 节点。
//
// 流程:
//   1. 接收当前已积累的 markdown 字符串(增量)+ figures/tables 原始数据
//   2. 走 lib/markdown:renderMarkdownBody 渲染主体(支持流式,新内容追加不影响旧节点)
//   3. 渲染后,扫描 HTML 里的 <span data-fig-idx="N"> 占位 → 替换为 <figure>
//
// 简化:renderMarkdownBody 不直接支持 ![[fig:N]] 这种 wiki 嵌入(plan
// §6.6),所以本模块在 main pipeline 后做 DOM 替换。

import type { FigureEntry } from '../lib/paper';

export interface RenderOptions {
  figures: FigureEntry[];
  /** base URL(部署子路径),用于拼图 URL */
  base?: string;
}

/** 在 markdown 中把所有 ![[fig:N]] / [[table:N]] 替换为 placeholder,
 *  让下游 renderMarkdownBody 渲染成 <p data-fig-idx="N"> 之类。
 * 实际占位策略:把 ![[fig:N]] 替换成自定义 HTML <span data-fig-idx="N" ...></span>,
 * 绕过 markdown 处理。 */
export function preSubstituteMedia(md: string): string {
  // ![[fig:N]] 整段替换为自定义占位 <span>(含 markdown 安全的 syntax)
  return md
    .replace(/!\[\[fig:(\d+)\]\]/g, (_m, n) => `\n\n<figure data-fig-idx="${n}"></figure>\n\n`)
    .replace(/\[\[table:(\d+)\]\]/g, (_m, n) => `\n\n<table data-table-idx="${n}"></table>\n\n`);
}

/** 在已渲染的 HTML 中,把 <figure data-fig-idx="N"> 替换为完整 <figure> 节点。 */
export function injectFiguresAndTables(html: string, opts: RenderOptions): string {
  const base = opts.base || '';
  const figMap = new Map<number, FigureEntry>();
  for (const f of opts.figures || []) figMap.set(f.index, f);

  // 替换 <figure data-fig-idx="N"></figure> → 真实 <figure> 节点
  let out = html.replace(
    /<figure data-fig-idx="(\d+)"><\/figure>/g,
    (_m, idxStr) => {
      const idx = Number(idxStr);
      const f = figMap.get(idx);
      if (!f) return `<p class="muted" data-missing-fig="${idx}">[图 ${idx} 不可用]</p>`;
      const imgSrc = f.url.startsWith('http') ? f.url : (base + '/' + f.url.replace(/^\.\//, ''));
      const cap = f.caption ? `<figcaption>${escapeHtml(f.caption)}${f.page ? ` (p.${f.page})` : ''}</figcaption>` : '';
      return `<figure class="paper-compile-figure"><img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(f.caption || `figure ${idx}`)}" loading="lazy" />${cap}</figure>`;
    },
  );

  // 替换 <table data-table-idx="N"></table> → 简化占位
  out = out.replace(
    /<table data-table-idx="(\d+)"><\/table>/g,
    (_m, idxStr) => `<div class="paper-compile-table-stub" data-table-idx="${idxStr}">📊 表格 ${idxStr}(完整表格请到论文 PDF 查看)</div>`,
  );

  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

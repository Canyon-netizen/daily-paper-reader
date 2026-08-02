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

/**
 * 极简 markdown 渲染 —— 不引外部库,只够 LLM 输出用。
 *  - 行内 **粗体** 和 *斜体*
 *  - # ## ### 标题
 *  - [[wikilink]] / ![[fig:N]] 占位(后者在调用方预处理成 <figure>)
 *  - ``` code fence
 *  - 段落换行
 * 不支持:列表、表格、链接(LLM 输出通常不用这些;表格走占位 + 真实替换)
 * 
 * 阶段 4 共享:workbench 详情面板复用此函数渲染内联编译缓存。
 */
export function renderInlineMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inPara: string[] = [];

  const flushPara = () => {
    if (inPara.length === 0) return;
    const text = inPara.join(' ').trim();
    if (text) out.push(`<p>${inlineFormat(text)}</p>`);
    inPara = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      flushPara();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    if (line.startsWith('### ')) { flushPara(); out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('## '))  { flushPara(); out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('# '))   { flushPara(); out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }
    if (line === '') { flushPara(); continue; }
    inPara.push(line);
  }
  flushPara();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  return out.join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 先转义,再做粗体/斜体(顺序重要)
    .replace(/&lt;\/em&gt;/g, '</em>')  // 防御性修复
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, name) => {
      // wiki-link: 保持原文,客户端已处理 [[fig:N]] 替换
      const trimmed = name.trim();
      if (/^fig:\d+$/i.test(trimmed)) return `<span class="wikilink-missing" data-raw="${escapeAttr(trimmed)}">[[${escapeHtml(trimmed)}]]</span>`;
      if (/^table:\d+$/i.test(trimmed)) return `<span class="wikilink-missing" data-raw="${escapeAttr(trimmed)}">[[${escapeHtml(trimmed)}]]</span>`;
      return `<span class="wikilink">[[${escapeHtml(trimmed)}]]</span>`;
    });
}

/**
 * 把 markdown → 完整 HTML 串(preSubstituteMedia + renderInlineMarkdown + injectFiguresAndTables)。
 * 阶段 4 workbench 复用:读 localStorage 缓存时调用本函数得到最终 HTML。
 */
export function renderCompileMarkdown(
  md: string,
  opts: RenderOptions,
): string {
  const substituted = preSubstituteMedia(md);
  const html = renderInlineMarkdown(substituted);
  return injectFiguresAndTables(html, opts);
}

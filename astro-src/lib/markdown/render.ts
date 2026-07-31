// /lib/markdown/render.ts — renderMarkdownBody orchestrator。
// 顶层行扫描 + 段落 / 标题 / 列表 / 表格 / 块级 KaTeX / 段落落分发;
// 行内 markdown 和 figures 拼装分别委托给 ./inline 和 ./figures。

import katex from 'katex';

import { escapeHtml } from '../dom-utils';
import { renderInline } from './inline';
import { renderTable, isTableRow, isAlignRow } from './table';
import { buildFiguresCarouselHtml } from './figures';
import type { RenderOptions } from './types';

const BLOCK_MATH_SINGLE_LINE_RE = /^\$\$[\s\S]+\$\$$/;
const BLOCK_MATH_OPEN_RE = /^\s*\$\$\s*$/;

export function renderMarkdownBody(md: string, opts: RenderOptions = {}): string {
  if (!md) return '';

  const isChat = !!opts.chat;
  let prefix = '';

  // figures 区块 — chat 模式跳过。
  if (!isChat) {
    const figures = (opts.figures || []).filter((f) => f.url);
    if (figures.length > 0) {
      const base = opts.base || '/';
      const allRasterized = figures.every((f) => f.extractor === 'pdf-rasterize');
      prefix = buildFiguresCarouselHtml(figures, base, allRasterized);
    }
  }

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let listItems: string[] = [];

  // 行内选项(wikilink resolver)。每行 renderInline 都拿到同一个对象,
  // chat 模式不传 wikilink resolver → 原文里 `[[name]]` 字面量保留。
  const inlineOpts = isChat
    ? {}
    : { wikilinkResolver: opts.wikilinkResolver };

  const flushList = (): void => {
    if (listItems.length) {
      out.push(`<ul>${listItems.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      listItems = [];
    }
    inList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, '');
    const line = raw;

    // 标题 — chat 模式下整体下移两级
    if (line.startsWith('### ')) {
      flushList();
      const tag = isChat ? 'h5' : 'h3';
      out.push(`<${tag}>${renderInline(line.slice(4), inlineOpts)}</${tag}>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      const tag = isChat ? 'h4' : 'h2';
      out.push(`<${tag}>${renderInline(line.slice(3), inlineOpts)}</${tag}>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      const tag = isChat ? 'h3' : 'h1';
      out.push(`<${tag}>${renderInline(line.slice(2), inlineOpts)}</${tag}>`);
      continue;
    }

    // 块级 $$..$$(单行)
    if (BLOCK_MATH_SINGLE_LINE_RE.test(line) && line.length > 4 && line.startsWith('$$') && line.endsWith('$$')) {
      flushList();
      const expr = line.slice(2, -2);
      try {
        out.push(katex.renderToString(expr, { throwOnError: false, output: 'html', displayMode: true }));
      } catch {
        out.push(`<pre class="math math-block">${escapeHtml(expr)}</pre>`);
      }
      continue;
    }
    // 块级 $$..$$(多行,$$ 独占一行)
    if (BLOCK_MATH_OPEN_RE.test(line)) {
      flushList();
      let j = i + 1;
      const buf: string[] = [];
      while (j < lines.length && lines[j].trim() !== '$$') {
        buf.push(lines[j]);
        j++;
      }
      const expr = buf.join('\n');
      try {
        out.push(katex.renderToString(expr, { throwOnError: false, output: 'html', displayMode: true }));
      } catch {
        out.push(`<pre class="math math-block">${escapeHtml(expr)}</pre>`);
      }
      i = j;
      continue;
    }

    // 表格(表头 + 分隔行 + 0..N 数据行)
    if (
      isTableRow(line)
      && i + 1 < lines.length
      && isAlignRow(lines[i + 1].replace(/\s+$/, ''))
    ) {
      flushList();
      const headerLine = line;
      const alignLine = lines[i + 1].replace(/\s+$/, '');
      const dataLines: string[] = [];
      for (let j = i + 2; j < lines.length; j++) {
        const dl = lines[j].replace(/\s+$/, '');
        if (!isTableRow(dl)) break;
        dataLines.push(dl);
      }
      out.push(renderTable(headerLine, alignLine, dataLines));
      i += 1 + dataLines.length;
      continue;
    }

    // 分隔线
    if (/^---+\s*$/.test(line)) {
      flushList();
      out.push('<hr />');
      continue;
    }

    // 列表
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      inList = true;
      listItems.push(renderInline(listMatch[1], inlineOpts));
      continue;
    }

    // 空行 = 段落分隔
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // 普通段落行
    flushList();
    out.push(`<p>${renderInline(line, inlineOpts)}</p>`);
  }

  flushList();

  return prefix + (out.length ? '\n' + out.join('\n') : '');
}
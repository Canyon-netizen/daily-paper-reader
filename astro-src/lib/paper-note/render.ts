// /lib/paper-note/render.ts — 极简 markdown 渲染(精读输出专用子集)。
//
// 与 lib/markdown/ 区别:
//   - lib/markdown/render.ts 处理全文 / 行内 KaTeX / 表格 / figures,比较重,
//     用在论文页面的 SSR 渲染;
//   - 本模块只处理精读结果所需的子集:#/##/### → h2/h3/h4,粗体,行内 code,
//     行内 $..$ LaTeX,块级引用,有序 / 无序列表,独立成行的图片。
//     仅靠 katex.renderToString 客户端跑,不引第三方纯 markdown 库,
//     避免精读功能引入额外依赖。

import katex from 'katex';
import { escapeHtml } from '../dom-utils';

/** 渲染精读 markdown → HTML 字符串(段间以 '\n' 连接)。 */
export function renderDeepDiveMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = (): void => {
    if (inList) {
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      out.push('');
      continue;
    }

    // 独立成行的图片
    const img = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (img) {
      closeList();
      out.push(
        `<p class="analyzer-figure"><img src="${escapeHtml(img[2])}" alt="${escapeHtml(img[1])}" loading="lazy" decoding="async" class="analyzer-figure-img" /></p>`,
      );
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      closeList();
      out.push(`<h4>${inlineMd(h3[1])}</h4>`);
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      closeList();
      out.push(`<h3>${inlineMd(h2[1])}</h3>`);
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      closeList();
      out.push(`<h2>${inlineMd(h1[1])}</h2>`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      closeList();
      out.push(`<blockquote>${inlineMd(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const ol = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (ol) {
      if (!inList || listType !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${inlineMd(ol[2])}</li>`);
      continue;
    }

    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (!inList || listType !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inlineMd(trimmed)}</p>`);
  }
  closeList();
  return out.join('\n');

  // 行内 markdown 渲染:粗体、code、行内 LaTeX
  function inlineMd(s: string): string {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // $...$ 行内 LaTeX → KaTeX 客户端渲染;失败兜底到 <code>
      .replace(/\$([^$\n]+?)\$/g, (_m, expr) => {
        try {
          return katex.renderToString(expr, { throwOnError: false, output: 'html' });
        } catch {
          return `<code class="analyzer-latex">$${expr}$</code>`;
        }
      });
  }
}
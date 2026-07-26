// /lib/markdown/title.ts — 论文标题安全渲染:
// - KaTeX(trust:false)
// - escapeHtml
// - 不解释 markdown 强调 / 链接(避免标题里的 `_*` 被误当成 markdown)
//
// 块级数学式不出现,所以也只走 inline $..$ / $$..$。

import katex from 'katex';
import { escapeHtml } from '../dom-utils';

export function renderTitleHtml(title: string): string {
  const raw = String(title || '');
  if (!raw) return '';
  const subs: string[] = [];
  const placeholder = (html: string): string => {
    subs.push(html);
    return ` KATEX${subs.length - 1} `;
  };
  let s = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr) => {
    try {
      return placeholder(katex.renderToString(expr, { throwOnError: false, output: 'html', trust: false }));
    } catch {
      return placeholder(`<code class="math math-inline">${escapeHtml(expr)}</code>`);
    }
  });
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, expr) => {
    try {
      return placeholder(katex.renderToString(expr, { throwOnError: false, output: 'html', trust: false }));
    } catch {
      return placeholder(`<code class="math math-inline">${escapeHtml(expr)}</code>`);
    }
  });
  let out = escapeHtml(s);
  out = out.replace(/ KATEX(\d+) /g, (_m, idx) => subs[Number(idx)] || '');
  return out;
}
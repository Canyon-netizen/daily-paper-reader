// /lib/markdown/inline.ts — 行内 markdown + KaTeX。纯函数,无副作用。
//
// 关键不变式:
//   - 不能在 escapeHtml 之后再抓 $..$ ;escape 会把 < / > 转成 &lt; / &gt;,
//     KaTeX 拿到 HTML entity 而不是真 LaTeX,会 parse error 然后 throwOnError:false 降级成红字。
//   - 用占位符  KATEX<i>  暂时替换公式段,等其它标记处理完再回填。

import katex from 'katex';
import { escapeHtml } from '../dom-utils';

const BLOCK_DOLLAR_DOLLAR_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_DOLLAR_RE = /\$([^$\n]+?)\$/g;
const MD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BOLD_STAR_RE = /\*\*([^*\n]+?)\*\*/g;
const BOLD_UNDERSCORE_RE = /__([^_\n]+?)__/g;
const ITALIC_STAR_RE = /(^|[^*])\*([^*\n]+?)\*(?!\*)/g;
const ITALIC_UNDERSCORE_RE = /(^|[^_\w])_([^_\n]+?)_(?!\w)/g;
const CODE_RE = /`([^`\n]+?)`/g;
const KATEX_PLACEHOLDER_RE = / KATEX(\d+) /g;

/** 行内 markdown 渲染:KaTeX 公式 + 粗体 / 斜体 / 行内 code / 图片 / 链接。 */
export function renderInline(s: string): string {
  const subs: string[] = [];
  const placeholder = (html: string): string => {
    subs.push(html);
    return ` KATEX${subs.length - 1} `;
  };

  // 块级 $$..$$ 优先(避免它内部的 $ 被行内匹配吃掉)
  s = s.replace(BLOCK_DOLLAR_DOLLAR_RE, (_m, expr) => {
    try {
      return placeholder(
        katex.renderToString(expr, { throwOnError: false, output: 'html', displayMode: true }),
      );
    } catch {
      return placeholder(`<pre class="math math-block">${expr}</pre>`);
    }
  });
  // 行内 $..$
  s = s.replace(INLINE_DOLLAR_RE, (_m, expr) => {
    try {
      return placeholder(katex.renderToString(expr, { throwOnError: false, output: 'html' }));
    } catch {
      return placeholder(`<code class="math math-inline">${expr}</code>`);
    }
  });

  let out = escapeHtml(s);
  // Markdown image: ![alt](url)
  out = out.replace(MD_IMG_RE, (_m, alt, src) => {
    return `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  // [text](url)
  out = out.replace(MD_LINK_RE, (_m, txt, url) => {
    return `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`;
  });
  // **bold** / __bold__
  out = out.replace(BOLD_STAR_RE, '<strong>$1</strong>');
  out = out.replace(BOLD_UNDERSCORE_RE, '<strong>$1</strong>');
  // *italic* / _italic_
  out = out.replace(ITALIC_STAR_RE, '$1<em>$2</em>');
  out = out.replace(ITALIC_UNDERSCORE_RE, '$1<em>$2</em>');
  // `code`
  out = out.replace(CODE_RE, '<code>$1</code>');
  // 回填 KaTeX 渲染好的 HTML
  out = out.replace(KATEX_PLACEHOLDER_RE, (_m, idx) => subs[Number(idx)] || '');
  return out;
}
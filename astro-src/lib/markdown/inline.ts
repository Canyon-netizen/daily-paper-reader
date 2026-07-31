// /lib/markdown/inline.ts — 行内 markdown + KaTeX + wikilink。纯函数,无副作用。
//
// 关键不变式:
//   - 不能在 escapeHtml 之后再抓 $..$ ;escape 会把 < / > 转成 &lt; / &gt;,
//     KaTeX 拿到 HTML entity 而不是真 LaTeX,会 parse error 然后 throwOnError:false 降级成红字。
//   - 用占位符  KATEX<i>  暂时替换公式段,等其它标记处理完再回填。
//   - wikilink 也在 escapeHtml 之前处理:占位符  WLINK<i>  ,命名空间与 KATEX 分开;
//     resolver 是 Map<name|alias|slug, target> 而非 Set<slug>(见 plan §阶段 9 #3)——
//     无法校验 `[[name|alias]]` 的 alias 分支,Set 会丢信息。

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
// wikilink `[[...]]` — 排除 `![[...]]` 图嵌入(用 (?<!\!) lookbehind)。
// 捕获组 1 = 内容(name 或 name|alias)。
const WIKILINK_RE = /(?<!\!)\[\[([^\]\[\n]+?)\]\]/g;
const WLINK_PLACEHOLDER_RE = / WLINK(\d+) /g;

/** wikilink resolver 形态:Map<key, target>;key 可能是 slug / display_name / lowercase display_name。 */
export interface WikilinkTarget {
  slug: string;
  display_name: string;
}

/** 解析 `[[foo]]` / `[[foo|bar]]`:返回 base + alias。
 *  alias = 'bar' → 渲染显示为 "bar",但链接走 foo 的 target。
 *  没 alias → 显示 name 本身。 */
function parseWikilinkContent(content: string): { name: string; alias: string | null } {
  const pipe = content.indexOf('|');
  if (pipe < 0) return { name: content.trim(), alias: null };
  return {
    name: content.slice(0, pipe).trim(),
    alias: content.slice(pipe + 1).trim(),
  };
}

/** 行内 markdown 渲染:KaTeX 公式 + 粗体 / 斜体 / 行内 code / 图片 / 链接 / wikilink。 */
export function renderInline(
  s: string,
  opts: { wikilinkResolver?: Map<string, WikilinkTarget> } = {},
): string {
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

  // wikilink:在 escapeHtml 之前替换,占位符命名空间与 KATEX 分开(WLINK<n>)。
  // 没 resolver → 跳过 wikilink 规则(留给原文里保留 `[[name]]` 字面量)。
  if (opts.wikilinkResolver && opts.wikilinkResolver.size > 0) {
    const resolver = opts.wikilinkResolver;
    s = s.replace(WIKILINK_RE, (_m, content: string) => {
      const { name, alias } = parseWikilinkContent(content);
      if (!name) return _m;
      const target = resolver.get(name) || resolver.get(name.toLowerCase());
      const escaped = escapeHtml(alias || name);
      if (!target) {
        // 可见红色 — 一片红能立刻暴露索引坏了,plan §阶段 9 #4
        return ` <span class="wikilink--missing">[[${escaped}]]</span> `;
      }
      const slugEscaped = escapeHtml(target.slug);
      const html = ` <a class="wikilink" href="/wiki/concepts/${slugEscaped}/">${escaped}</a> `;
      subs.push(html);
      return ` WLINK${subs.length - 1} `;
    });
  }

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
  // 回填 KaTeX / wikilink 渲染好的 HTML
  out = out.replace(KATEX_PLACEHOLDER_RE, (_m, idx) => subs[Number(idx)] || '');
  out = out.replace(WLINK_PLACEHOLDER_RE, (_m, idx) => subs[Number(idx)] || '');
  return out;
}
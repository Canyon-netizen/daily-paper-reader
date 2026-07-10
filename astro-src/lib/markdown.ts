// astro-src/lib/markdown.ts
//
// 共享的 markdown SSR 渲染器。
// 论文正文页(/papers/{arxiv}/)和聊天侧栏的 assistant 文本都通过这个函数渲染,
// 这样聊天气泡里就拿到了论文正文页同款 markdown 语法集。

import { escapeHtml } from './dom-utils';

//
// 为了让聊天气泡里的标题层级视觉上低于论文正文页(避免气泡里出现一个比正文 H2 还大的 H1),
// 调用方在传入 `chat: true` 时:
//   - 跳过 figures 区块(论文图表轮播)
//   - 标题整体下移两级:`#`→h3、`##`→h4、`###`→h5

// FigureEntry 的最小子集 — paper.ts 是数据源,这里定义我们真正用到的字段,
// 避免 chat 侧的 lib/markdown 还要反向依赖 lib/paper。
export interface FigureEntry {
  url: string;
  caption?: string;
  page?: number;
  index?: number;
  width?: number;
  height?: number;
}

export interface RenderOptions {
  // 论文 frontmatter figures_json 解析后的图片列表;若非空,会在 body 开头插入 "论文图表" 区块
  figures?: FigureEntry[];
  // 部署 base 路径,用来把相对路径的图片 url 解析成可访问的 src
  base?: string;
  // 聊天模式:跳过 figures 区块,标题下移两级。论文页面调用时不要设。
  chat?: boolean;
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // 行内 LaTeX: $...$  → 包成 <code class="math inline"> 包内公式字符
  out = out.replace(/\$([^$\n]+?)\$/g, (_m, expr) => {
    return `<code class="math math-inline">${expr}</code>`;
  });
  // Markdown 图片: ![alt](url) — 用于精读里 LLM 插入的 figure 引用
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    return `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  // [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) => {
    return `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`;
  });
  // **bold** / __bold__
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  // *italic* / _italic_
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
  // `code`
  out = out.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return out;
}

// 把 figures_json 的 url 解析成实际可访问的图片 src
//  - 已经是 http(s) 的绝对 URL:直接用
//  - 以 / 开头的:直接用(部署到根路径)
//  - 否则:拼上 base(部署到子路径)
function figureUrlToSrc(url: string, base: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/')) return url;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const u = url.startsWith('./') ? url.slice(2) : url;
  return `${b}/${u}`;
}

interface TableAlign {
  label: string;
  value: 'left' | 'center' | 'right';
}

function renderTableRow(
  line: string,
  align: ('left' | 'center' | 'right')[],
): string {
  // 去掉首尾 | 再按 | 切
  const stripped = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  const cells = stripped.split('|').map((c) => c.trim());
  return (
    '<tr>' +
    cells
      .map((c, i) => {
        const a = align[i] || 'left';
        return `<td style="text-align:${a}">${renderInline(c)}</td>`;
      })
      .join('') +
    '</tr>'
  );
}

function renderTable(
  headerLine: string,
  alignLine: string,
  dataLines: string[],
): string {
  // 对齐行解析:`:---:` / `:---` / `---:` / `---`
  const parseAlign = (s: string): Array<'left' | 'center' | 'right'> => {
    const cells = s.split('|').filter((c) => c.trim().length > 0);
    return cells.map((c) => {
      const t = c.trim();
      if (t.startsWith(':') && t.endsWith(':')) return 'center' as const;
      if (t.endsWith(':')) return 'right' as const;
      return 'left' as const;
    });
  };
  const align = parseAlign(alignLine);
  const headerCells = headerLine
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
  const ths = headerCells
    .map((c, i) => {
      const a = align[i] || 'left';
      return `<th style="text-align:${a}">${renderInline(c)}</th>`;
    })
    .join('');
  const bodyRows = dataLines
    .map((l) => renderTableRow(l, align))
    .join('');
  return `<table class="paper-md-table"><thead><tr>${ths}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

export function renderMarkdownBody(md: string, opts: RenderOptions = {}): string {
  if (!md) return '';

  const isChat = !!opts.chat;
  let prefix = '';

  // 论文图表区块:把 figures_json 里的所有图拼在 body 开头(摘要之前)
  // 默认折叠,避免首屏渲染过多 DOM。
  // chat 模式跳过这个区块 — 聊天气泡里塞一组 carousel 没意义。
  if (!isChat) {
    const figures = (opts.figures || []).filter((f) => f.url);
    if (figures.length > 0) {
      const base = opts.base || '/';
      const total = figures.length;
      const parts: string[] = [];
      parts.push(`<h2>📊 论文图表（共 ${total} 张）</h2>`);
      parts.push('<details class="paper-figures-wrap">');
      parts.push(`<summary>展开查看 ${total} 张图</summary>`);
      parts.push(`<div class="paper-carousel" data-count="${total}" aria-label="论文图表轮播，共 ${total} 张" tabindex="0">`);
      parts.push('<div class="paper-carousel-track">');
      figures.forEach((fig, i) => {
        const src = figureUrlToSrc(fig.url, base);
        const alt = escapeHtml(fig.caption || `Figure ${fig.index}`);
        const captionHtml = fig.caption
          ? `<figcaption>图 ${i + 1} / ${total}：${alt}</figcaption>`
          : `<figcaption>图 ${i + 1} / ${total}</figcaption>`;
        parts.push(
          `<figure class="paper-slide" data-index="${i}">` +
            `<div class="paper-slide-frame"><img src="${src}" loading="lazy" alt="${alt}" /></div>` +
            captionHtml +
          `</figure>`,
        );
      });
      parts.push('</div>'); // track
      parts.push('<button type="button" class="paper-carousel-btn paper-carousel-prev" aria-label="上一张">‹</button>');
      parts.push('<button type="button" class="paper-carousel-btn paper-carousel-next" aria-label="下一张">›</button>');
      parts.push('<div class="paper-carousel-dots" role="tablist" aria-label="选择图片">');
      for (let i = 0; i < total; i++) {
        parts.push(`<button type="button" class="paper-carousel-dot" data-index="${i}" aria-label="第 ${i + 1} 张"></button>`);
      }
      parts.push('</div>'); // dots
      parts.push('</div>'); // carousel
      parts.push('</details>');
      parts.push('<hr />');
      prefix = parts.join('\n');
    }
  }

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length) {
      out.push(`<ul>${listItems.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      listItems = [];
    }
    inList = false;
  }

  // 表格行识别:匹配 `| ... | ... |`(必须有 | 包裹)
  // 分隔行识别:`| --- | --- |` 或 `:---:` / `---:` / `:---`
  const isTableRow = (s: string): boolean => /^\s*\|.*\|\s*$/.test(s);
  const isAlignRow = (s: string): boolean => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(s);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, '');
    const line = raw;

    // 标题 — chat 模式下整体下移两级 (#→h3, ##→h4, ###→h5)
    if (line.startsWith('### ')) {
      flushList();
      const tag = isChat ? 'h5' : 'h3';
      out.push(`<${tag}>${renderInline(line.slice(4))}</${tag}>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      const tag = isChat ? 'h4' : 'h2';
      out.push(`<${tag}>${renderInline(line.slice(3))}</${tag}>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      const tag = isChat ? 'h3' : 'h1';
      out.push(`<${tag}>${renderInline(line.slice(2))}</${tag}>`);
      continue;
    }

    // 表格:必须是 `表头 + 分隔行 + 0..N 数据行`,且表头/分隔/数据都是 `| ... |` 行
    if (isTableRow(line) && i + 1 < lines.length && isAlignRow(lines[i + 1].replace(/\s+$/, ''))) {
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
      i += 1 + dataLines.length; // for 循环还会 +1,这里把 i 跳到表格最后一行
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
      listItems.push(renderInline(listMatch[1]));
      continue;
    }

    // 空行 = 段落分隔(flush 未结束的 list,段落 <p> 已在下面累计)
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // 普通段落行:收集,直到下一个空行/标题/列表
    flushList();
    let para = line;
    out.push(`<p>${renderInline(para)}</p>`);
  }

  flushList();

  return prefix + (out.length ? '\n' + out.join('\n') : '');
}

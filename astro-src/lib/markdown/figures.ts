// /lib/markdown/figures.ts — 论文 figures 区块的 URL 解析 + carousel HTML 注入。
//
// 块级行为(整页预览 vs 真图表)由 caller 决策:此模块仅提供拼 URL 和拼 HTML 字符串,
// 不参与页面语义判断(避免一个 helper 同时负责 view-model 和 presentation)。

import { escapeHtml } from '../dom-utils';
import type { FigureEntry } from './types';

/** 把 figures_json 的 url 解析成可访问的图片 src。
 *  - http(s):原样
 *  - 以 / 开头:原样
 *  - 其他:拼 base */
export function figureUrlToSrc(url: string, base: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/')) return url;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const u = url.startsWith('./') ? url.slice(2) : url;
  return `${b}/${u}`;
}

/** 拼接论文 figures 区块的完整 HTML(包括 carousel 控件 + 图标题)。
 *  `allRasterized=true` 时改用"页面预览"措辞,UI 不误导用户为 Figure 1/N。 */
export function buildFiguresCarouselHtml(
  figures: FigureEntry[],
  base: string,
  allRasterized: boolean = false,
): string {
  if (figures.length === 0) return '';
  const total = figures.length;
  const unit = allRasterized ? '页' : '图';
  const heading = allRasterized
    ? `📄 论文页面预览(共 ${total} 页)`
    : `📊 论文图表(共 ${total} 张)`;
  const summaryLabel = allRasterized
    ? `论文无独立配图,展开查看 ${total} 页整页预览`
    : `展开查看 ${total} 张图`;

  const parts: string[] = [];
  parts.push(`<h2>${heading}</h2>`);
  parts.push('<details class="paper-figures-wrap">');
  parts.push(`<summary>${summaryLabel}</summary>`);
  parts.push(
    `<div class="paper-carousel" data-count="${total}" aria-label="论文图表轮播，共 ${total} 张" tabindex="0">`,
  );
  parts.push('<div class="paper-carousel-track">');
  figures.forEach((fig, i) => {
    const src = figureUrlToSrc(fig.url, base);
    const alt = escapeHtml(fig.caption || `Figure ${fig.index}`);
    const captionHtml = fig.caption
      ? `<figcaption>${unit} ${i + 1} / ${total}:${alt}</figcaption>`
      : `<figcaption>${unit} ${i + 1} / ${total}</figcaption>`;
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
  return parts.join('\n');
}
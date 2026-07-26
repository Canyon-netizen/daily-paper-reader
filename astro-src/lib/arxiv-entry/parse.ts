// /lib/arxiv-entry/parse.ts — 解析 arXiv API Atom XML 返回的 <entry> 节点为 DTO。
//
// 纯函数:输入 DOM Element(由 caller DOMParser 解析得到),返回 ArxivEntry 或 null。
// UI / 业务层零依赖,可独立单测。
//
// 跳过 arXiv 的占位 entry(title 是 'Error' / 空 / 长度 < 3)→ 返回 null,
// caller 自行 filter。

import type { ArxivEntry } from './types';

/** 从 arXiv API Atom XML 的 <entry> 节点解析出 ArxivEntry。 */
export function parseArxivEntry(e: Element): ArxivEntry | null {
  const idFull = e.querySelector('id')?.textContent?.trim() ?? '';
  // idFull 形如 http://arxiv.org/abs/1706.03762v7
  const arxivId = idFull.split('/abs/').pop() ?? '';
  const title = (e.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // 跳过 arXiv 的占位 entry(title 是 "Error" 或空,作者为 0)
  if (!title || title.toLowerCase() === 'error' || title.length < 3) return null;
  const summary = (e.querySelector('summary')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const authorNodes = Array.from(e.querySelectorAll('author name'));
  const authors = authorNodes.map((n) => n.textContent?.trim() ?? '').filter(Boolean);
  const published = e.querySelector('published')?.textContent?.trim() ?? '';
  const updated = e.querySelector('updated')?.textContent?.trim() ?? '';
  // PDF 链接:优先取 entry 里 rel=related 或 title=pdf 的 link
  const pdfLink = Array.from(e.querySelectorAll('link')).find((l) =>
    l.getAttribute('title') === 'pdf' || l.getAttribute('rel') === 'related'
  );
  const pdfUrl = pdfLink?.getAttribute('href') ?? `https://arxiv.org/pdf/${arxivId}`;
  return { id: idFull, arxivId, title, authors, summary, published, updated, pdfUrl };
}
// astro-src/scripts/library-search.ts — PaperLibrary 客户端的 search 通道桥接。
//
// PaperLibrary 是虚拟滚动 owner(不改 paper-library.ts 的渲染主体),
// 但它原来用的是 inline substring.filter。本模块对外暴露 3 个用途:
//   - searchLibrary(query, opts): 单次跑搜索,返回 SearchResult
//   - applyRankedOrderToPapers(papers, hits): 用 hits 重排 papers 列表,未命中的 append 末尾
//   - renderModePill / renderDegradeBanner: 用 searchPapers() 结果更新工具栏 UI
//
// 设计:本文件保持薄壳,不改 PaperLibrary 的虚拟滚动 DOM 协议;
// 通过返回 rankedIds (canonicalId[]),由 paper-library.ts 在 refreshFilter
// 阶段拿这个 ID 列表去重排 .papers[]。

import { searchPapers, type SearchPapersOptions } from '../lib/search';
import type { SearchResult } from '../lib/search/types';

export type { SearchResult } from '../lib/search/types';

/** 单次跑检索。baseUrl 留空让 fetch 走相对路径(Astro 静态站)。 */
export function searchLibrary(
  query: string,
  opts: SearchPapersOptions = {},
): Promise<SearchResult> {
  return searchPapers(query, opts);
}

/** 从 SearchResult.hits 抽 ranked canonicalIds(丢分数与字段细节)。
 *  PaperLibrary 用它给 papers[] 排序,未命中的保留但 append 到末尾。 */
export function rankedIdsFromResult(result: SearchResult): string[] {
  return result.hits.map((h) => h.canonicalId);
}

/** 把命中标注在 row DOM 节点上,以便工具栏显示「笔记」徽章。
 *  用 canonicalId lookup 是因为 row.dataset.paperId 是 doc 路径,需先查表。 */
export function paperIdToCanonical(papers: { id: string; canonicalArxivId?: string }[]): Map<string, string> {
  // 假设 papers 已含 canonicalArxivId;若没有,就走 SearchResult.hits 里 canonicalId 与 id 的映射。
  const m = new Map<string, string>();
  for (const p of papers) {
    if (p.canonicalArxivId) m.set(p.id, p.canonicalArxivId);
  }
  return m;
}

/** 更新工具栏里的「模式胶囊 + 降级提示」DOM。 */
export function renderModePill(
  container: HTMLElement,
  result: SearchResult,
): void {
  container.dataset.mode = result.mode;
  container.dataset.degraded = result.degradedFrom ? '1' : '0';
  let label: string;
  let cls: string;
  switch (result.mode) {
    case 'bm25+notes': label = 'BM25 + 笔记'; cls = 'mode-bm25-notes'; break;
    case 'bm25':       label = 'BM25';        cls = 'mode-bm25'; break;
    case 'substring':  label = '子串匹配(降级)'; cls = 'mode-substring'; break;
    case 'empty':      label = '未搜索';       cls = 'mode-empty'; break;
    default:           label = result.mode;    cls = 'mode-empty';
  }
  container.className = `papers-search-mode ${cls}`;
  container.textContent = label;
  // 数据属性 attr 非空时(否则 Astro 渲染成无值 boolean)— feedback_astro_empty_data_attr
  container.setAttribute('data-mode', result.mode);
  container.setAttribute('data-degraded', result.degradedFrom ? '1' : '0');
  if (!result.degradedFrom) {
    container.removeAttribute('data-degrade-reason');
  } else {
    container.setAttribute('data-degrade-reason', result.degradeReason || '');
  }
}

/** 降级提示横幅。仅当 result.degradedFrom 存在时挂文案。 */
export function renderDegradeBanner(
  banner: HTMLElement,
  result: SearchResult,
): void {
  if (!result.degradedFrom) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  const why = degradeReasonText(result.degradeReason);
  banner.textContent = `搜索已降级:${why}`;
  banner.setAttribute('data-degrade-reason', result.degradeReason || '');
}

function degradeReasonText(why: SearchResult['degradeReason']): string {
  switch (why) {
    case 'corpus-fetch-failed':  return '语料拉取失败(/search-corpus.json 不可用)';
    case 'corpus-schema-mismatch': return '语料 schema 与客户端不匹配';
    case 'no-tokens':           return '无有效 token(< 2 字 CJK / 全部停用词)';
    case 'no-hits':             return 'BM25 无命中,改用子串匹配';
    case undefined:             return '未知原因';
    default:                    return String(why);
  }
}

// astro-src/scripts/library-workbench-actions.ts
//
// /libraries/<id>/ 工作台客户端控制器(PR 阶段 3+)。
//
// 当前职责:
//   - 监听 `dpr:library-tab` 事件(由 [id].astro 切 tab 时 dispatch)
//   - 论文库 tab 激活时:扫描论文行里没评过分(<span class="row-score"> 缺失)的,
//     对每篇触发 scorePaperRelevance LLM 调用,把结果写到 user-library store
//     并在 UI 上更新行内 score 标签。
//   - 全程异步、节流(默认并发 2);AbortController 切走 tab 时中断在飞请求。
//
// 后续阶段 4 将扩展:graph / digest / chat / govern / ingest 的真实逻辑挂载点。

import { scorePaperRelevance } from '../lib/library/relevance';
import {
  loadUserLibrary,
  upsertPaperMeta,
} from '../lib/user-library/store';

const MAX_CONCURRENT = 2; // 避免一次给 LLM 推太猛
const RELEVANCE_MIN_INTERVAL_MS = 800; // 同一篇 paper 评分最小间隔(防抖)
const TAB_NAME = 'papers';

interface ScoreRowContext {
  cx: string;
  arxivId: string;
  title: string;
  abstract: string;
  row: HTMLElement;
  scoreSpan: HTMLElement | null;
  libraryName: string;
  libraryStatement: string;
}

let abortCtl: AbortController | null = null;
const inflight = new Set<string>();
const lastScoreAt = new Map<string, number>();

function readLibraryMeta(): { name: string; statement: string } {
  const h1 = document.querySelector<HTMLElement>('.library-wb-hero h1')?.textContent?.trim() || '';
  const desc = document.querySelector<HTMLElement>('.lib-wb-desc')?.textContent?.trim() || '';
  // lib-wb-desc 通常是 "<en> — <zh>",取前半
  const dash = desc.indexOf('—');
  const en = dash > 0 ? desc.slice(0, dash).trim() : desc;
  return { name: h1, statement: en };
}

function collectRows(): ScoreRowContext[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.wb-paper-row'));
  if (rows.length === 0) return [];
  const meta = readLibraryMeta();
  return rows
    .map<ScoreRowContext | null>((row) => {
      const cx = row.dataset.paperId || '';
      if (!cx) return null;
      // 行内已有 .row-score 视为已评分(frontmatter 派生或用户态已存)
      const existing = row.querySelector<HTMLElement>('.row-score');
      if (existing) return null;
      const arx = row.querySelector<HTMLElement>('.row-head .arx')?.textContent?.trim() || '';
      const title = row.querySelector<HTMLElement>('.row-title')?.textContent?.trim() || '';
      // 摘要优先从后端注入的 detail panel 拿(SSR),fallback 空字符串(模型也能凑)
      const detail = document.getElementById(`paper-${cx}`);
      const abstract = detail?.querySelector<HTMLElement>('.detail-en, .detail-authors')?.textContent?.trim() || '';
      return {
        cx,
        arxivId: arx,
        title,
        abstract,
        row,
        scoreSpan: null, // 没有就插入一个
        libraryName: meta.name,
        libraryStatement: meta.statement,
      };
    })
    .filter((x): x is ScoreRowContext => x !== null);
}

function ensureScoreSpan(ctx: ScoreRowContext): HTMLElement {
  if (ctx.scoreSpan) return ctx.scoreSpan;
  const span = document.createElement('span');
  span.className = 'row-score skel';
  span.dataset.score = '0';
  span.textContent = '···';
  const head = ctx.row.querySelector('.row-head');
  head?.appendChild(span);
  ctx.scoreSpan = span;
  return span;
}

function setRowScore(ctx: ScoreRowContext, score: number): void {
  const span = ctx.scoreSpan || ensureScoreSpan(ctx);
  span.classList.remove('skel');
  span.dataset.score = String(score);
  span.textContent = score.toFixed(2);
}

async function runOne(ctx: ScoreRowContext, signal: AbortSignal): Promise<void> {
  if (inflight.has(ctx.cx)) return;
  inflight.add(ctx.cx);
  try {
    const result = await scorePaperRelevance({
      libraryName: ctx.libraryName,
      libraryStatement: ctx.libraryStatement,
      paperTitle: ctx.title,
      paperAbstract: ctx.abstract,
    }, { signal });
    if (signal.aborted) return;
    if (!result) {
      // 失败:移除 skel,留个空白(不要给假分)
      ctx.scoreSpan?.classList.remove('skel');
      return;
    }
    setRowScore(ctx, result.score);
    // 写回 user-library store(schema v2 字段 relevanceScore / tldr)
    upsertPaperMeta(ctx.cx, {
      relevanceScore: result.score,
      tldr: result.tldr,
    });
  } catch {
    ctx.scoreSpan?.classList.remove('skel');
  } finally {
    inflight.delete(ctx.cx);
  }
}

async function runQueue(ctxs: ScoreRowContext[], signal: AbortSignal): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ctxs.length && !signal.aborted) {
      const ctx = ctxs[cursor++];
      if (!ctx) break;
      const last = lastScoreAt.get(ctx.cx) || 0;
      const wait = RELEVANCE_MIN_INTERVAL_MS - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      lastScoreAt.set(ctx.cx, Date.now());
      await runOne(ctx, signal);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, ctxs.length) }, () => worker());
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function onTabActivate(tab: string): void {
  if (tab !== TAB_NAME) {
    // 切到非 papers tab 时中断在飞 relevance 请求
    abortCtl?.abort();
    abortCtl = null;
    inflight.clear();
    return;
  }
  // 先把已有 relevance 写回 UI(用户切回 tab 时不丢状态)
  const snapshot = loadUserLibrary();
  for (const row of document.querySelectorAll<HTMLElement>('.wb-paper-row')) {
    const cx = row.dataset.paperId || '';
    const paper = snapshot.papers[cx];
    const existing = row.querySelector<HTMLElement>('.row-score');
    if (paper?.relevanceScore != null && !existing) {
      const span = document.createElement('span');
      span.className = 'row-score';
      span.dataset.score = String(paper.relevanceScore);
      span.textContent = paper.relevanceScore.toFixed(2);
      row.querySelector('.row-head')?.appendChild(span);
    }
  }

  const ctxs = collectRows();
  if (ctxs.length === 0) return;
  abortCtl = new AbortController();
  // 异步 fire-and-forget:不阻塞 tab 切换
  void runQueue(ctxs, abortCtl.signal);
}

export function initLibraryWorkbenchActions(): void {
  document.addEventListener('dpr:library-tab', (e) => {
    const tab = (e as CustomEvent<{ tab: string }>).detail?.tab;
    if (typeof tab === 'string') onTabActivate(tab);
  });
}

// auto-init(仅当 DOM ready 后)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLibraryWorkbenchActions, { once: true });
  } else {
    initLibraryWorkbenchActions();
  }
}

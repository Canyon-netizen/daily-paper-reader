// /scripts/paper-workbench-filter.ts — 工作台筛选面板 ↔ URL hash 桥(Stage 10)。
//
// 流程:
//   1) DOMContentLoaded:从 #f= hash 解析 LibraryFilterOptions → 把每个字段填回 UI
//   2) 任何 UI 变化 → 重新构造 opts → writeLibraryFilters(opts) → 触发桥
//      (自定义事件 + hash 同步)
//   3) hashchange → 同步回填 UI
//   4) "复制筛选链接"按钮 → buildFilterShareUrl → clipboard → 弹小 toast
//
// venue 下拉、userTag kind 下拉在 mount 时根据 #papers-data + user-library snapshot
// 动态填充,SSR 不知道具体有哪些值。
//
// 渲染入口:本模块**不**直接驱动列表重绘,只发 change 事件给 paper-library 主脚本;
// paper-library 监听 + rAF 合并重绘。这样筛选逻辑与列表渲染解耦,换列表实现不
// 影响本面板。

import { canonicalArxivId } from '../lib/arxiv';
import type { LibraryFilterOptions } from '../lib/paper-filter';
import type { UserTag } from '../scripts/settings';
import { loadUserTags } from './settings';
import {
  readLibraryFilters,
  writeLibraryFilters,
  buildFilterShareUrl,
} from './paper-library-filter-bridge';

interface PaperLite {
  arxivId: string;
  categories?: { venue?: string[] };
}

function loadPapersLite(): PaperLite[] {
  const el = document.getElementById('papers-data');
  if (!el) return [];
  try {
    const data = JSON.parse(el.textContent || '{}') as { papers?: PaperLite[] };
    return Array.isArray(data.papers) ? data.papers : [];
  } catch {
    return [];
  }
}

function fillVenueSelect(select: HTMLSelectElement, papers: PaperLite[]): void {
  const cur = select.value;
  const venues = new Set<string>();
  for (const p of papers) {
    for (const v of p.categories?.venue || []) venues.add(v);
  }
  // 保留"全部",按字母序插入
  while (select.options.length > 1) select.remove(1);
  Array.from(venues).sort().forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    select.appendChild(o);
  });
  if (cur) select.value = cur;
}

function fillUserTagKindSelect(select: HTMLSelectElement, tags: UserTag[]): void {
  const cur = select.value;
  const kinds = new Set<string>();
  for (const t of tags) kinds.add(t.kind);
  while (select.options.length > 1) select.remove(1);
  Array.from(kinds).sort().forEach((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = k;
    select.appendChild(o);
  });
  if (cur) select.value = cur;
}

function readOptsFromUI(): LibraryFilterOptions {
  const root = document.querySelector<HTMLElement>('[data-papers-workbench-filter]');
  if (!root) return {};
  const opts: LibraryFilterOptions = {};
  const author = (root.querySelector<HTMLInputElement>('[data-wb-filter="author"]')?.value || '').trim();
  if (author) opts.author = author;
  const venue = (root.querySelector<HTMLSelectElement>('[data-wb-filter="venue"]')?.value || '').trim();
  if (venue) opts.venue = venue;
  const fromRaw = (root.querySelector<HTMLInputElement>('[data-wb-filter="yearFrom"]')?.value || '').trim();
  const toRaw = (root.querySelector<HTMLInputElement>('[data-wb-filter="yearTo"]')?.value || '').trim();
  const from = fromRaw ? Number(fromRaw) : undefined;
  const to = toRaw ? Number(toRaw) : undefined;
  if (from !== undefined || to !== undefined) {
    opts.yearRange = { from, to };
  }
  const starred = root.querySelector<HTMLInputElement>('[data-wb-filter="starred"]')?.checked;
  if (starred) opts.starred = true;
  const hasNote = root.querySelector<HTMLInputElement>('[data-wb-filter="hasNote"]')?.checked;
  if (hasNote) opts.hasNote = true;
  const rs = root.querySelector<HTMLSelectElement>('[data-wb-filter="readingStatus"]')?.value;
  if (rs === 'reading' || rs === 'read') opts.readingStatus = rs;
  const kind = (root.querySelector<HTMLSelectElement>('[data-wb-filter="userTagKind"]')?.value || '').trim();
  const label = (root.querySelector<HTMLInputElement>('[data-wb-filter="userTagLabel"]')?.value || '').trim();
  if (kind && label) opts.userTag = { kind, label };
  return opts;
}

function writeOptsToUI(opts: LibraryFilterOptions): void {
  const root = document.querySelector<HTMLElement>('[data-papers-workbench-filter]');
  if (!root) return;
  const setVal = (sel: string, v: string | boolean | number | undefined): void => {
    const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
    if (!el) return;
    if (typeof v === 'boolean') (el as HTMLInputElement).checked = v;
    else if (typeof v === 'string') el.value = v;
    else if (typeof v === 'number' && el instanceof HTMLInputElement) el.value = String(v);
  };
  setVal('[data-wb-filter="author"]', opts.author || '');
  setVal('[data-wb-filter="venue"]', opts.venue || '');
  setVal('[data-wb-filter="yearFrom"]', opts.yearRange?.from);
  setVal('[data-wb-filter="yearTo"]', opts.yearRange?.to);
  setVal('[data-wb-filter="starred"]', !!opts.starred);
  setVal('[data-wb-filter="hasNote"]', !!opts.hasNote);
  setVal('[data-wb-filter="readingStatus"]', opts.readingStatus || '');
  setVal('[data-wb-filter="userTagKind"]', opts.userTag?.kind || '');
  setVal('[data-wb-filter="userTagLabel"]', opts.userTag?.label || '');
  updateClearVisible();
}

function isEmptyOpts(opts: LibraryFilterOptions): boolean {
  return !opts.author && !opts.venue && !opts.yearRange && !opts.starred && !opts.readingStatus && !opts.hasNote && !opts.userTag;
}

function updateClearVisible(): void {
  const clear = document.querySelector<HTMLButtonElement>('[data-wb-filter-clear]');
  if (!clear) return;
  const opts = readOptsFromUI();
  clear.hidden = isEmptyOpts(opts);
  const share = document.querySelector<HTMLElement>('[data-wb-filter-share]');
  if (share) share.hidden = isEmptyOpts(opts);
}

let timer: number | undefined;

function scheduleWrite(): void {
  if (typeof window === 'undefined') return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    writeLibraryFilters(readOptsFromUI());
    updateClearVisible();
  }, 150);
}

function init(): void {
  const root = document.querySelector<HTMLElement>('[data-papers-workbench-filter]');
  if (!root) return;

  // 填充 venue / kind 下拉
  const venueSel = root.querySelector<HTMLSelectElement>('[data-wb-filter="venue"]');
  if (venueSel) fillVenueSelect(venueSel, loadPapersLite());
  const kindSel = root.querySelector<HTMLSelectElement>('[data-wb-filter="userTagKind"]');
  // userTags 来自 settings.loadUserTags()(单源);user-library 快照不拥有 userTags,
  // 所以这里走 settings 层。Gist 同步不在这里处理(settings.ts 自己 fire)。
  const allTags: UserTag[] = [];
  try {
    const raw = loadUserTags() as Record<string, UserTag[] | undefined>;
    for (const k of Object.keys(raw || {})) {
      for (const t of raw[k] || []) if (t && typeof t.kind === 'string') allTags.push(t);
    }
  } catch { /* ignore */ }
  // 兜底:user-library snapshot 也含 userTags(双保险)
  if (allTags.length === 0 && snap) {
    for (const list of snap.userTags.values()) for (const t of list) allTags.push(t);
  }
  if (kindSel) fillUserTagKindSelect(kindSel, allTags);

  // 绑定变化
  root.addEventListener('input', scheduleWrite);
  root.addEventListener('change', scheduleWrite);

  // 清空按钮
  const clear = root.querySelector<HTMLButtonElement>('[data-wb-filter-clear]');
  if (clear) clear.addEventListener('click', () => {
    writeOptsToUI({});
    writeLibraryFilters({});
    updateClearVisible();
  });

  // 复制链接按钮
  const shareBtn = root.querySelector<HTMLButtonElement>('[data-wb-filter-share-btn]');
  const shareToast = root.querySelector<HTMLElement>('[data-wb-filter-share-toast]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const opts = readOptsFromUI();
      const url = buildFilterShareUrl(window.location.href.split('#')[0], opts);
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(url);
        } else {
          // 兜底:临时 textarea + execCommand
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        if (shareToast) {
          shareToast.hidden = false;
          window.setTimeout(() => { shareToast.hidden = true; }, 1500);
        }
      } catch (e) {
        console.warn('[paper-workbench-filter] clipboard failed:', e);
      }
    });
  }

  // 进入页面:回填 UI
  const initial = readLibraryFilters();
  writeOptsToUI(initial);
  updateClearVisible();

  // hashchange → 回填 UI
  window.addEventListener('hashchange', () => {
    writeOptsToUI(readLibraryFilters());
    updateClearVisible();
  });
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
} catch (e) {
  console.error('[paper-workbench-filter] init failed:', e);
}
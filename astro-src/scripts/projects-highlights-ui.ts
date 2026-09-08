// astro-src/scripts/projects-highlights-ui.ts
//
// /projects/ 高亮 tab 的 UI 组件。
//
// 输入:root 元素 + 当前 projectId
// 职责:
//   1. 拉项目下所有论文的高亮(aggregateProjectHighlights)
//   2. 渲染列表 + 搜索框 + 统计头
//   3. 单条卡:正文 text 引用 + 可编辑 note + 删除 + 跳源论文
//   4. 用浏览器 MutationObserver + 事件总线订阅 store 变化,跨 tab 删除也同步
//
// 设计取舍:
//   - 用 DOM API(不引框架),<template> 模板克隆避免拼字符串
//   - 不依赖 Tailwind / 组件库,样式全在 projects-highlights.css
//   - inline 编辑 note 用单个 contenteditable div,不弹 modal,简洁
//   - 删除按钮加 confirm 兜底防误删

import {
  aggregateProjectHighlights,
  filterHighlights,
  computeHighlightsStats,
  type AggregatedHighlight,
} from '../lib/projects/highlights';
import {
  deleteHighlight,
  updateHighlightNote,
} from '../lib/user-library/highlights';
import { getProjectDetail } from './projects';
import { showToast } from './toast';

const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** 把时间戳转成短日期(相对 + 绝对双段) */
function formatDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return `${yyyy}-${mm}-${dd}`;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/** 单条卡的 DOM 渲染(模板字符串拼装,innerHTML 一次写入) */
function renderCard(h: AggregatedHighlight, paperTitle: string): string {
  const text = escapeHtml(truncate(h.text, 280));
  const note = h.note ? escapeHtml(h.note) : '';
  const date = formatDate(h.createdAt);
  const paperHref = `${base}/papers/${encodeURIComponent(h.canonicalId)}/?hl=${encodeURIComponent(h.id)}`;
  return `
    <article class="phl-card" data-hl-id="${h.id}">
      <blockquote class="phl-quote">${text}</blockquote>
      ${note
        ? `<div class="phl-note phl-note--readonly" data-role="note-display" tabindex="0">${note}</div>`
        : `<div class="phl-note phl-note--empty" data-role="note-display" tabindex="0">＋ 添加注释…</div>`
      }
      <footer class="phl-meta">
        <a class="phl-paper-link" href="${paperHref}" target="_blank" rel="noopener">
          📄 ${escapeHtml(truncate(paperTitle, 80))}
        </a>
        <span class="phl-date">${date}</span>
        <button class="phl-del" data-role="delete" title="删除这条高亮">🗑</button>
      </footer>
    </article>
  `;
}

export interface AttachResult {
  /** 返回 cleanup 函数 —— 调用方在 pagehide 时调用 */
  cleanup: () => void;
}

/**
 * 把高亮 UI 挂到指定根元素上(由 /projects/ 页面在切到 高亮 tab 时调用)。
 * 返回 cleanup,用于 pagehide 解除监听。
 */
export function attachHighlightsUI(rootEl: HTMLElement, projectId: string): AttachResult {
  // 复用根元素的内容槽 —— 多次 attach 不重复渲染
  if (rootEl.dataset.phlMounted === '1') {
    return { cleanup: () => {} };
  }
  rootEl.dataset.phlMounted = '1';
  rootEl.innerHTML = `
    <div class="phl-shell">
      <div class="phl-toolbar">
        <input type="search" class="phl-search" placeholder="在所有高亮里搜索(text 或 note)..." autocomplete="off" />
        <span class="phl-stats" data-role="stats"></span>
      </div>
      <div class="phl-list" data-role="list"></div>
      <p class="phl-empty" data-role="empty" hidden>
        这个项目下还没有高亮 —— 去 <a href="${base}/papers/">论文页</a> 选一段文字,点击浮出的「🖍 添加高亮」按钮即可保存。
      </p>
      <p class="phl-no-match" data-role="nomatch" hidden>没有匹配的高亮。</p>
    </div>
  `;

  const searchEl = rootEl.querySelector<HTMLInputElement>('.phl-search')!;
  const statsEl = rootEl.querySelector<HTMLElement>('[data-role="stats"]')!;
  const listEl = rootEl.querySelector<HTMLElement>('[data-role="list"]')!;
  const emptyEl = rootEl.querySelector<HTMLElement>('[data-role="empty"]')!;
  const nomatchEl = rootEl.querySelector<HTMLElement>('[data-role="nomatch"]')!;

  // 拉 paper title 映射(canonicalId → title),多次复用
  // 用 /arxiv-index.json(build-arxiv-index.mjs 生成)代替单篇 data.json:
  //   单 fetch 拿到全量标题,免去 N 次请求;title 字段可能为 null(无 zh title
  //   时),统一降级到 canonicalId。
  let paperTitleMap = new Map<string, string>();
  let allList: AggregatedHighlight[] = [];

  async function refreshPaperTitleMap(): Promise<void> {
    const detail = getProjectDetail(projectId);
    if (!detail) { paperTitleMap = new Map(); return; }
    const map = new Map<string, string>();
    try {
      const res = await fetch(`${base}/arxiv-index.json`);
      if (res.ok) {
        const idx = await res.json();
        for (const id of detail.paperIds || []) {
          const entry = idx[id];
          if (entry && entry.title) map.set(id, entry.title);
          else map.set(id, id);
        }
      } else {
        for (const id of detail.paperIds || []) map.set(id, id);
      }
    } catch {
      for (const id of detail.paperIds || []) map.set(id, id);
    }
    paperTitleMap = map;
  }

  function render(): void {
    const q = searchEl.value || '';
    const list = filterHighlights(allList, q);
    if (allList.length === 0) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      nomatchEl.hidden = true;
    } else if (list.length === 0) {
      listEl.innerHTML = '';
      emptyEl.hidden = true;
      nomatchEl.hidden = false;
    } else {
      emptyEl.hidden = true;
      nomatchEl.hidden = true;
      listEl.innerHTML = list
        .map((h) => renderCard(h, paperTitleMap.get(h.canonicalId) || h.canonicalId))
        .join('');
    }
    const s = computeHighlightsStats(allList);
    statsEl.textContent = q
      ? `${list.length} / ${s.total} 条 · 跨 ${s.byPaper} 篇 · ${s.withNotes} 带注释`
      : `${s.total} 条 · 跨 ${s.byPaper} 篇 · ${s.withNotes} 带注释`;
  }

  async function reload(): Promise<void> {
    const detail = getProjectDetail(projectId);
    const ids = detail?.paperIds || [];
    allList = await aggregateProjectHighlights(ids);
    render();
  }

  // 事件委托:删除 + 编辑 note
  listEl.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement;
    const card = target.closest<HTMLElement>('.phl-card');
    if (!card) return;
    const hlId = card.dataset.hlId;
    if (!hlId) return;

    if (target.matches('[data-role="delete"]')) {
      if (!confirm('删除这条高亮?对应注释会一起消失。')) return;
      const ok = await deleteHighlight(hlId);
      if (ok) {
        showToast('已删除', 'ok');
        await reload();
      } else {
        showToast('删除失败', 'error');
      }
      return;
    }

    if (target.matches('[data-role="note-display"]')) {
      enterNoteEdit(card, hlId);
    }
  });

  function enterNoteEdit(card: HTMLElement, hlId: string): void {
    const display = card.querySelector<HTMLElement>('[data-role="note-display"]')!;
    const current = display.classList.contains('phl-note--empty')
      ? ''
      : display.textContent || '';
    display.classList.remove('phl-note--readonly', 'phl-note--empty');
    display.classList.add('phl-note--editing');
    display.setAttribute('contenteditable', 'true');
    display.textContent = current;
    display.focus();
    // 全选
    const range = document.createRange();
    range.selectNodeContents(display);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    let finished = false;
    async function commit(): Promise<void> {
      if (finished) return;
      finished = true;
      const next = (display.textContent || '').trim();
      const updated = await updateHighlightNote(hlId, next);
      display.removeAttribute('contenteditable');
      display.classList.remove('phl-note--editing');
      if (updated) {
        if (updated.note) {
          display.classList.add('phl-note--readonly');
          display.classList.remove('phl-note--empty');
          display.textContent = updated.note;
        } else {
          display.classList.add('phl-note--empty');
          display.classList.remove('phl-note--readonly');
          display.textContent = '＋ 添加注释…';
        }
        showToast(next ? '已保存注释' : '已清空注释', 'ok');
        // 同步 stats
        render();
      } else {
        showToast('保存失败', 'error');
        render();
      }
    }
    function cancel(): void {
      if (finished) return;
      finished = true;
      display.removeAttribute('contenteditable');
      display.classList.remove('phl-note--editing');
      render();
    }
    display.addEventListener('blur', commit, { once: true });
    display.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); display.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    }, { once: true });
  }

  searchEl.addEventListener('input', render);

  // 初始化
  void (async () => {
    await refreshPaperTitleMap();
    await reload();
  })();

  return {
    cleanup: () => {
      searchEl.removeEventListener('input', render);
      rootEl.innerHTML = '';
      delete rootEl.dataset.phlMounted;
    },
  };
}

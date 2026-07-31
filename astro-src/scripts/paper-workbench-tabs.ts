// /scripts/paper-workbench-tabs.ts — 工作台 tab 切换 + 回收站渲染(Stage 10)。
//
// 设计要点:
//   - "论文" / "概念" 都是 <a> 链接,直接走 href;
//   - "回收站"是 <button>,按下切换 hash #wb=trash,触发本模块渲染
//     `data-papers-workbench-trash` 区域;再次按下或按 ESC → 关闭。
//   - 渲染靠 lib/user-library 的 listTrashed() + snapshot 还原 paper 元数据;
//     paper 元数据来自 #papers-data 的 SSR payload,所以每行能展示 title。
//   - "恢复"按钮 → restoreFromTrash(); "彻底删除"按钮 → purgeUserPaperState()
//     二次确认。两边都走 user-library 写入漏斗,单一事件源。

import {
  listTrashed,
  restoreFromTrash,
  purgeUserPaperState,
} from '../lib/user-library';
import {
  onDprUserLibraryChange,
} from '../lib/events';
import { canonicalArxivId } from '../lib/arxiv';
import { showToast } from './toast';

interface PaperLite {
  id: string;
  arxivId: string;
  title?: string;
  title_zh?: string;
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

function byArxivId(papers: PaperLite[]): Map<string, PaperLite> {
  const map = new Map<string, PaperLite>();
  for (const p of papers) {
    const cid = canonicalArxivId(p.arxivId);
    if (cid) map.set(cid, p);
  }
  return map;
}

function isTrashOpen(): boolean {
  return window.location.hash.includes('wb=trash');
}

function openTrash(): void {
  if (isTrashOpen()) return;
  const cur = window.location.hash.replace(/^#/, '');
  const parts = cur ? cur.split('&').filter((p) => !p.startsWith('wb=')) : [];
  parts.push('wb=trash');
  history.replaceState(null, '', `#${parts.join('&')}`);
  paintTrash();
}

function closeTrash(): void {
  const cur = window.location.hash.replace(/^#/, '');
  if (!cur) return;
  const parts = cur.split('&').filter((p) => !p.startsWith('wb='));
  const next = parts.length ? `#${parts.join('&')}` : window.location.pathname + window.location.search;
  history.replaceState(null, '', next);
  const panel = document.querySelector<HTMLElement>('[data-papers-workbench-trash]');
  if (panel) panel.hidden = true;
  const btn = document.querySelector<HTMLButtonElement>('[data-wb-trash-toggle]');
  if (btn) btn.setAttribute('aria-pressed', 'false');
}

function paintTrash(): void {
  const panel = document.querySelector<HTMLElement>('[data-papers-workbench-trash]');
  if (!panel) return;
  panel.hidden = false;
  const btn = document.querySelector<HTMLButtonElement>('[data-wb-trash-toggle]');
  if (btn) btn.setAttribute('aria-pressed', 'true');

  const listEl = panel.querySelector<HTMLElement>('[data-papers-workbench-trash-list]');
  const emptyEl = panel.querySelector<HTMLElement>('[data-papers-workbench-trash-empty]');
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';

  const trashed = listTrashed();
  if (trashed.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  const map = byArxivId(loadPapersLite());
  for (const cid of trashed) {
    const p = map.get(cid);
    const row = document.createElement('div');
    row.className = 'papers-workbench-trash-row';

    const title = document.createElement('span');
    title.className = 'papers-workbench-trash-row-title';
    title.textContent = p?.title_zh || p?.title || cid;
    row.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'papers-workbench-trash-row-meta';
    meta.textContent = p?.arxivId || cid;
    row.appendChild(meta);

    const actions = document.createElement('span');
    actions.className = 'papers-workbench-trash-row-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'papers-workbench-trash-row-btn';
    restoreBtn.textContent = '↩ 恢复';
    restoreBtn.addEventListener('click', () => {
      const r = restoreFromTrash(cid);
      if (!r.ok) {
        showToast(`恢复失败:${r.reason}`, 'error');
      }
    });
    actions.appendChild(restoreBtn);

    const purgeBtn = document.createElement('button');
    purgeBtn.type = 'button';
    purgeBtn.className = 'papers-workbench-trash-row-btn papers-workbench-trash-row-btn--danger';
    purgeBtn.textContent = '✕ 彻底删除';
    purgeBtn.addEventListener('click', () => {
      if (!window.confirm(`彻底删除 "${title.textContent}" 的全部用户态(星标 / 笔记 / 阅读状态)?此操作不可撤销。`)) return;
      const r = purgeUserPaperState(cid);
      if (!r.ok) {
        showToast(`删除失败:${r.reason}`, 'error');
      }
    });
    actions.appendChild(purgeBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

function init(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-wb-trash-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (isTrashOpen()) closeTrash();
    else openTrash();
  });
  // hashchange → 重新渲染回收站(让用户手改 hash 也能生效)
  window.addEventListener('hashchange', () => {
    const panel = document.querySelector<HTMLElement>('[data-papers-workbench-trash]');
    if (!panel) return;
    if (isTrashOpen()) paintTrash();
    else panel.hidden = true;
  });
  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isTrashOpen()) closeTrash();
  });

  // 进入页面时:如果 hash 已带 wb=trash,直接展示
  if (isTrashOpen()) paintTrash();

  // user-library 状态变化 → 重渲染回收站列表(恢复 / 软删除 / 永久删除都会触发)
  onDprUserLibraryChange(document, (detail) => {
    if (!isTrashOpen()) return;
    if (
      detail.reason === 'trash'
      || detail.reason === 'restore'
      || detail.reason === 'purge'
      || detail.reason === 'bulk'
      || detail.reason === 'sync'
      || detail.reason === 'reset'
    ) {
      paintTrash();
    }
  });
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
} catch (e) {
  console.error('[paper-workbench-tabs] init failed:', e);
}
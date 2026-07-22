// topic-search 已选论文弹层 —— 从 topic-search.ts 抽出（模块化重构 step 12）。
//
// 「📚 添加参考论文」modal + ?from=selection 入口卡片 + arXiv 标题搜索结果区。
//
// 模块局部状态：modalOpen + arxivSearchAbort/arxivSearchSeq — 这些只在本弹层里使用，
// 不与别的模块共享。

import { loadSelection, addToSelection, removeFromSelection, isInSelection, clearSelection, type SelectionItem } from '../settings';
import { searchArxiv, searchArxivById } from '../paper-analyzer';
import type { ArxivEntry } from '../paper-analyzer';
import { $, escapeHtml } from '../../lib/dom-utils';
import { canonicalArxivId as canonicalId } from '../../lib/dom-utils';
import { setStatus, clearStatus } from './status';
import { renderStageInputSeedsBanner } from './render';
import { exploreFromSeeds } from './pipeline';
import { setCurrent, ensureSession, doSummarize, persistSession, loadStore, saveStore } from './actions';
import { uid } from './concurrency';
import type { TopicSession } from '../../lib/schemas';
import { S } from './state';

// 模块局部状态
let modalOpen = false;
let arxivSearchAbort: AbortController | null = null;
let arxivSearchSeq = 0;

// 注入"📚 基于已选 N 篇论文探索"卡片到 #seeds-pill-slot
function renderSeedsPill(seeds: SelectionItem[]): void {
  const slot = document.getElementById('seeds-pill-slot');
  if (!slot || seeds.length === 0) return;
  slot.innerHTML = `
    <div class="seeds-pill" id="seeds-pill">
      <div class="seeds-pill-icon">📚</div>
      <div class="seeds-pill-body">
        <div class="seeds-pill-title">基于已选 ${seeds.length} 篇论文探索</div>
        <div class="seeds-pill-desc">跳过手动输入思路,模型会读取每篇的 TLDR/方法/结果,生成 4-6 个迁移/探索方向(跨域迁移 / 方法借鉴 / 反向工程 / 组合创新)。</div>
      </div>
      <button type="button" class="topic-btn primary seeds-pill-btn" id="seeds-explore-btn">🚀 开始迁移探索</button>
    </div>
  `;
  document.getElementById('seeds-explore-btn')?.addEventListener('click', () => doExploreFromSeeds());
}

function hideSeedsPill(): void {
  const slot = document.getElementById('seeds-pill-slot');
  if (slot) slot.innerHTML = '';
}

async function doExploreFromSeeds(): Promise<void> {
  const seeds = loadSelection();
  if (seeds.length === 0) {
    setStatus('已选论文为空,请先在论文详情页加入选集', 'error');
    return;
  }
  const { loadSettings } = await import('../settings');
  const cfg = loadSettings();
  if (!cfg.apiKey) {
    setStatus('请先在设置页填 LLM API Key', 'error');
    return;
  }

  // 当前会话已经有内容 → 二次确认
  const cur = S.getSession();
  if (cur && (cur.subqs.length > 0 || cur.summaries.length > 0)) {
    if (!confirm(`开始迁移探索会清空当前会话的 ${cur.subqs.length} 个子方向和 ${cur.summaries.length} 篇已总结论文,确定吗?`)) {
      return;
    }
  }

  // 创建全新会话
  ensureSession();
  const session = S.getSession();
  if (!session) return;
  // 用新会话覆盖旧 topic / subqs
  session.topic = `基于 ${seeds.length} 篇已选论文的迁移探索`;
  session.subqs = [];
  session.candidatesBySubq = {};
  session.summaries = [];
  session.chats = {};
  const ta = $<HTMLTextAreaElement>('topic-input');
  ta.value = session.topic;
  ($<HTMLButtonElement>('decompose-btn')).disabled = true;

  hideSeedsPill();
  clearStatus();
  S.setInFlight(new AbortController());
  setStatus(`🌱 基于 ${seeds.length} 篇已选论文生成迁移方向...`);

  try {
    const subqs = await exploreFromSeeds(seeds, cfg);
    if (subqs.length === 0) {
      throw new Error('LLM 未返回任何迁移方向');
    }
    session.subqs = subqs;
    ($('stage-subqs') as HTMLDetailsElement).open = true;
    setCurrent(session);
    renderStageInputSeedsBanner();
    persistSession(session);
    setStatus(`✓ 已生成 ${subqs.length} 个迁移方向,勾选后搜索 arXiv`, 'success');
    setTimeout(clearStatus, 2000);
  } catch (e) {
    setStatus(`迁移探索失败: ${(e as Error).message}`, 'error');
  } finally {
    S.setInFlight(null);
  }
}

function openAddSeedsModal(): void {
  const modal = document.getElementById('add-seeds-modal');
  if (!modal) return;
  renderAddSeedsModalList();
  modal.classList.remove('topic-hidden');
  modalOpen = true;
  document.getElementById('add-seeds-search-input')?.focus();
}

function closeAddSeedsModal(): void {
  const modal = document.getElementById('add-seeds-modal');
  if (!modal) return;
  modal.classList.add('topic-hidden');
  modalOpen = false;
}

function renderAddSeedsModalList(): void {
  const wrap = document.getElementById('add-seeds-list');
  if (!wrap) return;
  const items = loadSelection();
  if (items.length === 0) {
    wrap.innerHTML =
      '<div class="topic-modal-empty">还没有参考论文 — 上方输入论文标题搜索,或展开「已知 arXiv ID」直接添加。</div>';
    return;
  }
  wrap.innerHTML = items
    .map(
      (it) => `
    <div class="topic-modal-list-item" data-arxiv="${escapeHtml(it.arxivId)}">
      <span class="topic-modal-list-badge">已加入</span>
      <a href="/papers/${encodeURIComponent(it.arxivId)}/" target="_blank" rel="noopener" class="topic-link topic-modal-list-id">
        arXiv:${escapeHtml(it.arxivId)}
      </a>
      <span class="topic-modal-list-title">${escapeHtml(it.title)}</span>
      <button type="button" class="topic-btn ghost topic-modal-list-remove" data-act="remove" title="从参考列表移除">✕</button>
    </div>`,
    )
    .join('');
  wrap.querySelectorAll<HTMLElement>('.topic-modal-list-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    row.querySelector<HTMLButtonElement>('[data-act="remove"]')!.addEventListener('click', () => {
      removeFromSelection(ax);
    });
  });
}

function updateSeedsCounter(): void {
  const chip = document.getElementById('seeds-counter-chip');
  const nEl = document.getElementById('seeds-counter-n');
  if (!chip || !nEl) return;
  const n = loadSelection().length;
  nEl.textContent = String(n);
  chip.hidden = n === 0;
  const modalCount = document.getElementById('add-seeds-count');
  if (modalCount) modalCount.textContent = String(n);
  renderStageInputSeedsBanner();
}

async function submitAddSeedsUrl(_form: HTMLFormElement): Promise<void> {
  const input = document.getElementById('add-seeds-url-input') as HTMLInputElement | null;
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    input.focus();
    return;
  }
  const m = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (!m) {
    setStatus(`无法从 "${raw}" 识别 arXiv ID`, 'error');
    return;
  }
  try {
    setStatus(`📥 正在获取 arXiv:${m[1]} 的元数据...`);
    const entries = await searchArxivById(m[1]);
    if (!entries.length) throw new Error('未找到该论文');
    const e = entries[0];
    addToSelection({
      arxivId: e.arxivId,
      title: e.title,
      tldr: e.summary.slice(0, 400),
      method: '',
      result: '',
      tags: [],
      addedAt: Date.now(),
    });
    input.value = '';
    setStatus(`✓ 已加入 arXiv:${e.arxivId}`, 'success');
    setTimeout(clearStatus, 1500);
  } catch (err) {
    setStatus(`获取失败: ${(err as Error).message}`, 'error');
  }
}

// 简单 token 排序:标题真的命中查询 token 的条目排前面
function rankArxivResults(entries: ArxivEntry[], query: string): ArxivEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const score = (e: ArxivEntry): number => {
    const t = e.title.toLowerCase();
    let s = 0;
    for (const tok of tokens) {
      if (t.includes(tok)) s += 10;
      if (t.startsWith(tok)) s += 5;
      if (e.summary.toLowerCase().includes(tok)) s += 1;
    }
    return s;
  };
  return [...entries].sort((a, b) => score(b) - score(a));
}

async function searchArxivByTitle(query: string): Promise<ArxivEntry[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (arxivSearchAbort) arxivSearchAbort.abort();
  arxivSearchAbort = new AbortController();
  const seq = ++arxivSearchSeq;
  try {
    const entries = await searchArxiv(q, { dedupeLatestVersion: true });
    if (seq !== arxivSearchSeq) return [];
    return rankArxivResults(entries, q);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    throw e;
  }
}

function renderArxivSearchResults(entries: ArxivEntry[]): void {
  const wrap = document.getElementById('add-seeds-search-results');
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML =
      '<div class="topic-modal-search-empty">未命中 — 试试更短的关键词、英文术语、或下方的「已知 arXiv ID」直接添加。</div>';
    return;
  }
  wrap.innerHTML = entries
    .slice(0, 12)
    .map((e) => {
      const id = canonicalId(e.arxivId);
      const already = isInSelection(id);
      const btnText = already ? '✓ 已加入' : '➕ 加入';
      return `
    <div class="topic-modal-search-item" data-arxiv="${escapeHtml(e.arxivId)}">
      <div class="topic-modal-search-item-main">
        <div class="topic-modal-search-item-title">${escapeHtml(e.title)}</div>
        <div class="topic-modal-search-item-meta">
          <span class="topic-modal-search-item-id">arXiv:${escapeHtml(e.arxivId)}</span>
          <span class="topic-modal-search-item-authors">${escapeHtml(e.authors.slice(0, 3).join(', ') + (e.authors.length > 3 ? ' …' : ''))}</span>
          <span class="topic-modal-search-item-date">${escapeHtml(e.published.slice(0, 10))}</span>
        </div>
        <div class="topic-modal-search-item-summary">${escapeHtml(e.summary.slice(0, 220))}${e.summary.length > 220 ? '…' : ''}</div>
      </div>
      <button type="button" class="topic-btn primary topic-modal-search-item-add" data-act="add"${already ? ' disabled' : ''}>${btnText}</button>
    </div>`;
    })
    .join('');
  wrap.querySelectorAll<HTMLElement>('.topic-modal-search-item').forEach((row) => {
    const ax = row.dataset.arxiv!;
    row.querySelector<HTMLButtonElement>('[data-act="add"]')!.addEventListener('click', () => {
      addSearchResultToSelection(ax);
    });
  });
}

function addSearchResultToSelection(arxivId: string): void {
  const wrap = document.getElementById('add-seeds-search-results');
  if (!wrap) return;
  if (isInSelection(arxivId)) {
    setStatus(`arXiv:${arxivId} 已在参考列表中`, '');
    setTimeout(clearStatus, 1500);
    return;
  }
  const canonId = canonicalId(arxivId);
  const card = wrap.querySelector<HTMLElement>(
    `.topic-modal-search-item[data-arxiv="${CSS.escape(arxivId)}"]`,
  );
  const title = card?.querySelector('.topic-modal-search-item-title')?.textContent?.trim() || canonId;
  const sumText = card?.querySelector('.topic-modal-search-item-summary')?.textContent?.trim() || '';
  addToSelection({
    arxivId: canonId,
    title,
    tldr: sumText.slice(0, 400),
    method: '',
    result: '',
    tags: [],
    addedAt: Date.now(),
  });
  setStatus(`✓ 已加入 arXiv:${canonId}`, 'success');
  setTimeout(clearStatus, 1500);
  if (card) {
    const btn = card.querySelector<HTMLButtonElement>('[data-act="add"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '✓ 已加入';
    }
  }
}

// 搜索输入:debounce 250ms
function setupAddSeedsSearch(): void {
  const input = document.getElementById('add-seeds-search-input') as HTMLInputElement | null;
  if (!input) return;
  const debounceMs = 250;
  let timer: number | undefined;
  input.addEventListener('input', () => {
    const v = input.value;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        if (v.trim().length < 3) {
          const wrap = document.getElementById('add-seeds-search-results');
          if (wrap) wrap.innerHTML = '';
          return;
        }
        const wrapEl = document.getElementById('add-seeds-search-results');
        if (wrapEl) wrapEl.innerHTML = '<div class="topic-modal-search-empty">🔍 正在搜索...</div>';
        const entries = await searchArxivByTitle(v);
        renderArxivSearchResults(entries);
      } catch (e) {
        const wrapEl = document.getElementById('add-seeds-search-results');
        if (wrapEl) {
          wrapEl.innerHTML = `<div class="topic-modal-search-empty topic-modal-search-error">搜索失败: ${escapeHtml((e as Error).message)}</div>`;
        }
      }
    }, debounceMs);
  });
}

export {
  renderSeedsPill,
  hideSeedsPill,
  doExploreFromSeeds,
  openAddSeedsModal,
  closeAddSeedsModal,
  renderAddSeedsModalList,
  updateSeedsCounter,
  submitAddSeedsUrl,
  setupAddSeedsSearch,
  modalOpen,
};
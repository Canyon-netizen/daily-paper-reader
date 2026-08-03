// 客户端脚本:用户文献库(复数 libraries)UI 全套。
//
// 对照 Polaris LibrariesPage / NewLibraryModal / LibraryPicker / LibraryDetailPage
// 的行为,跑在浏览器单页模式下:打开/关闭弹窗、提交新建、删除、改名、
// 「+ 加进文献库」多选弹层。
//
// 设计原则(沿用 lib/user-libraries/store.ts:commit() 的单一写入漏斗):
//   - 写操作 100% 走 store.ts 的 mutator(createLibrary / renameLibrary /
//     deleteLibrary / addPaperToLibrary / removePaperFromLibrary),不绕道;
//   - 监听 dpr:user-libraries-change 事件统一重渲,避免漏改;
//   - SSR 期无 localStorage → store 全部返回空 doc,事件不触发;
//     DOM 应当显示空状态 + 提示「在浏览器里创建」,由用户决定是否新建。
//
// 不依赖任何外部库;vanilla TS(沿用 scripts/paper-hide.ts 等老脚本风格)。

import { canonicalArxivId } from '../lib/arxiv';
import { onDprUserLibrariesChange } from '../lib/events';
import {
  addLibraryAnchor,
  addPaperToLibrary,
  createLibrary,
  deleteLibrary,
  getUserLibrary,
  listLibrariesContainingPaper,
  listUserLibraries,
  removeLibraryAnchor,
  removePaperFromLibrary,
  renameLibrary,
  setLibraryPaperMeta,
  setLibraryVisibility,
  updateLibraryDefinition,
  defaultLibraryDefinition,
  type LibraryAnchor,
  type LibraryHue,
  type LibraryPaperMeta,
  type LibraryRubricItem,
  type UserLibrary,
  LIBRARY_HUES,
} from '../lib/user-libraries';
import { showToast } from './toast';

const HUE_LIST: readonly LibraryHue[] = LIBRARY_HUES;

// ----------------------------------------------------------------
// 工具
// ----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Ingest 面板入口。点击 Govern tab「启动 Ingest」按钮触发。
 *  - 动态 import library-ingest 模块(避免冷启动 bundle 膨胀)
 *  - 调 runIngest(),把候选列表渲染到 #lib-ingest-mount
 *  - 每条候选三个动作:候选 / 纳入 / 跳过 */
async function openIngestPanel(libId: string): Promise<void> {
  const mount = document.getElementById('lib-ingest-mount');
  if (!mount) {
    showToast('找不到 ingest 容器', 'error');
    return;
  }
  // 锁住按钮 + 显示 loading
  mount.innerHTML = `
    <div class="lib-ingest-panel">
      <div class="lib-ingest-header">
        <h3>🛰️ Ingest · 正在拉 arXiv 候选</h3>
        <p class="muted">从 arXiv listing API 拉最近 30 天,LLM 批量打分。</p>
      </div>
      <div class="lib-ingest-progress"><span class="lib-spinner"></span><span data-ingest-status>准备中…</span></div>
    </div>
  `;
  const statusEl = mount.querySelector<HTMLElement>('[data-ingest-status]');
  const setStatus = (s: string) => { if (statusEl) statusEl.textContent = s; };

  try {
    setStatus('加载 ingest 模块…');
    const { runIngest, persistCandidatesAsCandidate, commitCandidateAsIncluded } = await import('./library-ingest');

    setStatus('拉 arXiv 候选…(可能 10-30s)');
    const candidates = await runIngest(libId, { daysBack: 30, maxResults: 50, threshold: 0.45 });

    if (candidates.length === 0) {
      mount.innerHTML = `
        <div class="lib-ingest-panel">
          <h3>🛰️ Ingest 完成</h3>
          <p class="muted">arXiv 在最近 30 天、当前关键词下没有命中 ≥ 0.45 的候选。</p>
          <p class="muted">建议:放宽 inScope / 包括关键词,或拉长 daysBack。</p>
        </div>
      `;
      return;
    }

    // 写候选状态(走 candidate,不直接进 paperIds)
    persistCandidatesAsCandidate(libId, candidates);
    showToast(`拉回 ${candidates.length} 篇候选(已写入 candidate 状态)`, 'ok');

    // 渲染候选列表
    mount.innerHTML = `
      <div class="lib-ingest-panel">
        <div class="lib-ingest-header">
          <h3>🛰️ Ingest · 候选 ${candidates.length} 篇(score ≥ 0.45)</h3>
          <p class="muted">按相关度倒序。每条点「✓ 纳入」加进 paperIds / 「⏭ 跳过」忽略 / 「🕐 留候选」保存为 candidate。</p>
          <div class="lib-ingest-batch">
            <button type="button" class="btn btn-soft btn-sm" data-ingest-batch="include-top" data-threshold="0.7">✓ 批量纳入 ≥ 0.70</button>
            <button type="button" class="btn btn-soft btn-sm" data-ingest-batch="include-top" data-threshold="0.6">✓ 批量纳入 ≥ 0.60</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ingest-batch="hide">关闭面板</button>
          </div>
        </div>
        <div class="lib-ingest-list">
          ${candidates.map((c, idx) => `
            <div class="lib-ingest-row" data-cx="${escapeHtml(c.cx)}">
              <div class="lib-ingest-meta">
                <span class="lib-ingest-score s-${c.score >= 0.7 ? 'h' : c.score >= 0.55 ? 'm' : 'l'}">${c.score.toFixed(2)}</span>
                <span class="lib-ingest-id">${escapeHtml(c.arxivId)}</span>
                <span class="lib-ingest-date">${escapeHtml(c.date || '—')}</span>
              </div>
              <div class="lib-ingest-title">${escapeHtml(c.title)}</div>
              <div class="lib-ingest-authors">${escapeHtml(c.authors.slice(0, 5).join(', '))}${c.authors.length > 5 ? ` +${c.authors.length - 5}` : ''}</div>
              ${c.reason ? `<div class="lib-ingest-reason">${escapeHtml(c.reason)}</div>` : ''}
              <div class="lib-ingest-actions">
                <button type="button" class="btn btn-primary btn-sm" data-ingest-action="include" data-cx="${escapeHtml(c.cx)}" data-idx="${idx}">✓ 纳入</button>
                <button type="button" class="btn btn-ghost btn-sm" data-ingest-action="skip" data-cx="${escapeHtml(c.cx)}" data-idx="${idx}">⏭ 跳过</button>
                <a class="btn btn-ghost btn-sm" href="https://arxiv.org/abs/${encodeURIComponent(c.arxivId.replace(/v\d+$/, ''))}" target="_blank" rel="noopener">🔗 arXiv</a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    // 把 candidates 缓存到 dataset 上,供后续 button handler 读
    mount.querySelector<HTMLElement>('.lib-ingest-panel')!.dataset.candidates = JSON.stringify(
      candidates.map((c) => ({ cx: c.cx, arxivId: c.arxivId, score: c.score, reason: c.reason })),
    );

    // 行内动作
    mount.querySelectorAll<HTMLButtonElement>('[data-ingest-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.ingestAction;
        const cx = btn.dataset.cx || '';
        const panel = mount.querySelector<HTMLElement>('.lib-ingest-panel');
        const cached = JSON.parse(panel?.dataset.candidates || '[]') as Array<{ cx: string; arxivId: string; score: number; reason: string }>;
        const cand = cached.find((x) => x.cx === cx);
        if (!cand) return;
        if (action === 'include') {
          commitCandidateAsIncluded(libId, {
            cx: cand.cx, arxivId: cand.arxivId, score: cand.score, reason: cand.reason,
            title: '', authors: [], abstract: '', date: '', inLibrary: false,
          });
          showToast(`已纳入 ${cand.arxivId}`, 'ok');
          btn.closest<HTMLElement>('.lib-ingest-row')?.remove();
        } else if (action === 'skip') {
          btn.closest<HTMLElement>('.lib-ingest-row')?.remove();
        }
      });
    });

    // 批量动作
    mount.querySelectorAll<HTMLButtonElement>('[data-ingest-batch]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.ingestBatch;
        if (action === 'hide') {
          mount.innerHTML = '';
          return;
        }
        if (action === 'include-top') {
          const thr = parseFloat(btn.dataset.threshold || '0.7');
          const panel = mount.querySelector<HTMLElement>('.lib-ingest-panel');
          const cached = JSON.parse(panel?.dataset.candidates || '[]') as Array<{ cx: string; arxivId: string; score: number; reason: string }>;
          let n = 0;
          for (const cand of cached) {
            if (cand.score < thr) break; // 倒序的,break 即可
            commitCandidateAsIncluded(libId, {
              cx: cand.cx, arxivId: cand.arxivId, score: cand.score, reason: cand.reason,
              title: '', authors: [], abstract: '', date: '', inLibrary: false,
            });
            n++;
          }
          showToast(`批量纳入 ${n} 篇`, 'ok');
          // 重渲(简单:重跑整个 ingest 面板)
          renderUserLibraryDetail();
          openIngestPanel(libId);
        }
      });
    });
  } catch (e) {
    mount.innerHTML = `
      <div class="lib-ingest-panel">
        <h3>🛰️ Ingest 失败</h3>
        <p class="muted error">${escapeHtml((e as Error).message || String(e))}</p>
      </div>
    `;
    showToast(`Ingest 失败:${(e as Error).message}`, 'error');
  }
}

/** 渲染 string[] 列表(govern tab 用);空数组 fallback 到 empty 文案。 */
function renderList(items: string[] | undefined, empty: string): string {
  if (!items || items.length === 0) return `<em class="empty">${escapeHtml(empty)}</em>`;
  return `<ul class="govern-list">${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
}

/** Polaris library_papers.status → UI badge。
 *  - candidate  = LLM 还没打分
 *  - scored     = LLM 打分完,等用户确认
 *  - included   = 已纳入(membership 默认值)
 *  - excluded   = 用户/打分剔除
 *  - trashed    = 回收站 */
function renderStatusBadge(status: string): string {
  const map: Record<string, { label: string; emoji: string; cls: string }> = {
    candidate: { label: '候选', emoji: '🕐', cls: 'badge-candidate' },
    scored:    { label: '已打分', emoji: '⭐', cls: 'badge-scored' },
    included:  { label: '已纳入', emoji: '✓', cls: 'badge-included' },
    excluded:  { label: '已剔除', emoji: '✗', cls: 'badge-excluded' },
    trashed:   { label: '回收站', emoji: '🗑', cls: 'badge-trashed' },
  };
  const m = map[status];
  if (!m) return '';
  return `<span class="row-status ${m.cls}">${m.emoji} ${m.label}</span>`;
}

/** 极简 markdown → HTML(Digest 显示用,不需要 fig/table 替换)。 */
function renderDigestMarkdown(md: string): string {
  // escape first
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // 段(以空行切)+ 行内(**粗** / *斜*)
  const lines = esc.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let inList = false;
  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    para = [];
  };
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  const inline = (s: string) =>
    s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
     .replace(/\*([^*]+)\*/g, '<em>$1</em>')
     .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith('## ')) { flushPara(); closeList(); out.push(`<h2>${inline(l.slice(3))}</h2>`); continue; }
    if (l.startsWith('### ')) { flushPara(); closeList(); out.push(`<h3>${inline(l.slice(4))}</h3>`); continue; }
    if (l.startsWith('- ')) { flushPara(); if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (l === '') { flushPara(); closeList(); continue; }
    para.push(l);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

/** 渲染 digest mount:当前 digest + 历史 list。 */
function renderDigestMount(
  mount: HTMLElement,
  current: { markdown: string; paperCount: number; id: string; generatedAt: number; model: string } | null,
  history: Array<{ id: string; paperCount: number; generatedAt: number }>,
): void {
  const cur = current
    ? `
      <article class="digest-article">
        <header class="digest-article-head">
          <span class="digest-date">${escapeHtml(current.id)}</span>
          <span class="digest-stats">${current.paperCount} 篇 · 模型 ${escapeHtml(current.model)} · ${new Date(current.generatedAt).toLocaleString('zh-CN')}</span>
        </header>
        <div class="digest-body">${renderDigestMarkdown(current.markdown)}</div>
      </article>
    `
    : `<p class="muted">还没有 digest。点上方「✨ 生成今日简报」。</p>`;
  const hist = history.length > 1
    ? `
      <details class="digest-history">
        <summary>历史(${history.length - 1} 份)</summary>
        <ul>
          ${history.filter((h) => !current || h.id !== current.id).slice(0, 10).map((h) => `
            <li>
              <button type="button" class="linklike" data-digest-open="${escapeHtml(h.id)}">${escapeHtml(h.id)}</button>
              <span class="muted"> · ${h.paperCount} 篇</span>
            </li>
          `).join('')}
        </ul>
      </details>
    `
    : '';
  mount.innerHTML = cur + hist;
}

/** 同步读 listDigests(避免 button click handler 里再 import 一遍) */
function listDigestsSnapshot(libId: string): Array<{ id: string; paperCount: number; generatedAt: number }> {
  const out: Array<{ id: string; paperCount: number; generatedAt: number }> = [];
  const prefix = `dpr_library_digest_v1:${libId}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k) || '') as { id: string; paperCount: number; generatedAt: number; markdown: string };
      if (d && d.markdown) out.push(d);
    } catch { /* ignore */ }
  }
  out.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  return out;
}

function fmtDateShort(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear().toString().slice(2)}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function baseHref(): string {
  // 静态站 BASE_URL 可能为空 / 或带尾 /;统一 strip
  const raw = (document.querySelector('base')?.getAttribute('href')) || '/';
  return raw.replace(/\/+$/, '') || '';
}

function url(path: string): string {
  return baseHref() + path;
}

function getApiResultMessage(res: { ok: boolean; reason?: string }): string {
  if (res.ok) return '';
  switch (res.reason) {
    case 'quota': return '浏览器存储已满,无法保存。请清理一些旧的笔记或高亮后再试。';
    case 'unavailable': return '浏览器不支持本地存储(localStorage 不可用)。';
    case 'invalid': return '字段校验失败:名称和方向描述都不能为空,长度也不能超限。';
    default: return `操作失败:${res.reason || '未知原因'}`;
  }
}

// ----------------------------------------------------------------
// 「我的文献库」section 渲染(给首页 / /libraries/ 用)
// ----------------------------------------------------------------

interface SectionRefs {
  section: HTMLElement;
  grid: HTMLElement;
  empty: HTMLElement | null;
  counter: HTMLElement | null;
  filter?: { activeType: 'all' | 'public' | 'personal' };
}

function renderUserLibraryCard(lib: UserLibrary): string {
  const detailUrl = url(`/libraries/?id=${encodeURIComponent(lib.id)}`);
  const titleEsc = escapeHtml(lib.name);
  const stmtEsc = escapeHtml(lib.statement);
  const created = fmtDateShort(lib.createdAt);
  return `
    <a class="library-card hue-${escapeHtml(lib.hue)}"
       href="${escapeHtml(detailUrl)}"
       data-lib-id="${escapeHtml(lib.id)}"
       data-lib-type="personal"
       data-dim="user">
      <h2 class="lib-title">
        <span class="lib-title-row">
          <span class="lib-name" title="${titleEsc}">${titleEsc}</span>
          <span class="lib-type-badge lib-type-badge--personal">个人</span>
        </span>
        <span class="lib-count">${lib.paperIds.length} 篇</span>
      </h2>
      <p class="lib-statement">${stmtEsc}</p>
      <div class="lib-stats">
        <span><strong>${lib.paperIds.length}</strong> 篇论文</span>
        <span>创建于 ${created}</span>
      </div>
      <div class="lib-meta">
        <span class="lib-type-badge lib-mine-badge">⭐ 我的</span>
        <button type="button"
                class="lib-action-btn lib-action-btn--danger"
                data-lib-action="delete"
                data-lib-id="${escapeHtml(lib.id)}"
                aria-label="删除文献库"
                title="删除文献库">🗑</button>
      </div>
    </a>
  `;
}

function renderUserLibrariesSection(refs: SectionRefs): void {
  const libs = listUserLibraries();
  const counter = refs.counter;
  if (counter) counter.textContent = `${libs.length} 个`;

  if (libs.length === 0) {
    if (refs.empty) {
      refs.empty.style.display = '';
      refs.grid.style.display = 'none';
    } else {
      refs.grid.innerHTML = `
        <div class="libraries-empty">
          <div class="libraries-empty-icon">📂</div>
          <h3 class="libraries-empty-title">还没有个人文献库</h3>
          <p class="libraries-empty-desc">
            在这里新建一个文献库,把你想精读 / 反复查阅的论文收在一起。
            存在浏览器里,跨设备同步走 Gist。
          </p>
          <button type="button" class="btn btn-primary" data-open-new-library>➕ 新建文献库</button>
        </div>
      `;
    }
    return;
  }

  if (refs.empty) refs.empty.style.display = 'none';
  refs.grid.style.display = '';
  refs.grid.innerHTML = libs.map(renderUserLibraryCard).join('');

  // 过滤:如果 section 配了 type filter,只显示匹配项
  if (refs.filter) {
    const want = refs.filter.activeType;
    refs.grid.querySelectorAll<HTMLElement>('.library-card').forEach((el) => {
      const t = el.dataset.libType || 'personal';
      const show = want === 'all' || (want === 'public' ? t === 'public' : t === 'personal');
      el.style.display = show ? '' : 'none';
    });
  }
}

function setupUserLibrariesSection(): void {
  const sections = document.querySelectorAll<HTMLElement>('[data-user-libraries-section]');
  if (sections.length === 0) return;

  sections.forEach((section) => {
    const grid = section.querySelector<HTMLElement>('[data-user-libraries-grid]');
    const empty = section.querySelector<HTMLElement>('[data-user-libraries-empty]');
    const counter = section.querySelector<HTMLElement>('[data-user-libraries-counter]');
    if (!grid) return;

    const refs: SectionRefs = { section, grid, empty, counter };

    // 第一次渲染
    renderUserLibrariesSection(refs);

    // 监听事件,重渲整段
    const off = onDprUserLibrariesChange(window, () => renderUserLibrariesSection(refs));
    // Astro page-load 切换时不需要解绑(单页 reload 全部清掉)
    void off;

    // 删除按钮(事件代理)
    section.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-lib-action="delete"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || '';
      const lib = listUserLibraries().find((l) => l.id === id);
      if (!lib) return;
      const ok = window.confirm(
        `确定删除文献库「${lib.name}」吗?\n\n库内的论文不会从 docs 里删除,只是从你的收藏夹里移除。\n此操作不可撤销。`,
      );
      if (!ok) return;
      const res = deleteLibrary(id);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast(`已删除「${lib.name}」`, 'ok');
      }
    });
  });
}

// ----------------------------------------------------------------
// 「+ 新建文献库」按钮 + 弹窗(对照 Polaris NewLibraryModal)
// ----------------------------------------------------------------

function openModal(modal: HTMLElement): void {
  modal.style.display = 'flex';
  // 焦点放到 name input
  const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
  setTimeout(() => nameInput?.focus(), 30);
}

/** 把字符串列表绑到一个「输入框 + 已选 tag」控件上,负责:
 *  - 在 tagListEl 里渲染当前 items(可删除)
 *  - 同步到 hidden input(JSON 字符串)
 *  - 处理 input 的回车 / 逗号 / 「+ 添加」按钮
 *  - 暴露 reset() 清空内部状态(closeModal 调用)
 *
 *  onChange 在 items 变更后调用,用于刷新 chip 状态等。 */
function bindListInput(
  modal: HTMLElement,
  opts: {
    listKey: 'categories' | 'inclusion' | 'exclusion' | 'rubric';
    presetAttr?: string; // 对 categories:preset chip 的 selector
  },
): { tags: string[]; refresh: () => void; reset: () => void; loadFrom: (items: string[]) => void; rubric: LibraryRubricItem[] } {
  const isRubric = opts.listKey === 'rubric';
  const input = modal.querySelector<HTMLInputElement>(
    isRubric ? '[data-rubric-input]' : `[data-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}-input]`,
  )!;
  const addBtn = modal.querySelector<HTMLButtonElement>(
    isRubric ? '[data-rubric-add]' : `[data-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}-add]`,
  );
  const tagListEl = modal.querySelector<HTMLElement>(
    isRubric ? '[data-rubric-rows]' : `[data-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}-tags]`,
  )!;
  const hidden = modal.querySelector<HTMLInputElement>(
    isRubric ? '[data-modal-rubric]' : `[data-modal-${opts.listKey === 'categories' ? 'categories' : opts.listKey === 'inclusion' ? 'incl' : 'excl'}]`,
  )!;

  // rubric 用对象数组;其它用字符串数组。
  let strItems: string[] = [];
  let rubricItems: LibraryRubricItem[] = [];

  function commit(): void {
    hidden.value = isRubric ? JSON.stringify(rubricItems) : JSON.stringify(strItems);
    if (opts.presetAttr && !isRubric) {
      // 同步 preset chip 的 active 态(categories)
      const presets = modal.querySelectorAll<HTMLElement>(`[data-cat-preset]`);
      presets.forEach((chip) => {
        const v = chip.dataset.catPreset || '';
        chip.classList.toggle('active', strItems.includes(v));
      });
    }
  }

  function render(): void {
    const items = isRubric ? rubricItems.map((r) => r.name) : strItems;
    if (items.length === 0) {
      tagListEl.innerHTML = '<span class="lib-tag-empty">— 暂未添加 —</span>';
      commit();
      return;
    }
    tagListEl.innerHTML = items
      .map(
        (label, idx) =>
          `<span class="lib-tag">${escapeHtml(label)}<button type="button" class="lib-tag-x" data-rm="${idx}" aria-label="删除 ${escapeHtml(label)}">×</button></span>`,
      )
      .join('');
    commit();
  }

  function addOne(raw: string): boolean {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (!v) return false;
    if (isRubric) {
      if (rubricItems.some((r) => r.name.toLowerCase() === v.toLowerCase())) return false;
      rubricItems.push({ name: v.slice(0, 32) });
    } else {
      if (strItems.some((s) => s.toLowerCase() === v.toLowerCase())) return false;
      strItems.push(v.slice(0, 32));
    }
    render();
    return true;
  }

  function addManyFromInput(): void {
    // 支持中英文逗号 + 空格切分,粘多词进来一次添加多个
    const raw = input.value;
    if (!raw.trim()) return;
    const parts = raw.split(/[,,]+/).map((s) => s.trim()).filter(Boolean);
    let added = 0;
    for (const p of parts) {
      if (addOne(p)) added++;
    }
    input.value = '';
  }

  // input 行为:回车 / 逗号提交,失焦不提交
  input.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ',') {
      e.preventDefault();
      addManyFromInput();
    }
  });
  // 中文输入法 IME 阶段不应当吞回车,但这里 input.value 已经能拿到文字了,
  // 简单起见,IME 状态下走「compositionend 之后回车会立即被 keydown 接收」
  // —— 现代浏览器对 keydown Enter 在 IME 期间会带 keyCode 229 但 key 名仍是 Enter,
  // 我们用 inputType 粗略防御:compositionend 之后再清值。
  input.addEventListener('compositionend', () => {
    // 不主动 add(让用户回车显式确认),只是确保状态同步
    void input.value;
  });
  addBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    addManyFromInput();
    input.focus();
  });

  // 删除 tag
  tagListEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('[data-rm]');
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.rm || '-1');
    if (!Number.isFinite(idx) || idx < 0) return;
    if (isRubric) rubricItems.splice(idx, 1);
    else strItems.splice(idx, 1);
    render();
  });

  // categories preset chip 点击
  if (opts.presetAttr) {
    modal.querySelectorAll<HTMLElement>(`[data-cat-preset]`).forEach((chip) => {
      // 同一节点多次 bindListInput 时避免重复绑(closeModal 会再调一次)
      if ((chip as unknown as { __bound?: boolean }).__bound) return;
      (chip as unknown as { __bound?: boolean }).__bound = true;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const v = chip.dataset.catPreset || '';
        if (!v) return;
        if (strItems.includes(v)) {
          strItems = strItems.filter((s) => s !== v);
        } else {
          strItems.push(v);
        }
        render();
      });
    });
  }

  render();
  return {
    get tags() { return strItems.slice(); },
    get rubric() { return rubricItems.slice(); },
    refresh: render,
    reset: () => {
      strItems = [];
      rubricItems = [];
      input.value = '';
      render();
    },
    loadFrom: (items: string[]) => {
      strItems = isRubric ? [] : items.slice();
      rubricItems = isRubric ? items.slice().map((name) => ({ name: name.slice(0, 32) })) : [];
      input.value = '';
      render();
    },
  };
}

interface ModalControls {
  categories: ReturnType<typeof bindListInput>;
  inclusion: ReturnType<typeof bindListInput>;
  exclusion: ReturnType<typeof bindListInput>;
  rubric: ReturnType<typeof bindListInput>;
}

interface AnchorControl {
  get: () => LibraryAnchor[];
  reset: () => void;
  loadFrom: (anchors: LibraryAnchor[]) => void;
}

/** 锚点论文控件。Polaris LibraryDefinition.anchors 在 P8a JSONB 里,
 *  UI 上需要可增可删。每行 kind badge + value + 可选 note + 删除。 */
function bindAnchorControl(modal: HTMLElement): AnchorControl {
  const rowsEl = modal.querySelector<HTMLElement>('[data-anchor-rows]')!;
  const kindSel = modal.querySelector<HTMLSelectElement>('[data-anchor-kind]')!;
  const valueInput = modal.querySelector<HTMLInputElement>('[data-anchor-value]')!;
  const addBtn = modal.querySelector<HTMLButtonElement>('[data-anchor-add]')!;

  let items: LibraryAnchor[] = [];

  function render(): void {
    if (items.length === 0) {
      rowsEl.innerHTML = '<span class="lib-tag-empty">— 暂未添加锚点 —</span>';
      return;
    }
    rowsEl.innerHTML = items
      .map(
        (a, idx) => `
        <div class="lib-anchor-row" data-idx="${idx}">
          <span class="kind-badge kind-${a.kind}">${escapeHtml(a.kind)}</span>
          <span class="value">${escapeHtml(a.value)}</span>
          ${a.note ? `<span class="note">${escapeHtml(a.note)}</span>` : ''}
          <button type="button" class="lib-anchor-rm" aria-label="删除锚点">×</button>
        </div>
      `,
      )
      .join('');
    rowsEl.querySelectorAll<HTMLButtonElement>('.lib-anchor-rm').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('.lib-anchor-row');
        const idx = Number(row?.dataset.idx);
        if (Number.isFinite(idx)) {
          items.splice(idx, 1);
          render();
        }
      });
    });
  }

  function add(): void {
    const kind = (kindSel.value === 'arxiv' || kindSel.value === 'doi' || kindSel.value === 'free')
      ? kindSel.value
      : 'free';
    const v = valueInput.value.trim();
    if (!v) return;
    if (items.some((a) => a.kind === kind && a.value.toLowerCase() === v.toLowerCase())) {
      showToast('已存在相同锚点', 'info');
      return;
    }
    if (items.length >= 32) {
      showToast('锚点最多 32 条', 'error');
      return;
    }
    // 询问 note(prompt) — Polaris 留 note 字段;可选。
    const note = window.prompt('这个锚点为什么相关?(可选,1-100 字)')?.trim() || undefined;
    items.push({ kind, value: v.slice(0, 200), ...(note ? { note: note.slice(0, 100) } : {}) });
    valueInput.value = '';
    render();
  }

  addBtn.addEventListener('click', add);
  valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  render();
  return {
    get: () => items.slice(),
    reset: () => {
      items = [];
      render();
      valueInput.value = '';
    },
    loadFrom: (anchors) => {
      items = anchors.slice();
      render();
    },
  };
}

/** 在弹窗上装好四个 list 控件并 reset 到空态。返回 handlers 让 caller 在 reset/close 时复用。 */
function setupModalControls(modal: HTMLElement): ModalControls {
  return {
    categories: bindListInput(modal, { listKey: 'categories', presetAttr: 'data-cat-preset' }),
    inclusion: bindListInput(modal, { listKey: 'inclusion' }),
    exclusion: bindListInput(modal, { listKey: 'exclusion' }),
    rubric: bindListInput(modal, { listKey: 'rubric' }),
  };
}

function closeModal(modal: HTMLElement): void {
  modal.style.display = 'none';
  // 清 edit 模式
  delete modal.dataset.editId;
  const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
  if (titleEl) titleEl.textContent = '新建文献库';
  const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
  if (submitBtn) submitBtn.textContent = '创建个人文献库';
  // 清空 + 重置状态
  const form = modal.querySelector<HTMLFormElement>('form');
  form?.reset();
  // 重置 hue 默认 emerald
  modal.querySelectorAll<HTMLElement>('.lib-hue-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.hue === 'emerald');
  });
  // 清错误态
  modal.querySelectorAll<HTMLElement>('.lib-field-error').forEach((el) => (el.textContent = ''));
  modal.querySelectorAll<HTMLElement>('.lib-input--error, .lib-textarea--error').forEach((el) =>
    el.classList.remove('lib-input--error', 'lib-textarea--error'),
  );
  // 复位 list 控件:每次 closeModal 复用同一组 controls(避免重复 bind),
  // 这里只清内部数组 + 重渲染。preset chip 的 active 态通过
  // controls.categories.refresh() 内部 commit() 同步清掉。
  const controls = controlsByModal.get(modal);
  if (controls) {
    controls.categories.reset();
    controls.inclusion.reset();
    controls.exclusion.reset();
    controls.rubric.reset();
  }
  // 锚点控件
  const anchorCtl = anchorControlByModal.get(modal);
  if (anchorCtl) anchorCtl.reset();
  // 清空 P8a 多行文本
  modal.querySelectorAll<HTMLTextAreaElement>('[data-modal-goals],[data-modal-in-scope],[data-modal-out-of-scope],[data-modal-questions]').forEach((el) => {
    el.value = '';
  });
  // 重置 select 默认值
  const visSel = modal.querySelector<HTMLSelectElement>('[data-modal-visibility]');
  if (visSel) visSel.value = 'personal';
  const cadSel = modal.querySelector<HTMLSelectElement>('[data-modal-cadence]');
  if (cadSel) cadSel.value = 'manual';
}

/** 同一 modal 节点在不同打开轮次复用同一组 controls;
 *  关闭时全部清空 + reset。 */
const controlsByModal = new WeakMap<HTMLElement, ModalControls>();
const anchorControlByModal = new WeakMap<HTMLElement, AnchorControl>();

function bindHuePicker(modal: HTMLElement): void {
  const chips = modal.querySelectorAll<HTMLElement>('.lib-hue-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const hidden = modal.querySelector<HTMLInputElement>('[data-modal-hue]');
      if (hidden) hidden.value = chip.dataset.hue || 'emerald';
    });
  });
}

/** 多行文本 → string[];空串丢,空白折叠,长度限制,maxItems 兜底。 */
function parseSentences(raw: string, maxItems: number, maxLen: number): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\n+/)) {
    const v = line.trim().replace(/\s+/g, ' ');
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v.slice(0, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 把 library 现有 definition 回填到 modal(编辑模式) */
function fillModalFromLibrary(modal: HTMLElement, lib: UserLibrary): void {
  // 基础
  const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
  if (nameInput) nameInput.value = lib.name;
  const stmt = modal.querySelector<HTMLTextAreaElement>('[data-modal-statement]');
  if (stmt) stmt.value = lib.statement;
  const hueInput = modal.querySelector<HTMLInputElement>('[data-modal-hue]');
  if (hueInput) hueInput.value = lib.hue;
  modal.querySelectorAll<HTMLElement>('.lib-hue-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.hue === lib.hue);
  });

  // visibility + cadence
  const visSel = modal.querySelector<HTMLSelectElement>('[data-modal-visibility]');
  if (visSel) visSel.value = lib.visibility || 'personal';
  const cadSel = modal.querySelector<HTMLSelectElement>('[data-modal-cadence]');
  const def = lib.definition || defaultLibraryDefinition(lib.statement);
  if (cadSel) cadSel.value = def.cadence;

  // P8a 字段
  const goalsTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-goals]');
  if (goalsTA) goalsTA.value = def.goals.join('\n');
  const inScopeTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-in-scope]');
  if (inScopeTA) inScopeTA.value = def.inScope.join('\n');
  const outScopeTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-out-of-scope]');
  if (outScopeTA) outScopeTA.value = def.outOfScope.join('\n');
  const questionsTA = modal.querySelector<HTMLTextAreaElement>('[data-modal-questions]');
  if (questionsTA) questionsTA.value = def.questions.join('\n');
}

/** 编辑模式:把 library.definition.anchors + 已加入 paperIds 之外的 arxiv-id
 *  显示在锚点控件里。Polaris 实际只把「外部种子论文」放 anchors,library 内
 *  已有论文由 paperIds 自动 included。 */
function openEditLibraryModal(modal: HTMLElement, libId: string): boolean {
  const lib = getUserLibrary(libId);
  if (!lib) {
    showToast(`找不到文献库 ${libId.slice(0, 8)}`, 'error');
    return false;
  }
  // 标题切到「编辑」
  const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
  if (titleEl) titleEl.textContent = `编辑「${lib.name}」`;
  const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
  if (submitBtn) submitBtn.textContent = '保存修改';

  // 标 edit 模式
  modal.dataset.editId = libId;

  fillModalFromLibrary(modal, lib);

  // 控制依赖(创建阶段 setupModalControls 已经 bind;close 时 reset)
  const controls = controlsByModal.get(modal);
  if (controls) {
    controls.categories.loadFrom?.(lib.categories);
    controls.inclusion.loadFrom?.(lib.inclusionKeywords);
    controls.exclusion.loadFrom?.(lib.exclusionKeywords);
    controls.rubric.loadFrom?.(lib.rubric.map((r) => r.name));
  }
  // anchors 控件(创建阶段已 bind;现在 load)
  const anchorCtl = anchorControlByModal.get(modal);
  if (anchorCtl) {
    anchorCtl.loadFrom(lib.definition?.anchors || []);
  } else {
    // 没 bind(SSR 后没初始化过):补一次 bind 然后 load
    const ctl = bindAnchorControl(modal);
    ctl.loadFrom(lib.definition?.anchors || []);
    anchorControlByModal.set(modal, ctl);
  }
  modal.style.display = 'flex';
  const nameInput = modal.querySelector<HTMLInputElement>('[data-modal-name]');
  setTimeout(() => nameInput?.focus(), 30);
  return true;
}

function setupNewLibraryModal(): void {
  const modal = document.querySelector<HTMLElement>('[data-new-library-modal]');
  if (!modal) return;

  // 关闭
  modal.querySelectorAll<HTMLElement>('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal));
  });

  // 初始化 list 控件
  controlsByModal.set(modal, setupModalControls(modal));
  // 初始化 anchors 控件(只 bind 一次)
  if (!anchorControlByModal.has(modal)) {
    anchorControlByModal.set(modal, bindAnchorControl(modal));
  }

  // 打开:全局所有 [data-open-new-library] 触发
  document.querySelectorAll<HTMLElement>('[data-open-new-library]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 切到「新建」态
      delete modal.dataset.editId;
      const titleEl = modal.querySelector<HTMLElement>('#new-library-modal-title');
      if (titleEl) titleEl.textContent = '新建文献库';
      const submitBtn = modal.querySelector<HTMLButtonElement>('[data-modal-submit]');
      if (submitBtn) submitBtn.textContent = '创建个人文献库';
      openModal(modal);
    });
  });

  // 编辑:任意位置 [data-edit-library="<id>"]
  document.querySelectorAll<HTMLElement>('[data-edit-library]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.editLibrary || '';
      if (!id) return;
      openEditLibraryModal(modal, id);
    });
  });

  // 同步默认 hue 到 hidden input
  const initialActive = modal.querySelector<HTMLElement>('.lib-hue-chip.active');
  const initialHue = (initialActive?.dataset.hue as LibraryHue) || 'emerald';
  const hueInput = modal.querySelector<HTMLInputElement>('[data-modal-hue]');
  if (hueInput) hueInput.value = initialHue;

  // hue picker
  bindHuePicker(modal);

  // 提交(同时覆盖新建 + 编辑两种模式)
  const form = modal.querySelector<HTMLFormElement>('form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = form.querySelector<HTMLInputElement>('[data-modal-name]')!;
    const stmtInput = form.querySelector<HTMLTextAreaElement>('[data-modal-statement]')!;
    const hue = (form.querySelector<HTMLInputElement>('[data-modal-hue]')?.value as LibraryHue) || 'emerald';
    const name = nameInput.value.trim();
    const statement = stmtInput.value.trim();
    const nameErr = form.querySelector<HTMLElement>('[data-modal-name-err]')!;
    const stmtErr = form.querySelector<HTMLElement>('[data-modal-stmt-err]')!;
    let bad = false;
    if (!name) {
      nameErr.textContent = '请填写文献库名称';
      nameInput.classList.add('lib-input--error');
      bad = true;
    } else if (name.length > 32) {
      nameErr.textContent = '名称不能超过 32 字';
      nameInput.classList.add('lib-input--error');
      bad = true;
    } else {
      nameErr.textContent = '';
      nameInput.classList.remove('lib-input--error');
    }
    if (!statement) {
      stmtErr.textContent = '请填写一句话方向描述';
      stmtInput.classList.add('lib-textarea--error');
      bad = true;
    } else if (statement.length > 200) {
      stmtErr.textContent = '方向描述不能超过 200 字';
      stmtInput.classList.add('lib-textarea--error');
      bad = true;
    } else {
      stmtErr.textContent = '';
      stmtInput.classList.remove('lib-textarea--error');
    }
    if (bad) return;

    const controls = controlsByModal.get(modal);
    const categories = controls?.categories.tags ?? [];
    const inclusionKeywords = controls?.inclusion.tags ?? [];
    const exclusionKeywords = controls?.exclusion.tags ?? [];
    const rubric = controls?.rubric.rubric ?? [];

    // 新字段
    const visibility = (form.querySelector<HTMLSelectElement>('[data-modal-visibility]')?.value as 'personal' | 'pending' | 'public') || 'personal';
    const cadence = (form.querySelector<HTMLSelectElement>('[data-modal-cadence]')?.value as 'manual' | 'daily' | 'weekly' | 'monthly') || 'manual';
    const goals = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-goals]')?.value || '', 3, 200);
    const inScope = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-in-scope]')?.value || '', 8, 80);
    const outOfScope = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-out-of-scope]')?.value || '', 8, 80);
    const questions = parseSentences(form.querySelector<HTMLTextAreaElement>('[data-modal-questions]')?.value || '', 8, 200);
    const anchors = anchorControlByModal.get(modal)?.get() ?? [];

    const submitBtn = form.querySelector<HTMLButtonElement>('[data-modal-submit]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const editId = modal.dataset.editId;
      if (editId) {
        // 编辑模式
        const r1 = renameLibrary(editId, { name, statement, hue, categories, inclusionKeywords, exclusionKeywords, rubric });
        if (!r1.ok) {
          showToast(getApiResultMessage(r1) || '保存失败', 'error');
          return;
        }
        const r2 = updateLibraryDefinition(editId, {
          statement,
          cadence,
          anchors,
          keywords: {
            arxivCategories: categories,
            include: inclusionKeywords,
            exclude: exclusionKeywords,
          },
          rubric,
          goals,
          inScope,
          outOfScope,
          questions,
        });
        if (!r2.ok) {
          showToast(getApiResultMessage(r2) || '保存失败', 'error');
          return;
        }
        const r3 = setLibraryVisibility(editId, visibility);
        if (!r3.ok) {
          showToast(getApiResultMessage(r3) || '可见性保存失败', 'error');
          return;
        }
        showToast(`已保存「${name}」`, 'ok');
        closeModal(modal);
        // 触发详情视图重渲染(在 /libraries/?id=<editId> 上)
        document.dispatchEvent(new CustomEvent('dpr:user-library-edit', { detail: { id: editId } }));
        return;
      }

      // 新建模式
      const res = createLibrary({
        name,
        statement,
        hue,
        categories,
        inclusionKeywords,
        exclusionKeywords,
        rubric,
        visibility,
        definition: {
          statement,
          cadence,
          anchors,
          keywords: {
            arxivCategories: categories,
            include: inclusionKeywords,
            exclude: exclusionKeywords,
          },
          rubric,
          goals,
          inScope,
          outOfScope,
          questions,
        },
      });
      if (!res.ok || !res.id) {
        showToast(getApiResultMessage(res) || '创建失败', 'error');
        return;
      }
      showToast(`已创建「${name}」`, 'ok');
      closeModal(modal);
      window.location.href = url(`/libraries/?id=${encodeURIComponent(res.id)}`);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ----------------------------------------------------------------
// 「+ 加进文献库」按钮 + 弹层(对照 Polaris LibraryPicker)
// ----------------------------------------------------------------

interface PopoverRefs {
  btn: HTMLElement;
  popover: HTMLElement;
  paperId: string;
}

function renderAddToLibraryPopover(refs: PopoverRefs): void {
  const libs = listUserLibraries();
  const inLibs = new Set(listLibrariesContainingPaper(refs.paperId));
  const list = refs.popover.querySelector<HTMLElement>('[data-atl-list]')!;
  const confirmBtn = refs.popover.querySelector<HTMLButtonElement>('[data-atl-confirm]')!;
  const cancelBtn = refs.popover.querySelector<HTMLButtonElement>('[data-atl-cancel]')!;

  // 初始:每个库根据 inLibs 决定是否勾选;用户改动存到暂存 set
  const picked = new Set<string>(inLibs);
  function rerenderList(): void {
    if (libs.length === 0) {
      list.innerHTML = `
        <div class="atl-empty">
          还没有任何文献库,先创建一个吧 ⤵
        </div>
      `;
      confirmBtn.textContent = '关闭';
      confirmBtn.disabled = false;
      return;
    }
    list.innerHTML = libs
      .map((lib) => {
        const on = picked.has(lib.id);
        return `
          <button type="button" class="atl-item ${on ? 'on' : ''}" data-atl-id="${escapeHtml(lib.id)}">
            <span class="atl-check">${on ? '✓' : ''}</span>
            <span style="flex:1; min-width:0;">
              <div class="atl-name">${escapeHtml(lib.name)}</div>
              <div class="atl-statement">${escapeHtml(lib.statement)}</div>
              <div class="atl-meta">${lib.paperIds.length} 篇论文</div>
            </span>
          </button>
        `;
      })
      .join('');
    // 「+ 新建」入口
    const div = document.createElement('div');
    div.className = 'atl-divider';
    list.appendChild(div);
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'atl-new';
    newBtn.dataset.atlAction = 'new';
    newBtn.textContent = '➕ 新建文献库并加入';
    list.appendChild(newBtn);
    confirmBtn.textContent = '保存';
    confirmBtn.disabled = false;
  }
  rerenderList();

  // 列表点击:切换勾选
  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const newBtn = target.closest<HTMLElement>('[data-atl-action="new"]');
    if (newBtn) {
      e.preventDefault();
      e.stopPropagation();
      // 关掉 popover,打开新建 modal;再让用户回来勾选 — 简化:
      // 直接 inline 一个 mini form(避免再开 modal)
      const newForm = document.createElement('div');
      newForm.className = 'atl-empty';
      newForm.style.textAlign = 'left';
      newForm.innerHTML = `
        <div class="lib-field" style="margin-bottom: 0.5rem;">
          <input type="text" class="lib-input" placeholder="文献库名称" maxlength="32" data-atl-new-name />
        </div>
        <div class="lib-field" style="margin-bottom: 0.5rem;">
          <textarea class="lib-textarea" placeholder="一句话方向描述" maxlength="200" rows="2" data-atl-new-stmt></textarea>
        </div>
        <div class="lib-field-hint" style="margin-bottom: 0.5rem;">
          分类 / 关键词 / 打分维度可后续在文献库详情页补全。
        </div>
        <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
          <button type="button" class="btn btn-soft btn-sm" data-atl-new-cancel>取消</button>
          <button type="button" class="btn btn-primary btn-sm" data-atl-new-confirm>创建并加入</button>
        </div>
      `;
      list.innerHTML = '';
      list.appendChild(newForm);
      (newForm.querySelector<HTMLInputElement>('[data-atl-new-name]'))?.focus();

      newForm.querySelector('[data-atl-new-cancel]')?.addEventListener('click', () => {
        rerenderList();
      });
      newForm.querySelector('[data-atl-new-confirm]')?.addEventListener('click', () => {
        const n = (newForm.querySelector<HTMLInputElement>('[data-atl-new-name]')?.value || '').trim();
        const s = (newForm.querySelector<HTMLTextAreaElement>('[data-atl-new-stmt]')?.value || '').trim();
        if (!n || !s) {
          showToast('名称和方向描述都要填', 'error');
          return;
        }
        const res = createLibrary({ name: n, statement: s, hue: 'emerald' });
        if (!res.ok || !res.id) {
          showToast(getApiResultMessage(res) || '创建失败', 'error');
          return;
        }
        // 立即加入本论文
        addPaperToLibrary(res.id, refs.paperId);
        showToast(`已创建「${n}」并加入本论文`, 'ok');
        rerenderList();
        // 触发外层 update 按钮态
        updateAddToLibraryButtons();
      });
      return;
    }
    const item = target.closest<HTMLElement>('[data-atl-id]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const id = item.dataset.atlId || '';
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    rerenderList();
  });

  // 保存:把 picked 与 inLibs 算 diff,加 / 减
  confirmBtn.onclick = () => {
    if (libs.length === 0) {
      closePopover(refs);
      return;
    }
    let added = 0;
    let removed = 0;
    for (const id of picked) {
      if (!inLibs.has(id)) {
        const r = addPaperToLibrary(id, refs.paperId);
        if (r.ok && r.changed) added++;
      }
    }
    for (const id of inLibs) {
      if (!picked.has(id)) {
        const r = removePaperFromLibrary(id, refs.paperId);
        if (r.ok && r.changed) removed++;
      }
    }
    if (added > 0 || removed > 0) {
      const parts: string[] = [];
      if (added > 0) parts.push(`加入 ${added} 个`);
      if (removed > 0) parts.push(`移出 ${removed} 个`);
      showToast(parts.join(' / '), 'ok');
    }
    closePopover(refs);
    updateAddToLibraryButtons();
  };
  cancelBtn.onclick = () => closePopover(refs);
}

function openPopover(refs: PopoverRefs): void {
  refs.popover.style.display = 'flex';
  renderAddToLibraryPopover(refs);
}

function closePopover(refs: PopoverRefs): void {
  refs.popover.style.display = 'none';
}

function setupAddToLibraryButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-add-to-library]').forEach((btn) => {
    const paperId = btn.dataset.addToLibrary || '';
    if (!paperId) return;
    let popover = btn.parentElement?.querySelector<HTMLElement>('[data-add-to-library-popover]') || null;
    if (!popover) {
      // 自动建一个
      popover = document.createElement('div');
      popover.className = 'add-to-library-popover';
      popover.dataset.addToLibraryPopover = 'true';
      popover.style.display = 'none';
      popover.innerHTML = `
        <div data-atl-list></div>
        <div data-atl-actions class="atl-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-atl-cancel>取消</button>
          <button type="button" class="btn btn-primary btn-sm" data-atl-confirm>保存</button>
        </div>
      `;
      btn.insertAdjacentElement('afterend', popover);
    }
    const refs: PopoverRefs = { btn, popover, paperId };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (popover!.style.display === 'flex') {
        closePopover(refs);
      } else {
        // 关闭其它已开的
        document.querySelectorAll<HTMLElement>('[data-add-to-library-popover]').forEach((p) => {
          if (p !== popover) p.style.display = 'none';
        });
        openPopover(refs);
      }
    });
  });
  // 点击外部关掉
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-add-to-library]') || target.closest('[data-add-to-library-popover]')) return;
    document.querySelectorAll<HTMLElement>('[data-add-to-library-popover]').forEach((p) => (p.style.display = 'none'));
  });
  updateAddToLibraryButtons();
}

function updateAddToLibraryButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-add-to-library]').forEach((btn) => {
    const paperId = btn.dataset.addToLibrary || '';
    const cid = canonicalArxivId(paperId);
    if (!cid) return;
    const inLibs = listLibrariesContainingPaper(cid);
    const countEl = btn.querySelector<HTMLElement>('[data-in-libs-count]');
    const labelEl = btn.querySelector<HTMLElement>('[data-add-to-library-label]');
    if (inLibs.length > 0) {
      btn.classList.add('add-to-library-btn--in');
      if (labelEl) labelEl.textContent = '✓ 在文献库里';
      if (countEl) {
        countEl.textContent = `(${inLibs.length})`;
        countEl.style.display = '';
      }
    } else {
      btn.classList.remove('add-to-library-btn--in');
      if (labelEl) labelEl.textContent = '+ 加进文献库';
      if (countEl) countEl.style.display = 'none';
    }
  });
}

// ----------------------------------------------------------------
// 详情页(/libraries/?id=<userLibId>)的客户端 mount
//
// /libraries/ SSR 渲染「?id=」时输出一个空 mount 节点(因为静态站
// 不能预渲染运行时 user library id)。这里客户端水合:
//   1. 从 localStorage 找 lib
//   2. 从 SSR data-papers-json 拿全集,按 lib.paperIds 过滤
//   3. 渲染 3 tab(论文 / 概念 / 笔记)与公共库详情同构
//   4. 顶部加「✏️ 重命名 / 🗑 删除 / 🎨 改 hue」按钮组
// ----------------------------------------------------------------

interface PaperLite {
  id: string;
  canonicalArxivId: string;
  title: string;
  title_zh?: string;
  title_plain?: string;
  arxivId: string;
  date: string;
  pdf?: string;
  venue?: string;
  authors?: string;
  tldr?: string;
  evidence?: string;
  score?: number;
  concepts?: Array<{ slug: string; display_name: string; category: string }>;
}

function renderUserLibraryDetail(): void {
  const root = document.querySelector<HTMLElement>('[data-user-library-detail-id]');
  if (!root) return;
  const libId = root.dataset.userLibraryDetailId || '';
  const lib = listUserLibraries().find((l) => l.id === libId);
  if (!lib) {
    // 不存在:重定向回列表
    window.location.href = url('/libraries/');
    return;
  }

  const mount = root.querySelector<HTMLElement>('[data-user-library-detail-mount]')!;
  const papersJson = root.dataset.papersJson || '[]';
  let allPapers: PaperLite[] = [];
  try {
    allPapers = JSON.parse(papersJson);
  } catch {
    allPapers = [];
  }
  // 默认按相关度(score 降序,同分按 date 降序)排序 —— 跟公共库工作台的口径一致,
  // 进库第一眼看到最相关的研究,而不是按入库时间。"未打分"的论文(score 缺)
  // 会落到列表底部:不把"近期但未评估"的论文顶到 top 位置。
  const papers = allPapers
    .filter((p) => lib.paperIds.includes(p.canonicalArxivId))
    .sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : 0;
      const sb = typeof b.score === 'number' ? b.score : 0;
      if (sb !== sa) return sb - sa;
      return (b.date || '').localeCompare(a.date || '');
    });

  // 概念聚合
  const conceptMap = new Map<string, { slug: string; display_name: string; category: string; n: number }>();
  for (const p of papers) {
    for (const c of p.concepts || []) {
      if (!c?.slug) continue;
      const cur = conceptMap.get(c.slug);
      if (cur) cur.n++;
      else conceptMap.set(c.slug, { slug: c.slug, display_name: c.display_name, category: c.category, n: 1 });
    }
  }
  const topConcepts = Array.from(conceptMap.values()).sort((a, b) => b.n - a.n);
  const created = fmtDateShort(lib.createdAt);

  // 页面标题
  document.title = `${lib.name} · 我的文献库 · Daily Paper Reader`;

  mount.className = `library-workbench hue-${escapeHtml(lib.hue)}`;
  mount.innerHTML = `
    <header class="library-wb-hero">
      <div>
        <h1>
          <span class="lib-type-badge lib-type-badge--personal" style="margin-right: 0.5rem; vertical-align: middle;">个人</span>
          ${escapeHtml(lib.name)}
        </h1>
        <p class="lib-wb-zh">${escapeHtml(lib.statement)}</p>
        <div class="library-wb-meta">
          <span><span class="meta-num" data-user-lib-paper-count>${papers.length}</span> 篇论文</span>
          <span><span class="meta-num">${topConcepts.length}</span> 个高频概念</span>
          <span class="lib-user-owner">
            <span class="lib-type-badge lib-mine-badge">⭐ 我的</span>
            创建于 ${created}
          </span>
        </div>
        <div class="lib-detail-actions">
          <button type="button" class="btn btn-soft btn-sm" data-action="edit" data-lib-id="${escapeHtml(lib.id)}">📝 编辑文献库(全部)</button>
          <button type="button" class="btn btn-soft btn-sm" data-action="delete" data-lib-id="${escapeHtml(lib.id)}">🗑 删除文献库</button>
        </div>
      </div>
      <div class="library-wb-export">
        <a class="export-btn" href="#" data-library-export-target="bibtex" data-cx-prefix="${escapeHtml(lib.id)}-library" data-paper-ids='${escapeHtml(JSON.stringify(lib.paperIds))}'>📄 导出 references.bib</a>
        <a class="export-btn" href="#" data-library-export-target="csl" data-cx-prefix="${escapeHtml(lib.id)}-library" data-paper-ids='${escapeHtml(JSON.stringify(lib.paperIds))}'>📋 导出 library.csl.json</a>
        <a class="export-btn primary" href="#" data-library-export-target="obsidian" data-cx-prefix="${escapeHtml(lib.id)}-library" data-paper-ids='${escapeHtml(JSON.stringify(lib.paperIds))}'>📦 导出 my-library.zip</a>
        <span id="lib-export-hint" class="export-hint"></span>
      </div>
    </header>

    <nav class="library-wb-tabs" aria-label="tab 切换">
      <a class="lib-wb-tab active" href="#papers" data-tab="papers">📄 论文库 <span class="tab-count">${papers.length}</span></a>
      <a class="lib-wb-tab" href="#concepts" data-tab="concepts">🕸 概念库 <span class="tab-count">${topConcepts.length}</span></a>
      <a class="lib-wb-tab" href="#digest" data-tab="digest">📰 每日简报</a>
      <a class="lib-wb-tab" href="#notes" data-tab="notes">📝 笔记 <span class="tab-count">—</span></a>
      <a class="lib-wb-tab" href="#govern" data-tab="govern">⚙️ 文献库配置 <span class="tab-count">P8a</span></a>
      <a class="back" href="${url('/libraries/')}">← 所有文献库</a>
    </nav>

    <section id="papers-panel" class="library-wb-panel active" data-panel="papers">
      <div class="wb-papers" data-user-lib-paper-list>
        <div class="wb-papers-list">
          <div class="wb-papers-filter">
            <a class="filter-pill active" data-view="all" href="#papers">全部 ${papers.length}</a>
            <a class="filter-pill" data-view="today" href="#papers">今日 ${papers.filter((p) => p.date === new Date().toISOString().slice(0, 10)).length}</a>
          </div>
          <div class="wb-papers-sort">
            <span class="sort-label">排序</span>
            <a class="filter-pill" data-sort="date" href="#papers">📅 按时间</a>
            <a class="filter-pill active" data-sort="score" href="#papers">⭐ 按相关度</a>
          </div>
          ${papers.length === 0
            ? `<p class="empty" data-user-lib-empty-hint>
                库内还没有论文。
                <br />在论文详情页右上角点 <strong>+ 加进文献库</strong> 即可加入;
                或点这里 <button type="button" class="btn btn-soft btn-sm" data-action="add-papers" data-lib-id="${escapeHtml(lib.id)}">去添加</button>。
              </p>`
            : papers.map((p, i) => {
              const meta = lib.papers[p.canonicalArxivId];
              const statusBadge = meta ? renderStatusBadge(meta.status) : '';
              return `
              <a class="wb-paper-row${i === 0 ? ' is-selected' : ''}"
                 href="#paper-${escapeHtml(p.canonicalArxivId)}"
                 data-paper-id="${escapeHtml(p.canonicalArxivId)}"
                 ${typeof p.score === 'number' && p.score > 0 ? `data-score="${p.score}"` : ''}>
                <div class="row-head">
                  <span class="arx">${escapeHtml(p.arxivId || '—')}</span>
                  ${p.date ? `<span>${escapeHtml(p.date.slice(5))}</span>` : ''}
                  <span class="year">${escapeHtml((p.date || '').slice(0, 4) || '—')}</span>
                  ${statusBadge}
                </div>
                <p class="row-title">${escapeHtml(p.title_zh || p.title_plain || p.title || p.id)}</p>
                ${p.title && p.title_zh ? `<p class="row-en">${escapeHtml(p.title)}</p>` : ''}
                <div class="row-chips">
                  ${(p.concepts?.length || 0) > 0 ? `<span class="row-chip">🕸 ${p.concepts?.length} 概念</span>` : ''}
                  <span class="row-chip">📅 ${escapeHtml(p.date || '—')}</span>
                </div>
              </a>
            `;}).join('')}
        </div>
        <div class="wb-paper-detail" id="wb-detail-pane">
          ${papers.length === 0
            ? '<p class="empty">没有可显示的论文</p>'
            : papers.map((p, i) => renderPaperDetailBody(p, i, lib.papers[p.canonicalArxivId])).join('')}
        </div>
      </div>
    </section>

    <section id="concepts-panel" class="library-wb-panel" data-panel="concepts">
      <div class="wb-concepts">
        <div class="wb-concepts-filter">
          <a class="filter-pill active" href="#concepts" data-cat="all"><span>全部</span><span>${topConcepts.length}</span></a>
          ${Array.from(new Set(topConcepts.map((c) => c.category))).sort().map((cat) => `
            <a class="filter-pill" href="#concepts" data-cat="${escapeHtml(cat)}">
              <span>${escapeHtml(cat)}</span>
              <span>${topConcepts.filter((c) => c.category === cat).length}</span>
            </a>
          `).join('')}
        </div>
        <div class="wb-concepts-grid">
          ${topConcepts.length === 0
            ? '<p class="empty">库内还没有概念(论文还没挂概念时这里会空)。</p>'
            : topConcepts.map((c) => `
              <a class="wb-concepts-card" href="${url('/wiki/concepts/' + c.slug + '/')}" data-cat="${escapeHtml(c.category)}">
                <p class="cc-name">${escapeHtml(c.display_name)}</p>
                <div class="cc-meta"><span>×${c.n} 篇</span></div>
                <p class="cc-cat">${escapeHtml(c.category)}</p>
              </a>
            `).join('')}
        </div>
      </div>
    </section>

    <section id="govern-panel" class="library-wb-panel" data-panel="govern">
      <div class="wb-govern">
        <div class="govern-header">
          <h3>文献库配置(P8a LibraryDefinition)</h3>
          <button type="button" class="btn btn-soft btn-sm" data-action="edit" data-lib-id="${escapeHtml(lib.id)}">📝 编辑</button>
        </div>
        <dl class="govern-dl">
          <dt>可见性</dt>
          <dd>
            <span class="lib-visibility-pill vis-${escapeHtml(lib.visibility || 'personal')}">${escapeHtml({
              personal: '个人(仅本机 + Gist)',
              pending: '申请公开(请求中)',
              public: '公开(已发布)',
            }[lib.visibility || 'personal'])}</span>
          </dd>
          <dt>同步节奏</dt>
          <dd>${escapeHtml((lib.definition?.cadence || 'manual'))}</dd>
          <dt>研究方向陈述</dt>
          <dd>${escapeHtml(lib.statement)}</dd>
          <dt>分类 / 包括 / 排除关键词</dt>
          <dd>
            ${lib.categories.map((c) => `<span class="lib-tag">${escapeHtml(c)}</span>`).join('')}
            ${lib.inclusionKeywords.length > 0 ? '<div>包括:' + lib.inclusionKeywords.map((k) => `<span class="lib-tag include">${escapeHtml(k)}</span>`).join('') + '</div>' : ''}
            ${lib.exclusionKeywords.length > 0 ? '<div>排除:' + lib.exclusionKeywords.map((k) => `<span class="lib-tag exclude">${escapeHtml(k)}</span>`).join('') + '</div>' : ''}
            ${lib.categories.length + lib.inclusionKeywords.length + lib.exclusionKeywords.length === 0 ? '<em class="empty">— 未设置 —</em>' : ''}
          </dd>
          <dt>打分维度(rubric)</dt>
          <dd>
            ${lib.rubric.length > 0 ? lib.rubric.map((r) => `<span class="lib-tag">${escapeHtml(r.name)}</span>`).join('') : '<em class="empty">— 未设置 —</em>'}
          </dd>
          <dt>库目标(goals)</dt>
          <dd>${renderList(lib.definition?.goals, '— 未设置 —')}</dd>
          <dt>范围内(in scope)</dt>
          <dd>${renderList(lib.definition?.inScope, '— 未设置 —')}</dd>
          <dt>范围外(out of scope)</dt>
          <dd>${renderList(lib.definition?.outOfScope, '— 未设置 —')}</dd>
          <dt>研究问题</dt>
          <dd>${renderList(lib.definition?.questions, '— 未设置 —')}</dd>
          <dt>锚点论文</dt>
          <dd>
            ${lib.definition?.anchors && lib.definition.anchors.length > 0
              ? lib.definition.anchors.map((a) => `
                  <div class="lib-anchor-row">
                    <span class="kind-badge kind-${escapeHtml(a.kind)}">${escapeHtml(a.kind)}</span>
                    <span class="value">${escapeHtml(a.value)}</span>
                    ${a.note ? `<span class="note">${escapeHtml(a.note)}</span>` : ''}
                  </div>
                `).join('')
              : '<em class="empty">— 未设置 —</em>'}
          </dd>
        </dl>
        <p class="lib-edit-hint">
          配置变化后,顶部的论文列表会按新的 statement / 关键词重新过滤;
          想立刻按新方向给库内论文打分,
          <button type="button" class="linklike" data-action="rescore" data-lib-id="${escapeHtml(lib.id)}">点这里重打分</button>。
        </p>
        <p class="lib-edit-hint lib-ingest-hint">
          <strong>🛰️ Ingest</strong>:按当前 statement + 关键词去 arXiv 拉最近论文,LLM 给每篇打分,
          让你挑哪些进库。
          <button type="button" class="btn btn-primary btn-sm" data-action="ingest" data-lib-id="${escapeHtml(lib.id)}">▶ 启动 Ingest</button>
        </p>
      </div>
      <div id="lib-ingest-mount"></div>
    </section>

    <section id="digest-panel" class="library-wb-panel" data-panel="digest">
      <div class="wb-digest">
        <div class="digest-header">
          <h3>📰 每日简报</h3>
          <p class="muted">基于 statement + 关键词 + inScope,聚合最近 7 天库内论文,LLM 生成中文解读。本地缓存 24h。</p>
          <button type="button" class="btn btn-primary btn-sm" data-action="digest-generate" data-lib-id="${escapeHtml(lib.id)}">✨ 生成今日简报</button>
        </div>
        <div id="lib-digest-mount" data-lib-digest-mount></div>
      </div>
    </section>

    <section id="notes-panel" class="library-wb-panel" data-panel="notes">
      <div class="wb-notes">
        <p class="empty">
          笔记在每篇论文的 <a href="${url('/papers/')}">详情页</a> 底部写。
          选中下面的论文直接进入「📝 写笔记」位置。
        </p>
        ${papers.slice(0, 50).map((p) => `
          <a class="wb-note-row" href="${url('/papers/' + p.id + '/#paper-notes-section')}">
            <div class="note-head">
              <span>${escapeHtml(p.arxivId || '—')}</span>
              <span>${escapeHtml((p.date || '').slice(5) || '—')}</span>
            </div>
            <p class="note-title">${escapeHtml(p.title_zh || p.title_plain || p.title || p.id)}</p>
            ${p.title && p.title_zh !== p.title ? `<p class="note-body">${escapeHtml(p.title)}</p>` : ''}
          </a>
        `).join('')}
      </div>
    </section>
  `;

  // tab 切换
  const VALID_TABS = ['papers', 'concepts', 'digest', 'notes', 'govern'] as const;
  type Tab = typeof VALID_TABS[number];
  function setActiveTab(tab: Tab) {
    mount.querySelectorAll<HTMLAnchorElement>('.lib-wb-tab').forEach((t) => {
      t.classList.toggle('active', (t.dataset.tab || '') === tab);
    });
    mount.querySelectorAll<HTMLElement>('.library-wb-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === tab);
    });
  }
  function syncFromHash() {
    const m = window.location.hash.match(/^#(papers|concepts|digest|notes|govern)$/);
    if (m) setActiveTab(m[1] as Tab);
  }
  mount.querySelectorAll<HTMLAnchorElement>('.lib-wb-tab').forEach((t) => {
    t.addEventListener('click', () => {
      const tab = (t.dataset.tab || '') as Tab;
      if ((VALID_TABS as readonly string[]).includes(tab)) setActiveTab(tab);
    });
  });
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();

  // 论文行点击高亮
  mount.querySelectorAll<HTMLAnchorElement>('.wb-paper-row').forEach((row) => {
    row.addEventListener('click', () => {
      mount.querySelectorAll('.wb-paper-row').forEach((r) => r.classList.remove('is-selected'));
      row.classList.add('is-selected');
    });
  });

  // view 过滤(全部 / 今日)
  mount.querySelectorAll<HTMLAnchorElement>('.wb-papers-filter .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-papers-filter .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      const view = p.dataset.view;
      mount.querySelectorAll<HTMLElement>('.wb-paper-row').forEach((row) => {
        const date = row.querySelector('.row-head > span:nth-child(2)')?.textContent || '';
        const show = view === 'all' || (view === 'today' && /\d{2}-\d{2}/.test(date));
        row.style.display = show ? '' : 'none';
      });
    });
  });

  // 排序(按时间 / 按相关度)—— 客户端重排 DOM,与公共库工作台口径一致。
  // 读 row 上的 data-score 属性;缺失视为 0;同分 fallback 到 date 降序。
  mount.querySelectorAll<HTMLAnchorElement>('.wb-papers-sort .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-papers-sort .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      const sort = p.dataset.sort;
      const list = mount.querySelector<HTMLElement>('.wb-papers-list');
      if (!list) return;
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.wb-paper-row'));
      rows.sort((a, b) => {
        if (sort === 'score') {
          const sa = parseFloat(a.dataset.score || '0');
          const sb = parseFloat(b.dataset.score || '0');
          if (sb !== sa) return sb - sa;
        }
        const da = a.querySelector('.row-head > span:nth-child(2)')?.textContent || '';
        const db = b.querySelector('.row-head > span:nth-child(2)')?.textContent || '';
        return db.localeCompare(da);
      });
      const frag = document.createDocumentFragment();
      rows.forEach((r) => frag.appendChild(r));
      list.appendChild(frag);
    });
  });

  // 概念 category 过滤
  mount.querySelectorAll<HTMLAnchorElement>('.wb-concepts-filter .filter-pill').forEach((p) => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      mount.querySelectorAll('.wb-concepts-filter .filter-pill').forEach((b) => b.classList.toggle('active', b === p));
      const cat = p.dataset.cat;
      mount.querySelectorAll<HTMLElement>('.wb-concepts-card').forEach((card) => {
        const show = cat === 'all' || card.dataset.cat === cat;
        card.style.display = show ? '' : 'none';
      });
    });
  });

  // 顶部按钮(编辑 / 删除)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const modal = document.querySelector<HTMLElement>('[data-new-library-modal]');
      if (!modal) return;
      const id = btn.dataset.libId || lib.id;
      openEditLibraryModal(modal, id);
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="rescore"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showToast('正在按新方向给库内论文重打分 — 见 PapersTab', 'info');
      window.location.hash = '#papers';
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="ingest"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      openIngestPanel(id);
    });
  });
  mount.querySelectorAll<HTMLButtonElement>('[data-action="digest-generate"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.libId || lib.id;
      const mount = document.getElementById('lib-digest-mount');
      if (!mount) return;
      mount.innerHTML = '<p class="muted"><span class="lib-spinner"></span> 正在生成 digest…</p>';
      try {
        const { generateDigest, listDigests } = await import('./library-digest');
        const d = await generateDigest(id, allPapers);
        renderDigestMount(mount, d, listDigests(id));
      } catch (err) {
        mount.innerHTML = `<p class="muted error">生成失败:${escapeHtml((err as Error).message)}</p>`;
      }
    });
  });
  // digest 历史里的「打开」按钮
  mount.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>('[data-digest-open]');
    if (!btn) return;
    e.preventDefault();
    const date = btn.dataset.digestOpen || '';
    const id = lib.id;
    import('./library-digest').then(({ loadCachedDigest }) => {
      const d = loadCachedDigest(id, date);
      const mount = document.getElementById('lib-digest-mount');
      if (mount && d) renderDigestMount(mount, d, listDigestsSnapshot(id));
    });
  });
  mount.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => {
    const ok = window.confirm(
      `确定删除文献库「${lib.name}」吗?\n\n库内的论文不会从 docs 里删除,只是从你的收藏夹里移除。\n此操作不可撤销。`,
    );
    if (!ok) return;
    const res = deleteLibrary(lib.id);
    if (!res.ok) {
      showToast(getApiResultMessage(res), 'error');
    } else {
      showToast('已删除', 'ok');
      window.location.href = url('/libraries/');
    }
  });
  mount.querySelector<HTMLButtonElement>('[data-action="add-papers"]')?.addEventListener('click', () => {
    window.location.href = url('/papers/');
  });

  // 论文行:移出文献库按钮
  mount.querySelectorAll<HTMLButtonElement>('[data-action="remove-from-lib"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cxId = btn.dataset.cxId || '';
      if (!cxId) return;
      const ok = window.confirm('确定把这篇论文从文献库里移出?');
      if (!ok) return;
      const res = removePaperFromLibrary(lib.id, cxId);
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast('已移出', 'ok');
        renderUserLibraryDetail();
      }
    });
  });

  // status 切换(Polaris library_papers.status 状态机:included/excluded/trashed/candidate)
  mount.querySelectorAll<HTMLButtonElement>('[data-action="status"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cxId = btn.dataset.cxId || '';
      const status = btn.dataset.status as 'included' | 'excluded' | 'trashed' | 'candidate' | undefined;
      if (!cxId || !status) return;
      const res = setLibraryPaperMeta(lib.id, cxId, { status });
      if (!res.ok) {
        showToast(getApiResultMessage(res), 'error');
      } else {
        showToast(`状态 → ${status}`, 'ok');
        renderUserLibraryDetail();
      }
    });
  });

  // 本库专属 TL;DR(失焦防抖保存)
  let saveTimer: number | null = null;
  mount.querySelectorAll<HTMLTextAreaElement>('.lib-tldr-note').forEach((ta) => {
    ta.addEventListener('blur', () => {
      const cxId = ta.dataset.cxId || '';
      if (!cxId) return;
      if (saveTimer) window.clearTimeout(saveTimer);
      const note = ta.value.trim();
      saveTimer = window.setTimeout(() => {
        const res = setLibraryPaperMeta(lib.id, cxId, { tldrNote: note });
        if (!res.ok) {
          showToast(getApiResultMessage(res), 'error');
        } else if (res.changed) {
          showToast('已保存本库 TL;DR', 'ok');
        }
      }, 250);
    });
    // Ctrl/Cmd+Enter 立即保存
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        ta.blur();
      }
    });
  });

  // 导出按钮(走 export-bridge 同一份函数,但 prefix + paperIds 是用户库自己)
  // export-bridge.ts 期望 data-cx 是 JSON.stringify(canonicalId[]) + data-prefix
  // 我们用 data-cx-prefix(自定义属性)+ data-paper-ids 注入;这里简单直接调用
  // exportBySet()(如果有 export 的话)。但 export-bridge 默认从 #library-wb-data
  // 节点读;这里走同一份函数:
  //   - 在 mount 末尾插一个隐藏的 [data-library-wb-data],套上 data-cx / data-prefix
  //   - import initLibraryExportButtons() 让按钮工作
  // 简化:写一个 mini 注入器
  injectExportDataAttrs(mount, lib.id, lib.paperIds);
  import('./export-bridge').then((m) => {
    try {
      m.initLibraryExportButtons?.();
    } catch {
      /* ignore */
    }
  }).catch(() => {
    /* ignore */
  });
}

function injectExportDataAttrs(mount: HTMLElement, libId: string, paperIds: string[]): void {
  let carrier = mount.querySelector<HTMLElement>('[data-cx]');
  if (!carrier) {
    carrier = document.createElement('section');
    carrier.setAttribute('aria-hidden', 'true');
    mount.appendChild(carrier);
  }
  carrier.dataset.cx = JSON.stringify(paperIds);
  carrier.dataset.prefix = `${libId}-library`;
  carrier.id = 'library-wb-data';
}

function renderPaperDetailBody(p: PaperLite, i: number, meta: LibraryPaperMeta | undefined): string {
  const statusLabel = meta ? renderStatusBadge(meta.status) : '';
  const relevanceScore = typeof meta?.relevanceScore === 'number' ? meta.relevanceScore : null;
  return `
    <div id="paper-${escapeHtml(p.canonicalArxivId)}"
         class="wb-detail-body${i === 0 ? ' wb-detail-default' : ''}">
      <div class="detail-head">
        <div class="detail-head-text">
          <div class="detail-pills">
            ${statusLabel ? `<span class="pill pill-libstatus pill-${escapeHtml(meta?.status || 'included')}">${statusLabel.replace(/<[^>]*>/g, '')}</span>` : '<span class="pill pill-status">已纳入</span>'}
            ${p.tldr ? '<span class="pill pill-wiki">✨ wiki</span>' : ''}
            ${p.pdf ? '<span class="pill pill-pdf">📄 PDF</span>' : ''}
            ${p.venue ? `<span class="pill pill-venue">${escapeHtml(p.venue)}</span>` : ''}
          </div>
          <h2>${escapeHtml(p.title_zh || p.title_plain || p.title || p.id)}</h2>
          ${p.title && p.title_zh ? `<p class="detail-en">${escapeHtml(p.title)}</p>` : ''}
          ${p.authors ? `<p class="detail-authors">${escapeHtml(p.authors)}</p>` : ''}
          <div class="detail-meta">
            ${p.arxivId ? `<a href="https://arxiv.org/abs/${encodeURIComponent(p.arxivId.replace(/v\d+$/, ''))}" target="_blank" rel="noopener">arXiv:${escapeHtml(p.arxivId)}</a>` : ''}
            <span>${escapeHtml(p.date || '—')}</span>
          </div>
        </div>
        ${typeof p.score === 'number' && p.score > 0 ? `
          <div class="score-ring" aria-label="相关度 ${p.score.toFixed(2)}">
            <svg viewBox="0 0 64 64" width="64" height="64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="var(--bg-muted)" stroke-width="4" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="var(--accent)" stroke-width="4"
                      stroke-dasharray="${(p.score * 175.93).toFixed(1)} 175.93"
                      stroke-linecap="round" transform="rotate(-90 32 32)" />
            </svg>
            <span class="score-ring-label">${p.score.toFixed(2)}</span>
            <span class="score-ring-sub">相关度</span>
          </div>
        ` : ''}
      </div>

      <div class="detail-row detail-actions">
        <a class="export-btn primary" href="${url('/papers/' + p.id + '/')}">📖 阅读原文</a>
        <a class="export-btn" href="${url('/papers/' + p.id + '/#paper-notes-section')}">📝 写笔记</a>
        ${p.pdf ? `<a class="export-btn" href="${escapeHtml(p.pdf)}" target="_blank" rel="noopener">🔗 arXiv PDF</a>` : ''}
        <button type="button" class="export-btn" data-action="remove-from-lib" data-cx-id="${escapeHtml(p.canonicalArxivId)}">🗑 从文献库移出</button>
      </div>

      ${p.tldr ? `
        <div class="tldr-card">
          <span class="tldr-label">TL;DR</span>
          <p>${escapeHtml(p.tldr)}</p>
        </div>
      ` : ''}

      ${meta ? `
        <details class="detail-section" open>
          <summary>本库专属 TL;DR · ${meta.status}</summary>
          ${relevanceScore !== null ? `<p class="lib-meta-line">📊 本库相关度:<strong>${relevanceScore.toFixed(2)}</strong>${meta.relevanceReason ? ` — ${escapeHtml(meta.relevanceReason)}` : ''}</p>` : ''}
          <textarea
            class="lib-tldr-note"
            rows="3"
            maxlength="500"
            placeholder="在这条库的方向上,这篇论文的核心要点 / 我的批注(0-500 字)"
            data-cx-id="${escapeHtml(p.canonicalArxivId)}"
          >${escapeHtml(meta.tldrNote || '')}</textarea>
          <div class="lib-meta-actions">
            <button type="button" class="btn btn-soft btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="included">✓ 纳入</button>
            <button type="button" class="btn btn-soft btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="excluded">✗ 剔除</button>
            <button type="button" class="btn btn-soft btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="candidate">🕐 重置候选</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="status" data-cx-id="${escapeHtml(p.canonicalArxivId)}" data-status="trashed">🗑 回收站</button>
          </div>
        </details>
      ` : ''}

      ${p.concepts && p.concepts.length > 0 ? (() => {
        const limit = 12;
        const overflow = p.concepts.length > limit;
        return `
          <details class="detail-section" open=${p.concepts.length <= limit}>
            <summary>概念 · ${p.concepts.length} 个</summary>
            <div class="concepts-chips">
              ${(overflow ? p.concepts.slice(0, limit) : p.concepts).map((c) => `
                <a class="cc" href="${url('/wiki/concepts/' + c.slug + '/')}">${escapeHtml(c.display_name)}</a>
              `).join('')}
              ${overflow ? `<span class="cc cc-overflow">+${p.concepts.length - limit} 个</span>` : ''}
            </div>
          </details>
        `;
      })() : ''}

      <details class="detail-section">
        <summary>摘要</summary>
        ${p.evidence
          ? `<p class="detail-abstract">${escapeHtml(p.evidence)}</p>`
          : '<p class="empty muted">这篇还没有摘要。</p>'}
      </details>

      <details class="detail-section">
        <summary>我的笔记</summary>
        <p class="empty muted">
          笔记存在浏览器 localStorage,SSR 无法读取。<br />
          <a href="${url('/papers/' + p.id + '/#paper-notes-section')}">→ 去论文页底部写笔记 / 读笔记</a>
        </p>
      </details>

      <details class="detail-section">
        <summary>元信息</summary>
        <dl class="detail-meta-table">
          ${p.arxivId ? `<dt>arXiv</dt><dd class="mono">${escapeHtml(p.arxivId)}</dd>` : ''}
          ${p.date ? `<dt>发布日期</dt><dd class="mono">${escapeHtml(p.date)}</dd>` : ''}
          ${p.pdf ? `<dt>PDF</dt><dd><a href="${escapeHtml(p.pdf)}" target="_blank" rel="noopener" class="mono">${escapeHtml(p.pdf)}</a></dd>` : ''}
          ${typeof p.score === 'number' ? `<dt>相关度</dt><dd class="mono">${p.score.toFixed(3)}</dd>` : ''}
        </dl>
      </details>
    </div>
  `;
}

// ----------------------------------------------------------------
// type 段控件(全部 / 公共 / 个人)—— 用于 /libraries/ 页
// ----------------------------------------------------------------

function setupTypeFilter(): void {
  const root = document.querySelector<HTMLElement>('[data-type-filter]');
  if (!root) return;
  const segs = root.querySelectorAll<HTMLElement>('.lib-segment');
  const targetSel = root.dataset.typeFilterTarget || '[data-type-filter-target]';
  const target = document.querySelector<HTMLElement>(targetSel);
  if (!target) return;

  segs.forEach((seg) => {
    seg.addEventListener('click', () => {
      segs.forEach((s) => s.classList.remove('active'));
      seg.classList.add('active');
      const v = seg.dataset.typeValue || 'all';
      target.querySelectorAll<HTMLElement>('[data-lib-type]').forEach((el) => {
        const t = el.dataset.libType || 'public';
        const show = v === 'all' || (v === 'public' ? t === 'public' : t === 'personal');
        el.style.display = show ? '' : 'none';
      });
      // 更新计数
      const counter = target.querySelector<HTMLElement>('[data-type-filter-count]');
      if (counter) {
        const total = target.querySelectorAll<HTMLElement>('[data-lib-type]').length;
        const visible = target.querySelectorAll<HTMLElement>('[data-lib-type]:not([style*="display: none"])').length;
        counter.textContent = v === 'all' ? '' : `${visible} / ${total}`;
      }
    });
  });
}

// ----------------------------------------------------------------
// bootstrap
// ----------------------------------------------------------------

function bootstrap(): void {
  setupUserLibrariesSection();
  setupNewLibraryModal();
  setupAddToLibraryButtons();
  renderUserLibraryDetail();
  setupTypeFilter();

  // 编辑 modal 保存后刷新详情(沿用 dpr:user-libraries-change 已经会刷新卡片,
  // 但 detail 视图是 SSR-空壳 + 客户端挂载,需要在 save 后主动重渲)
  document.addEventListener('dpr:user-library-edit', () => {
    renderUserLibraryDetail();
  });
}

if (typeof window !== 'undefined') {
  // 首次加载 + Astro 切页都跑
  document.addEventListener('astro:page-load', bootstrap);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}

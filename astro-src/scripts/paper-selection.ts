// 多选论文 → 送去主题探索(/topic/?from=selection)的客户端脚本。
//
// 两种模式共用一个文件:
//   A) 多卡片模式 — 首页 / tag 列表。遍历 [data-selectable-paper] 元素,
//      在每张卡片左上角注入复选框 badge;勾选 → 写 localStorage → 更新 action bar。
//   B) 详情页模式 — /papers/{arxiv}/。载体 #paper-select 把元数据写到 data-*,
//      脚本把 #paper-select-btn hydrate 成"📌 选入探索 / ✓ 已选入"。
//
// 数据流:
//   loadSelection() ← settings.ts (Set+order-preserving dedup)
//   每次 add/remove → saveSelectionRaw() → repaintActionBar() + dispatch
//   'paper-selection-change' 自定义事件,topic 页可以监听它做实时刷新。
//
// 跨 tab 同步:window 'storage' 事件触发时重读 localStorage 并 repaint(防止
// A tab 选完跳到 B tab,bar 状态不同步)。
//
// 沿用 paper-hide.ts 容错约定:
//   - DOM 不存在 → return 不抛错
//   - 顶层 try/catch 包住 initSelection(),避免一处错误拖死整个 ESM bundle

import {
  loadSelection,
  addToSelection,
  removeFromSelection,
  clearSelection,
  isInSelection,
  SELECTION_SOFT_CAP,
  type SelectionItem,
} from './settings';
import { emitPaperSelectionChange } from '../lib/events';

const SOFT_CAP = SELECTION_SOFT_CAP;

// ----------------------------------------------------------------------------
// 工具:从元素 dataset 读 SelectionItem;字段为空时跳过(undefined)
// ----------------------------------------------------------------------------
function readItemFromDataset(el: HTMLElement): SelectionItem | null {
  const arxivId = (el.dataset.selectablePaper || '').trim();
  const title = (el.dataset.selectableTitle || '').trim();
  if (!arxivId || !title) return null;
  return {
    arxivId,
    title,
    title_zh: (el.dataset.selectableTitleZh || '').trim() || undefined,
    tldr: (el.dataset.selectableTldr || '').trim(),
    motivation: (el.dataset.selectableMotivation || '').trim() || undefined,
    method: (el.dataset.selectableMethod || '').trim(),
    result: (el.dataset.selectableResult || '').trim(),
    conclusion: (el.dataset.selectableConclusion || '').trim() || undefined,
    tags: (el.dataset.selectableTags || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    addedAt: Date.now(),
  };
}

// ----------------------------------------------------------------------------
// 工具:dispatch 自定义事件,让 topic 页等其它脚本能监听
// ----------------------------------------------------------------------------
function emitChange(): void {
  emitPaperSelectionChange();
}

// ----------------------------------------------------------------------------
// Action bar — 浮动在底部的"已选 N 篇 / 送去主题探索 / 清空"
// ----------------------------------------------------------------------------
let bar: HTMLDivElement | null = null;
let barCountEl: HTMLSpanElement | null = null;
let barGoBtn: HTMLButtonElement | null = null;
let barClearBtn: HTMLButtonElement | null = null;

function ensureBar(): HTMLDivElement | null {
  if (bar) return bar;
  // 页面显式声明 no-selection-bar (如 /topic/ 自己处理) → 不挂 bar
  if (document.body?.dataset.noSelectionBar !== undefined) return null;

  bar = document.createElement('div');
  bar.id = 'paper-selection-bar';
  bar.className = 'paper-selection-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '已选论文操作栏');
  bar.innerHTML = `
    <div class="paper-selection-bar-inner">
      <span class="paper-selection-count" aria-live="polite">已选 <strong>0</strong> 篇</span>
      <button type="button" class="paper-selection-go" data-act="go">🚀 送去主题探索</button>
      <button type="button" class="paper-selection-clear" data-act="clear">清空选择</button>
    </div>
  `;
  document.body.appendChild(bar);
  barCountEl = bar.querySelector<HTMLSpanElement>('.paper-selection-count');
  barGoBtn = bar.querySelector<HTMLButtonElement>('[data-act="go"]');
  barClearBtn = bar.querySelector<HTMLButtonElement>('[data-act="clear"]');

  barGoBtn?.addEventListener('click', () => {
    const items = loadSelection();
    if (items.length === 0) return;
    // 选好之后直接跳 topic;topic 页 init 时通过 loadSelection() 读种子
    // 拼 context,不需要在 URL 上带 (selection 可能 8 篇,URL 太长)。
    const base = (import.meta.env?.BASE_URL || '/').replace(/\/+$/, '');
    window.location.href = `${base}/topic/?from=selection`;
  });

  barClearBtn?.addEventListener('click', () => {
    const items = loadSelection();
    if (items.length === 0) return;
    if (items.length >= 3 && !window.confirm(`确定清空已选的 ${items.length} 篇论文?`)) return;
    clearSelection();
    repaintAll();
  });

  return bar;
}

function repaintActionBar(): void {
  if (!ensureBar() || !barCountEl) return;
  const items = loadSelection();
  const n = items.length;
  bar!.hidden = n === 0;
  const overCap = n > SOFT_CAP;
  barCountEl.innerHTML = overCap
    ? `已选 <strong>${n}</strong> 篇 <span class="paper-selection-warn" title="软上限 ${SOFT_CAP} 篇,仍可发送但建议精简">⚠️</span>`
    : `已选 <strong>${n}</strong> 篇`;
  barCountEl.classList.toggle('paper-selection-count--over', overCap);
}

// ----------------------------------------------------------------------------
// 复选框 badge — 注入 [data-selectable-paper] 元素左上角
// ----------------------------------------------------------------------------
const BADGE_CLASS = 'paper-select-badge';

function buildBadge(checked: boolean): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = BADGE_CLASS;
  label.setAttribute('aria-label', '选中这篇论文');
  // label 包裹 input,点 label 任意位置都触发 input,不需要精准点 input
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = `${BADGE_CLASS}-input`;
  input.checked = checked;
  // tab 顺序与卡片正文链接错开,避免重复 tab 停留
  input.tabIndex = 0;
  const icon = document.createElement('span');
  icon.className = `${BADGE_CLASS}-icon`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✓';
  label.appendChild(input);
  label.appendChild(icon);

  // 关键:阻止 label/input 的 click 冒泡触发外层 <a> 跳转
  // (paper-card-link 是 <a> 包整张卡片,点空白处也会跳转)
  const swallow = (e: Event): void => {
    e.stopPropagation();
    if (e.type === 'click') e.preventDefault();
  };
  label.addEventListener('click', swallow);
  input.addEventListener('click', swallow);
  return label;
}

function paintCardSelection(el: HTMLElement, selected: boolean): void {
  el.dataset.selected = selected ? 'true' : 'false';
}

function attachCard(card: HTMLElement): void {
  // 白名单:仅当卡片显式声明 data-paper-card-selectable 才挂复选框。
  // 早期版本对所有 [data-selectable-paper] 元素都挂,会让首页 Top 6 卡片
  // 顶部也出现复选框,视觉噪音;现在只有「论文库」/「主题分类」等
  // 真正用来"凑种子"的列表才显式开 opt-in。
  if (card.dataset.paperCardSelectable === undefined) return;
  const arxivId = (card.dataset.selectablePaper || '').trim();
  if (!arxivId) return;
  // 同一张卡可能被多次扫描(动态注入 / SSR 重渲染),只挂一次
  if (card.querySelector(`.${BADGE_CLASS}`)) return;

  const initialSelected = isInSelection(arxivId);
  const badge = buildBadge(initialSelected);
  // top-left,绝对定位;不抢卡片内文点击区域
  card.appendChild(badge);
  paintCardSelection(card, initialSelected);

  const input = badge.querySelector<HTMLInputElement>(`input.${BADGE_CLASS}-input`);
  if (!input) return;

  const onChange = (): void => {
    const item = readItemFromDataset(card);
    if (!item) return;
    if (input.checked) {
      addToSelection(item);
    } else {
      removeFromSelection(item.arxivId);
    }
    paintCardSelection(card, input.checked);
    repaintActionBar();
    emitChange();
  };
  input.addEventListener('change', onChange);
}

// 详情页 select 按钮 (在 paper-header-row 右侧,跟 hide 按钮并列)
function attachDetailButton(): void {
  const carrier = document.getElementById('paper-select');
  const btn = document.getElementById('paper-select-btn') as HTMLButtonElement | null;
  if (!carrier || !btn) return;
  const arxivId = (carrier.dataset.arxivId || '').trim();
  if (!arxivId) return;

  const render = (): void => {
    const inSel = isInSelection(arxivId);
    btn!.hidden = false;
    btn!.textContent = inSel ? '✓ 已选入' : '📌 选入探索';
    btn!.classList.toggle('paper-select-btn--selected', inSel);
    btn!.title = inSel
      ? '当前已选入主题探索。再次点击移除。'
      : '把这篇论文加入主题探索的种子上下文(可在首页 / 论文列表多选凑齐再发送)';
  };
  render();

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInSelection(arxivId)) {
      removeFromSelection(arxivId);
    } else {
      const item: SelectionItem = {
        arxivId,
        title: (carrier.dataset.title || '').trim(),
        title_zh: (carrier.dataset.titleZh || '').trim() || undefined,
        tldr: (carrier.dataset.tldr || '').trim(),
        motivation: (carrier.dataset.motivation || '').trim() || undefined,
        method: (carrier.dataset.method || '').trim(),
        result: (carrier.dataset.result || '').trim(),
        conclusion: (carrier.dataset.conclusion || '').trim() || undefined,
        tags: (carrier.dataset.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
        addedAt: Date.now(),
      };
      if (!addToSelection(item)) return;
    }
    render();
    repaintActionBar();
    emitChange();
  });
}

// ----------------------------------------------------------------------------
// 入口
// ----------------------------------------------------------------------------
function initSelection(): void {
  attachDetailButton();
  // 多卡片模式:遍历 [data-selectable-paper]
  const cards = document.querySelectorAll<HTMLElement>('[data-selectable-paper]');
  cards.forEach(attachCard);
  // 进入页面时同步一次 bar
  repaintActionBar();
}

function repaintAll(): void {
  // 重新读 localStorage,然后让所有已经挂好的卡片/按钮反映最新状态
  const items = loadSelection();
  const set = new Set(items.map((x) => x.arxivId));
  for (const card of document.querySelectorAll<HTMLElement>('[data-selectable-paper]')) {
    const id = (card.dataset.selectablePaper || '').trim();
    if (!id) continue;
    const inSel = set.has(id);
    const input = card.querySelector<HTMLInputElement>(`input.${BADGE_CLASS}-input`);
    if (input && input.checked !== inSel) input.checked = inSel;
    paintCardSelection(card, inSel);
  }
  attachDetailButton(); // detail 按钮状态同步
  repaintActionBar();
  emitChange();
}

// 跨 tab 同步:另一个 tab 改了 localStorage,本 tab 跟着 repaint
window.addEventListener('storage', (e) => {
  if (e.key && e.key !== 'dpr_paper_selection_v1') return;
  repaintAll();
});

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSelection, { once: true });
  } else {
    initSelection();
  }
} catch (e) {
  console.error('[paper-selection] init failed:', e);
}

// 暴露给其它脚本 / topic 页用
export { PAPER_SELECTION_CHANGE } from '../lib/events';
export function getSelectionSnapshot() {
  return loadSelection();
}

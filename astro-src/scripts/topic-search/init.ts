// topic-search 入口层 —— 从 topic-search.ts 抽出（模块化重构 step 13）。
//
// 5 阶段按钮 / 表单 / 弹层的 DOM 事件绑定，调用 actions / seeds-modal 完成业务逻辑。
// 只在 DOMContentLoaded 触发一次 init()。

import { loadSettings } from '../settings';
import { $, escapeHtml } from '../../lib/dom-utils';
import { onPaperSelectionChange } from '../../lib/events';
import { setStatus, clearStatus, renderBanner } from './status';
import { renderAll } from './render';
import {
  ensureSession,
  setCurrent,
  doDecompose,
  doSearch,
  doSummarize,
  doVerifyHit,
  filterCandidatesByLLM,
  startNewSession,
  persistSession,
} from './actions';
import {
  openAddSeedsModal,
  closeAddSeedsModal,
  renderAddSeedsModalList,
  updateSeedsCounter,
  submitAddSeedsUrl,
  setupAddSeedsSearch,
  renderSeedsPill,
  modalOpen,
  hideSeedsPill,
} from './seeds-modal';
import {
  copyAllAsMarkdown,
  copyReportAsMarkdown,
  downloadReportAsMarkdown,
} from './report-markdown';
import { loadSelection, clearSelection, addToSelection, removeFromSelection } from '../settings';
import { addFacet } from './render';
import { uid } from './concurrency';
import { S } from './state';

export function init(): void {
  document.body.dataset.noSelectionBar = '';

  const cfg = loadSettings();
  if (!cfg.apiKey) {
    renderBanner('⚠️ 你还没填 LLM API Key,先去 <a href="/settings/">设置</a> 页面填一下。');
  }

  ensureSession();
  setCurrent(S.getSession());
  renderAll();

  // 监听 textarea 输入 → 拆解按钮 enable
  $<HTMLTextAreaElement>('topic-input').addEventListener('input', (e) => {
    const v = (e.target as HTMLTextAreaElement).value.trim();
    ($<HTMLButtonElement>('decompose-btn')).disabled = !v;
    const session = S.getSession();
    if (session) {
      session.topic = (e.target as HTMLTextAreaElement).value;
      persistSession(session);
    }
  });

  // 主按钮
  $<HTMLButtonElement>('decompose-btn').addEventListener('click', doDecompose);
  $<HTMLButtonElement>('search-btn').addEventListener('click', doSearch);
  $<HTMLButtonElement>('summarize-btn').addEventListener('click', () => doSummarize());
  $<HTMLButtonElement>('summarize-top-btn')?.addEventListener('click', () => doSummarize(20));
  $<HTMLButtonElement>('summarize-all-btn')?.addEventListener('click', () => doSummarize());
  $<HTMLButtonElement>('filter-cand-btn').addEventListener('click', () => filterCandidatesByLLM(30));
  $<HTMLButtonElement>('subq-add-btn').addEventListener('click', () => {
    const session = S.getSession();
    if (!session) return;
    session.subqs.push({
      id: uid('q'),
      label: '新子方向',
      query: '',
      reason: '',
      selected: true,
    });
    setCurrent(session);
    renderAll();
    persistSession(session);
  });
  document.getElementById('facet-add-btn')?.addEventListener('click', () => addFacet());

  // 顶栏
  $<HTMLButtonElement>('new-session-btn').addEventListener('click', startNewSession);
  $<HTMLButtonElement>('copy-all-btn').addEventListener('click', copyAllAsMarkdown);

  // 阶段 1:📚 添加参考论文弹层
  $<HTMLButtonElement>('add-seeds-btn').addEventListener('click', openAddSeedsModal);
  document.getElementById('stage-input-seeds-edit')?.addEventListener('click', openAddSeedsModal);
  document.getElementById('add-seeds-modal')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.act === 'close-mask' || target.dataset.act === 'close-modal') {
      closeAddSeedsModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) closeAddSeedsModal();
  });
  document.getElementById('add-seeds-clear-all')?.addEventListener('click', () => {
    const items = loadSelection();
    if (items.length === 0) return;
    if (items.length >= 3 && !confirm(`确定清空已选 ${items.length} 篇参考论文?`)) return;
    clearSelection();
  });
  document.getElementById('add-seeds-url-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitAddSeedsUrl(e.currentTarget as HTMLFormElement);
  });
  setupAddSeedsSearch();
  // 监听 paper-selection-change — 走 lib/events/ 强类型总线
  onPaperSelectionChange(document, () => {
    updateSeedsCounter();
    if (modalOpen) renderAddSeedsModalList();
  });

  // 阶段 5:报告按钮 + 增量开关
  $<HTMLButtonElement>('report-gen-btn').addEventListener('click', () => {
    void import('./actions').then((m) => m.doGenerateReport());
  });
  $<HTMLButtonElement>('report-copy-btn').addEventListener('click', copyReportAsMarkdown);
  $<HTMLButtonElement>('report-download-btn').addEventListener('click', downloadReportAsMarkdown);
  $<HTMLInputElement>('report-incremental-toggle').addEventListener('change', (e) => {
    setStatus(
      (e.target as HTMLInputElement).checked
        ? '✓ 已开启增量更新 — 后续每篇速览完成会自动刷新报告'
        : '已关闭增量更新',
      '',
    );
    setTimeout(clearStatus, 1800);
  });

  // 阶段 2 子方向面板的 🔬 实测命中按钮 — 用事件委托避免每次重绘重新绑定
  document.getElementById('subq-list')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.act === 'verify-hit') {
      const sid = target.dataset.sid;
      if (sid) void doVerifyHit(sid);
    }
  });

  // ?from=selection 入口
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('from') === 'selection') {
      try {
        const url = new URL(location.href);
        url.searchParams.delete('from');
        history.replaceState(null, '', url.toString());
      } catch { /* ignore */ }
      const seeds = loadSelection();
      if (seeds.length > 0) {
        renderSeedsPill(seeds);
      }
    }
  } catch (e) {
    console.warn('[topic] 注入已选论文入口失败:', (e as Error).message);
  }
}
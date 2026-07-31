// /scripts/paper-library-detail.ts
//
// 论文详情页右上角的"星标" + "阅读状态"按钮。
// 复用 paper-hide.ts 的 section-as-data-carrier 模式:
//   - 按钮在 .paper-header-actions 里(SSR 渲染,hidden,客户端按需显示)
//   - canonicalArxivId 从按钮自身 data-arxiv-id 读出
//
// 写入走 lib/user-library 的唯一漏斗(toggleStar / setReadingStatus),
// 状态从 store 读,事件订阅 DPR_USER_LIBRARY_CHANGE 自动跨 tab 同步。
//
// 沿用 paper-hide 的容错约定:
//   - DOM / canonicalArxivId 缺失 → 直接 return,不抛错
//   - 顶层 try/catch 包 init(),避免一处错误拖死 ES module bundle

import {
  getUserPaperState,
  isStarred,
  toggleStar,
  setReadingStatus,
} from '../lib/user-library';
import { showToast } from './toast';

function applyStar(btn: HTMLButtonElement, canonicalId: string): void {
  const on = isStarred(canonicalId);
  btn.textContent = on ? '⭐' : '☆';
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? '已星标。点击取消星标' : '星标这篇论文';
}

function applyStatus(btn: HTMLButtonElement, canonicalId: string): void {
  const s = getUserPaperState(canonicalId)?.readingStatus ?? 'unread';
  const label = s === 'read' ? '● 已读' : s === 'reading' ? '◐ 在读' : '○ 未读';
  btn.textContent = label;
  btn.classList.remove('is-unread', 'is-reading', 'is-read');
  btn.classList.add(`is-${s}`);
  btn.title = '点击切换:未读 → 在读 → 已读';
}

function init(): void {
  const starBtn = document.getElementById('paper-star-btn') as HTMLButtonElement | null;
  const statusBtn = document.getElementById('paper-status-btn') as HTMLButtonElement | null;
  if (!starBtn || !statusBtn) return;

  const canonicalId = (starBtn.dataset.arxivId || '').trim();
  if (!canonicalId || canonicalId === ' ') return;

  starBtn.hidden = false;
  statusBtn.hidden = false;
  applyStar(starBtn, canonicalId);
  applyStatus(statusBtn, canonicalId);

  starBtn.addEventListener('click', () => {
    const res = toggleStar(canonicalId);
    if (!res.ok) {
      showToast(
        res.reason === 'quota' ? '本地存储已满,星标失败' : '星标失败',
        'error',
      );
    }
  });

  statusBtn.addEventListener('click', () => {
    const cur = getUserPaperState(canonicalId)?.readingStatus ?? 'unread';
    const next = cur === 'unread' ? 'reading' : cur === 'reading' ? 'read' : 'unread';
    const res = setReadingStatus(canonicalId, next);
    if (!res.ok) {
      showToast(
        res.reason === 'quota' ? '本地存储已满,状态保存失败' : '状态保存失败',
        'error',
      );
    }
  });

  // 跨 tab / Gist pull 同步后刷新按钮状态 —— 通过 StorageEvent 兜底,
  // 主路径由 store.ts 里的 DPR_USER_LIBRARY_CHANGE 事件承担。bus.ts 已经双发 legacy alias,
  // 这里只 listen legacy 名就够(避免重复订阅)。
  window.addEventListener('storage', (ev) => {
    if (!ev.key || ev.key === 'dpr_user_library_v1') {
      applyStar(starBtn, canonicalId);
      applyStatus(statusBtn, canonicalId);
    }
  });
}

try {
  init();
} catch (e) {
  console.error('[paper-library-detail] init failed:', e);
}
// topic-search 状态条/横幅层 —— 从 topic-search.ts 抽出（模块化重构 step 8）。
//
// 负责 /topic 页面状态条 (status-bar) 的读写、⏹ 停止按钮、全局红色横幅 (banner-slot)。
// 5 阶段共用。inFlight 通过 S.getInFlight() 取，不再读模块级 let。

import { S } from './state';
import { $, escapeHtml } from '../../lib/dom-utils';

// status-bar 写入 — msg + kind（'' / 'error' / 'success'）。
// spinner + ⏹ 停止按钮只在「确实有任务在飞」且非完成态时出现；之前无条件渲染
// spinner，导致每条 ✓ 完成/已复制/已下载 消息都一直转圈，误导用户以为还在忙。
export function setStatus(msg: string, kind: '' | 'error' | 'success' = ''): void {
  const el = $('status-bar');
  el.classList.remove('topic-hidden');
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('success', kind === 'success');
  const busy = kind === '' && S.getInFlight() !== null;
  const stopBtn = busy
    ? `<button type="button" class="topic-btn ghost" id="status-stop-btn" style="margin-left:auto">⏹ 停止</button>`
    : '';
  const icon = kind === 'error'
    ? '<span>⚠️</span>'
    : kind === 'success'
      ? '<span>✅</span>'
      : busy
        ? '<span class="topic-status-spinner"></span>'
        : '<span>ℹ️</span>';
  el.innerHTML = `${icon}<span>${escapeHtml(msg)}</span>${stopBtn}`;
  if (busy) {
    document.getElementById('status-stop-btn')?.addEventListener('click', stopInFlight);
  }
}

// 失败时挂一个按钮(label + onClick)，方便用户一键重试
export function setStatusErrorWithAction(msg: string, actionLabel: string, action: () => void): void {
  const el = $('status-bar');
  el.classList.remove('topic-hidden');
  el.classList.add('error');
  el.innerHTML = `<span>⚠️</span><span>${escapeHtml(msg)}</span><button type="button" class="topic-btn ghost" id="status-action-btn" style="margin-left:auto">${escapeHtml(actionLabel)}</button>`;
  document.getElementById('status-action-btn')?.addEventListener('click', () => {
    clearStatus();
    action();
  });
}

export function clearStatus(): void {
  const el = $('status-bar');
  el.classList.add('topic-hidden');
  el.innerHTML = '';
}

// 全局「⏹ 停止」按钮触发。AbortController 中断正在跑的 LLM fetch / PDF 下载;
// runConcurrent 的 in-flight Promise 会被 reject，然后 doSearch / doSummarize
// 的 finally 把 inFlightController 置 null，UI 状态条变 error。
export function stopInFlight(): void {
  const ctrl = S.getInFlight();
  if (ctrl) {
    ctrl.abort();
    setStatus('⏹ 已停止当前任务', 'error');
  }
}

// banner-slot 渲染（红色提示横幅 / 信息 banner）
export function renderBanner(msg: string, info = false): void {
  const slot = $('banner-slot');
  slot.classList.remove('topic-hidden');
  slot.classList.toggle('info', info);
  slot.innerHTML = msg;
}

export function clearBanner(): void {
  const slot = $('banner-slot');
  slot.classList.add('topic-hidden');
  slot.innerHTML = '';
}
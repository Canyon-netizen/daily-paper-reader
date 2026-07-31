// /scripts/paper-notes-editor.ts
//
// 论文详情页底部的"我的笔记"区:
//   - textarea 失焦防抖保存到 lib/user-library(setUserNote)
//   - 切换预览 / 编辑模式;预览走 renderMarkdownBody 复用 server 渲染链路
//   - 配额失败时弹 toast(Stage 1 决定的 WriteResult 必须显式处理)
//
// 数据载体:#paper-notes-section 在 [arxiv].astro 渲染;canonical arxivId 由
// 按钮 #paper-star-btn / #paper-status-btn 的 data-arxiv-id 读出。
//
// 沿用 paper-chat / paper-hide 的容错约定:
//   - DOM / canonicalArxivId 缺失 → 直接 return,不抛错
//   - 顶层 try/catch 包 init(),避免一处错误拖死 ES module bundle

import { debounce } from '../lib/dom-utils';
import { renderMarkdownBody } from '../lib/markdown';
import {
  getUserNote,
  setUserNote,
} from '../lib/user-library';
import { onDprUserLibraryChange } from '../lib/events';
import { showToast } from './toast';

function init(): void {
  const section = document.getElementById('paper-notes-section');
  const textarea = document.getElementById('paper-notes-textarea') as HTMLTextAreaElement | null;
  const preview = document.getElementById('paper-notes-preview');
  const toggle = document.getElementById('paper-notes-toggle') as HTMLButtonElement | null;
  const saved = document.getElementById('paper-notes-saved');
  if (!section || !textarea || !preview || !toggle) return;

  // 取 canonicalArxivId —— 优先级:笔记按钮上的 data-arxiv-id > #paper-library-state 段
  let canonicalId =
    (document.getElementById('paper-star-btn')?.dataset.arxivId || '').trim() ||
    (document.getElementById('paper-library-state')?.dataset.canonicalArxivId || '').trim();
  if (!canonicalId || canonicalId === ' ') return;

  // 初始内容:从 user-library 读;空 = placeholder
  textarea.value = getUserNote(canonicalId);

  // 防抖保存:停顿 1000ms 后写;失焦立即写一次
  const debouncedSave = debounce((text: string) => {
    const res = setUserNote(canonicalId, text);
    if (!res.ok) {
      const msg =
        res.reason === 'quota'
          ? '笔记保存失败:本地存储已满。考虑清理或关闭一些其它标签页。'
          : '笔记保存失败:本地存储不可用';
      showToast(msg, 'error');
      return;
    }
    if (res.changed) flashSaved();
  }, 1000);

  textarea.addEventListener('input', () => {
    debouncedSave(textarea.value);
  });
  textarea.addEventListener('blur', () => {
    // 失焦强制立即写,不等防抖尾巴
    const res = setUserNote(canonicalId, textarea.value);
    if (!res.ok) {
      const msg =
        res.reason === 'quota'
          ? '笔记保存失败:本地存储已满'
          : '笔记保存失败:本地存储不可用';
      showToast(msg, 'error');
      return;
    }
    if (res.changed) flashSaved();
  });

  // 预览 / 编辑切换
  toggle.addEventListener('click', () => {
    const showingPreview = !preview!.hidden;
    if (showingPreview) {
      // → 切回编辑
      preview!.hidden = true;
      textarea!.hidden = false;
      toggle.classList.remove('is-preview');
      toggle.textContent = '👁 预览';
      textarea!.focus();
    } else {
      // → 切预览,渲染 markdown
      const html = renderMarkdownBody(textarea!.value || '*(暂无笔记)*');
      preview!.innerHTML = html;
      preview!.hidden = false;
      textarea!.hidden = true;
      toggle.classList.add('is-preview');
      toggle.textContent = '✏ 编辑';
    }
  });

  function flashSaved(): void {
    if (!saved) return;
    saved.hidden = false;
    window.setTimeout(() => {
      saved.hidden = true;
    }, 1500);
  }

  // 跨 tab / Gist pull 同步后刷新 textarea。如果当前正在编辑,不要打断用户;
  // 为了简单,只在 textarea 没聚焦时同步值。
  const off = onDprUserLibraryChange(window, (detail) => {
    if (!detail.ids.includes(canonicalId)) return;
    if (document.activeElement === textarea) return;
    const cur = getUserNote(canonicalId);
    if (textarea.value !== cur) textarea.value = cur;
  });
  // 不主动 off —— 页面卸载时 GC 回收。
  void off;
}

try {
  init();
} catch (e) {
  console.error('[paper-notes-editor] init failed:', e);
}
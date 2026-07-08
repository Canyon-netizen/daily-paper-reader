// /papers/{arxiv}/ 详情页右上角"隐藏"按钮。
//
// 数据载体 #paper-hide(SSR 时 Astro 在 main 末尾追加一个 hidden section,
// 把 arxivId 写到 data-arxiv-id);按钮 #paper-hide-btn 在 .paper-header-row
// 右上角渲染。两者一一对应,broken 论文 / 404 时都不挂载,所以可以 null-safe 退出。
//
// 软删除语义:把 arxivId 加进 localStorage `dpr_hidden_papers_v1`。
// Gist 跨设备同步走 pushHiddenPapersToGist()(GET→merge→PATCH,只动
// hiddenPapers 字段,不动 settings / analyzer 的其他字段);首次加载时
// 调 pullHiddenPapersFromGist() 把远端合并到本地。
//
// 详情页本身仍可访问,想恢复时再来这里点一次即可(或在 /settings/ 面板里)。
//
// 沿用 paper-chat.ts 容错约定:
// - DOM 不存在或 arxivId 为空 → 直接 return,不抛错
// - 顶层 try/catch 包住 initHide(),避免一处错误拖死整个 ES module bundle

import {
  isPaperHidden,
  addHiddenPaper,
  removeHiddenPaper,
  getGistToken,
  getGistId,
  pullHiddenPapersFromGist,
  pushHiddenPapersToGist,
} from './settings';
import { showHiddenToast } from './hidden-toast';

function initHide(): void {
  const container = document.getElementById('paper-hide');
  const btn = document.getElementById('paper-hide-btn') as HTMLButtonElement | null;
  if (!container || !btn) return;

  const arxivId = (container.dataset.arxivId || '').trim();
  if (!arxivId) return;

  function render(): void {
    const hidden = isPaperHidden(arxivId);
    btn!.hidden = false;
    btn!.textContent = hidden ? '↩ 取消隐藏' : '🗑 隐藏';
    btn!.classList.toggle('paper-hide-btn--hidden', hidden);
    btn!.title = hidden
      ? '当前已隐藏。点击从你的隐藏列表移除。'
      : '从你的浏览器隐藏这篇论文(可在 /settings/ 已隐藏论文面板恢复)';
  }

  render();

  // Gist 拉取 — 若 token + gistId 配齐,把远端 hiddenPapers 合并到本地
  // 再 render() 一次,确保初始按钮文案反映合并后的状态(而不是只反映空 localStorage)。
  // 失败静默:无 token / 网络错误 → 本地状态不变。
  if (getGistToken() && getGistId()) {
    pullHiddenPapersFromGist()
      .then((r) => {
        if (r.ok && r.merged && r.merged.length > 0) {
          render();
        }
      })
      .catch((e) => console.warn('[paper-hide] Gist pull failed:', e));
  }

  btn.addEventListener('click', () => {
    const wasHidden = isPaperHidden(arxivId);
    if (wasHidden) {
      removeHiddenPaper(arxivId);
      render();
      // 取消隐藏时也 push Gist(若配了),保持远端同步
      if (getGistToken() && getGistId()) {
        pushHiddenPapersToGist().catch((e) =>
          console.warn('[paper-hide] Gist push failed:', e),
        );
      }
      return;
    }
    addHiddenPaper(arxivId);
    render();
    // 弹 toast(30s 可撤销),撤销回调里移除 arxivId + 重新 render + 推 Gist。
    showHiddenToast(arxivId, () => {
      removeHiddenPaper(arxivId);
      render();
      if (getGistToken() && getGistId()) {
        pushHiddenPapersToGist().catch((e) =>
          console.warn('[paper-hide] Gist push failed:', e),
        );
      }
    });
    // 立即推 Gist(若配了);失败不影响本地状态。
    if (getGistToken() && getGistId()) {
      pushHiddenPapersToGist().catch((e) =>
        console.warn('[paper-hide] Gist push failed:', e),
      );
    }
  });
}

try {
  initHide();
} catch (e) {
  console.error('[paper-hide] init failed:', e);
}

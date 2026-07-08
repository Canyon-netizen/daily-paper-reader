// /papers/{arxiv}/ 详情页右上角"隐藏"按钮。
//
// 数据载体 #paper-hide(SSR 时 Astro 在 main 末尾追加一个 hidden section,
// 把 arxivId 写到 data-arxiv-id);按钮 #paper-hide-btn 在 .paper-header-row
// 右上角渲染。两者一一对应,broken 论文 / 404 时都不挂载,所以可以 null-safe 退出。
//
// 软删除语义:把 arxivId 加进 localStorage `dpr_hidden_papers_v1`,
// 不写 Gist(避免污染 CI $GITHUB_ENV,见 settings.ts 注释)。详情页本身仍可访问,
// 想恢复时再来这里点一次即可。
//
// 沿用 paper-chat.ts 容错约定:
// - DOM 不存在或 arxivId 为空 → 直接 return,不抛错
// - 顶层 try/catch 包住 initHide(),避免一处错误拖死整个 ES module bundle
//   (上次 paper-chat 的 escapeHtml 未定义就把 paper-figures 拖死过)。

import { isPaperHidden, addHiddenPaper, removeHiddenPaper } from './settings';

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
      : '从你的浏览器隐藏这篇论文(可在 localStorage 清除)';
  }

  render();

  btn.addEventListener('click', () => {
    const wasHidden = isPaperHidden(arxivId);
    if (wasHidden) {
      removeHiddenPaper(arxivId);
    } else {
      addHiddenPaper(arxivId);
    }
    render();
  });
}

try {
  initHide();
} catch (e) {
  console.error('[paper-hide] init failed:', e);
}

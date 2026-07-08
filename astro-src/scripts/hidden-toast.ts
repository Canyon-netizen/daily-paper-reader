// /papers/{arxiv}/ 详情页底部"已隐藏"撤销 toast。
//
// 论文页点隐藏按钮后调用 showHiddenToast(arxivId, onUndo)。
// 30 秒倒计时,期间点"撤销"会回调 onUndo 让 paper-hide.ts 取消隐藏;
// 到点后按钮 disabled、变"已过期",5 秒后 toast 淡出。
//
// 复用 settings.css 里 .settings-saved-hint 的 fixed + opacity 风格,
// 但放在底部居中,避开 paper-chat FAB(右下角)+ paper-hide-btn(右上)。
// 单一 toast:新 toast 覆盖旧 toast,不堆叠。

interface ToastRefs {
  root: HTMLDivElement;
  icon: HTMLSpanElement;
  text: HTMLSpanElement;
  undoBtn: HTMLButtonElement;
}

let active: {
  refs: ToastRefs;
  timer: ReturnType<typeof setInterval> | null;
  expireTimer: ReturnType<typeof setTimeout> | null;
  fadeTimer: ReturnType<typeof setTimeout> | null;
} | null = null;

function ensureDom(): ToastRefs | null {
  let root = document.getElementById('hidden-toast') as HTMLDivElement | null;
  if (root) {
    return {
      root,
      icon: root.querySelector<HTMLSpanElement>('.hidden-toast-icon')!,
      text: root.querySelector<HTMLSpanElement>('.hidden-toast-text')!,
      undoBtn: root.querySelector<HTMLButtonElement>('.hidden-toast-undo')!,
    };
  }
  root = document.createElement('div');
  root.id = 'hidden-toast';
  root.className = 'hidden-toast';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <span class="hidden-toast-icon">🗑</span>
    <span class="hidden-toast-text">已隐藏 <strong class="hidden-toast-id"></strong></span>
    <button type="button" class="hidden-toast-undo">撤销 (30s)</button>
  `;
  document.body.appendChild(root);
  return {
    root,
    icon: root.querySelector<HTMLSpanElement>('.hidden-toast-icon')!,
    text: root.querySelector<HTMLSpanElement>('.hidden-toast-text')!,
    undoBtn: root.querySelector<HTMLButtonElement>('.hidden-toast-undo')!,
  };
}

function clearActive(): void {
  if (!active) return;
  if (active.timer) clearInterval(active.timer);
  if (active.expireTimer) clearTimeout(active.expireTimer);
  if (active.fadeTimer) clearTimeout(active.fadeTimer);
  active = null;
}

export function showHiddenToast(arxivId: string, onUndo: () => void): void {
  clearActive();
  const refs = ensureDom();
  if (!refs) return;

  refs.root.querySelector('.hidden-toast-id')!.textContent = arxivId;
  refs.undoBtn.disabled = false;
  refs.undoBtn.textContent = '撤销 (30s)';
  refs.root.classList.add('hidden-toast--visible');
  refs.root.hidden = false;

  let remaining = 30;
  const tick = (): void => {
    remaining -= 1;
    if (remaining > 0) {
      refs.undoBtn.textContent = `撤销 (${remaining}s)`;
      return;
    }
    // 到点:禁用按钮 + 标记过期
    if (active?.timer) clearInterval(active.timer);
    refs.undoBtn.disabled = true;
    refs.undoBtn.textContent = '已过期';
    refs.root.classList.add('hidden-toast--expired');
    active = { refs, timer: null, expireTimer: null, fadeTimer: setTimeout(fadeOut, 5000) };
  };

  refs.undoBtn.onclick = (): void => {
    if (refs.undoBtn.disabled) return;
    onUndo();
    fadeOut();
  };

  const fadeOut = (): void => {
    refs.root.classList.remove('hidden-toast--visible');
    active = null;
  };

  active = {
    refs,
    timer: setInterval(tick, 1000),
    expireTimer: setTimeout(tick, 30_000), // 兜底:setInterval 在标签页休眠时会漂
    fadeTimer: null,
  };
}

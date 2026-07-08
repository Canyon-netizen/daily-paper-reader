// 通用 toast 提示 — /papers/ 抽屉标签保存 / Gist 同步等场景共用。
//
// 区别于 ./hidden-toast.ts(那个带 30s 撤销倒计时,专给"隐藏论文"用),
// 这里只做单向通知:无撤销,固定 3s 后淡出。level:
//
//   - 'info'  : 蓝灰色,普通信息(默认)
//   - 'ok'    : 绿色,操作成功
//   - 'warn'  : 黄色,提醒
//   - 'error' : 红色,失败(默认 5s,比 info 停留更久)
//
// 单一 toast:新 toast 覆盖旧 toast,不堆叠。
// DOM 不存在 / document.body 还没就绪时静默忽略,避免拖死 ES module 加载。

export type ToastLevel = 'info' | 'ok' | 'warn' | 'error';

interface ToastRefs {
  root: HTMLDivElement;
  icon: HTMLSpanElement;
  text: HTMLSpanElement;
}

let active: {
  refs: ToastRefs;
  fadeTimer: ReturnType<typeof setTimeout> | null;
} | null = null;

function ensureDom(): ToastRefs | null {
  if (typeof document === 'undefined') return null;
  let root = document.getElementById('dpr-toast') as HTMLDivElement | null;
  if (root) {
    return {
      root,
      icon: root.querySelector<HTMLSpanElement>('.dpr-toast-icon')!,
      text: root.querySelector<HTMLSpanElement>('.dpr-toast-text')!,
    };
  }
  root = document.createElement('div');
  root.id = 'dpr-toast';
  root.className = 'dpr-toast';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <span class="dpr-toast-icon">ℹ</span>
    <span class="dpr-toast-text"></span>
  `;
  document.body.appendChild(root);
  return {
    root,
    icon: root.querySelector<HTMLSpanElement>('.dpr-toast-icon')!,
    text: root.querySelector<HTMLSpanElement>('.dpr-toast-text')!,
  };
}

function clearActive(): void {
  if (!active) return;
  if (active.fadeTimer) clearTimeout(active.fadeTimer);
  active = null;
}

const ICONS: Record<ToastLevel, string> = {
  info: 'ℹ',
  ok: '✓',
  warn: '⚠',
  error: '✗',
};

const DURATIONS: Record<ToastLevel, number> = {
  info: 3000,
  ok: 2500,
  warn: 4000,
  error: 5000,
};

/** 显示一条 toast。msg 会被转义后再注入,所以安全;level 决定图标 / 颜色 / 停留时长。 */
export function showToast(msg: string, level: ToastLevel = 'info'): void {
  clearActive();
  const refs = ensureDom();
  if (!refs) return;
  refs.text = refs.root.querySelector<HTMLSpanElement>('.dpr-toast-text')!;
  refs.icon.textContent = ICONS[level] || ICONS.info;
  refs.text.textContent = msg;
  refs.root.classList.remove(
    'dpr-toast--visible',
    'dpr-toast--info',
    'dpr-toast--ok',
    'dpr-toast--warn',
    'dpr-toast--error',
  );
  refs.root.classList.add(`dpr-toast--${level}`, 'dpr-toast--visible');
  active = {
    refs,
    fadeTimer: setTimeout(() => {
      refs.root.classList.remove('dpr-toast--visible');
      active = null;
    }, DURATIONS[level] || 3000),
  };
}

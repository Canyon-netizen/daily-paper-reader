// astro-src/scripts/paper-figures.ts
// 论文图表 carousel:箭头 + 键盘 ←/→ + 触屏/鼠标拖动 + 指示点。
// 图片在统一的响应式边界框内等比缩放,位置记 sessionStorage。

let bound = false;

function clampIndex(i: number, n: number): number {
  if (!Number.isFinite(i) || n <= 0) return 0;
  // 用模运算环绕,而不是 min 截断 ——
  // 之前是 max(0, min(n-1, i)),在最后一张(current = n-1)点 next 时 i=n,
  // clampIndex 返回 n-1,current 不变,按钮表现为"没反应"。
  // 用户感知:点到最后一张就卡住,以为是没绑事件。
  return ((Math.floor(i) % n) + n) % n;
}

function initFigures(): void {
  const details = document.querySelector<HTMLDetailsElement>('.paper-figures-wrap');
  const root = details?.querySelector<HTMLElement>('.paper-carousel');
  if (!details || !root) return;
  if (bound || root.dataset.bound === '1') return;
  bound = true;
  root.dataset.bound = '1';

  const slides = Array.from(root.querySelectorAll<HTMLElement>('.paper-slide'));
  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('.paper-carousel-dot'));
  const prevBtn = root.querySelector<HTMLButtonElement>('.paper-carousel-prev');
  const nextBtn = root.querySelector<HTMLButtonElement>('.paper-carousel-next');
  const track = root.querySelector<HTMLElement>('.paper-carousel-track');
  if (!slides.length || !track) return;

  const arxivIdMatch = location.pathname.match(/(\d{4}\.\d{4,5}v\d+)/);
  const arxivId = arxivIdMatch ? arxivIdMatch[1] : 'unknown';
  const storageKey = `paperFigures:${arxivId}:idx`;

  let current = clampIndex(parseInt(sessionStorage.getItem(storageKey) || '0', 10), slides.length);

  function show(i: number, opts: { persist?: boolean } = {}): void {
    current = clampIndex(i, slides.length);
    slides.forEach((s, idx) => s.classList.toggle('is-active', idx === current));
    dots.forEach((d, idx) => {
      d.classList.toggle('is-active', idx === current);
      d.setAttribute('aria-current', idx === current ? 'true' : 'false');
    });
    const single = slides.length <= 1;
    if (prevBtn) prevBtn.disabled = single;
    if (nextBtn) nextBtn.disabled = single;
    if (opts.persist !== false) {
      try { sessionStorage.setItem(storageKey, String(current)); } catch { /* privacy mode */ }
    }
  }

  function go(delta: number): void { show(current + delta); }
  function goto(i: number): void { show(i); }

  prevBtn?.addEventListener('click', () => go(-1));
  nextBtn?.addEventListener('click', () => go(1));
  dots.forEach((d) => d.addEventListener('click', () => {
    goto(parseInt(d.dataset.index || '0', 10));
  }));

  root.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });

  // 触屏 / 鼠标拖动
  let startX = 0;
  let dx = 0;
  let dragging = false;
  let activePointerId: number | null = null;
  const THRESHOLD = 40;
  root.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 按钮/指示点上的按压不进拖拽:否则 root.setPointerCapture 会把随后的 click
    // 事件重定向到 root(Chromium 行为),按钮自己的 click 监听收不到,表现为箭头/圆点点了没反应。
    if ((e.target as HTMLElement).closest('.paper-carousel-btn, .paper-carousel-dot')) return;
    dragging = true;
    startX = e.clientX;
    dx = 0;
    activePointerId = e.pointerId;
    try { root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  root.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    dx = e.clientX - startX;
  });
  root.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (activePointerId !== null) {
      try { root.releasePointerCapture(activePointerId); } catch { /* ignore */ }
      activePointerId = null;
    }
    if (Math.abs(dx) > THRESHOLD) go(dx < 0 ? 1 : -1);
  });
  root.addEventListener('pointercancel', () => {
    dragging = false;
    activePointerId = null;
  });

  show(current, { persist: false });
}

function bootstrap(): void {
  // 包 try/catch:若 carousel DOM 异常或别处先抛,不影响 astro:page-load 等后续重挂
  try {
    initFigures();
  } catch (e) {
    console.error('[paper-figures] init failed:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}

// Astro 客户端导航 / 视图过渡后页面可能换 DOM,重新挂一次
document.addEventListener('astro:page-load', bootstrap);
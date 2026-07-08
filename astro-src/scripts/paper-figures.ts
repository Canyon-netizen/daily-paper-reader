// astro-src/scripts/paper-figures.ts
// 论文图表 carousel:箭头 + 键盘 ←/→ + 触屏/鼠标拖动 + 指示点。
// 容器高度按所有图片 contain 后最大高度取,避免首屏跳变;位置记 sessionStorage。
// 复用 paper-chat.ts 的「顶层直接调用 + 早返回」模式,其它页面 import 也无害。

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

  function applyTrackHeight(): void {
    if (!track) return;
    const maxWidth = track.clientWidth || 800;
    // 自适应:容器高度跟着「当前这张图」走,而不是所有图的最大/中位。
    // 每张图都按其原始宽高比 contain 到满宽后的高度撑开容器 —— 任何一张都刚好贴合、
    // 没有多余留白;比窗口高的图仍靠 object-fit:contain 等比压缩,不裁切。
    const active = slides[current];
    const img = active?.querySelector<HTMLImageElement>('img');
    let target = 320;
    if (img && img.naturalWidth && img.naturalHeight) {
      target = Math.max(160, Math.round((img.naturalHeight * maxWidth) / img.naturalWidth));
    }
    track.style.height = `${target + 60}px`;
  }

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
    // 自适应高度跟随当前图。lazy 图切过去时可能还没解码(naturalWidth=0),
    // applyTrackHeight 会先退到兜底高;挂一次性 load 监听,解码完再撑到正确高度。
    // 外层函数在 !details 时已经早返回,这里闭包里 details 一定存在,用 ! 断言。
    if (details!.open) {
      const img = slides[current]?.querySelector<HTMLImageElement>('img');
      if (img && !img.complete) {
        img.addEventListener('load', applyTrackHeight, { once: true });
      }
      applyTrackHeight();
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

  function measure(): void {
    const imgs = Array.from(root!.querySelectorAll<HTMLImageElement>('img'));
    const waitAll = Promise.all(imgs.map((img) => img.complete
      ? Promise.resolve()
      : new Promise<void>((res) => {
          img.addEventListener('load', () => res(), { once: true });
          img.addEventListener('error', () => res(), { once: true });
        })));
    waitAll.then(applyTrackHeight);
  }

  show(current, { persist: false });
  if (details.open) measure();
  details.addEventListener('toggle', () => { if (details.open) measure(); });

  let resizeT: number | undefined;
  window.addEventListener('resize', () => {
    if (resizeT) window.clearTimeout(resizeT);
    resizeT = window.setTimeout(applyTrackHeight, 150);
  });
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
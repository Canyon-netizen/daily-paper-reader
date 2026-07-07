// astro-src/scripts/paper-figures.ts
// 论文图表 carousel:箭头 + 键盘 ←/→ + 触屏/鼠标拖动 + 指示点。
// 容器高度按所有图片 contain 后最大高度取,避免首屏跳变;位置记 sessionStorage。
// 复用 paper-chat.ts 的「顶层直接调用 + 早返回」模式,其它页面 import 也无害。

function clampIndex(i: number, n: number): number {
  if (!Number.isFinite(i) || n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, i));
}

function initFigures(): void {
  const details = document.querySelector<HTMLDetailsElement>('.paper-figures-wrap');
  const root = details?.querySelector<HTMLElement>('.paper-carousel');
  if (!details || !root) return;

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
    let maxH = 320;
    for (const s of slides) {
      const img = s.querySelector<HTMLImageElement>('img');
      if (!img) continue;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) continue;
      const containH = Math.round((h * maxWidth) / w);
      if (containH > maxH) maxH = containH;
    }
    track.style.height = `${maxH + 60}px`;
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

initFigures();
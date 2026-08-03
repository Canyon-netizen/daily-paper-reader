// astro-src/scripts/virtual-list.ts
//
// 通用「虚拟滚动」helper —— 不引外部库,~150 行。
//
// 设计目标:
//   - 单列 / 高度不固定 / 一次只挂载 viewport 内可见行 + overscan
//   - 状态自包含(viewport + spacer + list),每个实例绑定一组
//   - caller 只提供 items[] + renderRow(i) → string;其余滚动 / 测量 / 重算自动
//   - 行高可校准:首屏用 estimate,渲染后 measure 实测,后续滚动按实测高度算偏移
//
// 用法(单库工作台 wb-papers-list):
//   const list = document.querySelector('[data-vlist]')!;
//   const vl = createVirtualList(list, {
//     items: papers,
//     estimate: 120,
//     overscan: 6,
//     renderRow: (p, i) => `<a class="wb-paper-row ..." data-paper-id="${p.canonicalArxivId}">…</a>`,
//   });
//   vl.dispose() 解绑。
//
// 已知取舍:
//   - 行间不等高时,二分 + 累计偏移数组 = O(log n + k) per scroll event。
//   - 不支持横向滚动(单列纵向);如要 grid,自己包一层。
//   - 滚动事件 passive,scroll 内不调 preventDefault。
//   - 容器宽度变化(responsive)会触发重测:监听 ResizeObserver。

const RESIZE_OBSERVER = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => requestRedraw()) : null;

export interface VirtualListOpts<T> {
  items: readonly T[];
  estimate: number;     // 首屏预估行高(px)
  overscan?: number;    // 上下各多挂几行,默认 6
  renderRow: (item: T, idx: number) => string;
  /** 行容器选择器(spacer 内的子节点);留空 = 用 renderRow 的根 */
  rowSelector?: string;
}

export interface VirtualList<T> {
  setItems(items: readonly T[]): void;
  scrollToIndex(idx: number): void;
  forceRender(): void;
  dispose(): void;
}

export function createVirtualList<T>(
  host: HTMLElement,
  opts: VirtualListOpts<T>,
): VirtualList<T> {
  // host 期望结构:<div data-vlist-viewport style="overflow:auto;height:...">
  //                  <div data-vlist-spacer style="position:relative">
  //                    <div data-vlist-rows>真实渲染</div>
  //                  </div>
  //                </div>
  const viewport = host.querySelector<HTMLElement>('[data-vlist-viewport]') || host;
  const spacer = host.querySelector<HTMLElement>('[data-vlist-spacer]') || (() => {
    const el = document.createElement('div');
    el.setAttribute('data-vlist-spacer', '');
    el.style.position = 'relative';
    viewport.appendChild(el);
    return el;
  })();
  const rowsLayer = host.querySelector<HTMLElement>('[data-vlist-rows]') || (() => {
    const el = document.createElement('div');
    el.setAttribute('data-vlist-rows', '');
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.right = '0';
    el.style.top = '0';
    spacer.appendChild(el);
    return el;
  })();

  viewport.style.overflow = 'auto';

  let items: readonly T[] = opts.items;
  let estimate = opts.estimate;
  const overscan = opts.overscan ?? 6;
  const rowHeights = new Map<number, number>(); // index → measured
  let offsets: number[] = []; // 累计偏移
  let rafPending = false;
  let disposed = false;

  function recomputeOffsets(): void {
    const n = items.length;
    offsets = new Array(n + 1);
    offsets[0] = 0;
    for (let i = 0; i < n; i++) {
      offsets[i + 1] = offsets[i] + (rowHeights.get(i) ?? estimate);
    }
    spacer.style.height = `${offsets[n]}px`;
  }

  function totalHeight(): number {
    return offsets.length > 0 ? offsets[offsets.length - 1] : 0;
  }

  function binaryRange(scrollTop: number, height: number): [number, number] {
    // 找第一个 offset >= scrollTop 的下标
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    const startIdx = Math.max(0, lo - overscan);
    // 找第一个 offset > scrollTop + height 的下标
    const targetEnd = scrollTop + height;
    let lo2 = lo;
    let hi2 = items.length;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >> 1;
      if (offsets[mid] <= targetEnd) lo2 = mid + 1;
      else hi2 = mid;
    }
    const endIdx = Math.min(items.length, lo2 + overscan);
    return [startIdx, endIdx];
  }

  function render(): void {
    if (disposed) return;
    const scrollTop = viewport.scrollTop;
    const viewportH = viewport.clientHeight;
    if (items.length === 0) {
      rowsLayer.innerHTML = '';
      spacer.style.height = '0px';
      return;
    }
    recomputeOffsets();
    const [start, end] = binaryRange(scrollTop, viewportH);
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const item = items[i];
      if (item === undefined) continue;
      const wrap = document.createElement('div');
      wrap.setAttribute('data-vlist-row', '');
      wrap.style.position = 'absolute';
      wrap.style.left = '0';
      wrap.style.right = '0';
      wrap.style.transform = `translateY(${offsets[i]}px)`;
      wrap.innerHTML = opts.renderRow(item, i);
      frag.appendChild(wrap);
    }
    rowsLayer.replaceChildren(frag);
    // 测量首屏实际高度,刷新 estimate
    requestAnimationFrame(() => {
      if (disposed) return;
      const layers = rowsLayer.querySelectorAll<HTMLElement>('[data-vlist-row]');
      let changed = false;
      layers.forEach((el) => {
        const idxAttr = el.firstElementChild?.getAttribute('data-vlist-idx');
        // 用行内 idx(由 renderRow 自己塞);找不到就 skip
        // 简化:用 transform Y 反推 idx
        const y = parseFloat(el.style.transform.replace(/translateY\(([^p]+)px\)/, '$1'));
        const idx = findIdxByOffset(y);
        if (idx >= 0) {
          const h = el.getBoundingClientRect().height;
          if (Math.abs((rowHeights.get(idx) ?? estimate) - h) > 1) {
            rowHeights.set(idx, h);
            changed = true;
          }
        }
      });
      if (changed) {
        recomputeOffsets();
        // 总高度变了 → spacer 同步
        spacer.style.height = `${totalHeight()}px`;
      }
    });
  }

  function findIdxByOffset(y: number): number {
    // 二分找 offsets[i] === y
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < y) lo = mid + 1;
      else hi = mid;
    }
    return offsets[lo] === y ? lo : -1;
  }

  function requestRedraw(): void {
    if (rafPending || disposed) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  // 绑定事件
  viewport.addEventListener('scroll', requestRedraw, { passive: true });
  if (RESIZE_OBSERVER) {
    try { RESIZE_OBSERVER.observe(viewport); } catch { /* ignore */ }
  }

  // 首次渲染
  recomputeOffsets();
  render();

  return {
    setItems(newItems) {
      items = newItems;
      rowHeights.clear();
      recomputeOffsets();
      requestRedraw();
    },
    scrollToIndex(idx) {
      if (idx < 0 || idx >= items.length) return;
      viewport.scrollTop = offsets[idx] ?? 0;
      requestRedraw();
    },
    forceRender() {
      rowHeights.clear();
      recomputeOffsets();
      render();
    },
    dispose() {
      disposed = true;
      viewport.removeEventListener('scroll', requestRedraw);
      if (RESIZE_OBSERVER) {
        try { RESIZE_OBSERVER.unobserve(viewport); } catch { /* ignore */ }
      }
    },
  };
}
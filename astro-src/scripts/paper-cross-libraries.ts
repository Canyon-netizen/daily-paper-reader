// astro-src/scripts/paper-cross-libraries.ts
//
// 论文详情页「所在文献库」横条 —— 在论文 metadata 区显示这篇论文所在的所有
// 用户库(Polaris paper detail 的「in N libraries」视图)。
//
// 触发:
//   1. paper detail 页加载时,扫描 [data-paper-canonical-id] 上的 id
//   2. 调用 listLibrariesContainingPaperDetailed(canonical)
//   3. 把结果渲染成一行 chip,每个库链到 /libraries/?id=<libId>
//
// 入口:setupCrossLibrariesStrip(scope)
//   默认在 DOMContentLoaded 时对整个 document 跑一次。
//   Astro 切页时通过 astro:page-load 事件再次跑(N 个 paper 列表页共用)。

import {
  listLibrariesContainingPaperDetailed,
} from '../lib/user-libraries';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c] || c);
}

/** 把一条库信息渲染为 chip。 */
function renderLibChip(
  lib: { id: string; name: string; statement: string; hue: string; visibility: string; archived: boolean },
  base: string,
): string {
  const url = `${base}/libraries/?id=${encodeURIComponent(lib.id)}`;
  const visBadge = lib.visibility === 'public'
    ? '<span class="cl-vis cl-vis--public">🌐</span>'
    : lib.visibility === 'pending'
      ? '<span class="cl-vis cl-vis--pending">⏳</span>'
      : '<span class="cl-vis cl-vis--personal">⭐</span>';
  const archBadge = lib.archived ? '<span class="cl-arch">📦</span>' : '';
  return `
    <a class="cl-chip hue-${escapeHtml(lib.hue)}"
       href="${escapeHtml(url)}"
       data-cl-lib-id="${escapeHtml(lib.id)}"
       title="${escapeHtml(lib.statement)}">
      <span class="cl-name">${escapeHtml(lib.name)}</span>
      ${visBadge}
      ${archBadge}
    </a>
  `;
}

/** 把「所在文献库」横条挂到目标容器里。若没库就 hide mount。 */
function mountOne(
  mount: HTMLElement,
  canonicalId: string,
  base: string,
): void {
  const libs = listLibrariesContainingPaperDetailed(canonicalId);
  if (libs.length === 0) {
    mount.hidden = true;
    mount.innerHTML = '';
    return;
  }
  mount.hidden = false;
  const archiveCount = libs.filter((l) => l.archived).length;
  mount.innerHTML = `
    <div class="cl-header">
      📚 这篇论文在 ${libs.length} 个文献库里${archiveCount > 0 ? `(${archiveCount} 个已归档)` : ''}:
    </div>
    <div class="cl-chips">
      ${libs.map((l) => renderLibChip(l, base)).join('')}
    </div>
  `;
}

function baseHref(): string {
  const raw = (document.querySelector('base')?.getAttribute('href')) || '/';
  return raw.replace(/\/+$/, '') || '';
}

/** 找所有 paper detail 用的 mount 节点,跑一次。 */
function setupAll(): void {
  const base = baseHref();
  const mounts = document.querySelectorAll<HTMLElement>('[data-paper-cross-libs]');
  mounts.forEach((mount) => {
    const cx = mount.dataset.paperCanonicalId || '';
    if (!cx) return;
    mountOne(mount, cx, base);
  });
}

export function setupCrossLibrariesStrip(_scope?: Element): void {
  setupAll();
}

// auto-init(astro:page-load 都会重跑;Astro 切页后 mount 是新挂的)
if (typeof document !== 'undefined') {
  document.addEventListener('astro:page-load', setupAll);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAll, { once: true });
  } else {
    setupAll();
  }
}

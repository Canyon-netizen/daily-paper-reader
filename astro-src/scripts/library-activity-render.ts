// astro-src/scripts/library-activity-render.ts
//
// 库活动日志渲染器 —— 接到 user-libraries-ui 的 Govern tab 上,
// 调用 listLibraryActivity() 拿 events,渲染为「最近活动」面板。
//
// 触发:renderLibraryActivity(mount, libId) —— mount 是 <div id="lib-activity-feed">
//
// 风格:沿用 Govern tab dl/govern-dl 的卡片样式,避免重复定义;
// 每条事件一行:相对时间 + 简短描述,鼠标悬停显示完整 ISO 时间戳。

import { listLibraryActivity, formatActivityTime } from '../lib/user-libraries';
import type { LibraryActivity } from '../lib/user-libraries';

const KIND_BADGE_COLOR: Record<string, string> = {
  create: 'green',
  delete: 'red',
  rename: 'blue',
  statement: 'blue',
  hue: 'purple',
  definition: 'amber',
  visibility: 'sky',
  archive: 'rose',
  'addPaper': 'green',
  'addPaper-bulk': 'green',
  'removePaper': 'orange',
  'removePaper-bulk': 'orange',
  'anchor-add': 'emerald',
  'anchor-remove': 'red',
  'paper-meta': 'amber',
  'paper-status-bulk': 'amber',
  'paper-meta-remove': 'red',
  'concept-override': 'sky',
  'concept-override-remove': 'sky',
  sync: 'cyan',
  reset: 'red',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c] || c);
}

function kindBadge(kind: string): string {
  const c = KIND_BADGE_COLOR[kind] || 'slate';
  return `<span class="lib-activity-badge lib-activity-badge--${escapeHtml(c)}">${escapeHtml(kind)}</span>`;
}

function renderRow(a: LibraryActivity): string {
  const t = formatActivityTime(a.at);
  const iso = new Date(a.at).toISOString();
  return `
    <li class="lib-activity-row" data-activity-kind="${escapeHtml(a.kind)}">
      ${kindBadge(a.kind)}
      <span class="lib-activity-msg" title="${escapeHtml(iso)}">${escapeHtml(a.message)}</span>
      <span class="lib-activity-time" title="${escapeHtml(iso)}">${escapeHtml(t)}</span>
    </li>
  `;
}

/**
 * 渲染活动 feed 到指定 mount 节点。
 * 返回总条数(供调用方决定是否显示「清空日志」按钮)。
 */
export function renderLibraryActivity(
  mount: HTMLElement,
  libId: string,
  limit = 30,
): number {
  const events = listLibraryActivity(libId, limit);
  if (events.length === 0) {
    mount.innerHTML = `<p class="empty muted">还没有活动记录。所有变更(创建 / 改名 / 加入论文 / 状态切换)都会出现在这里。</p>`;
    return 0;
  }
  mount.innerHTML = `
    <ul class="lib-activity-list">
      ${events.map(renderRow).join('')}
    </ul>
    ${events.length === limit ? `<p class="lib-activity-more muted">只显示最近 ${limit} 条;完整日志见 localStorage <code>dpr_library_activity_log_v1</code>。</p>` : ''}
  `;
  return events.length;
}

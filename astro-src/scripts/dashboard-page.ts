// astro-src/scripts/dashboard-page.ts
//
// Pure-TS orchestrator for the full dashboard page.
// Provides loading, rendering, and event subscription for dashboard.

import { buildDashboardSummary, type DashboardSummary } from '../lib/projects/recommend';
import type { PaperListItem } from '../lib/paper';
import {
  onDprReadingDashboardDirty,
  emitDprReadingDashboardDirty,
  type DprReadingDashboardDirtyDetail,
} from '../lib/events';

export interface DashboardRenderHandlers {
  renderKPIs(container: HTMLElement, summary: DashboardSummary): void;
  renderStale(container: HTMLElement, summary: DashboardSummary): void;
  renderNewRelated(container: HTMLElement, summary: DashboardSummary): void;
  renderDrafts(container: HTMLElement, summary: DashboardSummary): void;
}

export interface DashboardPageConfig {
  staleDays?: number;
  newRelatedLimit?: number;
  throttleMs?: number;
}

const DEFAULT_CONFIG: Required<DashboardPageConfig> = {
  staleDays: 30,
  newRelatedLimit: 5,
  throttleMs: 5000,
};

interface DashboardElements {
  kpis: HTMLElement;
  stale: HTMLElement;
  newRelated: HTMLElement;
  drafts: HTMLElement;
}

/**
 * Get dashboard DOM elements by ID.
 */
function getDashboardElements(): DashboardElements | null {
  const kpis = document.getElementById('dashboard-kpis');
  const stale = document.getElementById('dashboard-stale');
  const newRelated = document.getElementById('dashboard-new-related');
  const drafts = document.getElementById('dashboard-drafts');

  if (!kpis || !stale || !newRelated || !drafts) {
    return null;
  }

  return { kpis, stale, newRelated, drafts };
}

/**
 * Load and render dashboard with default handlers.
 */
export async function loadAndRenderDashboard(
  papers: PaperListItem[],
  config: DashboardPageConfig = {}
): Promise<DashboardSummary | null> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const elements = getDashboardElements();

  if (!elements) {
    console.warn('[dashboard-page] Dashboard elements not found');
    return null;
  }

  try {
    const summary = await buildDashboardSummary({
      staleDays: mergedConfig.staleDays,
      newRelatedLimit: mergedConfig.newRelatedLimit,
    });

    // Use default render handlers
    renderKPIs(elements.kpis, summary);
    renderStale(elements.stale, summary);
    renderNewRelated(elements.newRelated, summary);
    renderDrafts(elements.drafts, summary);

    return summary;
  } catch (err) {
    console.error('[dashboard-page] Failed to load dashboard:', err);
    elements.kpis.innerHTML = '<p class="dpr-error">加载失败，请刷新页面重试。</p>';
    return null;
  }
}

/**
 * Render KPIs section.
 */
function renderKPIs(container: HTMLElement, summary: DashboardSummary): void {
  const { byStatus, totalProjects, totalDrafts, totalWords, weeklyAdds } = summary;

  container.innerHTML = `
    <div class="dashboard-kpi-card">
      <span class="dashboard-kpi-number">${byStatus.unread}</span>
      <span class="dashboard-kpi-label">待读</span>
    </div>
    <div class="dashboard-kpi-card">
      <span class="dashboard-kpi-number">${byStatus.reading}</span>
      <span class="dashboard-kpi-label">在读</span>
    </div>
    <div class="dashboard-kpi-card">
      <span class="dashboard-kpi-number">${byStatus.read}</span>
      <span class="dashboard-kpi-label">已读</span>
    </div>
    <div class="dashboard-kpi-card">
      <span class="dashboard-kpi-number">${weeklyAdds}</span>
      <span class="dashboard-kpi-label">本周新增</span>
    </div>
    <div class="dashboard-kpi-card">
      <span class="dashboard-kpi-number">${totalProjects}</span>
      <span class="dashboard-kpi-label">项目</span>
    </div>
    <div class="dashboard-kpi-card">
      <span class="dashboard-kpi-number">${totalDrafts}</span>
      <span class="dashboard-kpi-label">草稿</span>
    </div>
    <div class="dashboard-kpi-card dashboard-kpi-words">
      <span class="dashboard-kpi-number">${formatWords(totalWords)}</span>
      <span class="dashboard-kpi-label">字数</span>
    </div>
  `;
}

/**
 * Render stale reads section.
 */
function renderStale(container: HTMLElement, summary: DashboardSummary): void {
  const { staleReads } = summary;

  if (staleReads.length === 0) {
    container.innerHTML = `
      <h2 class="dashboard-section-title">已很久没读</h2>
      <div class="dpr-empty">
        <p class="dpr-empty-icon">🎉</p>
        <h3>所有论文 7 天内都过了一眼!</h3>
        <p>暂无需要重读的论文。</p>
      </div>
    `;
    return;
  }

  const itemsHtml = staleReads
    .map((item) => {
      return `
      <div class="dashboard-stale-item" data-arxiv-id="${item.arxivId}">
        <a href="/papers/${item.arxivId}/" class="dashboard-stale-link">${item.arxivId}</a>
        <span class="dashboard-stale-days">${item.lastTouchDays} 天</span>
        <button class="dashboard-stale-btn" data-action="reread" data-id="${item.arxivId}">重读</button>
      </div>
    `;
    })
    .join('');

  container.innerHTML = `
    <h2 class="dashboard-section-title">已很久没读</h2>
    <p class="dashboard-section-desc">超过 30 天没有翻开的论文</p>
    <div class="dashboard-stale-list">
      ${itemsHtml}
    </div>
  `;

  // Attach event listeners for reread buttons
  container.querySelectorAll('.dashboard-stale-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const arxivId = target.dataset.id;
      if (!arxivId) return;

      // Emit dirty event to trigger refresh after status change
      emitDprReadingDashboardDirty();
    });
  });
}

/**
 * Render new related papers section.
 */
function renderNewRelated(container: HTMLElement, summary: DashboardSummary): void {
  const { newRelated } = summary;

  if (newRelated.length === 0) {
    container.innerHTML = `
      <h2 class="dashboard-section-title">相关新论文</h2>
      <div class="dpr-empty">
        <p class="dpr-empty-icon">📚</p>
        <h3>暂无新相关论文</h3>
        <p>收藏更多论文后会推荐相关新论文。</p>
      </div>
    `;
    return;
  }

  const itemsHtml = newRelated
    .map((item) => {
      const relatedToDisplay = item.relatedToIds.slice(0, 3).join(', ');
      const moreCount = item.relatedToIds.length - 3;
      const moreDisplay = moreCount > 0 ? ` 等${moreCount}篇` : '';

      return `
      <div class="dashboard-related-card" data-arxiv-id="${item.arxivId}">
        <a href="/papers/${item.arxivId}/" class="dashboard-related-link">${item.arxivId}</a>
        <div class="dashboard-related-meta">
          <span class="dashboard-related-weight">相关度: ${item.relatedToIds.length} 篇</span>
          ${item.relatedToIds.length > 0 ? `<span class="dashboard-related-to">关联: ${relatedToDisplay}${moreDisplay}</span>` : ''}
        </div>
      </div>
    `;
    })
    .join('');

  container.innerHTML = `
    <h2 class="dashboard-section-title">相关新论文</h2>
    <p class="dashboard-section-desc">根据你的收藏推荐的近 7 天新论文</p>
    <div class="dashboard-related-list">
      ${itemsHtml}
    </div>
  `;
}

/**
 * Render drafts section.
 */
function renderDrafts(container: HTMLElement, summary: DashboardSummary): void {
  const { totalDrafts, totalWords } = summary;

  if (totalDrafts === 0) {
    container.innerHTML = `
      <h2 class="dashboard-section-title">写作进度</h2>
      <div class="dpr-empty">
        <p class="dpr-empty-icon">✍️</p>
        <h3>还没有草稿</h3>
        <p>在项目中创建草稿开始写作。</p>
        <div class="dpr-empty-actions">
          <a href="/projects/" class="dpr-btn dpr-btn-primary">进入项目</a>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <h2 class="dashboard-section-title">写作进度</h2>
    <p class="dashboard-section-desc">共有 ${totalDrafts} 篇草稿，${formatWords(totalWords)} 字</p>
    <div class="dpr-empty-actions">
      <a href="/projects/" class="dpr-btn dpr-btn-secondary">查看全部草稿</a>
    </div>
  `;
}

/**
 * Format word count for display.
 */
function formatWords(words: number): string {
  if (words >= 10000) {
    return (words / 10000).toFixed(1) + 'w';
  }
  if (words >= 1000) {
    return (words / 1000).toFixed(1) + 'k';
  }
  return words.toString();
}

/**
 * Subscribe to dashboard dirty events.
 * Returns unsubscribe function.
 */
export function subscribeDashboardDirty(handler: () => void): () => void {
  return onDprReadingDashboardDirty(document, (detail: DprReadingDashboardDirtyDetail) => {
    handler();
  });
}

// astro-src/scripts/dashboard-strip.ts
//
// Pure-TS orchestrator for the home-page dashboard strip.
// Provides lightweight summary for insertion on the home page.

import { buildDashboardSummary, type DashboardSummary } from '../lib/projects/recommend';
import type { PaperListItem } from '../lib/paper';

export interface DashboardStripData {
  unreadCount: number;
  staleCount: number;
  newRelatedCount: number;
}

/**
 * Extract strip data from full dashboard summary.
 */
export function buildStripData(summary: DashboardSummary): DashboardStripData {
  return {
    unreadCount: summary.byStatus.unread + summary.byStatus.reading,
    staleCount: summary.staleReads.length,
    newRelatedCount: summary.newRelated.length,
  };
}

/**
 * Format count for display.
 */
function formatCount(count: number): string {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k';
  }
  return count.toString();
}

/**
 * Create strip HTML for dashboard summary.
 */
export function createStripHtml(data: DashboardStripData): string {
  const { unreadCount, staleCount, newRelatedCount } = data;

  return `
    <div class="strip-dashboard">
      <a href="/dashboard/" class="strip-pill strip-pill-unread">
        <span class="strip-pill-icon">📚</span>
        <span class="strip-pill-label">待读</span>
        <span class="strip-pill-count">${formatCount(unreadCount)}</span>
      </a>
      <a href="/dashboard/?filter=stale" class="strip-pill strip-pill-stale">
        <span class="strip-pill-icon">🔴</span>
        <span class="strip-pill-label">重读</span>
        <span class="strip-pill-count">${formatCount(staleCount)}</span>
      </a>
      <a href="/dashboard/?filter=new-related" class="strip-pill strip-pill-new">
        <span class="strip-pill-icon">🆕</span>
        <span class="strip-pill-label">相关</span>
        <span class="strip-pill-count">${formatCount(newRelatedCount)}</span>
      </a>
    </div>
  `;
}

/**
 * Mount dashboard strip to a root element.
 * Returns unsubscribe function for cleanup.
 */
export function mountDashboardStrip(
  root: HTMLElement,
  _papers: PaperListItem[]
): () => void {
  let mounted = false;

  async function mount() {
    if (mounted) return;
    mounted = true;

    try {
      const summary = await buildDashboardSummary({
        staleDays: 30,
        newRelatedLimit: 5,
      });

      const stripData = buildStripData(summary);
      root.innerHTML = createStripHtml(stripData);
    } catch (err) {
      console.error('[dashboard-strip] Failed to load:', err);
      root.innerHTML = `
        <div class="strip-dashboard">
          <span class="strip-pill strip-pill-disabled">加载失败</span>
        </div>
      `;
    }
  }

  // Mount immediately
  mount();

  // Return cleanup function
  return () => {
    mounted = false;
  };
}

/**
 * Refresh strip data without full re-render.
 */
export async function refreshStripData(): Promise<DashboardStripData | null> {
  try {
    const summary = await buildDashboardSummary({
      staleDays: 30,
      newRelatedLimit: 5,
    });
    return buildStripData(summary);
  } catch (err) {
    console.error('[dashboard-strip] Failed to refresh:', err);
    return null;
  }
}

/**
 * Update strip counts in DOM without full re-render.
 */
export function updateStripCounts(container: HTMLElement, data: DashboardStripData): void {
  const counts = container.querySelectorAll('.strip-pill-count');
  if (counts.length >= 3) {
    const unreadEl = counts[0];
    const staleEl = counts[1];
    const newRelatedEl = counts[2];

    if (unreadEl) unreadEl.textContent = formatCount(data.unreadCount);
    if (staleEl) staleEl.textContent = formatCount(data.staleCount);
    if (newRelatedEl) newRelatedEl.textContent = formatCount(data.newRelatedCount);
  }
}

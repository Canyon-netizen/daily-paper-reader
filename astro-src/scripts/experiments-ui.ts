// astro-src/scripts/experiments-ui.ts
//
// Client interactions for experiments page.

/** Initialize experiments page interactions */
export function initExperimentsUI(): void {
  initStatusFilter();
}

/** Status filter: update URL to trigger SSR re-render */
function initStatusFilter(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-status-filter] button');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.statusValue || 'all';

      // Update active state
      buttons.forEach((b) => b.classList.toggle('active', b === btn));

      // Update URL for SSR re-render
      const baseUrl = window.location.pathname.replace(/\/$/, '');
      const newUrl = status === 'all'
        ? baseUrl
        : `${baseUrl}?status=${status}`;

      window.location.href = newUrl;
    });
  });
}

// Auto-init when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExperimentsUI);
  } else {
    initExperimentsUI();
  }
}

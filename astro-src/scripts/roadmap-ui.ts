// astro-src/scripts/roadmap-ui.ts
//
// Client-side interactions for roadmap page.

/**
 * Initialize roadmap page interactivity
 */
export function initRoadmapUI() {
  console.log('[roadmap] UI initialized');

  // Could add filtering, sorting, or interactive goal editing here
  // For now, just log that the page is ready
}

/**
 * Emit event when roadmap is updated (using CustomEvent)
 */
export function emitRoadmapUpdated(roadmapId: string) {
  const event = new CustomEvent('dpr:roadmap-updated', {
    detail: { roadmapId },
    bubbles: true,
  });
  document.dispatchEvent(event);
}

/**
 * Subscribe to roadmap updates
 */
export function onRoadmapUpdated(callback: (data: { roadmapId: string }) => void): () => void {
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent;
    callback(customEvent.detail);
  };
  document.addEventListener('dpr:roadmap-updated', handler);
  return () => document.removeEventListener('dpr:roadmap-updated', handler);
}

// Auto-init when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRoadmapUI);
  } else {
    initRoadmapUI();
  }
}

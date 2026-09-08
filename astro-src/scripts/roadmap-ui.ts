// astro-src/scripts/roadmap-ui.ts
//
// Client-side interactions for roadmap page.

import type { Roadmap, RoadmapGoal } from '../lib/roadmap/types';
import { getClientRoadmaps, saveClientRoadmaps, createRoadmap as createClientRoadmap, updateRoadmap as updateClientRoadmap, updateGoalStatus } from '../lib/roadmap/client';

/** Initialize roadmap page interactivity */
export function initRoadmapUI() {
  console.log('[roadmap] UI initialized');
  initGoalStatusToggle();
  initCreateRoadmapModal();
  initGoalEditModal();
  initProgressDashboard();
}

/** Toggle goal status on click - Issue #7 */
function initGoalStatusToggle() {
  document.querySelectorAll('.roadmap-goal-status').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = '点击切换状态';
    el.addEventListener('click', (e) => {
      const goalEl = (e.target as HTMLElement).closest('.roadmap-goal');
      if (!goalEl) return;

      const currentStatus = goalEl.getAttribute('data-status') as RoadmapGoal['status'] || 'pending';
      const nextStatus: Record<RoadmapGoal['status'], RoadmapGoal['status']> = {
        'pending': 'in-progress',
        'in-progress': 'completed',
        'completed': 'pending'
      };
      const newStatus = nextStatus[currentStatus];

      // Update UI immediately
      goalEl.setAttribute('data-status', newStatus);
      const statusIcon = goalEl.querySelector('.roadmap-goal-status');
      if (statusIcon) {
        statusIcon.setAttribute('data-status', newStatus);
        statusIcon.textContent = newStatus === 'completed' ? '✓' : newStatus === 'in-progress' ? '◐' : '○';
      }

      // Emit event for any listeners
      const roadmapId = document.querySelector('.roadmap-detail')?.getAttribute('data-roadmap-id');
      const quarterId = goalEl.closest('.roadmap-quarter')?.getAttribute('data-quarter');
      const goalId = goalEl.querySelector('.roadmap-goal-id')?.textContent?.replace('G', '');

      if (roadmapId && quarterId && goalId) {
        emitGoalStatusChanged(roadmapId, quarterId, goalId, newStatus);
      }
    });
  });
}

/** Emit event when goal status changes */
function emitGoalStatusChanged(roadmapId: string, quarterId: string, goalId: string, status: string) {
  const event = new CustomEvent('dpr:goal-status-changed', {
    detail: { roadmapId, quarterId, goalId, status },
    bubbles: true,
  });
  document.dispatchEvent(event);
}

/** Initialize create roadmap modal - Issue #6 */
function initCreateRoadmapModal() {
  const createBtn = document.getElementById('create-roadmap-btn');
  const modal = document.getElementById('create-roadmap-modal');
  const closeBtn = document.getElementById('modal-close');
  const form = document.getElementById('create-roadmap-form');

  if (!createBtn || !modal) return;

  createBtn.addEventListener('click', () => {
    modal.classList.add('active');
    (modal.querySelector('input') as HTMLInputElement)?.focus();
  });

  closeBtn?.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);

    const roadmapData = {
      title: formData.get('title') as string,
      titleZh: formData.get('titleZh') as string,
      description: formData.get('description') as string,
      descriptionZh: formData.get('descriptionZh') as string,
      type: (formData.get('type') as Roadmap['type']) || 'personal',
      owner: formData.get('owner') as string || 'User',
      startDate: formData.get('startDate') as string || new Date().toISOString().split('T')[0],
      endDate: formData.get('endDate') as string || '2026-12-31',
      quarters: [],
      linked_ideas: [],
      linked_experiments: [],
      tags: (formData.get('tags') as string || '').split(',').map(t => t.trim()).filter(Boolean),
    };

    try {
      // Use client-side function
      const newRoadmap = createClientRoadmap(roadmapData);
      // Note: For SSR sites, client-created roadmaps won't persist across builds
      // They exist only in localStorage
      window.location.href = `/roadmap/${newRoadmap.id}/`;
    } catch (err) {
      console.error('[roadmap] Failed to create:', err);
      alert('创建失败，请重试');
    }
  });
}

/** Initialize goal edit modal - Issue #7 */
function initGoalEditModal() {
  document.querySelectorAll('.roadmap-goal').forEach(el => {
    el.addEventListener('dblclick', () => {
      const modal = document.getElementById('goal-edit-modal');
      if (!modal) return;

      const goalId = el.querySelector('.roadmap-goal-id')?.textContent;
      const goalTitle = el.querySelector('.roadmap-goal-title')?.textContent;
      const goalDesc = el.querySelector('.roadmap-goal-desc')?.textContent;
      const status = el.getAttribute('data-status');
      const priority = el.getAttribute('data-priority');

      const idInput = modal.querySelector('#edit-goal-id') as HTMLInputElement;
      const titleInput = modal.querySelector('#edit-goal-title') as HTMLInputElement;
      const descInput = modal.querySelector('#edit-goal-desc') as HTMLTextAreaElement;
      const statusSelect = modal.querySelector('#edit-goal-status') as HTMLSelectElement;
      const prioritySelect = modal.querySelector('#edit-goal-priority') as HTMLSelectElement;

      if (idInput) idInput.value = goalId || '';
      if (titleInput) titleInput.value = goalTitle || '';
      if (descInput) descInput.value = goalDesc || '';
      if (statusSelect && status) statusSelect.value = status;
      if (prioritySelect && priority) prioritySelect.value = priority;

      modal.classList.add('active');
    });
  });

  const modal = document.getElementById('goal-edit-modal');
  const closeBtn = document.getElementById('goal-modal-close');
  const form = document.getElementById('goal-edit-form');

  closeBtn?.addEventListener('click', () => modal?.classList.remove('active'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });
}

/** Initialize progress dashboard - Issue #25 */
function initProgressDashboard() {
  const dashboard = document.getElementById('roadmap-dashboard');
  if (!dashboard) return;

  // Calculate and display progress stats
  const totalGoals = dashboard.querySelectorAll('.roadmap-goal').length;
  const completedGoals = dashboard.querySelectorAll('.roadmap-goal[data-status="completed"]').length;
  const inProgressGoals = dashboard.querySelectorAll('.roadmap-goal[data-status="in-progress"]').length;
  const pendingGoals = dashboard.querySelectorAll('.roadmap-goal[data-status="pending"]').length;

  // Calculate experiment progress (iter3 feedback: completed=1.0, running=0.5, planning=0.1)
  const experimentProgress = calculateExperimentProgressFromStorage();

  // Combined progress: weight goals 70%, experiments 30%
  const goalProgress = totalGoals > 0 ? completedGoals / totalGoals : 0;
  const combinedProgress = (goalProgress * 0.7) + (experimentProgress * 0.3);

  const statsEl = dashboard.querySelector('.dashboard-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card">
        <span class="stat-value">${totalGoals}</span>
        <span class="stat-label">总目标</span>
      </div>
      <div class="stat-card completed">
        <span class="stat-value">${completedGoals}</span>
        <span class="stat-label">已完成</span>
      </div>
      <div class="stat-card in-progress">
        <span class="stat-value">${inProgressGoals}</span>
        <span class="stat-label">进行中</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${Math.round(experimentProgress * 100)}%</span>
        <span class="stat-label">实验进度</span>
      </div>
    `;
  }

  // Update progress bar with combined progress
  const progressFill = dashboard.querySelector('.dashboard-progress-fill') as HTMLElement;
  const progressText = dashboard.querySelector('.dashboard-progress-text');
  if (progressFill) {
    const percent = Math.round(combinedProgress * 100);
    progressFill.style.width = `${percent}%`;
    if (progressText) {
      progressText.textContent = `${percent}% (目标) + ${Math.round(experimentProgress * 100)}% (实验)`;
    }
  }
}

/** Calculate experiment progress from localStorage */
function calculateExperimentProgressFromStorage(): number {
  const EXPERIMENT_STATUS_WEIGHTS: Record<string, number> = {
    completed: 1.0,
    running: 0.5,
    planning: 0.1,
    failed: 0.0,
    paused: 0.0,
  };

  try {
    const stored = localStorage.getItem('dpr_experiments');
    if (!stored) return 0;

    const doc = JSON.parse(stored);
    const experiments = doc.experiments || {};
    const experimentIds = Object.keys(experiments);

    if (experimentIds.length === 0) return 0;

    let totalWeight = 0;
    for (const expId of experimentIds) {
      const exp = experiments[expId];
      if (exp && exp.status && EXPERIMENT_STATUS_WEIGHTS[exp.status] !== undefined) {
        totalWeight += EXPERIMENT_STATUS_WEIGHTS[exp.status];
      }
    }

    return totalWeight / experimentIds.length;
  } catch {
    return 0;
  }
}

/** Emit event when roadmap is updated (using CustomEvent) */
export function emitRoadmapUpdated(roadmapId: string) {
  const event = new CustomEvent('dpr:roadmap-updated', {
    detail: { roadmapId },
    bubbles: true,
  });
  document.dispatchEvent(event);
}

/** Subscribe to roadmap updates */
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

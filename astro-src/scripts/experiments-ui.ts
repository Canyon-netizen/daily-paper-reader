// astro-src/scripts/experiments-ui.ts
//
// Client interactions for experiments page.

import type { Experiment, ExperimentStatus } from '../lib/experiments/types';
import {
  getAllExperiments,
  getExperiment,
  createExperiment,
  updateExperiment,
  deleteExperiment,
  getExperimentCounts,
} from '../lib/experiments';

let currentFilter: ExperimentStatus | 'all' = 'all';
let lastStatusChange: { expId: string; oldStatus: ExperimentStatus; timeout: number } | null = null;

/** Initialize the experiments UI */
export function initExperimentsUI(): void {
  // Check for prefill from idea
  const urlParams = new URLSearchParams(window.location.search);
  const fromIdea = urlParams.get('from_idea');
  const titlePrefill = urlParams.get('title');
  const hypothesisPrefill = urlParams.get('hypothesis');

  renderExperimentGrid();
  setupFilterButtons();
  setupNewExperimentButton();
  setupModalHandlers();
  updateCounts();

  // If prefill from idea, open modal immediately
  if (fromIdea && titlePrefill) {
    openExperimentModal({
      title: titlePrefill,
      hypothesis: hypothesisPrefill || '',
      relatedIdeas: [fromIdea],
    });
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/** Render the experiment grid */
function renderExperimentGrid(): void {
  const container = document.getElementById('experiments-grid');
  if (!container) return;

  const experiments = currentFilter === 'all'
    ? getAllExperiments()
    : getAllExperiments().filter((e) => e.status === currentFilter);

  if (experiments.length === 0) {
    // Show sample data for new users
    const isFirstVisit = !localStorage.getItem('dpr_has_experiments');
    if (isFirstVisit && currentFilter === 'all') {
      container.innerHTML = `
        <div class="experiments-empty">
          <div class="experiments-empty-icon">🔬</div>
          <h3 class="experiments-empty-title">还没有实验</h3>
          <p class="experiments-empty-desc">
            点击右上角「+ 新建实验」开始设计你的第一个实验。
          </p>
          <div class="experiments-sample">
            <p class="exp-sample-label">示例实验:</p>
            <div class="exp-card">
              <div class="exp-card-header">
                <h2 class="exp-title">探索 Transformer 的高效注意力机制</h2>
                <span class="exp-status exp-status--planning">规划中</span>
              </div>
              <p class="exp-title-zh">消融实验:不同稀疏注意力模式的性能对比</p>
              <p class="exp-hypothesis">研究如何通过稀疏注意力或线性注意力降低 O(n²) 计算复杂度...</p>
              <div class="exp-tags">
                <span class="exp-tag">architecture</span>
                <span class="exp-tag">efficiency</span>
              </div>
            </div>
            <p class="exp-sample-hint">这是示例，点击「+ 新建实验」创建你自己的</p>
          </div>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div class="experiments-empty">
        <div class="experiments-empty-icon">🔬</div>
        <h3 class="experiments-empty-title">还没有实验</h3>
        <p class="experiments-empty-desc">
          点击右上角「+ 新建实验」开始设计你的第一个实验。
        </p>
      </div>
    `;
    return;
  }

  // Mark that user has created at least one experiment
  localStorage.setItem('dpr_has_experiments', 'true');

  container.innerHTML = experiments.map((exp) => renderExperimentCard(exp)).join('');

  // Attach event listeners to cards
  container.querySelectorAll<HTMLElement>('.exp-card').forEach((card) => {
    const id = card.dataset.expId;
    if (!id) return;

    // Status change buttons
    card.querySelectorAll<HTMLButtonElement>('.btn-status').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const newStatus = btn.dataset.status as ExperimentStatus;
        if (newStatus) {
          const exp = getExperiment(id);
          if (exp) {
            // Store for undo
            if (lastStatusChange) {
              clearTimeout(lastStatusChange.timeout);
            }
            lastStatusChange = {
              expId: id,
              oldStatus: exp.status,
              timeout: window.setTimeout(() => {
                lastStatusChange = null;
              }, 5000),
            };
            updateExperiment(id, { status: newStatus });
            showUndoToast(exp.title, exp.status, newStatus);
          }
          renderExperimentGrid();
          updateCounts();
        }
      });
    });

    // Delete button
    card.querySelector<HTMLButtonElement>('.btn-delete')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('确定要删除这个实验吗?')) {
        deleteExperiment(id);
        renderExperimentGrid();
        updateCounts();
      }
    });
  });
}

/** Render a single experiment card */
function renderExperimentCard(exp: Experiment): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const statusLabels: Record<ExperimentStatus, string> = {
    planning: '规划中',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    paused: '暂停',
  };
  const date = new Date(exp.updatedAt).toLocaleDateString('zh-CN');

  const tagsHtml = exp.tags.length > 0
    ? `<div class="exp-tags">
        ${exp.tags.slice(0, 4).map((t) => `<span class="exp-tag">${escapeHtml(t)}</span>`).join('')}
       </div>`
    : '';

  return `
    <a href="${base}/experiments/${exp.id}/" class="exp-card" data-exp-id="${exp.id}">
      <div class="exp-card-header">
        <h2 class="exp-title">${escapeHtml(exp.title)}</h2>
        <span class="exp-status exp-status--${exp.status}">
          ${statusLabels[exp.status]}
        </span>
      </div>
      <p class="exp-title-zh">${escapeHtml(exp.titleZh)}</p>
      <p class="exp-hypothesis">${escapeHtml(truncate(exp.hypothesis, 100))}</p>
      ${tagsHtml}
      <div class="exp-meta">
        <span>📄 ${exp.relatedPapers.length} 篇相关论文</span>
        <span>${date}</span>
      </div>
      <div class="exp-card-actions">
        ${exp.status !== 'running' ? `<button type="button" class="btn-status" data-status="running" title="开始实验">▶️</button>` : ''}
        ${exp.status !== 'completed' ? `<button type="button" class="btn-status" data-status="completed" title="标记完成">✅</button>` : ''}
        ${exp.status !== 'paused' ? `<button type="button" class="btn-status" data-status="paused" title="暂停">⏸️</button>` : ''}
        ${exp.status !== 'failed' ? `<button type="button" class="btn-status" data-status="failed" title="标记失败">❌</button>` : ''}
        <button type="button" class="btn-delete" title="删除">🗑️</button>
      </div>
    </a>
  `;
}

/** Setup filter button handlers */
function setupFilterButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-exp-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.expFilter as ExperimentStatus | 'all';
      document.querySelectorAll('[data-exp-filter]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderExperimentGrid();
    });
  });
}

/** Setup new experiment button */
function setupNewExperimentButton(): void {
  document.querySelector<HTMLButtonElement>('[data-open-new-experiment]')?.addEventListener('click', () => {
    openExperimentModal();
  });
}

/** Setup modal handlers */
function setupModalHandlers(): void {
  const modal = document.getElementById('experiment-modal');
  const closeBtn = modal?.querySelector('.modal-close');
  const cancelBtn = modal?.querySelector('.modal-cancel');
  const form = modal?.querySelector<HTMLFormElement>('#experiment-form');

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const title = formData.get('title') as string;
    const titleZh = formData.get('titleZh') as string;
    const hypothesis = formData.get('hypothesis') as string;
    const hypothesisZh = formData.get('hypothesisZh') as string;
    const method = formData.get('method') as string;
    const methodZh = formData.get('methodZh') as string;
    const expectedResults = formData.get('expectedResults') as string;
    const expectedResultsZh = formData.get('expectedResultsZh') as string;
    const tagsStr = formData.get('tags') as string;
    const papersStr = formData.get('relatedPapers') as string;
    const relatedIdeasStr = formData.get('relatedIdeas') as string;

    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const relatedPapers = papersStr
      ? papersStr.split(',').map((p) => p.trim().replace(/^(\d+\.\d+v?\d*).*$/, '$1')).filter(Boolean)
      : [];
    const relatedIdeas = relatedIdeasStr
      ? relatedIdeasStr.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    const newExp = createExperiment(title, hypothesis, method, titleZh, hypothesisZh, methodZh);
    updateExperiment(newExp.id, {
      expectedResults,
      expectedResultsZh,
      tags,
      relatedPapers,
      relatedIdeas,
    });

    closeModal();
    renderExperimentGrid();
    updateCounts();
  });
}

/** Open the experiment modal */
function openExperimentModal(prefill?: {
  title?: string;
  hypothesis?: string;
  relatedIdeas?: string[];
}): void {
  const modal = document.getElementById('experiment-modal');
  const form = document.getElementById('experiment-form') as HTMLFormElement;
  if (modal && form) {
    form.reset();
    if (prefill) {
      const titleInput = form.querySelector('input[name="title"]') as HTMLInputElement;
      const hypothesisInput = form.querySelector('textarea[name="hypothesis"]') as HTMLTextAreaElement;
      const relatedIdeasInput = form.querySelector('input[name="relatedIdeas"]') as HTMLInputElement;
      if (prefill.title) titleInput.value = prefill.title;
      if (prefill.hypothesis) hypothesisInput.value = prefill.hypothesis;
      if (prefill.relatedIdeas?.length) relatedIdeasInput.value = prefill.relatedIdeas.join(', ');
    }
    modal.classList.add('active');
    (form.querySelector('input[name="title"]') as HTMLInputElement)?.focus();
  }
}

/** Close the experiment modal */
function closeModal(): void {
  document.getElementById('experiment-modal')?.classList.remove('active');
}

/** Update the counts display */
function updateCounts(): void {
  const counts = getExperimentCounts();
  const counter = document.querySelector('[data-exp-count]');
  if (counter) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    counter.textContent = `${total} 个实验`;
  }

  // Update filter counts
  const allBtn = document.querySelector('[data-exp-filter="all"]');
  const planningBtn = document.querySelector('[data-exp-filter="planning"]');
  const runningBtn = document.querySelector('[data-exp-filter="running"]');
  const completedBtn = document.querySelector('[data-exp-filter="completed"]');
  const failedBtn = document.querySelector('[data-exp-filter="failed"]');
  const pausedBtn = document.querySelector('[data-exp-filter="paused"]');

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (allBtn) allBtn.textContent = `全部 ${total}`;
  if (planningBtn) planningBtn.textContent = `规划中 ${counts.planning}`;
  if (runningBtn) runningBtn.textContent = `进行中 ${counts.running}`;
  if (completedBtn) completedBtn.textContent = `已完成 ${counts.completed}`;
  if (failedBtn) failedBtn.textContent = `失败 ${counts.failed}`;
  if (pausedBtn) pausedBtn.textContent = `暂停 ${counts.paused}`;
}

/** Utility: escape HTML */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Utility: truncate text */
function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/** Show undo toast after status change */
function showUndoToast(title: string, oldStatus: string, newStatus: string): void {
  const existing = document.querySelector('.undo-toast');
  if (existing) existing.remove();

  const statusLabels: Record<string, string> = {
    planning: '规划中',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    paused: '暂停',
  };

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `
    <span>状态已改为 <strong>${statusLabels[newStatus] || newStatus}</strong></span>
    <button type="button" class="undo-btn">撤销</button>
  `;

  const undoBtn = toast.querySelector('.undo-btn');
  undoBtn?.addEventListener('click', () => {
    if (lastStatusChange) {
      updateExperiment(lastStatusChange.expId, { status: lastStatusChange.oldStatus });
      clearTimeout(lastStatusChange.timeout);
      lastStatusChange = null;
      renderExperimentGrid();
      updateCounts();
    }
    toast.remove();
  });

  document.body.appendChild(toast);

  // Auto-remove after timeout
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
    lastStatusChange = null;
  }, 5000);
}

/** Open experiment modal with prefill (for "Create from Idea") */
export function openExperimentModalWithPrefill(title: string, hypothesis: string, ideaId: string): void {
  openExperimentModal({
    title,
    hypothesis,
    relatedIdeas: [ideaId],
  });
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initExperimentsUI);
}

// Export for external use
export { updateCounts };

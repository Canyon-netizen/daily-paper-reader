// astro-src/scripts/experiments-ui.ts
//
// Client interactions for experiments page.

import type { Experiment, ExperimentStatus } from '../lib/experiments/types';
import { experimentTemplates, getExperimentTemplate } from '../lib/experiments/templates';
import {
  getAllExperiments,
  getExperiment,
  createExperiment,
  updateExperiment,
  deleteExperiment,
  getExperimentCounts,
} from '../lib/experiments';
import { getIdea } from '../lib/ideas';

let currentFilter: ExperimentStatus | 'all' = 'all';
let lastStatusChange: { expId: string; oldStatus: ExperimentStatus; timeout: number } | null = null;

/** Initialize the experiments UI */
export function initExperimentsUI(): void {
  // Check for prefill from idea
  const urlParams = new URLSearchParams(window.location.search);

  // New parameter names (preferred)
  const prefillIdeaId = urlParams.get('prefill_idea_id');
  const prefillTitle = urlParams.get('prefill_title');
  const prefillHypothesis = urlParams.get('prefill_hypothesis');
  const prefillPapers = urlParams.get('prefill_papers');
  const prefillMethod = urlParams.get('prefill_method');

  // Old parameter names (backward compatibility)
  const fromIdea = urlParams.get('from_idea') || prefillIdeaId;
  const titlePrefill = urlParams.get('title') || prefillTitle;
  const hypothesisPrefill = urlParams.get('hypothesis') || prefillHypothesis;

  // Parse related papers
  const relatedPapers = prefillPapers
    ? prefillPapers.split(',').map(p => p.trim()).filter(Boolean)
    : [];

  renderExperimentGrid();
  setupFilterButtons();
  setupNewExperimentButton();
  setupModalHandlers();
  setupVariableHandlers();
  setupTemplateSelector();
  updateCounts();

  // If prefill from idea, open modal immediately
  if (fromIdea && titlePrefill) {
    openExperimentModal({
      title: titlePrefill,
      hypothesis: hypothesisPrefill || '',
      method: prefillMethod,
      relatedPapers,
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
          点击右上角「+ 新建实验」开始设计你的第一个实验，或从想法页面点「创建实验」快速派生。
        </p>
        <button type="button" class="btn btn-primary btn-sm" data-open-new-experiment>➕ 新建实验</button>
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

    // Remove idea association button
    card.querySelector<HTMLButtonElement>('[data-remove-idea]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ideaIdToRemove = (e.target as HTMLElement).dataset.removeIdea;
      if (ideaIdToRemove && confirm('解除与该想法的关联？')) {
        const exp = getExperiment(id);
        if (exp && exp.relatedIdeas) {
          const newRelatedIdeas = exp.relatedIdeas.filter(i => i !== ideaIdToRemove);
          updateExperiment(id, { relatedIdeas: newRelatedIdeas });
          renderExperimentGrid();
        }
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

  // Derived from idea badge
  let derivedBadgeHtml = '';
  if (exp.relatedIdeas && exp.relatedIdeas.length > 0) {
    const ideaId = exp.relatedIdeas[0];
    const idea = getIdea(ideaId);
    if (idea) {
      derivedBadgeHtml = `
        <a href="${base}/ideas/${ideaId}/" class="exp-derived-badge" title="查看源想法">
          💡 来自: ${escapeHtml(truncate(idea.title, 30))}
        </a>`;
    } else {
      derivedBadgeHtml = `
        <span class="exp-derived-badge exp-derived-badge--deleted">
          💡 想法已删除
          <button type="button" class="exp-derived-badge__remove" data-remove-idea="${ideaId}" title="解除关联">×</button>
        </span>`;
    }
  }

  return `
    <a href="${base}/experiments/${exp.id}/" class="exp-card" data-exp-id="${exp.id}">
      <div class="exp-card-header">
        <h2 class="exp-title">${escapeHtml(exp.title)}</h2>
        <span class="exp-status exp-status--${exp.status}">
          ${statusLabels[exp.status]}
        </span>
      </div>
      ${derivedBadgeHtml ? `<div class="exp-derived">${derivedBadgeHtml}</div>` : ''}
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

    // Extract variables from form
    const variables: Experiment['variables'] = [];
    const container = document.getElementById('exp-variables-container');
    if (container) {
      Array.from(container.children).forEach((el) => {
        const varNameInput = el.querySelector('[name^="var_name_"]') as HTMLInputElement;
        const varTypeSelect = el.querySelector('[name^="var_type_"]') as HTMLSelectElement;
        const varDescInput = el.querySelector('[name^="var_desc_"]') as HTMLInputElement;
        const varValuesInput = el.querySelector('[name^="var_values_"]') as HTMLInputElement;

        if (varNameInput?.value) {
          variables.push({
            name: varNameInput.value,
            type: (varTypeSelect?.value as 'independent' | 'dependent' | 'controlled') || 'independent',
            description: varDescInput?.value || '',
            values: varValuesInput?.value ? varValuesInput.value.split(',').map(v => v.trim()).filter(Boolean) : undefined,
          });
        }
      });
    }

    const newExp = createExperiment(title, hypothesis, method, titleZh, hypothesisZh, methodZh);
    updateExperiment(newExp.id, {
      expectedResults,
      expectedResultsZh,
      tags,
      relatedPapers,
      relatedIdeas,
      variables,
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
  method?: string;
  relatedPapers?: string[];
  relatedIdeas?: string[];
}): void {
  const modal = document.getElementById('experiment-modal');
  const form = document.getElementById('experiment-form') as HTMLFormElement;
  if (modal && form) {
    form.reset();
    // Clear any existing variables
    const variablesContainer = document.getElementById('exp-variables-container');
    if (variablesContainer) variablesContainer.innerHTML = '';

    if (prefill) {
      const titleInput = form.querySelector('input[name="title"]') as HTMLInputElement;
      const hypothesisInput = form.querySelector('textarea[name="hypothesis"]') as HTMLTextAreaElement;
      const methodInput = form.querySelector('textarea[name="method"]') as HTMLTextAreaElement;
      const relatedIdeasInput = form.querySelector('input[name="relatedIdeas"]') as HTMLInputElement;
      const relatedPapersInput = form.querySelector('input[name="relatedPapers"]') as HTMLInputElement;

      if (prefill.title) titleInput.value = prefill.title;
      if (prefill.hypothesis) hypothesisInput.value = prefill.hypothesis;
      if (prefill.method) methodInput.value = prefill.method;
      if (prefill.relatedIdeas?.length) relatedIdeasInput.value = prefill.relatedIdeas.join(', ');
      if (prefill.relatedPapers?.length) relatedPapersInput.value = prefill.relatedPapers.join(', ');
    }
    modal.classList.add('active');
    (form.querySelector('input[name="title"]') as HTMLInputElement)?.focus();
  }
}

/** Handle template selection */
function setupTemplateSelector(): void {
  const templateSelect = document.getElementById('exp-template') as HTMLSelectElement;
  if (!templateSelect) return;

  templateSelect.addEventListener('change', () => {
    const templateId = templateSelect.value;
    if (!templateId) return;

    const template = getExperimentTemplate(templateId);
    if (!template) return;

    // Fill form with template values
    const form = document.getElementById('experiment-form') as HTMLFormElement;
    if (!form) return;

    (form.querySelector('input[name="title"]') as HTMLInputElement).value = template.title;
    (form.querySelector('input[name="titleZh"]') as HTMLInputElement).value = template.titleZh;
    (form.querySelector('textarea[name="hypothesis"]') as HTMLTextAreaElement).value = template.hypothesis;
    (form.querySelector('textarea[name="hypothesisZh"]') as HTMLTextAreaElement).value = template.hypothesisZh;
    (form.querySelector('textarea[name="method"]') as HTMLTextAreaElement).value = template.method;
    (form.querySelector('textarea[name="methodZh"]') as HTMLTextAreaElement).value = template.methodZh;
    (form.querySelector('textarea[name="expectedResults"]') as HTMLTextAreaElement).value = template.expectedResults;
    (form.querySelector('textarea[name="expectedResultsZh"]') as HTMLTextAreaElement).value = template.expectedResultsZh;
    (form.querySelector('input[name="tags"]') as HTMLInputElement).value = template.tags.join(', ');

    // Add variables from template
    const variablesContainer = document.getElementById('exp-variables-container');
    if (variablesContainer) {
      variablesContainer.innerHTML = '';
      template.variables.forEach((v, idx) => {
        const varEl = document.createElement('div');
        varEl.className = 'exp-variable-row';
        varEl.dataset.varIndex = String(idx);
        varEl.innerHTML = `
          <div class="exp-variable-fields">
            <input type="text" name="var_name_${idx}" placeholder="变量名" class="var-name-input" value="${escapeHtml(v.name)}" required />
            <select name="var_type_${idx}" class="var-type-select">
              <option value="independent" ${v.type === 'independent' ? 'selected' : ''}>自变量</option>
              <option value="dependent" ${v.type === 'dependent' ? 'selected' : ''}>因变量</option>
              <option value="controlled" ${v.type === 'controlled' ? 'selected' : ''}>控制变量</option>
            </select>
            <input type="text" name="var_desc_${idx}" placeholder="描述" class="var-desc-input" value="${escapeHtml(v.description)}" />
            <input type="text" name="var_values_${idx}" placeholder="取值 (逗号分隔)" class="var-values-input" value="${v.values ? v.values.join(', ') : ''}" />
            <button type="button" class="btn-remove-var" title="删除变量">×</button>
          </div>
        `;
        variablesContainer.appendChild(varEl);

        // Add remove handler
        varEl.querySelector('.btn-remove-var')?.addEventListener('click', () => {
          varEl.remove();
          reindexVariables();
        });
      });
    }
  });
}

/** Escape HTML helper */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/** Setup variable add/remove handlers */
function setupVariableHandlers(): void {
  const addBtn = document.getElementById('add-variable-btn');
  const container = document.getElementById('exp-variables-container');

  addBtn?.addEventListener('click', () => {
    if (!container) return;
    const varIndex = container.children.length;
    const varEl = document.createElement('div');
    varEl.className = 'exp-variable-row';
    varEl.dataset.varIndex = String(varIndex);
    varEl.innerHTML = `
      <div class="exp-variable-fields">
        <input type="text" name="var_name_${varIndex}" placeholder="变量名" class="var-name-input" required />
        <select name="var_type_${varIndex}" class="var-type-select">
          <option value="independent">自变量</option>
          <option value="dependent">因变量</option>
          <option value="controlled">控制变量</option>
        </select>
        <input type="text" name="var_desc_${varIndex}" placeholder="描述" class="var-desc-input" />
        <input type="text" name="var_values_${varIndex}" placeholder="取值 (逗号分隔)" class="var-values-input" />
        <button type="button" class="btn-remove-var" title="删除变量">×</button>
      </div>
    `;
    container.appendChild(varEl);

    // Remove button handler
    varEl.querySelector('.btn-remove-var')?.addEventListener('click', () => {
      varEl.remove();
      reindexVariables();
    });
  });
}

/** Reindex variable field names after deletion */
function reindexVariables(): void {
  const container = document.getElementById('exp-variables-container');
  if (!container) return;
  Array.from(container.children).forEach((el, idx) => {
    el.dataset.varIndex = String(idx);
    const inputs = el.querySelectorAll('input, select');
    inputs.forEach((input) => {
      const name = input.getAttribute('name') || '';
      const field = name.replace(/_\d+$/, '');
      input.setAttribute('name', `${field}_${idx}`);
    });
  });
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
export function openExperimentModalWithPrefill(
  title: string,
  hypothesis: string,
  ideaId: string,
  relatedPapers?: string[]
): void {
  openExperimentModal({
    title,
    hypothesis,
    relatedPapers,
    relatedIdeas: [ideaId],
  });
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initExperimentsUI);
}

// Export for external use
export { updateCounts };

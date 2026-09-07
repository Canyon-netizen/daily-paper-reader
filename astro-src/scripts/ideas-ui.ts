// astro-src/scripts/ideas-ui.ts
// Client-side interactions for Ideas module

import type { Idea, IdeaStatus } from '../lib/ideas/types';
import {
  listIdeas,
  getIdea,
  createIdea,
  updateIdea,
  deleteIdea,
  getIdeaCounts,
} from '../lib/ideas';

let currentFilter: IdeaStatus | 'all' = 'all';
let lastStatusChange: { ideaId: string; oldStatus: IdeaStatus; timeout: number } | null = null;

/** Initialize the Ideas UI */
export function initIdeasUI(): void {
  renderIdeaGrid();
  setupFilterButtons();
  setupNewIdeaButton();
  setupModalHandlers();
}

/** Render the idea grid */
function renderIdeaGrid(): void {
  const container = document.getElementById('ideas-grid');
  if (!container) return;

  const ideas = currentFilter === 'all'
    ? listIdeas()
    : listIdeas().filter((i) => i.status === currentFilter);

  if (ideas.length === 0) {
    // Show sample data for new users
    const isFirstVisit = !localStorage.getItem('dpr_has_ideas');
    if (isFirstVisit && currentFilter === 'all') {
      container.innerHTML = `
        <div class="ideas-empty">
          <div class="ideas-empty-icon">💡</div>
          <h3 class="ideas-empty-title">还没有想法</h3>
          <p class="ideas-empty-desc">
            点击右上角「+ 新建想法」开始记录你的研究 idea。
          </p>
          <div class="ideas-sample">
            <p class="ideas-sample-label">示例想法:</p>
            <div class="idea-card idea-card--draft">
              <div class="idea-card-header">
                <span class="idea-status-icon">📝</span>
                <span class="idea-status-label">草稿</span>
              </div>
              <h3 class="idea-title">探索 Transformer 的高效注意力机制</h3>
              <p class="idea-description">研究如何通过稀疏注意力或线性注意力降低 O(n²) 计算复杂度，在长文档场景下提升推理效率...</p>
              <div class="idea-tags">
                <span class="idea-tag">architecture</span>
                <span class="idea-tag">efficiency</span>
              </div>
            </div>
            <p class="ideas-sample-hint">这是示例，点击「+ 新建想法」创建你自己的</p>
          </div>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div class="ideas-empty">
        <div class="ideas-empty-icon">💡</div>
        <h3 class="ideas-empty-title">还没有想法</h3>
        <p class="ideas-empty-desc">
          点击右上角「+ 新建想法」开始记录你的研究 idea。
        </p>
      </div>
    `;
    return;
  }

  // Mark that user has created at least one idea
  localStorage.setItem('dpr_has_ideas', 'true');

  container.innerHTML = ideas.map((idea) => renderIdeaCard(idea)).join('');

  // Attach event listeners to cards
  container.querySelectorAll<HTMLElement>('.idea-card').forEach((card) => {
    const id = card.dataset.ideaId;
    if (!id) return;

    // Status change buttons
    card.querySelectorAll<HTMLButtonElement>('.btn-status').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const newStatus = btn.dataset.status as IdeaStatus;
        if (newStatus) {
          const idea = getIdea(id);
          if (idea) {
            // Store for undo
            if (lastStatusChange) {
              clearTimeout(lastStatusChange.timeout);
            }
            lastStatusChange = {
              ideaId: id,
              oldStatus: idea.status,
              timeout: window.setTimeout(() => {
                lastStatusChange = null;
              }, 5000),
            };
            updateIdea(id, { status: newStatus });
            showUndoToast(idea.title, idea.status, newStatus);
          }
          renderIdeaGrid();
          updateCounts();
        }
      });
    });

    // Delete button
    card.querySelector<HTMLButtonElement>('.btn-delete')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('确定要删除这个想法吗?')) {
        deleteIdea(id);
        renderIdeaGrid();
        updateCounts();
      }
    });
  });
}

/** Render a single idea card */
function renderIdeaCard(idea: Idea): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const statusIcons: Record<IdeaStatus, string> = {
    draft: '📝',
    active: '🚀',
    promoted: '⭐',
    archived: '📦',
  };
  const statusLabels: Record<IdeaStatus, string> = {
    draft: '草稿',
    active: '进行中',
    promoted: '已推荐',
    archived: '已归档',
  };
  const date = new Date(idea.updatedAt).toLocaleDateString('zh-CN');

  const papersHtml = idea.relatedPapers.length > 0
    ? `<div class="idea-papers">
        <span class="idea-papers-label">📄 关联论文:</span>
        ${idea.relatedPapers.map((pid) => `
          <a href="${base}/papers/${pid}/" class="idea-paper-badge" target="_blank">${pid}</a>
        `).join('')}
       </div>`
    : '';

  const tagsHtml = idea.tags.length > 0
    ? `<div class="idea-tags">
        ${idea.tags.map((t) => `<span class="idea-tag">${t}</span>`).join('')}
       </div>`
    : '';

  return `
    <a href="${base}/ideas/${idea.id}/" class="idea-card idea-card--${idea.status}" data-idea-id="${idea.id}">
      <div class="idea-card-header">
        <span class="idea-status-icon">${statusIcons[idea.status]}</span>
        <span class="idea-status-label">${statusLabels[idea.status]}</span>
        <span class="idea-date">${date}</span>
      </div>
      <h3 class="idea-title">${escapeHtml(idea.title)}</h3>
      <p class="idea-description">${escapeHtml(truncate(idea.description, 120))}</p>
      ${papersHtml}
      ${tagsHtml}
      <div class="idea-card-actions">
        ${idea.status !== 'active' ? `<button type="button" class="btn-status" data-status="active" title="标记进行中">🚀</button>` : ''}
        ${idea.status !== 'promoted' ? `<button type="button" class="btn-status" data-status="promoted" title="标记推荐">⭐</button>` : ''}
        ${idea.status !== 'archived' ? `<button type="button" class="btn-status" data-status="archived" title="标记归档">📦</button>` : ''}
        <button type="button" class="btn-delete" title="删除">🗑️</button>
      </div>
    </a>
  `;
}

/** Setup filter button handlers */
function setupFilterButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-idea-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.ideaFilter as IdeaStatus | 'all';
      document.querySelectorAll('[data-idea-filter]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderIdeaGrid();
    });
  });
}

/** Setup new idea button */
function setupNewIdeaButton(): void {
  document.querySelector<HTMLButtonElement>('[data-open-new-idea]')?.addEventListener('click', () => {
    openIdeaModal();
  });

  // Check for prefill data from URL params (e.g., from paper detail page)
  const urlParams = new URLSearchParams(window.location.search);
  const prefillTitle = urlParams.get('prefill_title');
  const prefillPapers = urlParams.get('prefill_papers');

  if (prefillTitle || prefillPapers) {
    // Auto-open the modal with prefill data
    setTimeout(() => {
      openIdeaModal(prefillTitle || '', prefillPapers || '');
      // Clear URL params to avoid re-opening on refresh
      window.history.replaceState({}, '', window.location.pathname);
    }, 100);
  }
}

/** Setup modal handlers */
function setupModalHandlers(): void {
  const modal = document.getElementById('idea-modal');
  const closeBtn = modal?.querySelector('.modal-close');
  const cancelBtn = modal?.querySelector('.modal-cancel');
  const form = modal?.querySelector<HTMLFormElement>('#idea-form');

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const tagsStr = formData.get('tags') as string;
    const papersStr = formData.get('relatedPapers') as string;

    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const relatedPapers = papersStr
      ? papersStr.split(',').map((p) => p.trim().replace(/^(\d+\.\d+v?\d*).*$/, '$1')).filter(Boolean)
      : [];

    createIdea(title, description, relatedPapers, tags);
    closeModal();
    renderIdeaGrid();
    updateCounts();
  });
}

/** Open the idea modal */
function openIdeaModal(prefillTitle: string = '', prefillPapers: string = ''): void {
  const modal = document.getElementById('idea-modal');
  const form = document.getElementById('idea-form') as HTMLFormElement;
  if (modal && form) {
    form.reset();
    // Pre-fill form fields if data provided
    if (prefillTitle) {
      const titleInput = form.querySelector('#idea-title') as HTMLInputElement;
      if (titleInput) titleInput.value = prefillTitle;
    }
    if (prefillPapers) {
      const papersInput = form.querySelector('#idea-related-papers') as HTMLInputElement;
      if (papersInput) papersInput.value = prefillPapers;
    }
    modal.classList.add('active');
    (form.querySelector('input[name="title"]') as HTMLInputElement)?.focus();
  }
}

/** Close the idea modal */
function closeModal(): void {
  document.getElementById('idea-modal')?.classList.remove('active');
}

/** Update the counts display */
function updateCounts(): void {
  const counts = getIdeaCounts();
  const counter = document.querySelector('[data-idea-count]');
  if (counter) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    counter.textContent = `${total} 个想法`;
  }

  // Update filter counts
  const allBtn = document.querySelector('[data-idea-filter="all"]');
  const draftBtn = document.querySelector('[data-idea-filter="draft"]');
  const activeBtn = document.querySelector('[data-idea-filter="active"]');
  const promotedBtn = document.querySelector('[data-idea-filter="promoted"]');
  const archivedBtn = document.querySelector('[data-idea-filter="archived"]');

  if (allBtn) allBtn.textContent = `全部 ${Object.values(counts).reduce((a, b) => a + b, 0)}`;
  if (draftBtn) draftBtn.textContent = `草稿 ${counts.draft}`;
  if (activeBtn) activeBtn.textContent = `进行中 ${counts.active}`;
  if (promotedBtn) promotedBtn.textContent = `推荐 ${counts.promoted}`;
  if (archivedBtn) archivedBtn.textContent = `归档 ${counts.archived}`;
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

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `
    <span>状态已改为 <strong>${newStatus}</strong></span>
    <button type="button" class="undo-btn">撤销</button>
  `;

  const undoBtn = toast.querySelector('.undo-btn');
  undoBtn?.addEventListener('click', () => {
    if (lastStatusChange) {
      updateIdea(lastStatusChange.ideaId, { status: lastStatusChange.oldStatus });
      clearTimeout(lastStatusChange.timeout);
      lastStatusChange = null;
      renderIdeaGrid();
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

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initIdeasUI);
}

// Export for external use
export { updateCounts };

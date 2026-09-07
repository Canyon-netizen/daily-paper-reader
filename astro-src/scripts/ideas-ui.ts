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
          updateIdea(id, { status: newStatus });
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
function openIdeaModal(): void {
  const modal = document.getElementById('idea-modal');
  const form = document.getElementById('idea-form') as HTMLFormElement;
  if (modal && form) {
    form.reset();
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

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initIdeasUI);
}

// Export for external use
export { updateCounts };

// /scripts/writing-ui.ts — Writing module client-side interactions.
//
// Handles:
// - Loading/rendering writings from localStorage
// - Creating new writings
// - Editing sections
// - Managing citations
// - Status changes
// - Version history

import {
  loadWritings,
  createWriting,
  updateWriting,
  deleteWriting,
  getWriting,
  listWritings,
  addCitation,
  removeCitation,
} from '../lib/writing';
import type { Writing, WritingStatus, WritingType, WritingSection, PaperRef } from '../lib/writing/types';

// Status labels
const STATUS_LABELS: Record<WritingStatus, string> = {
  draft: '草稿',
  review: '审核中',
  final: '已完成',
};

const TYPE_LABELS: Record<WritingType, string> = {
  paper: '论文',
  section: '章节',
  note: '笔记',
  review: '综述',
  translation: '翻译',
};

// Current writing being edited
let currentWriting: Writing | null = null;

// Initialize the list page
function initListPage(): void {
  const grid = document.querySelector('.writing-grid');
  const emptyState = document.querySelector('[data-empty-state]');
  if (!grid || !emptyState) return;

  const writings = listWritings();

  if (writings.length === 0) {
    (grid as HTMLElement).style.display = 'none';
    (emptyState as HTMLElement).style.display = 'block';
    return;
  }

  (emptyState as HTMLElement).style.display = 'none';
  (grid as HTMLElement).style.display = 'grid';

  grid.innerHTML = writings.map(w => renderWritingCard(w)).join('');

  // Setup filter buttons
  setupFilters(writings);
}

// Render a writing card
function renderWritingCard(w: Writing): string {
  const updated = new Date(w.updatedAt).toLocaleDateString('zh-CN');
  const citationCount = w.citedPapers?.length || 0;
  const sectionCount = w.sections?.length || 0;

  return `
    <a class="writing-card" href="/writing/${w.id}/">
      <div class="writing-card-header">
        <h2 class="writing-card-title">${escapeHtml(w.title)}</h2>
        <span class="writing-card-type">${TYPE_LABELS[w.type]}</span>
      </div>
      <span class="writing-card-status ${w.status}">${STATUS_LABELS[w.status]}</span>
      ${w.abstract ? `<p class="writing-card-abstract">${escapeHtml(w.abstract)}</p>` : ''}
      <div class="writing-card-meta">
        <span>📝 ${sectionCount} 章节</span>
        <span class="writing-card-citations">📚 ${citationCount} 引用</span>
        <span>🕐 ${updated}</span>
        ${w.targetVenue ? `<span>🎯 ${escapeHtml(w.targetVenue)}</span>` : ''}
      </div>
    </a>
  `;
}

// Setup filter functionality
function setupFilters(writings: Writing[]): void {
  // Type filter
  const typeButtons = document.querySelectorAll('[data-type-filter] button');
  typeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      typeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterWritings(writings);
    });
  });

  // Status filter
  const statusButtons = document.querySelectorAll('[data-status-filter] button');
  statusButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      statusButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterWritings(writings);
    });
  });
}

// Filter writings based on active filters
function filterWritings(writings: Writing[]): void {
  const activeType = document.querySelector('[data-type-filter] button.active')?.getAttribute('data-type-value') || 'all';
  const activeStatus = document.querySelector('[data-status-filter] button.active')?.getAttribute('data-status-value') || 'all';

  const filtered = writings.filter(w => {
    const typeMatch = activeType === 'all' || w.type === activeType;
    const statusMatch = activeStatus === 'all' || w.status === activeStatus;
    return typeMatch && statusMatch;
  });

  const grid = document.querySelector('.writing-grid');
  const emptyState = document.querySelector('[data-empty-state]');
  if (!grid || !emptyState) return;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    (grid as HTMLElement).style.display = 'none';
    (emptyState as HTMLElement).style.display = 'block';
  } else {
    (emptyState as HTMLElement).style.display = 'none';
    (grid as HTMLElement).style.display = 'grid';
    grid.innerHTML = filtered.map(w => renderWritingCard(w)).join('');
  }
}

// Initialize the detail page
function initDetailPage(): void {
  const container = document.querySelector('[data-writing-id]');
  if (!container) return;

  const writingId = container.getAttribute('data-writing-id');
  if (!writingId) return;

  currentWriting = getWriting(writingId);
  if (!currentWriting) {
    // Redirect to list if not found
    window.location.href = '/writing/';
    return;
  }

  renderDetailPage();
}

// Render the detail page
function renderDetailPage(): void {
  if (!currentWriting) return;

  // Update header
  const titleEl = document.querySelector('[data-writing-title]');
  const typeEl = document.querySelector('[data-writing-type]');
  const statusEl = document.querySelector('[data-writing-status]');
  const venueEl = document.querySelector('[data-writing-venue]');
  const updatedEl = document.querySelector('[data-writing-updated]');
  const wordcountEl = document.querySelector('[data-writing-wordcount]');
  const abstractEl = document.querySelector('[data-writing-abstract]') as HTMLTextAreaElement;

  if (titleEl) titleEl.textContent = currentWriting.title;
  if (typeEl) typeEl.textContent = TYPE_LABELS[currentWriting.type];
  if (statusEl) {
    statusEl.textContent = STATUS_LABELS[currentWriting.status];
    statusEl.className = `writing-card-status ${currentWriting.status}`;
  }
  if (venueEl) venueEl.textContent = currentWriting.targetVenue ? `🎯 ${currentWriting.targetVenue}` : '';
  if (updatedEl) updatedEl.textContent = `🕐 ${new Date(currentWriting.updatedAt).toLocaleString('zh-CN')}`;
  if (wordcountEl) wordcountEl.textContent = `${currentWriting.wordCount || 0} 字`;
  if (abstractEl) abstractEl.value = currentWriting.abstract || '';

  // Render sections
  renderSections();

  // Render citations
  renderCitations();

  // Render versions
  renderVersions();
}

// Render sections
function renderSections(): void {
  const container = document.querySelector('[data-sections-container]');
  if (!container || !currentWriting) return;

  container.innerHTML = currentWriting.sections.map((section, idx) => `
    <div class="writing-section" data-section-id="${section.id}">
      <div class="writing-section-header">
        <h3 class="writing-section-title">${escapeHtml(section.title)}</h3>
        <span class="writing-section-toggle">${section.content ? '✓ 已填写' : '空'}</span>
      </div>
      <div class="writing-section-content">
        <textarea
          placeholder="在此输入 ${section.title} 内容..."
          data-section-content="${section.id}"
        >${escapeHtml(section.content)}</textarea>
      </div>
    </div>
  `).join('');

  // Setup section change listeners
  container.querySelectorAll<HTMLTextAreaElement>('[data-section-content]').forEach(textarea => {
    textarea.addEventListener('input', () => {
      const sectionId = textarea.getAttribute('data-section-content');
      if (!sectionId || !currentWriting) return;

      const section = currentWriting.sections.find(s => s.id === sectionId);
      if (section) {
        section.content = textarea.value;
      }
    });
  });
}

// Render citations
function renderCitations(): void {
  const container = document.querySelector('[data-citations-list]');
  if (!container || !currentWriting) return;

  const citations = currentWriting.citedPapers || [];

  if (citations.length === 0) {
    container.innerHTML = '<p class="muted" style="font-size: 0.9rem;">暂无引用论文</p>';
    return;
  }

  container.innerHTML = citations.map(c => `
    <div class="writing-citation" data-citation-arxiv="${c.arxivId}">
      <div class="writing-citation-info">
        <span class="writing-citation-arxiv">arXiv: ${escapeHtml(c.arxivId)}</span>
        ${c.context ? `<span class="writing-citation-context">${escapeHtml(c.context)}</span>` : ''}
      </div>
      <button type="button" class="writing-citation-remove" data-remove-citation="${c.arxivId}">移除</button>
    </div>
  `).join('');

  // Setup remove citation listeners
  container.querySelectorAll<HTMLButtonElement>('[data-remove-citation]').forEach(btn => {
    btn.addEventListener('click', () => {
      const arxivId = btn.getAttribute('data-remove-citation');
      if (!arxivId || !currentWriting) return;
      removeCitation(currentWriting.id, arxivId);
      currentWriting = getWriting(currentWriting.id);
      renderCitations();
    });
  });
}

// Render versions
function renderVersions(): void {
  const container = document.querySelector('[data-versions-list]');
  if (!container || !currentWriting) return;

  const versions = currentWriting.versions || [];

  if (versions.length === 0) {
    container.innerHTML = '<p class="muted" style="font-size: 0.9rem;">暂无版本历史</p>';
    return;
  }

  container.innerHTML = versions.map(v => `
    <div class="writing-version">
      <span class="writing-version-date">${new Date(v.savedAt).toLocaleString('zh-CN')}</span>
      <span>${countWords(v.content)} 字</span>
    </div>
  `).join('');
}

// Count words
function countWords(text: string): number {
  if (!text) return 0;
  const englishWords = text.match(/[a-zA-Z]+/g) || [];
  const chineseChars = text.match(/[一-龥]/g) || [];
  return englishWords.length + chineseChars.length;
}

// Setup modal functionality
function setupModal(): void {
  const modal = document.getElementById('new-writing-modal');
  const openBtn = document.querySelector('[data-open-new-writing]');
  const closeBtn = modal?.querySelector('[data-close-modal]');
  const createBtn = document.querySelector('[data-create-writing]');
  const titleInput = document.getElementById('new-writing-title') as HTMLInputElement;
  const typeSelect = document.getElementById('new-writing-type') as HTMLSelectElement;
  const venueInput = document.getElementById('new-writing-venue') as HTMLInputElement;

  if (!modal || !openBtn || !closeBtn || !createBtn) return;

  openBtn.addEventListener('click', () => {
    modal.classList.add('open');
    titleInput?.focus();
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
    }
  });

  createBtn.addEventListener('click', () => {
    const title = titleInput?.value.trim();
    const type = (typeSelect?.value || 'paper') as WritingType;
    const venue = venueInput?.value.trim();

    if (!title) {
      alert('请输入标题');
      return;
    }

    const writing = createWriting(title, type);
    if (venue) {
      updateWriting(writing.id, { targetVenue: venue });
    }

    // Reset form
    if (titleInput) titleInput.value = '';
    if (venueInput) venueInput.value = '';
    modal.classList.remove('open');

    // Redirect to detail page
    window.location.href = `/writing/${writing.id}/`;
  });
}

// Setup save functionality
function setupSave(): void {
  const saveBtn = document.querySelector('[data-save-writing]');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', () => {
    if (!currentWriting) return;

    // Get abstract
    const abstractEl = document.querySelector('[data-writing-abstract]') as HTMLTextAreaElement;
    if (abstractEl) {
      currentWriting.abstract = abstractEl.value;
    }

    // Get sections
    const sectionTexts = document.querySelectorAll<HTMLTextAreaElement>('[data-section-content]');
    sectionTexts.forEach(textarea => {
      const sectionId = textarea.getAttribute('data-section-content');
      if (!sectionId) return;
      const section = currentWriting!.sections.find(s => s.id === sectionId);
      if (section) {
        section.content = textarea.value;
      }
    });

    // Save
    updateWriting(currentWriting.id, {
      abstract: currentWriting.abstract,
      sections: currentWriting.sections,
    });

    // Update word count display
    const wordcountEl = document.querySelector('[data-writing-wordcount]');
    if (wordcountEl) {
      const totalWords = currentWriting.sections.reduce((sum, s) => sum + countWords(s.content), 0);
      wordcountEl.textContent = `${totalWords} 字`;
    }

    // Show saved feedback
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '✓ 已保存';
    setTimeout(() => {
      saveBtn.textContent = originalText;
    }, 1500);
  });
}

// Setup status change
function setupStatusChange(): void {
  const statusBtn = document.querySelector('[data-change-status]');
  if (!statusBtn || !currentWriting) return;

  statusBtn.addEventListener('click', () => {
    const statuses: WritingStatus[] = ['draft', 'review', 'final'];
    const currentIdx = statuses.indexOf(currentWriting!.status);
    const nextStatus = statuses[(currentIdx + 1) % statuses.length];

    updateWriting(currentWriting!.id, { status: nextStatus });
    currentWriting = getWriting(currentWriting!.id);
    renderDetailPage();
  });
}

// Setup delete
function setupDelete(): void {
  const deleteBtn = document.querySelector('[data-delete-writing]');
  if (!deleteBtn || !currentWriting) return;

  deleteBtn.addEventListener('click', () => {
    if (!confirm(`确定要删除「${currentWriting!.title}」吗？此操作不可恢复。`)) return;

    deleteWriting(currentWriting!.id);
    window.location.href = '/writing/';
  });
}

// Setup add citation
function setupAddCitation(): void {
  const addBtn = document.querySelector('[data-add-citation]');
  const arxivInput = document.getElementById('citation-arxiv-id') as HTMLInputElement;
  const contextInput = document.getElementById('citation-context') as HTMLInputElement;

  if (!addBtn || !arxivInput) return;

  addBtn.addEventListener('click', () => {
    if (!currentWriting) return;

    const arxivId = arxivInput.value.trim();
    if (!arxivId) {
      alert('请输入 arXiv ID');
      return;
    }

    // Normalize arxiv ID (remove version suffix)
    const normalizedId = arxivId.replace(/v\d+$/, '');
    const context = contextInput?.value.trim();

    addCitation(currentWriting.id, normalizedId, context);
    currentWriting = getWriting(currentWriting.id);
    renderCitations();

    // Clear inputs
    arxivInput.value = '';
    if (contextInput) contextInput.value = '';
  });
}

// Escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize based on page
function init(): void {
  // Check if we're on list or detail page
  const listContainer = document.querySelector('[data-writings-json]');
  const detailContainer = document.querySelector('[data-writing-id]');

  if (listContainer) {
    // List page
    initListPage();
    setupModal();
  } else if (detailContainer) {
    // Detail page
    initDetailPage();
    setupSave();
    setupStatusChange();
    setupDelete();
    setupAddCitation();
  }
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Listen for external changes
document.addEventListener('dpr:writing-change', () => {
  const listContainer = document.querySelector('[data-writings-json]');
  if (listContainer) {
    initListPage();
  }
});

export { initListPage, initDetailPage, renderDetailPage };

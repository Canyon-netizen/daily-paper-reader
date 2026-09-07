// /scripts/writing-ui.ts — Writing module client-side interactions.
//
// Handles:
// - Loading/rendering writings from localStorage
// - Creating new writings
// - Editing sections with markdown preview
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

// Check if marked is available (will be loaded from CDN)
declare const marked: any;
declare const katex: any;

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

    // Show sample data for new users
    const isFirstVisit = !localStorage.getItem('dpr_has_writings');
    if (isFirstVisit) {
      const container = document.querySelector('#all-writings');
      if (container) {
        container.insertAdjacentHTML('beforeend', `
          <div class="writing-sample" data-writing-sample>
            <p class="writing-sample-label">示例写作:</p>
            <div class="writing-card">
              <div class="writing-card-header">
                <h2 class="writing-card-title">Transformer 注意力机制综述</h2>
                <span class="writing-card-type">综述</span>
              </div>
              <span class="writing-card-status draft">草稿</span>
              <p class="writing-card-abstract">系统回顾自注意力机制在自然语言处理中的发展，从原始 Transformer 到现代变体...</p>
              <div class="writing-card-meta">
                <span>📝 8 章节</span>
                <span>📚 12 引用</span>
              </div>
            </div>
            <p class="writing-sample-hint">这是示例，点击「➕ 新建写作」创建你自己的</p>
          </div>
        `);
      }
    }
    return;
  }

  // Mark that user has created at least one writing
  localStorage.setItem('dpr_has_writings', 'true');

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

// Render sections with markdown preview support
function renderSections(): void {
  const container = document.querySelector('[data-sections-container]');
  if (!container || !currentWriting) return;

  // Word count guidance by section type
  const wordCountGuidance: Record<string, string> = {
    abstract: '200-300 字',
    introduction: '800-1500 字',
    method: '1000-2000 字',
    experiments: '1500-3000 字',
    results: '1000-2000 字',
    discussion: '800-1500 字',
    conclusion: '200-500 字',
    references: '按引用格式',
  };

  container.innerHTML = currentWriting.sections.map((section, idx) => {
    const mode = markdownPreviewMode[section.id] || 'edit';
    const wordCount = countWords(section.content);
    const guidance = wordCountGuidance[section.id] || '';
    const hasContent = section.content.length > 0;

    return `
      <div class="writing-section" data-section-id="${section.id}">
        <div class="writing-section-header">
          <h3 class="writing-section-title">${escapeHtml(section.title)}</h3>
          <div class="writing-section-actions">
            <span class="writing-section-wordcount">${wordCount} 字 ${guidance ? `· ${guidance}` : ''}</span>
            <button type="button" class="btn btn-ghost btn-xs section-mode-toggle" data-toggle-mode="${section.id}">
              ${mode === 'edit' ? '👁️ 预览' : '✏️ 编辑'}
            </button>
            <span class="writing-section-status">${hasContent ? '✓ 已填写' : '空'}</span>
          </div>
        </div>
        <div class="writing-section-content ${mode}">
          ${mode === 'edit' ? `
            <textarea
              placeholder="在此输入 ${section.title} 内容...（支持 Markdown 和 LaTeX，例：$x^2$ 或 $$E=mc^2$$）"
              data-section-content="${section.id}"
            >${escapeHtml(section.content)}</textarea>
          ` : `
            <div class="writing-section-preview markdown-body" data-section-preview="${section.id}">
              ${renderMarkdown(section.content) || '<p class="muted">无内容</p>'}
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  // Setup section change listeners
  container.querySelectorAll<HTMLTextAreaElement>('[data-section-content]').forEach(textarea => {
    textarea.addEventListener('input', () => {
      const sectionId = textarea.getAttribute('data-section-content');
      if (!sectionId || !currentWriting) return;

      const section = currentWriting.sections.find(s => s.id === sectionId);
      if (section) {
        section.content = textarea.value;
        // Update word count display
        const wordCountEl = container.querySelector(`[data-section-id="${sectionId}"] .writing-section-wordcount`);
        if (wordCountEl) {
          const wordCount = countWords(textarea.value);
          const guidance = wordCountGuidance[sectionId] || '';
          wordCountEl.textContent = `${wordCount} 字 ${guidance ? `· ${guidance}` : ''}`;
        }
      }
    });
  });

  // Setup mode toggle listeners
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.getAttribute('data-toggle-mode');
      if (sectionId) {
        toggleSectionMode(sectionId);
      }
    });
  });
}

// Render citations with paper titles
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
        <span class="writing-citation-arxiv"><a href="/papers/${c.arxivId}/" target="_blank">arXiv: ${escapeHtml(c.arxivId)}</a></span>
        <span class="writing-citation-title" data-citation-title="${c.arxivId}">加载中...</span>
        ${c.context ? `<span class="writing-citation-context">${escapeHtml(c.context)}</span>` : ''}
      </div>
      <button type="button" class="writing-citation-remove" data-remove-citation="${c.arxivId}">移除</button>
    </div>
  `).join('');

  // Load paper titles asynchronously
  citations.forEach(c => {
    loadPaperTitle(c.arxivId);
  });

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

// Load paper title from localStorage
const paperTitleCache: Record<string, string> = {};

async function loadPaperTitle(arxivId: string): Promise<void> {
  // Check cache first
  if (paperTitleCache[arxivId]) {
    updatePaperTitleElement(arxivId, paperTitleCache[arxivId]);
    return;
  }

  try {
    // Try to get from papers stored in localStorage (same as idea module)
    const stored = localStorage.getItem('dpr_papers_v1');
    if (stored) {
      const papers = JSON.parse(stored);
      const paper = papers[arxivId] || papers[arxivId.replace(/^arxiv:/, '')];
      if (paper?.title) {
        paperTitleCache[arxivId] = paper.title;
        updatePaperTitleElement(arxivId, paper.title);
        return;
      }
    }

    // If not found locally, try fetching from the papers API
    const response = await fetch(`/api/papers/${arxivId}`);
    if (response.ok) {
      const paper = await response.json();
      if (paper?.title) {
        paperTitleCache[arxivId] = paper.title;
        updatePaperTitleElement(arxivId, paper.title);
        return;
      }
    }

    // Not found
    updatePaperTitleElement(arxivId, '（论文未找到）');
  } catch {
    updatePaperTitleElement(arxivId, '（加载失败）');
  }
}

function updatePaperTitleElement(arxivId: string, title: string): void {
  const el = document.querySelector(`[data-citation-title="${arxivId}"]`);
  if (el) {
    el.textContent = title;
  }
}

// Setup citation picker
function setupCitationPicker(): void {
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

  // Add search button to open citation picker modal
  const searchBtn = document.querySelector('[data-open-citation-picker]');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      openCitationPickerModal();
    });
  }
}

// Citation picker modal
function openCitationPickerModal(): void {
  const modal = document.getElementById('citation-picker-modal');
  if (modal) {
    modal.classList.add('open');
    initCitationPickerSearch();
  }
}

function closeCitationPickerModal(): void {
  const modal = document.getElementById('citation-picker-modal');
  if (modal) {
    modal.classList.remove('open');
  }
}

// Setup modal close handlers
function setupModalCloseHandlers(): void {
  // Close citation picker on backdrop click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.matches('[data-close-modal]') || target.closest('[data-close-modal]')) {
      closeCitationPickerModal();
    }
    if (target.matches('[data-close-citation-picker]') || target.closest('[data-close-citation-picker]')) {
      closeCitationPickerModal();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCitationPickerModal();
    }
  });
}

async function initCitationPickerSearch(): Promise<void> {
  const searchInput = document.getElementById('citation-search-input') as HTMLInputElement;
  const resultsContainer = document.getElementById('citation-search-results');
  if (!searchInput || !resultsContainer) return;

  // Load papers from localStorage
  let papers: any[] = [];
  try {
    const stored = localStorage.getItem('dpr_papers_v1');
    if (stored) {
      papers = Object.values(JSON.parse(stored));
    }
  } catch { /* ignore */ }

  // Filter papers as user types
  const filterAndRender = async () => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
      resultsContainer.innerHTML = '<p class="muted">输入关键词搜索论文</p>';
      return;
    }

    const filtered = papers.filter(p =>
      p.title?.toLowerCase().includes(query) ||
      p.authors?.some((a: string) => a.toLowerCase().includes(query)) ||
      p.arxivId?.toLowerCase().includes(query)
    ).slice(0, 20);

    if (filtered.length === 0) {
      resultsContainer.innerHTML = '<p class="muted">未找到匹配的论文</p>';
      return;
    }

    resultsContainer.innerHTML = filtered.map(p => `
      <div class="citation-picker-result" data-select-citation="${p.arxivId}">
        <div class="citation-picker-result-title">${escapeHtml(p.title || '无标题')}</div>
        <div class="citation-picker-result-meta">arXiv: ${escapeHtml(p.arxivId || '')} · ${escapeHtml(p.authors?.slice(0, 3).join(', ') || '')}</div>
      </div>
    `).join('');

    // Add click handlers
    resultsContainer.querySelectorAll<HTMLElement>('[data-select-citation]').forEach(el => {
      el.addEventListener('click', () => {
        const arxivId = el.getAttribute('data-select-citation');
        if (arxivId && currentWriting) {
          addCitation(currentWriting.id, arxivId.replace(/v\d+$/, ''));
          currentWriting = getWriting(currentWriting.id);
          renderCitations();
          closeCitationPickerModal();
        }
      });
    });
  };

  searchInput.addEventListener('input', filterAndRender);
  // Initial state
  resultsContainer.innerHTML = '<p class="muted">输入关键词搜索论文</p>';
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

// Render markdown content with preview mode
let markdownPreviewMode: Record<string, 'edit' | 'preview'> = {};

function renderMarkdown(text: string): string {
  if (!text) return '';

  try {
    // First render LaTeX (inline and block)
    let rendered = text
      // Block math: $$...$$
      .replace(/\$\$([^$]+)\$\$/g, (_, math) => {
        try {
          return katex?.renderToString(math, { displayMode: true, throwOnError: false })
            || `<pre>${escapeHtml(math)}</pre>`;
        } catch {
          return `<pre>${escapeHtml(math)}</pre>`;
        }
      })
      // Inline math: $...$
      .replace(/\$([^$\n]+)\$/g, (_, math) => {
        try {
          return katex?.renderToString(math, { displayMode: false, throwOnError: false })
            || escapeHtml(math);
        } catch {
          return escapeHtml(math);
        }
      });

    // Then render markdown (if marked is available)
    if (typeof marked !== 'undefined' && marked.parse) {
      rendered = marked.parse(rendered);
    } else {
      // Fallback: escape HTML and convert basic markdown
      rendered = escapeHtml(text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }

    return rendered;
  } catch {
    return escapeHtml(text);
  }
}

// Toggle between edit and preview mode
function toggleSectionMode(sectionId: string): void {
  const current = markdownPreviewMode[sectionId] || 'edit';
  markdownPreviewMode[sectionId] = current === 'edit' ? 'preview' : 'edit';
  renderSections();
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
    setupCitationPicker();
    setupModalCloseHandlers();
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

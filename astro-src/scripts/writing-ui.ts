// /scripts/writing-ui.ts — Writing module client-side interactions.
//
// Handles:
// - Loading/rendering writings from localStorage
// - Creating new writings
// - Editing sections with markdown preview
// - Managing citations
// - Status changes
// - Version history
// - URL prefill from experiments/ideas
// - Section pull from related ideas/experiments
// - [cite:] autocomplete

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
import { getWritingTemplate } from '../lib/writing/templates';
import { getExperiment, getAllExperiments } from '../lib/experiments';
import { getIdea, listIdeas } from '../lib/ideas';

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

/**
 * Initialize prefill from URL parameters.
 * Reads prefill_title, prefill_papers, prefill_experiment_id, prefill_idea_id, prefill_method_summary
 * and opens the writing modal with pre-filled data.
 */
function initPrefillFromUrl(): void {
  const urlParams = new URLSearchParams(window.location.search);

  const prefillTitle = urlParams.get('prefill_title');
  const prefillPapers = urlParams.get('prefill_papers');
  const prefillExperimentId = urlParams.get('prefill_experiment_id');
  const prefillIdeaId = urlParams.get('prefill_idea_id');
  const prefillMethodSummary = urlParams.get('prefill_method_summary');

  // If no prefill params, do nothing
  if (!prefillTitle && !prefillExperimentId && !prefillIdeaId) {
    return;
  }

  // Parse related papers
  const papers = prefillPapers
    ? prefillPapers.split(',').map(p => p.trim()).filter(Boolean)
    : [];

  // Get experiment details if experiment ID provided
  let experimentTitle = '';
  let experimentMethod = '';
  if (prefillExperimentId) {
    const exp = getExperiment(prefillExperimentId);
    if (exp) {
      experimentTitle = exp.title;
      experimentMethod = exp.method || '';
      // Also collect related papers from experiment
      if (exp.relatedPapers && exp.relatedPapers.length > 0) {
        for (const pid of exp.relatedPapers) {
          if (!papers.includes(pid)) {
            papers.push(pid);
          }
        }
      }
    }
  }

  // Get idea details if idea ID provided
  let ideaTitle = '';
  if (prefillIdeaId) {
    const idea = getIdea(prefillIdeaId);
    if (idea) {
      ideaTitle = idea.title;
    }
  }

  // Build title with context
  let finalTitle = prefillTitle || '';
  if (experimentTitle && !finalTitle.includes(experimentTitle)) {
    finalTitle = experimentTitle + (finalTitle ? ` - ${finalTitle}` : '');
  }
  if (ideaTitle && !finalTitle.includes(ideaTitle)) {
    finalTitle = ideaTitle + (finalTitle ? ` - ${finalTitle}` : '');
  }

  // Build method summary
  let methodSummary = prefillMethodSummary || '';
  if (!methodSummary && experimentMethod) {
    methodSummary = experimentMethod.substring(0, 200);
  }

  // Open modal with prefill
  openWritingModalWithPrefill({
    title: finalTitle,
    papers,
    experimentId: prefillExperimentId || undefined,
    ideaId: prefillIdeaId || undefined,
    methodSummary,
  });

  // Clean URL after processing
  window.history.replaceState({}, '', window.location.pathname);
}

/**
 * Open the writing modal with pre-filled data.
 */
function openWritingModalWithPrefill(options: {
  title: string;
  papers: string[];
  experimentId?: string;
  ideaId?: string;
  methodSummary?: string;
}): void {
  const modal = document.getElementById('new-writing-modal');
  const openBtn = document.querySelector('[data-open-new-writing]');
  const titleInput = document.getElementById('new-writing-title') as HTMLInputElement;
  const typeSelect = document.getElementById('new-writing-type') as HTMLSelectElement;
  const createBtn = document.querySelector('[data-create-writing]');

  if (!modal || !openBtn || !titleInput || !createBtn) return;

  // Open modal first
  modal.classList.add('open');

  // Pre-fill title
  titleInput.value = options.title;
  titleInput.focus();

  // We'll handle the papers and experiment/idea associations after creation
  // Store prefill data in a global for the create handler
  (window as any).__writingPrefill = options;

  // Override the create button handler temporarily
  const originalCreateHandler = createBtn.onclick;
  createBtn.onclick = () => {
    // Call original handler first
    if (originalCreateHandler) {
      (originalCreateHandler as EventListener)();
    }

    // After creation, redirect should happen, but we need to add related data
    const newWritingId = (window as any).__lastCreatedWritingId;
    if (newWritingId) {
      // Add experiment/idea associations
      const updates: Partial<Writing> = {};
      if (options.experimentId) {
        updates.relatedExperiments = [options.experimentId];
      }
      if (options.ideaId) {
        updates.relatedIdeas = [options.ideaId];
      }
      if (Object.keys(updates).length > 0) {
        updateWriting(newWritingId, updates);
      }

      // Add papers as citations
      for (const paperId of options.papers) {
        addCitation(newWritingId, paperId.replace(/v\d+$/, ''));
      }

      // Pre-fill method section if method summary provided
      if (options.methodSummary) {
        const writing = getWriting(newWritingId);
        if (writing) {
          const methodSection = writing.sections.find(s => s.id === 'method');
          if (methodSection) {
            methodSection.content = options.methodSummary;
            updateWriting(newWritingId, { sections: writing.sections });
          }
        }
      }
    }

    // Clean up
    delete (window as any).__writingPrefill;
    delete (window as any).__lastCreatedWritingId;
  };
}

// Initialize the list page
function initListPage(): void {
  // Check for URL prefill from experiment/idea
  initPrefillFromUrl();

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

  // Render upstream sources
  renderUpstreamSources();

  // Render versions
  renderVersions();
}

// Section pull sources - maps section IDs to data extraction functions
const PULL_SOURCES: Record<string, (writing: Writing) => string> = {
  introduction: (w) => {
    if (!w.relatedIdeas || w.relatedIdeas.length === 0) return '';
    return w.relatedIdeas
      .map(id => getIdea(id))
      .filter(Boolean)
      .map(i => `### ${i!.title}\n${i!.description}`)
      .join('\n\n');
  },
  method: (w) => {
    if (!w.relatedExperiments || w.relatedExperiments.length === 0) return '';
    return w.relatedExperiments
      .map(id => getExperiment(id))
      .filter(Boolean)
      .map(e => `### ${e!.title}\n${e!.method}`)
      .join('\n\n');
  },
  experiments: (w) => {
    if (!w.relatedExperiments || w.relatedExperiments.length === 0) return '';
    return w.relatedExperiments
      .map(id => getExperiment(id))
      .filter(Boolean)
      .map(e => {
        const vars = e!.variables?.map(v => `- ${v.name}: ${v.range || v.description || ''}`).join('\n') || '';
        return `### ${e!.title}\n**假设**: ${e!.hypothesis}\n\n**变量**:\n${vars}`;
      }).join('\n\n');
  },
  results: (w) => {
    if (!w.relatedExperiments || w.relatedExperiments.length === 0) return '';
    const completed = w.relatedExperiments
      .map(id => getExperiment(id))
      .filter(e => e && e.status === 'completed');
    const running = w.relatedExperiments
      .map(id => getExperiment(id))
      .filter(e => e && (e.status === 'planning' || e.status === 'running'));
    const failed = w.relatedExperiments
      .map(id => getExperiment(id))
      .filter(e => e && e.status === 'failed');

    if (failed.length > 0 && completed.length === 0 && running.length === 0) {
      return '⚠️ 所有关联实验失败，请去实验页查看 error logs';
    }
    if (completed.length === 0 && running.length > 0) {
      return '（实验进行中，结果待补）';
    }
    return completed
      .map(e => `### ${e!.title}\n${e!.actualResults || '（结果未记录）'}`)
      .join('\n\n');
  },
  conclusion: (w) => {
    if (!w.relatedIdeas || w.relatedIdeas.length === 0) return '';
    return w.relatedIdeas
      .map(id => getIdea(id))
      .filter(i => i && i.status === 'promoted')
      .map(i => `### ${i!.title}\n${i!.description}\n\n**Tags**: ${i!.tags.join(', ')}`)
      .join('\n\n');
  },
};

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

  // Sections that have pull functionality
  const pullableSections = ['introduction', 'method', 'experiments', 'results', 'conclusion'];

  container.innerHTML = currentWriting.sections.map((section, idx) => {
    const mode = markdownPreviewMode[section.id] || 'edit';
    const wordCount = countWords(section.content);
    const guidance = wordCountGuidance[section.id] || '';
    const hasContent = section.content.length > 0;
    const hasPullSource = pullableSections.includes(section.id) && PULL_SOURCES[section.id];

    return `
      <div class="writing-section" data-section-id="${section.id}">
        <div class="writing-section-header">
          <h3 class="writing-section-title">${escapeHtml(section.title)}</h3>
          <div class="writing-section-actions">
            <span class="writing-section-wordcount">${wordCount} 字 ${guidance ? `· ${guidance}` : ''}</span>
            ${hasPullSource ? `
              <button type="button" class="btn btn-ghost btn-xs writing-section-pull-btn" data-pull-section="${section.id}" title="从关联的想法/实验拉取内容">
                📥 拉取
              </button>
            ` : ''}
            <button type="button" class="btn btn-ghost btn-xs section-mode-toggle" data-toggle-mode="${section.id}">
              ${mode === 'edit' ? '👁️ 预览' : '✏️ 编辑'}
            </button>
            <span class="writing-section-status">${hasContent ? '✓ 已填写' : '空'}</span>
          </div>
        </div>
        <div class="writing-section-content ${mode}">
          ${mode === 'edit' ? `
            <textarea
              placeholder="在此输入 ${section.title} 内容...（支持 Markdown 和 LaTeX，例：$x^2$ 或 $$E=mc^2$），输入 [cite: 可自动补全引用"
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

  // Setup pull button listeners
  container.querySelectorAll<HTMLButtonElement>('[data-pull-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.getAttribute('data-pull-section');
      if (!sectionId || !currentWriting || !PULL_SOURCES[sectionId]) return;

      const pullSource = PULL_SOURCES[sectionId];
      const pulledContent = pullSource(currentWriting);

      if (!pulledContent) {
        alert('没有可拉取的内容。请先关联相关的想法或实验。');
        return;
      }

      // Append to textarea
      const textarea = container.querySelector<HTMLTextAreaElement>(`[data-section-content="${sectionId}"]`);
      if (!textarea) return;

      const separator = textarea.value ? '\n\n---\n\n' : '';
      textarea.value = textarea.value + separator + pulledContent;
      textarea.dispatchEvent(new Event('input'));

      // Show toast
      const charCount = pulledContent.length;
      alert(`已追加 ${charCount} 字符，保留原有内容`);
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

  // Load papers from page-embedded data (injected by SSR)
  let papers: any[] = [];
  try {
    const papersDataEl = document.getElementById('papers-data');
    if (papersDataEl) {
      const payload = JSON.parse(papersDataEl.textContent || '{}');
      papers = payload.papers || [];
    }
  } catch { /* ignore */ }

  // If no papers embedded, try user's library papers from localStorage
  if (papers.length === 0) {
    try {
      // Try to get papers from user libraries in localStorage
      const libsData = localStorage.getItem('dpr_user_libraries_v1');
      if (libsData) {
        const doc = JSON.parse(libsData);
        const libraries = doc.libraries || {};
        // Collect all paper IDs from all libraries
        const paperIds = new Set<string>();
        for (const lib of Object.values(libraries) as any[]) {
          for (const pid of lib.paperIds || []) {
            paperIds.add(pid);
          }
        }
        // Convert to paper-like objects for citation picker
        papers = Array.from(paperIds).map(id => ({
          arxivId: id,
          title: `arXiv: ${id}`,
          authors: [],
        }));
      }
    } catch { /* ignore */ }
  }

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

// Render upstream sources
function renderUpstreamSources(): void {
  const container = document.querySelector('[data-upstream-list]');
  if (!container || !currentWriting) return;

  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

  // Get upstream ideas and experiments
  const upstreamIdeas = (currentWriting.relatedIdeas || [])
    .map(id => getIdea(id))
    .filter(Boolean) as NonNullable<ReturnType<typeof getIdea>>[];

  const upstreamExperiments = (currentWriting.relatedExperiments || [])
    .map(id => getExperiment(id))
    .filter(Boolean) as NonNullable<ReturnType<typeof getExperiment>>[];

  if (upstreamIdeas.length === 0 && upstreamExperiments.length === 0) {
    container.innerHTML = '<p class="muted" style="font-size: 0.9rem;">此写作没有关联上游想法或实验。</p>';
    return;
  }

  // Sort by status group then updatedAt descending
  const ideaStatusOrder: Record<string, number> = { active: 0, running: 1, completed: 2, planning: 3, failed: 4, promoted: 5, archived: 6 };
  const expStatusOrder: Record<string, number> = { planning: 0, running: 1, completed: 2, failed: 3, paused: 4 };

  const ideaStatusLabels: Record<string, string> = { draft: '草稿', active: '进行中', promoted: '已推荐', archived: '已归档' };
  const expStatusLabels: Record<string, string> = { planning: '规划中', running: '进行中', completed: '已完成', failed: '失败', paused: '暂停' };

  // Sort ideas
  const sortedIdeas = [...upstreamIdeas].sort((a, b) => {
    const aOrder = ideaStatusOrder[a.status] ?? 99;
    const bOrder = ideaStatusOrder[b.status] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  // Sort experiments
  const sortedExperiments = [...upstreamExperiments].sort((a, b) => {
    const aOrder = expStatusOrder[a.status] ?? 99;
    const bOrder = expStatusOrder[b.status] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const ideasHtml = sortedIdeas.length > 0 ? `
    <h4 class="upstream-subtitle">💡 想法</h4>
    <div class="upstream-items">
      ${sortedIdeas.map(i => `
        <a href="${base}/ideas/${i.id}/" class="upstream-item">
          <span class="upstream-item-title">${escapeHtml(i.title)}</span>
          <span class="upstream-item-badge upstream-item-badge--${i.status}">${ideaStatusLabels[i.status] || i.status}</span>
          <span class="upstream-item-date">${new Date(i.updatedAt).toLocaleDateString('zh-CN')}</span>
        </a>
      `).join('')}
    </div>
  ` : '';

  const experimentsHtml = sortedExperiments.length > 0 ? `
    <h4 class="upstream-subtitle">🧪 实验</h4>
    <div class="upstream-items">
      ${sortedExperiments.map(e => `
        <a href="${base}/experiments/${e.id}/" class="upstream-item">
          <span class="upstream-item-title">${escapeHtml(e.title)}</span>
          <span class="upstream-item-badge upstream-item-badge--${e.status}">${expStatusLabels[e.status] || e.status}</span>
          <span class="upstream-item-date">${new Date(e.updatedAt).toLocaleDateString('zh-CN')}</span>
        </a>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `${ideasHtml}${experimentsHtml}`;
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
  const templateSelect = document.getElementById('new-writing-template') as HTMLSelectElement;

  if (!modal || !openBtn || !closeBtn || !createBtn) return;

  openBtn.addEventListener('click', () => {
    // Reset template selection on open
    if (templateSelect) templateSelect.value = '';
    modal.classList.add('open');
    titleInput?.focus();
  });

  // Handle template selection - auto-fill type based on template
  templateSelect?.addEventListener('change', () => {
    const templateId = templateSelect.value;
    if (!templateId) return;

    const template = getWritingTemplate(templateId);
    if (!template) return;

    // Auto-select type based on template
    typeSelect.value = template.type;
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
    const templateId = templateSelect?.value;

    if (!title) {
      alert('请输入标题');
      return;
    }

    const writing = createWriting(title, type);

    // Store ID for prefill handler
    (window as any).__lastCreatedWritingId = writing.id;

    if (venue) {
      updateWriting(writing.id, { targetVenue: venue });
    }

    // Apply template sections if selected
    if (templateId) {
      const template = getWritingTemplate(templateId);
      if (template && template.sections.length > 0) {
        const sections = template.sections.map((s) => ({
          id: `section-${Date.now()}-${s.order}`,
          title: s.title,
          content: '',
          order: s.order,
        }));
        updateWriting(writing.id, { sections });
      }
    }

    // Reset form
    if (titleInput) titleInput.value = '';
    if (venueInput) venueInput.value = '';
    if (templateSelect) templateSelect.value = '';
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

// Setup metadata edit modal
function setupMetadataEdit(): void {
  const editBtn = document.querySelector('[data-edit-metadata]');
  const modal = document.getElementById('metadata-edit-modal');
  const form = document.getElementById('metadata-edit-form') as HTMLFormElement;
  const closeBtns = document.querySelectorAll('[data-close-metadata-modal]');

  if (!editBtn || !modal || !currentWriting) return;

  // Open modal and populate fields
  editBtn.addEventListener('click', () => {
    const titleInput = document.getElementById('edit-title') as HTMLInputElement;
    const typeSelect = document.getElementById('edit-type') as HTMLSelectElement;
    const venueInput = document.getElementById('edit-venue') as HTMLInputElement;

    if (titleInput) titleInput.value = currentWriting!.title;
    if (typeSelect) typeSelect.value = currentWriting!.type || 'paper';
    if (venueInput) venueInput.value = currentWriting!.targetVenue || '';

    modal.classList.add('open');
  });

  // Close handlers
  closeBtns.forEach(btn => {
    btn.addEventListener('click', () => modal.classList.remove('open'));
  });

  modal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  // Form submit
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const titleInput = document.getElementById('edit-title') as HTMLInputElement;
    const typeSelect = document.getElementById('edit-type') as HTMLSelectElement;
    const venueInput = document.getElementById('edit-venue') as HTMLInputElement;

    if (titleInput?.value) {
      updateWriting(currentWriting!.id, {
        title: titleInput.value,
        type: typeSelect?.value as Writing['type'],
        targetVenue: venueInput?.value,
      });
      currentWriting = getWriting(currentWriting!.id);
      renderDetailPage();
      modal.classList.remove('open');
    }
  });
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
    setupMetadataEdit();
    setupStatusChange();
    setupDelete();
    setupCitationPicker();
    setupModalCloseHandlers();
    setupExport();
    // Init cite autocomplete after sections are rendered
    setTimeout(() => initCiteAutocomplete(), 100);
  }
}

/**
 * Simple [cite:] autocomplete for section textareas.
 * Triggers on '[cite:' prefix and shows a popup with paper suggestions.
 */
interface CitePaperItem {
  arxivId: string;
  title: string;
  title_zh?: string;
}

let citeAutocompletePopup: HTMLElement | null = null;
let citeFilteredPapers: CitePaperItem[] = [];
let citeSelectedIndex = -1;

function initCiteAutocomplete(): void {
  // Get papers from page-embedded data
  const papersDataEl = document.getElementById('papers-data');
  let papers: CitePaperItem[] = [];

  if (papersDataEl) {
    try {
      const payload = JSON.parse(papersDataEl.textContent || '{}');
      papers = (payload.papers || []).map((p: any) => ({
        arxivId: p.arxivId || p.id,
        title: p.title || '',
        title_zh: p.title_zh || '',
      }));
    } catch { /* ignore */ }
  }

  // If no papers embedded, try user's library papers from localStorage
  if (papers.length === 0) {
    try {
      const libsData = localStorage.getItem('dpr_user_libraries_v1');
      if (libsData) {
        const doc = JSON.parse(libsData);
        const libraries = doc.libraries || {};
        const paperIds = new Set<string>();
        for (const lib of Object.values(libraries) as any[]) {
          for (const pid of lib.paperIds || []) {
            paperIds.add(pid);
          }
        }
        papers = Array.from(paperIds).map(id => ({
          arxivId: id,
          title: `arXiv: ${id}`,
        }));
      }
    } catch { /* ignore */ }
  }

  // Also add papers from current writing's citations
  if (currentWriting?.citedPapers) {
    for (const ref of currentWriting.citedPapers) {
      if (!papers.find(p => p.arxivId === ref.arxivId)) {
        papers.unshift({ arxivId: ref.arxivId, title: ref.context || ref.arxivId });
      }
    }
  }

  // Create popup element
  function createPopup(): void {
    if (citeAutocompletePopup) return;
    citeAutocompletePopup = document.createElement('div');
    citeAutocompletePopup.id = 'cite-autocomplete-popup';
    citeAutocompletePopup.className = 'cite-autocomplete-popup';
    citeAutocompletePopup.hidden = true;
    document.body.appendChild(citeAutocompletePopup);
  }

  function showPopup(items: CitePaperItem[], query: string): void {
    if (!citeAutocompletePopup) createPopup();
    if (!citeAutocompletePopup) return;

    citeFilteredPapers = items;
    citeSelectedIndex = -1;

    if (items.length === 0) {
      citeAutocompletePopup.hidden = true;
      return;
    }

    citeAutocompletePopup.innerHTML = items
      .slice(0, 8)
      .map((p, i) => {
        const displayTitle = p.title_zh || p.title || p.arxivId;
        return `<div class="cite-autocomplete-item" data-index="${i}" tabindex="-1">
          <span class="cite-autocomplete-id">${p.arxivId}</span>
          <span class="cite-autocomplete-title">${escapeHtml(displayTitle.slice(0, 60))}</span>
        </div>`;
      })
      .join('');

    citeAutocompletePopup.hidden = false;
  }

  function hidePopup(): void {
    if (citeAutocompletePopup) {
      citeAutocompletePopup.hidden = true;
    }
    citeFilteredPapers = [];
    citeSelectedIndex = -1;
  }

  function insertCite(arxivId: string, textarea: HTMLTextAreaElement): void {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);
    const afterCursor = text.slice(cursorPos);

    const openIdx = beforeCursor.lastIndexOf('[cite:');
    if (openIdx === -1) return;

    const citeText = `[cite:${arxivId}]`;
    const newBefore = beforeCursor.slice(0, openIdx) + citeText;
    textarea.value = newBefore + afterCursor;

    const newPos = newBefore.length;
    textarea.setSelectionRange(newPos, newPos);
    hidePopup();
    textarea.focus();
  }

  function filterPapers(query: string): CitePaperItem[] {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    return papers
      .filter((p) => {
        if (p.arxivId.toLowerCase().includes(q)) return true;
        const title = p.title?.toLowerCase() || '';
        const titleZh = p.title_zh?.toLowerCase() || '';
        return title.includes(q) || titleZh.includes(q);
      })
      .slice(0, 8);
  }

  // Attach to all section textareas
  const container = document.querySelector('[data-sections-container]');
  if (!container) return;

  container.querySelectorAll<HTMLTextAreaElement>('[data-section-content]').forEach(textarea => {
    // Input handler
    const handleInput = () => {
      const text = textarea.value;
      const cursorPos = textarea.selectionStart;
      const beforeCursor = text.slice(0, cursorPos);

      const openIdx = beforeCursor.lastIndexOf('[cite:');
      if (openIdx === -1) {
        hidePopup();
        return;
      }

      const afterOpen = beforeCursor.slice(openIdx + 6);
      if (afterOpen.includes(']')) {
        hidePopup();
        return;
      }

      const query = afterOpen;
      const items = filterPapers(query);

      if (items.length > 0) {
        // Position popup
        const rect = textarea.getBoundingClientRect();
        if (!citeAutocompletePopup) createPopup();
        if (citeAutocompletePopup) {
          citeAutocompletePopup.style.position = 'absolute';
          citeAutocompletePopup.style.left = `${rect.left}px`;
          citeAutocompletePopup.style.top = `${rect.bottom + 4}px`;
          citeAutocompletePopup.style.width = `${Math.max(rect.width, 300)}px`;
        }
      }

      showPopup(items, query);
    };

    // Keydown handler
    const handleKeydown = (e: KeyboardEvent) => {
      if (!citeAutocompletePopup || citeAutocompletePopup.hidden) return;

      const items = citeAutocompletePopup.querySelectorAll('.cite-autocomplete-item');

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          citeSelectedIndex = Math.min(citeSelectedIndex + 1, items.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          citeSelectedIndex = Math.max(citeSelectedIndex - 1, 0);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (citeSelectedIndex >= 0 && citeFilteredPapers[citeSelectedIndex]) {
            insertCite(citeFilteredPapers[citeSelectedIndex].arxivId, textarea);
          }
          return;
        case 'Escape':
          e.preventDefault();
          hidePopup();
          return;
        default:
          return;
      }

      items.forEach((item, i) => {
        item.classList.toggle('is-selected', i === citeSelectedIndex);
      });
      if (citeSelectedIndex >= 0) {
        items[citeSelectedIndex]?.scrollIntoView({ block: 'nearest' });
      }
    };

    // Click handler for popup items
    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const item = target.closest('.cite-autocomplete-item');
      if (item) {
        const idx = parseInt((item as HTMLElement).dataset.index || '-1', 10);
        if (idx >= 0 && citeFilteredPapers[idx]) {
          insertCite(citeFilteredPapers[idx].arxivId, textarea);
        }
      }
    };

    // Click outside to close
    const handleDocumentClick = (e: Event) => {
      if (citeAutocompletePopup && !citeAutocompletePopup.contains(e.target as Node) && e.target !== textarea) {
        hidePopup();
      }
    };

    textarea.addEventListener('input', handleInput);
    textarea.addEventListener('keydown', handleKeydown);
    document.addEventListener('click', handleDocumentClick);
  });
}

// Setup export functionality
/**
 * Convert [cite:] syntax to markdown links in export.
 * [cite:2301.12345] -> [2301.12345](https://arxiv.org/abs/2301.12345)
 * [cite:2301.12345|caption] -> [caption](https://arxiv.org/abs/2301.12345)
 * Unrecognized IDs get a comment appended.
 */
function convertCiteSyntax(content: string, citedPapers: PaperRef[]): string {
  const paperIds = new Set(citedPapers.map(p => p.arxivId.toLowerCase()));

  return content.replace(/\[cite:([^\]]+)\]/g, (match, capture) => {
    const parts = capture.split('|');
    const arxivId = parts[0].trim();
    const caption = parts[1]?.trim();
    const normalizedId = arxivId.replace(/v\d+$/, '');

    const isKnown = paperIds.has(normalizedId.toLowerCase());

    if (isKnown) {
      const url = `https://arxiv.org/abs/${normalizedId}`;
      if (caption) {
        return `[${caption}](${url})`;
      }
      return `[${normalizedId}](${url})`;
    } else {
      // Unknown paper - keep as-is but add comment
      const url = `https://arxiv.org/abs/${normalizedId}`;
      if (caption) {
        return `[${caption}](${url})（未加入引用列表）`;
      }
      return `[${normalizedId}](${url})（未加入引用列表）`;
    }
  });
}

function setupExport(): void {
  // Export as Markdown
  const exportMdBtn = document.querySelector('[data-export-markdown]');
  exportMdBtn?.addEventListener('click', () => {
    if (!currentWriting) return;

    let md = `# ${currentWriting.title}\n\n`;
    md += `**状态**: ${STATUS_LABELS[currentWriting.status]}\n`;
    md += `**类型**: ${TYPE_LABELS[currentWriting.type]}\n`;
    if (currentWriting.targetVenue) {
      md += `**目标期刊/会议**: ${currentWriting.targetVenue}\n`;
    }
    md += `\n---\n\n`;

    if (currentWriting.abstract) {
      md += `## 摘要\n\n${currentWriting.abstract}\n\n`;
    }

    // Sort sections by order
    const sortedSections = [...currentWriting.sections].sort((a, b) => a.order - b.order);
    for (const section of sortedSections) {
      // Convert [cite:] syntax before exporting
      const convertedContent = convertCiteSyntax(section.content || '(内容待填写)', currentWriting.citedPapers || []);
      md += `## ${section.title}\n\n${convertedContent}\n\n`;
    }

    // Citations
    if (currentWriting.citedPapers && currentWriting.citedPapers.length > 0) {
      md += `---\n\n## 参考文献\n\n`;
      for (const ref of currentWriting.citedPapers) {
        md += `- [${ref.arxivId}](https://arxiv.org/abs/${ref.arxivId})`;
        if (ref.context) {
          md += ` — ${ref.context}`;
        }
        md += '\n';
      }
    }

    // Download
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentWriting.title.replace(/[^a-zA-Z0-9一-龥]/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Export as JSON
  const exportJsonBtn = document.querySelector('[data-export-json]');
  exportJsonBtn?.addEventListener('click', () => {
    if (!currentWriting) return;

    // Build export data with upstreamFetchedAt
    const exportData = {
      ...currentWriting,
      upstreamFetchedAt: Date.now(),
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentWriting.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  // Export as PDF (using window.print)
  const exportPdfBtn = document.querySelector('[data-export-pdf]');
  exportPdfBtn?.addEventListener('click', () => {
    window.print();
  });
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

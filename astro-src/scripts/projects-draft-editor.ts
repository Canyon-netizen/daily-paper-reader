// astro-src/scripts/projects-draft-editor.ts
//
// Draft editor orchestrator for project writing workspace.
// Wires textarea input → debounced autosave → IDB, with cite autocomplete.
//
// Architecture matches paper-notes-editor.ts patterns.

import { createAutosaveHandler, installVisibilityFlush, type Draft } from '../lib/projects/draft-store';
import { extractCites, type CiteToken } from '../lib/projects/citation';
import { showToast } from './toast';

interface PaperListItem {
  canonicalArxivId: string;
  title?: string;
  title_zh?: string;
  title_plain?: string;
  title_zh_plain?: string;
  authors?: string[];
}

interface DraftEditorState {
  textarea: HTMLTextAreaElement;
  draftId: string;
  projectId: string;
  autosave: ReturnType<typeof createAutosaveHandler>;
  unsubscribes: Array<() => void>;
}

/**
 * Get current draft data from textarea and hidden fields.
 */
function getDraftFromDOM(
  textarea: HTMLTextAreaElement,
  draftId: string,
  projectId: string,
): Omit<Draft, 'savedAt' | 'wordCount'> {
  return {
    id: draftId,
    projectId,
    title: (document.getElementById('draft-title') as HTMLInputElement)?.value || 'Untitled',
    markdown: textarea.value,
    cursorOffset: textarea.selectionStart,
  };
}

/**
 * Initialize the draft editor for a textarea element.
 * Returns detach function to clean up.
 */
export function attachDraftEditor(
  textarea: HTMLTextAreaElement,
  draftId: string,
  projectId: string,
): { detach: () => void } {
  const unsubscribes: Array<() => void> = [];

  // Create autosave handler
  const autosave = createAutosaveHandler(() =>
    getDraftFromDOM(textarea, draftId, projectId)
  );

  // Wire input → debounced schedule
  const inputHandler = () => {
    autosave.schedule();
    updateWordCount(textarea);
  };
  textarea.addEventListener('input', inputHandler);
  unsubscribes.push(() => textarea.removeEventListener('input', inputHandler));

  // Wire beforeunload / visibilitychange → flush
  const flushHandler = async () => {
    await autosave.flush();
  };
  const unsubVisibility = installVisibilityFlush(flushHandler);
  unsubscribes.push(unsubVisibility);

  // Initial word count
  updateWordCount(textarea);

  // Return detach function
  return {
    detach: () => {
      unsubscribes.forEach((fn) => fn());
      unsubscribes.length = 0;
    },
  };
}

/**
 * Update word count display in toolbar.
 */
function updateWordCount(textarea: HTMLTextAreaElement): void {
  const counter = document.getElementById('draft-word-count');
  if (!counter) return;

  const text = textarea.value || '';
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0).length;
  counter.textContent = `${words} 字`;
}

/**
 * Extract cite tokens from current textarea and emit autosave event.
 * Throttled to 30s to avoid excessive events.
 */
let lastAutosaveEmit = 0;
const AUTOSAVE_THROTTLE_MS = 30000;

function emitAutosaveEvent(tokens: CiteToken[], draftId: string): void {
  const now = Date.now();
  if (now - lastAutosaveEmit < AUTOSAVE_THROTTLE_MS) {
    return;
  }
  lastAutosaveEmit = now;

  // Dispatch custom event for any listeners (e.g., citation indexer)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('dpr:draft-autosave', {
        detail: {
          draftId,
          citeCount: tokens.length,
          citedPapers: [...new Set(tokens.map((t) => t.arxivId))],
          at: now,
        },
      })
    );
  }
}

/**
 * Mount cite autocomplete for a textarea.
 * Uses <datalist> for MVP - triggers on '[cite:' prefix.
 */
export function mountCiteAutocomplete(
  textarea: HTMLTextAreaElement,
  papers: PaperListItem[],
): { unmount: () => void } {
  // Create datalist with paper options
  const datalistId = 'cite-papers-datalist';
  let datalist = document.getElementById(datalistId) as HTMLDataListElement | null;

  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = datalistId;
    document.body.appendChild(datalist);
  }

  // Populate options
  datalist.innerHTML = papers
    .map((p) => {
      const displayTitle = p.title_zh_plain || p.title_plain || p.title_zh || p.title || p.canonicalArxivId;
      const label = `${p.canonicalArxivId} — ${displayTitle}`.slice(0, 100);
      return `<option value="${p.canonicalArxivId}|${displayTitle}">`;
    })
    .join('');

  // Set textarea list attribute
  textarea.setAttribute('list', datalistId);

  // Track state for autocomplete
  let activePopup: HTMLElement | null = null;
  let currentQuery = '';
  let filteredPapers: PaperListItem[] = [];

  // Build paper lookup map
  const paperMap = new Map<string, PaperListItem>();
  for (const p of papers) {
    paperMap.set(p.canonicalArxivId.toLowerCase(), p);
  }

  // Create popup element
  function createPopup(): void {
    if (activePopup) return;
    activePopup = document.createElement('div');
    activePopup.id = 'cite-autocomplete-popup';
    activePopup.className = 'cite-autocomplete-popup';
    activePopup.hidden = true;
    document.body.appendChild(activePopup);
  }

  function showPopup(items: PaperListItem[], query: string): void {
    if (!activePopup) createPopup();
    if (!activePopup) return;

    filteredPapers = items;
    currentQuery = query;

    if (items.length === 0) {
      activePopup.hidden = true;
      return;
    }

    activePopup.innerHTML = items
      .slice(0, 8)
      .map((p, i) => {
        const title = p.title_zh_plain || p.title_plain || p.title_zh || p.title || p.canonicalArxivId;
        return `<div class="cite-autocomplete-item" data-index="${i}" tabindex="-1">
          <span class="cite-autocomplete-id">${p.canonicalArxivId}</span>
          <span class="cite-autocomplete-title">${title.slice(0, 60)}</span>
        </div>`;
      })
      .join('');

    // Position below textarea
    const rect = textarea.getBoundingClientRect();
    activePopup.style.position = 'absolute';
    activePopup.style.left = `${rect.left}px`;
    activePopup.style.top = `${rect.bottom + 4}px`;
    activePopup.style.width = `${Math.max(rect.width, 300)}px`;
    activePopup.hidden = false;
  }

  function hidePopup(): void {
    if (activePopup) {
      activePopup.hidden = true;
    }
    filteredPapers = [];
    currentQuery = '';
  }

  function insertCite(arxivId: string, caption?: string): void {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);
    const afterCursor = text.slice(cursorPos);

    // Find the '[cite:' that triggered this
    const openIdx = beforeCursor.lastIndexOf('[cite:');
    if (openIdx === -1) return;

    // Build replacement: [cite:arxivId|caption] or [cite:arxivId]
    const citeText = caption ? `[cite:${arxivId}|${caption}]` : `[cite:${arxivId}]`;
    const newBefore = beforeCursor.slice(0, openIdx) + citeText;
    textarea.value = newBefore + afterCursor;

    // Position cursor after inserted text
    const newPos = newBefore.length;
    textarea.setSelectionRange(newPos, newPos);
    hidePopup();
    textarea.focus();
  }

  function filterPapers(query: string): PaperListItem[] {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    return papers
      .filter((p) => {
        if (p.canonicalArxivId.toLowerCase().includes(q)) return true;
        const title = p.title_plain || p.title || '';
        const titleZh = p.title_zh_plain || p.title_zh || '';
        return title.toLowerCase().includes(q) || titleZh.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }

  // Input handler for cite detection
  const handleInput = () => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = text.slice(0, cursorPos);

    // Detect '[cite:' trigger
    const openIdx = beforeCursor.lastIndexOf('[cite:');
    if (openIdx === -1) {
      hidePopup();
      return;
    }

    // Check if already complete (has closing ])
    const afterOpen = beforeCursor.slice(openIdx + 6);
    if (afterOpen.includes(']')) {
      hidePopup();
      return;
    }

    // Extract query (everything after [cite: to cursor)
    const query = afterOpen;
    const items = filterPapers(query);
    showPopup(items, query);
  };

  // Keydown handler for navigation
  const handleKeydown = (e: KeyboardEvent) => {
    if (!activePopup || activePopup.hidden) return;

    const items = activePopup.querySelectorAll('.cite-autocomplete-item');
    let selectedIdx = -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIdx = Math.min((selectedIdx + 1) % items.length, items.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIdx = Math.max((selectedIdx - 1 + items.length) % items.length, 0);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (selectedIdx >= 0 && filteredPapers[selectedIdx]) {
          insertCite(filteredPapers[selectedIdx].canonicalArxivId);
        }
        return;
      case 'Escape':
        e.preventDefault();
        hidePopup();
        return;
    }

    // Update selection visual
    items.forEach((item, i) => {
      item.classList.toggle('is-selected', i === selectedIdx);
    });
    if (selectedIdx >= 0) {
      items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    }
  };

  // Click handler for popup items
  const handleClick = (e: Event) => {
    const target = e.target as HTMLElement;
    const item = target.closest('.cite-autocomplete-item');
    if (item) {
      const idx = parseInt((item as HTMLElement).dataset.index || '-1', 10);
      if (idx >= 0 && filteredPapers[idx]) {
        insertCite(filteredPapers[idx].canonicalArxivId);
      }
    }
  };

  // Click outside to close
  const handleDocumentClick = (e: Event) => {
    if (activePopup && !activePopup.contains(e.target as Node) && e.target !== textarea) {
      hidePopup();
    }
  };

  // Attach handlers
  textarea.addEventListener('input', handleInput);
  textarea.addEventListener('keydown', handleKeydown);
  document.addEventListener('click', handleDocumentClick);

  // Return unmount function
  return {
    unmount: () => {
      textarea.removeEventListener('input', handleInput);
      textarea.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('click', handleDocumentClick);
      if (activePopup) {
        activePopup.remove();
        activePopup = null;
      }
    },
  };
}

/**
 * Load paper list from the paper search corpus endpoint.
 * Falls back to empty array if unavailable.
 */
export async function loadPaperCorpus(): Promise<PaperListItem[]> {
  try {
    const resp = await fetch('/paper-search-corpus.json');
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Initialize a complete draft editor with toolbar and autosave.
 * Creates the editor UI if not already present.
 */
export async function initDraftEditor(
  container: HTMLElement,
  draft: Draft,
  papers: PaperListItem[],
): Promise<{ detach: () => void }> {
  const unsubscribes: Array<() => void> = [];

  // Create editor UI if not exists
  let editorContainer = container.querySelector('.draft-editor-container') as HTMLElement | null;
  if (!editorContainer) {
    editorContainer = document.createElement('div');
    editorContainer.className = 'draft-editor-container';
    editorContainer.innerHTML = `
      <div class="draft-toolbar">
        <input type="text" id="draft-title" class="draft-title-input" value="${escapeHtml(draft.title)}" placeholder="草稿标题" />
        <span id="draft-word-count" class="draft-word-count">0 字</span>
        <span id="draft-save-status" class="draft-save-status"></span>
        <button type="button" id="draft-export-btn" class="button">📥 导出 Literature Review</button>
      </div>
      <textarea
        id="draft-textarea"
        class="draft-editor"
        placeholder="开始写作... 使用 [cite:arxivId] 引用论文"
        spellcheck="true"
      >${escapeHtml(draft.markdown)}</textarea>
      <div id="draft-export-status" class="draft-export-status"></div>
    `;
    container.appendChild(editorContainer);
  }

  const textarea = editorContainer.querySelector('#draft-textarea') as HTMLTextAreaElement;
  const titleInput = editorContainer.querySelector('#draft-title') as HTMLInputElement;
  const saveStatus = editorContainer.querySelector('#draft-save-status') as HTMLElement;

  if (!textarea) {
    return { detach: () => {} };
  }

  // Attach base editor
  const editor = attachDraftEditor(textarea, draft.id, draft.projectId);
  unsubscribes.push(editor.detach);

  // Mount cite autocomplete
  const citeAutocomplete = mountCiteAutocomplete(textarea, papers);
  unsubscribes.push(citeAutocomplete.unmount);

  // Track save status
  textarea.addEventListener('input', () => {
    if (saveStatus) {
      saveStatus.textContent = '● 保存中...';
    }
  });

  // Listen for successful saves (hack: check autosave schedule)
  const originalSchedule = textarea;
  void originalSchedule;

  // Export button handler will be wired by the page

  return {
    detach: () => {
      unsubscribes.forEach((fn) => fn());
    },
  };
}

/**
 * Escape HTML special characters for safe insertion.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

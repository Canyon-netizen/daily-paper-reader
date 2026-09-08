// /lib/writing/index.ts — Writing data access layer.
//
// Provides CRUD operations for writings stored in localStorage.
// Data is client-side only (no SSR persistence).

import type { Writing, WritingsDoc, WritingType, WritingStatus, WritingSection, PaperRef } from './types';

const WRITINGS_KEY = 'dpr_writings_v1';

function getDefaultDoc(): WritingsDoc {
  return { schemaVersion: 1, writings: {} };
}

/** Load all writings from localStorage */
export function loadWritings(): WritingsDoc {
  if (typeof localStorage === 'undefined') return getDefaultDoc();
  try {
    const raw = localStorage.getItem(WRITINGS_KEY);
    if (!raw) return getDefaultDoc();
    const doc = JSON.parse(raw) as WritingsDoc;
    if (doc.schemaVersion !== 1) return getDefaultDoc();
    return doc;
  } catch {
    return getDefaultDoc();
  }
}

/** Save writings to localStorage */
export function saveWritings(doc: WritingsDoc): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WRITINGS_KEY, JSON.stringify(doc));
  } catch (e) {
    console.error('[writing] Failed to save:', e);
  }
}

/** Generate a kebab-case slug from title */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Create a new writing */
export function createWriting(
  title: string,
  type: WritingType,
  sections?: WritingSection[]
): Writing {
  const now = Date.now();
  const slug = generateSlug(title);
  const doc = loadWritings();

  // Ensure unique ID
  let id = slug;
  let counter = 1;
  while (doc.writings[id]) {
    id = `${slug}-${counter}`;
    counter++;
  }

  const writing: Writing = {
    id,
    title,
    type,
    status: 'draft',
    sections: sections || [
      { id: 'abstract', title: '摘要', content: '', order: 0 },
      { id: 'introduction', title: '引言', content: '', order: 1 },
      { id: 'method', title: '方法', content: '', order: 2 },
      { id: 'experiments', title: '实验', content: '', order: 3 },
      { id: 'results', title: '结果', content: '', order: 4 },
      { id: 'discussion', title: '讨论', content: '', order: 5 },
      { id: 'conclusion', title: '结论', content: '', order: 6 },
      { id: 'references', title: '参考文献', content: '', order: 7 },
    ],
    citedPapers: [],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 0,
    versions: [],
    createdAt: now,
    updatedAt: now,
  };

  doc.writings[id] = writing;
  saveWritings(doc);

  // Dispatch event
  dispatchWritingEvent('created', writing);

  return writing;
}

/** Update a writing */
export function updateWriting(id: string, partial: Partial<Writing>): void {
  const doc = loadWritings();
  const existing = doc.writings[id];
  if (!existing) return;

  // Save version if content changed
  if (partial.sections) {
    const newContent = partial.sections.map(s => s.content).join('\n');
    const oldContent = existing.sections.map(s => s.content).join('\n');
    if (newContent !== oldContent) {
      existing.versions.push({
        content: oldContent,
        savedAt: existing.updatedAt,
      });
      // Keep only last 10 versions
      if (existing.versions.length > 10) {
        existing.versions = existing.versions.slice(-10);
      }
    }
    // Recalculate word count
    partial.wordCount = countWords(newContent);
  }

  const updated = { ...existing, ...partial, updatedAt: Date.now() };
  doc.writings[id] = updated;
  saveWritings(doc);

  dispatchWritingEvent('updated', updated);
}

/** Delete a writing */
export function deleteWriting(id: string): void {
  const doc = loadWritings();
  if (!doc.writings[id]) return;

  const deleted = doc.writings[id];
  delete doc.writings[id];
  saveWritings(doc);

  dispatchWritingEvent('deleted', deleted);
}

/** Get a single writing by ID */
export function getWriting(id: string): Writing | null {
  const doc = loadWritings();
  return doc.writings[id] || null;
}

/** List all writings */
export function listWritings(): Writing[] {
  const doc = loadWritings();
  return Object.values(doc.writings).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Filter writings by type */
export function listWritingsByType(type: WritingType): Writing[] {
  return listWritings().filter(w => w.type === type);
}

/** Filter writings by status */
export function listWritingsByStatus(status: WritingStatus): Writing[] {
  return listWritings().filter(w => w.status === status);
}

/** Count words in content */
function countWords(text: string): number {
  if (!text) return 0;
  // Handle both English and Chinese text
  const englishWords = text.match(/[a-zA-Z]+/g) || [];
  const chineseChars = text.match(/[一-龥]/g) || [];
  return englishWords.length + chineseChars.length;
}

/** Add a citation to a writing */
export function addCitation(writingId: string, arxivId: string, context?: string): void {
  const doc = loadWritings();
  const writing = doc.writings[writingId];
  if (!writing) return;

  // Check if already cited
  const exists = writing.citedPapers.some(p => p.arxivId === arxivId);
  if (exists) return;

  writing.citedPapers.push({ arxivId, context });
  writing.updatedAt = Date.now();
  saveWritings(doc);
}

/** Remove a citation from a writing */
export function removeCitation(writingId: string, arxivId: string): void {
  const doc = loadWritings();
  const writing = doc.writings[writingId];
  if (!writing) return;

  writing.citedPapers = writing.citedPapers.filter(p => p.arxivId !== arxivId);
  writing.updatedAt = Date.now();
  saveWritings(doc);
}

/** Dispatch custom event for writing changes */
function dispatchWritingEvent(action: 'created' | 'updated' | 'deleted', writing: Writing): void {
  if (typeof document === 'undefined') return;
  try {
    document.dispatchEvent(new CustomEvent('dpr:writing-change', {
      detail: { action, writing }
    }));
  } catch { /* ignore */ }
}

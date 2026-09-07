// astro-src/lib/ideas/index.ts
// Ideas module data access layer

import type { Idea, IdeasDoc, IdeaStatus } from './types';
import { IDEAS_KEY, createIdeaData } from './types';

/** Load ideas from localStorage */
export function loadIdeas(): IdeasDoc {
  if (typeof window === 'undefined') {
    return { schemaVersion: 1, ideas: {} };
  }
  try {
    const raw = localStorage.getItem(IDEAS_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as IdeasDoc;
      if (doc.schemaVersion === 1) {
        return doc;
      }
    }
  } catch (e) {
    console.warn('[ideas] Failed to load ideas:', e);
  }
  return { schemaVersion: 1, ideas: {} };
}

/** Save ideas to localStorage */
export function saveIdeas(doc: IdeasDoc): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(IDEAS_KEY, JSON.stringify(doc));
  } catch (e) {
    console.error('[ideas] Failed to save ideas:', e);
  }
}

/** List all ideas */
export function listIdeas(): Idea[] {
  const doc = loadIdeas();
  return Object.values(doc.ideas).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Get a single idea by ID */
export function getIdea(id: string): Idea | null {
  const doc = loadIdeas();
  return doc.ideas[id] || null;
}

/** Filter ideas by status */
export function filterIdeasByStatus(status: IdeaStatus): Idea[] {
  return listIdeas().filter((idea) => idea.status === status);
}

/** Create a new idea */
export function createIdea(
  title: string,
  description: string,
  relatedPapers: string[] = [],
  tags: string[] = []
): Idea {
  const doc = loadIdeas();
  const idea = createIdeaData(title, description, relatedPapers, tags);

  // Ensure unique ID
  let finalId = idea.id;
  let counter = 1;
  while (doc.ideas[finalId]) {
    finalId = `${idea.id}-${counter}`;
    counter++;
  }
  idea.id = finalId;

  doc.ideas[finalId] = idea;
  saveIdeas(doc);
  return idea;
}

/** Update an existing idea */
export function updateIdea(id: string, partial: Partial<Idea>): Idea | null {
  const doc = loadIdeas();
  const idea = doc.ideas[id];
  if (!idea) return null;

  const updated = { ...idea, ...partial, updatedAt: Date.now() };
  doc.ideas[id] = updated;
  saveIdeas(doc);
  return updated;
}

/** Delete an idea */
export function deleteIdea(id: string): boolean {
  const doc = loadIdeas();
  if (!doc.ideas[id]) return false;
  delete doc.ideas[id];
  saveIdeas(doc);
  return true;
}

/** Get idea count by status */
export function getIdeaCounts(): Record<IdeaStatus, number> {
  const ideas = listIdeas();
  return {
    draft: ideas.filter((i) => i.status === 'draft').length,
    active: ideas.filter((i) => i.status === 'active').length,
    promoted: ideas.filter((i) => i.status === 'promoted').length,
    archived: ideas.filter((i) => i.status === 'archived').length,
  };
}

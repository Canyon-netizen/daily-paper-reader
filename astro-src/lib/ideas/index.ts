// astro-src/lib/ideas/index.ts
// Ideas module data access layer

import type { Idea, IdeasDoc, IdeaStatus, IdeaSource, IdeaVersion } from './types';
import { IDEAS_KEY, createIdeaData, IDEA_STATUS_TRANSITIONS, canTransitionIdeaStatus } from './types';

/** Load ideas from localStorage */
export function loadIdeas(): IdeasDoc {
  if (typeof window === 'undefined') {
    return { schemaVersion: 2, ideas: {} };
  }
  try {
    const raw = localStorage.getItem(IDEAS_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as IdeasDoc;
      // Migrate from v1 to v2
      if (doc.schemaVersion === 1) {
        doc.schemaVersion = 2;
        // Ensure all ideas have methodology field
        for (const idea of Object.values(doc.ideas)) {
          if (!idea.methodology) {
            idea.methodology = {};
          }
        }
        saveIdeas(doc);
        return doc;
      }
      if (doc.schemaVersion === 2) {
        return doc;
      }
    }
  } catch (e) {
    console.warn('[ideas] Failed to load ideas:', e);
  }
  return { schemaVersion: 2, ideas: {} };
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
  tags: string[] = [],
  source?: IdeaSource
): Idea {
  const doc = loadIdeas();
  const idea = createIdeaData(title, description, relatedPapers, tags, source);

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

/**
 * E.1.2: 给一个 idea 写入一个新的 version 快照。
 * 把当前 title / description / status 截一份,version 号单调递增。
 * changeNote 可选,描述这次的变化(diff hint,不影响数据)。
 *
 * 返回新 snapshot;idea 不存在返回 null。
 *
 * 实现细节:
 *   - 如果现有 idea 没有 versions 数组,先按 currentVersion = 1 补一条历史。
 *   - 如果 update 全空(no-op),仍然写一份 version(status 没变也写,user 显式
 *     编辑 description 时常见)。
 */
export function saveIdeaVersion(
  id: string,
  updates: Partial<Pick<Idea, 'title' | 'description' | 'status'>> & { changeNote?: string },
): IdeaVersion | null {
  if (typeof window === 'undefined') return null;
  const doc = loadIdeas();
  const idea = doc.ideas[id];
  if (!idea) return null;

  const now = Date.now();
  const next: Idea = {
    ...idea,
    title: updates.title ?? idea.title,
    description: updates.description ?? idea.description,
    status: updates.status ?? idea.status,
    updatedAt: now,
  };

  // 兜底:旧 doc 没有 versions 数组 → 补一条 v1 历史
  if (!Array.isArray(next.versions)) {
    next.versions = [{ version: 1, timestamp: idea.createdAt || now, title: idea.title, description: idea.description, status: idea.status }];
  }
  const lastVersion = next.versions[next.versions.length - 1];
  const nextVersionNumber = (next.currentVersion ?? lastVersion?.version ?? 0) + 1;
  const snapshot: IdeaVersion = {
    version: nextVersionNumber,
    timestamp: now,
    title: next.title,
    description: next.description,
    status: next.status,
    changeNote: updates.changeNote,
  };
  next.versions = [...next.versions, snapshot];
  next.currentVersion = snapshot.version;

  doc.ideas[id] = next;
  saveIdeas(doc);
  return snapshot;
}

/**
 * E.1.3: 转换 idea 的状态。如果转换非法(不在 IDEA_STATUS_TRANSITIONS 图里)
 * 返回 null,合法则更新 idea 的 status 并写一条 version 快照。
 */
export function transitionIdeaStatus(
  id: string,
  to: IdeaStatus,
  changeNote?: string,
): { idea: Idea; from: IdeaStatus; to: IdeaStatus } | null {
  const idea = getIdea(id);
  if (!idea) return null;
  const from = idea.status;
  if (!canTransitionIdeaStatus(from, to)) return null;
  const snap = saveIdeaVersion(id, { status: to, changeNote: changeNote ?? `status: ${from} → ${to}` });
  if (!snap) return null;
  const updated = getIdea(id);
  if (!updated) return null;
  return { idea: updated, from, to };
}

/** E.1.3 辅助:列出某个 idea 当前状态允许去到的所有状态。 */
export function nextStatusesFor(id: string): IdeaStatus[] {
  const idea = getIdea(id);
  if (!idea) return [];
  return IDEA_STATUS_TRANSITIONS[idea.status] ?? [];
}

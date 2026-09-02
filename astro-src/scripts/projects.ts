// astro-src/scripts/projects.ts
//
// Project workspace orchestrator — client-side entry point for /projects/ page.
// Provides list/detail fetching, stage progress computation, and cross-tab
// change subscriptions.
//
// SSR-safe: all browser APIs guarded with `typeof window !== 'undefined'`.

import {
  listUserLibraries,
  getUserLibrary,
  createLibrary,
  addStage,
  renameStage,
  archiveStage,
  addPaperToStage,
  removePaperFromStage,
} from '../lib/user-libraries/store';
import type { UserLibrary, LibraryHue } from '../lib/user-libraries/types';
import {
  onDprUserLibrariesChange,
  onDprProjectStageChange,
  emitDprUserLibrariesChange,
} from '../lib/events';
import { listDraftsByProject } from '../lib/projects/draft-store';

/** Stage progress summary — computed from a project's stages. */
export interface StageProgress {
  /** Number of stages with status 'active'. */
  active: number;
  /** Number of stages with status 'done'. */
  done: number;
  /** Total unique papers across all stages. */
  totalPapers: number;
}

/** Project detail including computed fields. */
export interface ProjectDetail extends UserLibrary {
  stageProgress: StageProgress;
}

/**
 * Get all user libraries that act as projects.
 * Returns empty array in SSR context.
 */
export function getProjectsList(): UserLibrary[] {
  if (typeof window === 'undefined') return [];
  return listUserLibraries();
}

/**
 * Get a single project by id, returns null in SSR context.
 */
export function getProjectDetail(id: string): ProjectDetail | null {
  if (typeof window === 'undefined') return null;
  const lib = getUserLibrary(id);
  if (!lib) return null;
  return {
    ...lib,
    stageProgress: getStageProgress(lib),
  };
}

/**
 * Compute progress metrics from a library's stages.
 */
export function getStageProgress(library: UserLibrary): StageProgress {
  const stages = library.stages ?? [];
  const active = stages.filter((s) => s.status === 'active').length;
  const done = stages.filter((s) => s.status === 'done').length;
  const totalPapers = new Set(stages.flatMap((s) => s.paperIds ?? [])).size;
  return { active, done, totalPapers };
}

/**
 * Subscribe to library and stage changes.
 * Returns unsubscribe handle that removes all listeners.
 *
 * Listens to:
 * - DPR_USER_LIBRARIES_CHANGE event
 * - DPR_PROJECT_STAGE_CHANGE event
 * - storage event for cross-tab sync (dpr_user_libraries_v1 key)
 */
export function subscribeLibraries(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const target = window;
  const off1 = onDprUserLibrariesChange(target, handler);
  const off2 = onDprProjectStageChange(target, handler);

  const onStorage = (e: StorageEvent): void => {
    if (e.key === 'dpr_user_libraries_v1') {
      handler();
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    off1();
    off2();
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Create a new project/library.
 * Returns the created library id on success, null on failure.
 */
export function createProject(
  name: string,
  statement: string,
  hue: LibraryHue = 'emerald',
): string | null {
  if (typeof window === 'undefined') return null;
  const result = createLibrary({ name, statement, hue });
  return result.ok && result.id ? result.id : null;
}

/**
 * Add a stage to a project.
 * Returns stage id on success.
 */
export function createStage(projectId: string, stageName: string): string | null {
  if (typeof window === 'undefined') return null;
  const result = addStage(projectId, stageName);
  return result.ok && result.stageId ? result.stageId : null;
}

/**
 * Rename an existing stage.
 */
export function updateStageName(
  projectId: string,
  stageId: string,
  newName: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const result = renameStage(projectId, stageId, newName);
  return result.ok;
}

/**
 * Archive a stage (mark as done).
 */
export function completeStage(projectId: string, stageId: string): boolean {
  if (typeof window === 'undefined') return false;
  const result = archiveStage(projectId, stageId);
  return result.ok;
}

/**
 * Add a paper to a stage.
 */
export function addPaperToProjectStage(
  projectId: string,
  stageId: string,
  arxivId: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const result = addPaperToStage(projectId, stageId, arxivId);
  return result.ok;
}

/**
 * Remove a paper from a stage.
 */
export function removePaperFromProjectStage(
  projectId: string,
  stageId: string,
  arxivId: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const result = removePaperFromStage(projectId, stageId, arxivId);
  return result.ok;
}

/**
 * Get drafts for a project.
 */
export async function getProjectDrafts(
  projectId: string,
): Promise<Array<{ id: string; title: string; savedAt: number; wordCount: number }>> {
  if (typeof window === 'undefined') return [];
  const drafts = await listDraftsByProject(projectId);
  return drafts.map((d) => ({
    id: d.id,
    title: d.title,
    savedAt: d.savedAt,
    wordCount: d.wordCount,
  }));
}

/**
 * Trigger a manual refresh of the libraries (useful after external changes).
 */
export function refreshProjects(): void {
  if (typeof window === 'undefined') return;
  emitDprUserLibrariesChange(window, { ids: [], reason: 'sync' });
}

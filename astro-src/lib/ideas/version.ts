// astro-src/lib/ideas/version.ts
//
// R7 E.1.2: Idea versioning.
//
// Version history management for ideas:
//   - IdeaVersion interface
//   - snapshotIdea(idea): create a new version
//   - getVersionHistory(ideaId): read from localStorage
//   - diffVersions(a, b): compute diff stats

import type { Idea } from './types';

/** Storage key for idea versions. */
export const IDEA_VERSIONS_KEY = 'dpr_idea_versions_v1';

/**
 * Idea version stored in localStorage.
 */
export interface StoredIdeaVersion {
  ideaId: string;
  version: number;
  content: {
    title: string;
    description: string;
    status: string;
  };
  savedAt: number; // timestamp ms
  sha?: string; // optional git-like hash
}

/** Diff result between two versions. */
export interface VersionDiff {
  linesAdded: number;
  linesRemoved: number;
  similarity: number; // 0..1, Jaccard similarity on lines
}

/**
 * Snapshot an idea to create a new version.
 *
 * @param idea - The idea to snapshot
 * @returns The stored version (not persisted yet)
 */
export function snapshotIdea(idea: Idea): StoredIdeaVersion {
  return {
    ideaId: idea.id,
    version: (idea.currentVersion ?? 0) + 1,
    content: {
      title: idea.title,
      description: idea.description,
      status: idea.status,
    },
    savedAt: Date.now(),
    sha: generateSha(),
  };
}

/**
 * Get version history for an idea from localStorage.
 *
 * @param ideaId - The idea ID
 * @returns Array of stored versions, sorted by version desc
 */
export function getVersionHistory(ideaId: string): StoredIdeaVersion[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(IDEA_VERSIONS_KEY);
    if (!raw) return [];

    const all = JSON.parse(raw) as StoredIdeaVersion[];
    return all
      .filter((v) => v.ideaId === ideaId)
      .sort((a, b) => b.version - a.version);
  } catch {
    return [];
  }
}

/**
 * Save a version to localStorage.
 *
 * @param version - The version to save
 */
export function saveVersion(version: StoredIdeaVersion): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(IDEA_VERSIONS_KEY);
    const all: StoredIdeaVersion[] = raw ? JSON.parse(raw) : [];

    // Add or update
    const existingIdx = all.findIndex(
      (v) => v.ideaId === version.ideaId && v.version === version.version
    );

    if (existingIdx >= 0) {
      all[existingIdx] = version;
    } else {
      all.push(version);
    }

    localStorage.setItem(IDEA_VERSIONS_KEY, JSON.stringify(all));
  } catch (e) {
    console.error('[ideas/version] Failed to save version:', e);
  }
}

/**
 * Compute diff between two versions.
 *
 * @param a - Earlier version
 * @param b - Later version
 * @returns Diff stats
 */
export function diffVersions(a: StoredIdeaVersion, b: StoredIdeaVersion): VersionDiff {
  const linesA = (a.content.description || '').split('\n').filter(Boolean);
  const linesB = (b.content.description || '').split('\n').filter(Boolean);

  const setA = new Set(linesA);
  const setB = new Set(linesB);

  let linesRemoved = 0;
  for (const line of linesA) {
    if (!setB.has(line)) linesRemoved++;
  }

  let linesAdded = 0;
  for (const line of linesB) {
    if (!setA.has(line)) linesAdded++;
  }

  // Jaccard similarity
  const union = new Set([...linesA, ...linesB]);
  const intersection = new Set([...linesA].filter((l) => setB.has(l)));
  const similarity = union.size > 0 ? intersection.size / union.size : 1;

  return {
    linesAdded,
    linesRemoved,
    similarity: Math.round(similarity * 1000) / 1000,
  };
}

/**
 * Delete all versions for an idea.
 *
 * @param ideaId - The idea ID
 */
export function clearVersionHistory(ideaId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(IDEA_VERSIONS_KEY);
    if (!raw) return;

    const all = JSON.parse(raw) as StoredIdeaVersion[];
    const filtered = all.filter((v) => v.ideaId !== ideaId);

    localStorage.setItem(IDEA_VERSIONS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('[ideas/version] Failed to clear versions:', e);
  }
}

/**
 * Generate a simple SHA-like hash.
 */
function generateSha(): string {
  const chars = '0123456789abcdef';
  let sha = '';
  for (let i = 0; i < 40; i++) {
    sha += chars[Math.floor(Math.random() * chars.length)];
  }
  return sha;
}

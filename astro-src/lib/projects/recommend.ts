// astro-src/lib/projects/recommend.ts
//
// Dashboard summary for reading dashboard.
// Aggregates user library, project activity, and paper recommendations.

import { buildUserLibrarySnapshot } from '../user-library/snapshot';
import { loadUserLibraries } from '../user-libraries/store';
import { listDraftsByProject } from './draft-store';
import { listByKind } from './activity';
import { findRelatedForList } from '../paper-relations/list-related';

export interface DashboardSummary {
  byStatus: { unread: number; reading: number; read: number };
  staleReads: Array<{ arxivId: string; lastTouchDays: number }>;
  newRelated: Array<{
    arxivId: string;
    relatedSinceDays: number;
    relatedToIds: string[];
    source: 'paper-relations' | 'embedding-cache';
  }>;
  weeklyAdds: number;
  totalProjects: number;
  totalDrafts: number;
  totalWords: number;
}

/**
 * Build dashboard summary for reading dashboard.
 */
export async function buildDashboardSummary(opts?: {
  staleDays?: number;
  newRelatedLimit?: number;
}): Promise<DashboardSummary> {
  const staleDays = opts?.staleDays ?? 30;
  const newRelatedLimit = opts?.newRelatedLimit ?? 5;

  // 1. byStatus - aggregate from user library snapshot
  const snapshot = buildUserLibrarySnapshot();
  const byStatus = { unread: 0, reading: 0, read: 0 };

  for (const [, status] of snapshot.status) {
    if (status === 'reading') byStatus.reading++;
    else if (status === 'read') byStatus.read++;
    else byStatus.unread++;
  }

  // Count papers not in status map as unread
  const statusIds = new Set(snapshot.status.keys());
  const allStarredOrNoted = new Set([
    ...snapshot.starred,
    ...Array.from(snapshot.notes.keys()),
  ]);
  for (const id of allStarredOrNoted) {
    if (!statusIds.has(id)) {
      byStatus.unread++;
    }
  }

  // 2. staleReads - find papers with status-changed more than staleDays ago
  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  const staleReads: Array<{ arxivId: string; lastTouchDays: number }> = [];

  // Get starred/reading/read papers
  const statusPapers: string[] = [];
  for (const [id, status] of snapshot.status) {
    if (status === 'reading' || status === 'read') {
      statusPapers.push(id);
    }
  }

  // For each paper with status, check last touch from activity log
  for (const arxivId of statusPapers) {
    const activities = await listByKind('', 'status-changed', staleThreshold);
    const paperActivities = activities.filter((a) => a.arxivId === arxivId);
    if (paperActivities.length > 0) {
      const latest = paperActivities[0];
      const days = Math.floor((Date.now() - latest.at) / (24 * 60 * 60 * 1000));
      if (days >= staleDays) {
        staleReads.push({ arxivId, lastTouchDays: days });
      }
    } else {
      // Fallback: no activity log, check updatedAt from snapshot as upper bound
      // This is less precise but provides some data
      const paperState = snapshot.status.get(arxivId);
      if (!paperState) {
        // Not in snapshot status map - skip
        continue;
      }
      // If no activity log exists, we can't calculate precise days
      // Skip for now - real implementation would need user-library store updatedAt
    }
  }

  // 3. newRelated - find papers related to user's library papers
  const newRelated: Array<{
    arxivId: string;
    relatedSinceDays: number;
    relatedToIds: string[];
    source: 'paper-relations' | 'embedding-cache';
  }> = [];

  // Get starred papers as base for finding related
  const libraryPaperIds = Array.from(snapshot.starred);
  if (libraryPaperIds.length > 0) {
    // Need PaperListItem for findRelatedForList
    // In real implementation, would fetch from PaperRepository
    // For now, we'll create a placeholder approach
    try {
      const related = await findRelatedForList(libraryPaperIds, {
        papers: [], // Would need PaperListItem array
        algorithm: 'hybrid',
        topK: 12,
        minWeight: 0.05,
        queryLimit: 50,
      });

      for (const r of related.slice(0, newRelatedLimit)) {
        newRelated.push({
          arxivId: r.arxivId,
          relatedSinceDays: 0, // Would calculate from paper date
          relatedToIds: r.relatedTo,
          source: 'paper-relations',
        });
      }
    } catch {
      // findRelatedForList may fail if papers array not provided
      // Continue with empty newRelated
    }
  }

  // 4. weeklyAdds - count papers added in last 7 days
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyAdds = await countWeeklyAdds(weekAgo);

  // 5. totalProjects - count user libraries
  const librariesDoc = loadUserLibraries();
  const totalProjects = Object.keys(librariesDoc.libraries).length;

  // 6. totalDrafts and totalWords - aggregate from all projects
  let totalDrafts = 0;
  let totalWords = 0;

  const projectIds = Object.keys(librariesDoc.libraries);
  // N+1 acceptable for <=50 projects as per spec
  const DRAFT_LIMIT = 50;
  const projectsToCheck = projectIds.slice(0, DRAFT_LIMIT);

  for (const projectId of projectsToCheck) {
    try {
      const drafts = await listDraftsByProject(projectId);
      totalDrafts += drafts.length;
      for (const d of drafts) {
        totalWords += d.wordCount;
      }
    } catch {
      // Skip failed project
    }
  }

  return {
    byStatus,
    staleReads: staleReads.slice(0, 10), // Limit stale reads display
    newRelated,
    weeklyAdds,
    totalProjects,
    totalDrafts,
    totalWords,
  };
}

/**
 * Count papers added in last week (via activity log).
 */
async function countWeeklyAdds(sinceMs: number): Promise<number> {
  const activities = await listByKind('', 'added-to-stage', sinceMs);
  // Deduplicate by arxivId
  const addedIds = new Set<string>();
  for (const a of activities) {
    addedIds.add(a.arxivId);
  }
  return addedIds.size;
}

// astro-src/lib/roadmap/client.ts
//
// Client-side roadmap operations using localStorage.

import type { Roadmap, RoadmapGoal, RoadmapQuarter } from './types';

const ROADMAP_STORAGE_KEY = 'dpr_roadmaps';

/** Get all roadmaps from localStorage */
export function getClientRoadmaps(): Roadmap[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(ROADMAP_STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/** Save roadmaps to localStorage */
export function saveClientRoadmaps(roadmaps: Roadmap[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ROADMAP_STORAGE_KEY, JSON.stringify(roadmaps));
}

/** Create a new roadmap */
export function createRoadmap(data: Omit<Roadmap, 'id' | 'createdAt' | 'updatedAt'>): Roadmap {
  const roadmaps = getClientRoadmaps();
  const id = `roadmap-${Date.now()}`;
  const now = new Date().toISOString();
  const newRoadmap: Roadmap = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };
  roadmaps.push(newRoadmap);
  saveClientRoadmaps(roadmaps);
  return newRoadmap;
}

/** Update an existing roadmap */
export function updateRoadmap(id: string, updates: Partial<Roadmap>): Roadmap | null {
  const roadmaps = getClientRoadmaps();
  const idx = roadmaps.findIndex(r => r.id === id);
  if (idx === -1) return null;
  roadmaps[idx] = {
    ...roadmaps[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveClientRoadmaps(roadmaps);
  return roadmaps[idx];
}

/** Update goal status */
export function updateGoalStatus(roadmapId: string, quarterId: string, goalId: string, status: RoadmapGoal['status']): Roadmap | null {
  const roadmaps = getClientRoadmaps();
  const roadmap = roadmaps.find(r => r.id === roadmapId);
  if (!roadmap) return null;

  const quarter = roadmap.quarters.find(q => q.id === quarterId);
  if (!quarter) return null;

  const goal = quarter.goals.find(g => g.id === goalId);
  if (!goal) return null;

  goal.status = status;
  roadmap.updatedAt = new Date().toISOString();
  saveClientRoadmaps(roadmaps);
  return roadmap;
}

/** Delete a roadmap */
export function deleteRoadmap(id: string): boolean {
  const roadmaps = getClientRoadmaps();
  const idx = roadmaps.findIndex(r => r.id === id);
  if (idx === -1) return false;
  roadmaps.splice(idx, 1);
  saveClientRoadmaps(roadmaps);
  return true;
}

/** Add a goal to a quarter */
export function addGoal(roadmapId: string, quarterId: string, goal: Omit<RoadmapGoal, 'id'>): Roadmap | null {
  const roadmaps = getClientRoadmaps();
  const roadmap = roadmaps.find(r => r.id === roadmapId);
  if (!roadmap) return null;

  const quarter = roadmap.quarters.find(q => q.id === quarterId);
  if (!quarter) return null;

  const newId = String(quarter.goals.length + 1);
  quarter.goals.push({ ...goal, id: newId });
  roadmap.updatedAt = new Date().toISOString();
  saveClientRoadmaps(roadmaps);
  return roadmap;
}

/** Add a quarter to a roadmap */
export function addQuarter(roadmapId: string, quarter: Omit<RoadmapQuarter, 'id'>): Roadmap | null {
  const roadmaps = getClientRoadmaps();
  const roadmap = roadmaps.find(r => r.id === roadmapId);
  if (!roadmap) return null;

  const newId = `${quarter.year}-Q${quarter.quarter}`;
  roadmap.quarters.push({ ...quarter, id: newId });
  roadmap.updatedAt = new Date().toISOString();
  saveClientRoadmaps(roadmaps);
  return roadmap;
}

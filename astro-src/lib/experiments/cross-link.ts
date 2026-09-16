// astro-src/lib/experiments/cross-link.ts
//
// R7 LP.3: Experiment ↔ idea cross-linking.
//
// Link experiments to ideas and manage bidirectional relationships.

const STORAGE_KEY = 'dpr_experiment_idea_links_v1';

/** Link storage structure. */
interface LinksStorage {
  experimentToIdea: Record<string, string>; // experimentId -> ideaId
  ideaToExperiments: Record<string, string[]>; // ideaId -> experimentIds[]
}

/**
 * Get links from storage.
 */
function getStorage(): LinksStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { experimentToIdea: {}, ideaToExperiments: {} };
  } catch {
    return { experimentToIdea: {}, ideaToExperiments: {} };
  }
}

/**
 * Save links to storage.
 */
function setStorage(storage: LinksStorage): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
}

/**
 * Link an experiment to an idea.
 *
 * @param experimentId - The experiment ID
 * @param ideaId - The idea ID
 * @returns true if linked successfully
 */
export function linkExperimentToIdea(
  experimentId: string,
  ideaId: string
): boolean {
  const storage = getStorage();

  // Remove any existing link for this experiment
  const existingIdea = storage.experimentToIdea[experimentId];
  if (existingIdea && existingIdea !== ideaId) {
    storage.ideaToExperiments[existingIdea] = storage.ideaToExperiments[existingIdea]?.filter(
      (id) => id !== experimentId
    ) || [];
  }

  // Create new link
  storage.experimentToIdea[experimentId] = ideaId;

  // Update reverse index
  if (!storage.ideaToExperiments[ideaId]) {
    storage.ideaToExperiments[ideaId] = [];
  }
  if (!storage.ideaToExperiments[ideaId].includes(experimentId)) {
    storage.ideaToExperiments[ideaId].push(experimentId);
  }

  setStorage(storage);
  return true;
}

/**
 * Unlink an experiment from its idea.
 *
 * @param experimentId - The experiment ID
 * @param ideaId - The idea ID to unlink from
 * @returns true if unlinked successfully
 */
export function unlinkExperiment(
  experimentId: string,
  ideaId: string
): boolean {
  const storage = getStorage();

  // Check if link exists
  if (storage.experimentToIdea[experimentId] !== ideaId) {
    return false;
  }

  // Remove experiment->idea link
  delete storage.experimentToIdea[experimentId];

  // Update reverse index
  if (storage.ideaToExperiments[ideaId]) {
    storage.ideaToExperiments[ideaId] = storage.ideaToExperiments[ideaId].filter(
      (id) => id !== experimentId
    );
    // Clean up empty arrays
    if (storage.ideaToExperiments[ideaId].length === 0) {
      delete storage.ideaToExperiments[ideaId];
    }
  }

  setStorage(storage);
  return true;
}

/**
 * Get the idea linked to an experiment.
 *
 * @param experimentId - The experiment ID
 * @returns The idea ID or null if not linked
 */
export function getLinkedIdea(experimentId: string): string | null {
  const storage = getStorage();
  return storage.experimentToIdea[experimentId] || null;
}

/**
 * Get all experiments linked to an idea.
 *
 * @param ideaId - The idea ID
 * @returns Array of experiment IDs
 */
export function getLinkedExperiments(ideaId: string): string[] {
  const storage = getStorage();
  return storage.ideaToExperiments[ideaId] || [];
}

/**
 * Get all idea IDs that have linked experiments.
 *
 * @returns Array of idea IDs
 */
export function getAllLinkedIdeas(): string[] {
  const storage = getStorage();
  return Object.keys(storage.ideaToExperiments);
}

/**
 * Clear all links (for testing/reset).
 */
export function clearAllLinks(): void {
  setStorage({ experimentToIdea: {}, ideaToExperiments: {} });
}

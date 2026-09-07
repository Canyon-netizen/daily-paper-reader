// astro-src/lib/ideas/types.ts
// Ideas module TypeScript types

/** Lifecycle status for an idea */
export type IdeaStatus = 'draft' | 'active' | 'promoted' | 'archived';

/** Reference to a paper by canonical arXiv ID */
export interface PaperRef {
  arxivId: string;
  context?: string; // Why this paper is relevant
}

/** Main Idea interface */
export interface Idea {
  /** kebab-case slug, auto-generated from title */
  id: string;
  /** Title, 1-100 chars */
  title: string;
  /** Detailed description, markdown */
  description: string;
  /** Lifecycle status */
  status: IdeaStatus;
  /** Papers related to this idea (canonical IDs) */
  relatedPapers: string[];
  /** Concepts this idea relates to */
  relatedConcepts: string[];
  /** User-defined tags */
  tags: string[];
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
}

/** Storage document structure */
export interface IdeasDoc {
  schemaVersion: 1;
  ideas: Record<string, Idea>;
}

/** Storage key constant */
export const IDEAS_KEY = 'dpr_ideas_v1';

/** Create a new idea with generated ID */
export function createIdeaData(
  title: string,
  description: string,
  relatedPapers: string[] = [],
  tags: string[] = []
): Idea {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled-idea';

  const now = Date.now();
  return {
    id,
    title,
    description,
    status: 'draft',
    relatedPapers,
    relatedConcepts: [],
    tags,
    createdAt: now,
    updatedAt: now,
  };
}

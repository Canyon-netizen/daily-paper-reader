// astro-src/lib/roadmap/types.ts
//
// Types for the research roadmap timeline feature.

/** A single goal within a quarter */
export interface RoadmapGoal {
  id: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  status: 'pending' | 'in-progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  dueDate?: string; // ISO date for milestone tracking
  sprint?: string; // e.g., "Sprint 1", "Sprint 2" for industry workflow
}

/** A quarter within a roadmap */
export interface RoadmapQuarter {
  id: string; // e.g., "2026-Q3"
  year: number;
  quarter: 1 | 2 | 3 | 4;
  title: string;
  titleZh: string;
  granularity: 'quarter' | 'month' | 'sprint'; // Issue #8: support different granularity
  goals: RoadmapGoal[];
}

/** A complete roadmap */
export interface Roadmap {
  id: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  type: 'phd' | 'industry' | 'personal';
  owner: string;
  startDate: string;
  endDate: string;
  quarters: RoadmapQuarter[];
  linked_ideas: string[]; // IDs of related ideas
  linked_experiments: string[]; // IDs of related experiments
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Frontmatter parsed from a roadmap markdown file */
export interface RoadmapFrontmatter {
  title: string;
  title_zh: string;
  description: string;
  description_zh: string;
  type: 'phd' | 'industry' | 'personal';
  owner: string;
  start_date: string;
  end_date: string;
  linked_ideas: string[];
  linked_experiments: string[];
  tags: string[];
}

/** Aggregated summary for list view */
export interface RoadmapSummary {
  id: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  type: Roadmap['type'];
  owner: string;
  startDate: string;
  endDate: string;
  totalGoals: number;
  completedGoals: number;
  inProgressGoals: number;
  experimentProgress: number; // Weighted progress from linked experiments (0-1)
  quarters: string[];
  tags: string[];
}

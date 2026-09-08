// astro-src/lib/research/index.ts
//
// Cross-module research data aggregation.
// Provides unified view of ideas, experiments, writings, and roadmaps.

import type { Idea, IdeaStatus } from '../ideas/types';
import type { Experiment, ExperimentStatus } from '../experiments/types';
import type { Writing } from '../writing/types';
import type { RoadmapGoal } from '../roadmap/types';

// Import from existing modules
import { loadIdeas, getIdeaCounts } from '../ideas';
import { loadExperiments, getExperimentCounts } from '../experiments';
import { listWritings } from '../writing';
import { listRoadmaps, getRoadmap } from '../roadmap';

/** Research module types */
export interface ResearchStats {
  ideas: {
    total: number;
    byStatus: Record<IdeaStatus, number>;
  };
  experiments: {
    total: number;
    byStatus: Record<ExperimentStatus, number>;
  };
  writings: {
    total: number;
    drafts: number;
    published: number;
  };
  roadmaps: {
    total: number;
    active: number;
  };
  currentQuarter: string;
  /** Weekly activity counts: { weekStartDate: { ideas: number, experiments: number, writings: number } } */
  weeklyActivity: Record<string, { ideas: number; experiments: number; writings: number }>;
}

/** Research item for dashboard display */
export interface ResearchItem {
  module: 'idea' | 'experiment' | 'writing' | 'roadmap';
  id: string;
  title: string;
  titleZh?: string;
  status: string;
  tags: string[];
  updatedAt: string;
  description?: string;
  url: string;
}

/** Get aggregated research statistics */
export function getResearchStats(): ResearchStats {
  // Ideas
  const ideasDoc = loadIdeas();
  const ideas = Object.values(ideasDoc.ideas);
  const ideaCounts = getIdeaCounts();

  // Experiments
  const experimentsDoc = loadExperiments();
  const experiments = Object.values(experimentsDoc.experiments);
  const experimentCounts = getExperimentCounts();

  // Writings
  const writings = listWritings();
  const draftWritings = writings.filter(w => w.status === 'draft');
  const finalWritings = writings.filter(w => w.status === 'final');

  // Roadmaps
  const roadmaps = listRoadmaps();
  const activeRoadmaps = roadmaps.filter(r => {
    const now = new Date();
    const start = new Date(r.startDate);
    const end = new Date(r.endDate);
    return now >= start && now <= end;
  });

  // Current quarter
  const now = new Date();
  const currentQuarter = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;

  // Weekly activity - last 8 weeks
  const weeklyActivity = computeWeeklyActivity(ideas, experiments, writings);

  return {
    ideas: {
      total: ideas.length,
      byStatus: ideaCounts,
    },
    experiments: {
      total: experiments.length,
      byStatus: experimentCounts,
    },
    writings: {
      total: writings.length,
      drafts: draftWritings.length,
      published: finalWritings.length,
    },
    roadmaps: {
      total: roadmaps.length,
      active: activeRoadmaps.length,
    },
    currentQuarter,
    weeklyActivity,
  };
}

/** Compute weekly activity counts for the last 8 weeks */
function computeWeeklyActivity(
  ideas: any[],
  experiments: any[],
  writings: any[]
): Record<string, { ideas: number; experiments: number; writings: number }> {
  const result: Record<string, { ideas: number; experiments: number; writings: number }> = {};
  const now = new Date();

  // Generate last 8 weeks' start dates (Monday)
  for (let i = 0; i < 8; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - (i * 7 + date.getDay() - 1)); // Get Monday of each week
    const weekKey = date.toISOString().split('T')[0];
    result[weekKey] = { ideas: 0, experiments: 0, writings: 0 };
  }

  // Count ideas created each week
  for (const idea of ideas) {
    const createdAt = new Date(idea.createdAt);
    const weekStart = getWeekStart(createdAt);
    if (result[weekStart]) {
      result[weekStart].ideas++;
    }
  }

  // Count experiments created each week
  for (const exp of experiments) {
    const createdAt = new Date(exp.createdAt);
    const weekStart = getWeekStart(createdAt);
    if (result[weekStart]) {
      result[weekStart].experiments++;
    }
  }

  // Count writings created each week
  for (const writing of writings) {
    const createdAt = new Date(writing.createdAt);
    const weekStart = getWeekStart(createdAt);
    if (result[weekStart]) {
      result[weekStart].writings++;
    }
  }

  return result;
}

/** Get the Monday of the week for a given date */
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

/** Get active ideas (status: active) */
export function getActiveIdeas(limit: number = 5): ResearchItem[] {
  const ideasDoc = loadIdeas();
  const ideas = Object.values(ideasDoc.ideas)
    .filter((idea: Idea) => idea.status === 'active')
    .sort((a: Idea, b: Idea) => b.updatedAt - a.updatedAt)
    .slice(0, limit);

  return ideas.map((idea: Idea) => ({
    module: 'idea' as const,
    id: idea.id,
    title: idea.title,
    status: idea.status,
    tags: idea.tags,
    updatedAt: new Date(idea.updatedAt).toISOString(),
    description: idea.description,
    url: `/ideas/${idea.id}/`,
  }));
}

/** Get running experiments (status: running) */
export function getRunningExperiments(limit: number = 5): ResearchItem[] {
  const experimentsDoc = loadExperiments();
  const experiments = Object.values(experimentsDoc.experiments)
    .filter((exp: Experiment) => exp.status === 'running')
    .sort((a: Experiment, b: Experiment) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  return experiments.map((exp: Experiment) => ({
    module: 'experiment' as const,
    id: exp.id,
    title: exp.title,
    titleZh: exp.titleZh,
    status: exp.status,
    tags: exp.tags,
    updatedAt: exp.updatedAt,
    description: exp.hypothesis,
    url: `/experiments/${exp.id}/`,
  }));
}

/** Get draft writings */
export function getDraftWritings(limit: number = 5): ResearchItem[] {
  const writings = listWritings()
    .filter((w: Writing) => w.status === 'draft')
    .sort((a: Writing, b: Writing) => b.updatedAt - a.updatedAt)
    .slice(0, limit);

  return writings.map((w: Writing) => ({
    module: 'writing' as const,
    id: w.id,
    title: w.title,
    status: w.status,
    tags: w.type ? [w.type] : [],
    updatedAt: new Date(w.updatedAt).toISOString(),
    description: w.sections?.find(s => s.id === 'abstract')?.content?.slice(0, 100),
    url: `/writing/${w.id}/`,
  }));
}

/** Get active roadmap goals */
export function getCurrentQuarterGoals(): ResearchItem[] {
  const roadmapSummaries = listRoadmaps();
  const items: ResearchItem[] = [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);

  for (const summary of roadmapSummaries) {
    // Get full roadmap data for quarters
    const roadmap = getRoadmap(summary.id);
    if (!roadmap) continue;

    // Find current quarter
    const quarter = roadmap.quarters.find(q => {
      const [year, qNum] = q.id.split('-Q').map(Number);
      return year === currentYear && qNum === currentQuarter;
    });

    if (quarter) {
      for (const goal of quarter.goals) {
        if (goal.status === 'in-progress' || goal.status === 'pending') {
          items.push({
            module: 'roadmap' as const,
            id: `${roadmap.id}-${goal.id}`,
            title: goal.title,
            titleZh: goal.titleZh,
            status: goal.status,
            tags: [goal.priority],
            updatedAt: now.toISOString(),
            description: goal.description || goal.descriptionZh,
            url: `/roadmap/${roadmap.id}/`,
          });
        }
      }
    }
  }

  return items.slice(0, 5);
}

/** Get all research items for dashboard */
export function getResearchDashboard() {
  const stats = getResearchStats();

  return {
    stats,
    activeIdeas: getActiveIdeas(5),
    runningExperiments: getRunningExperiments(5),
    draftWritings: getDraftWritings(5),
    currentGoals: getCurrentQuarterGoals(),
  };
}

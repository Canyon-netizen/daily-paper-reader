// astro-src/lib/roadmap/index.ts
//
// Data access layer for roadmap timeline. Reads from docs/roadmap/*.md

import fs from 'node:fs';
import path from 'node:path';
import type { Roadmap, RoadmapSummary, RoadmapFrontmatter, RoadmapQuarter, RoadmapGoal } from './types';

const ROADMAP_DIR = path.join(process.cwd(), 'docs', 'roadmap');

function parseFrontmatter(content: string): RoadmapFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm: Record<string, string | string[]> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Handle array values
    if (value.startsWith('[') && value.endsWith(']')) {
      const arrContent = value.slice(1, -1);
      if (arrContent.trim()) {
        fm[key] = arrContent.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        fm[key] = [];
      }
    } else {
      fm[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return {
    title: fm.title as string || '',
    title_zh: fm.title_zh as string || '',
    description: fm.description as string || '',
    description_zh: fm.description_zh as string || '',
    type: fm.type as Roadmap['type'] || 'personal',
    owner: fm.owner as string || '',
    start_date: fm.start_date as string || '',
    end_date: fm.end_date as string || '',
    linked_ideas: (fm.linked_ideas as string[]) || [],
    linked_experiments: (fm.linked_experiments as string[]) || [],
    tags: (fm.tags as string[]) || [],
  };
}

function parseGoalsFromContent(content: string): RoadmapGoal[] {
  const goals: RoadmapGoal[] = [];
  const lines = content.split('\n');
  let currentGoal: Partial<RoadmapGoal> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match goal headers like "### G1: Goal Title"
    const goalMatch = trimmed.match(/^###\s+G(\d+):\s+(.+)$/);
    if (goalMatch) {
      if (currentGoal && currentGoal.id) {
        goals.push(currentGoal as RoadmapGoal);
      }
      currentGoal = {
        id: goalMatch[1],
        title: goalMatch[2],
        titleZh: '',
        description: '',
        descriptionZh: '',
        status: 'pending',
        priority: 'medium',
      };
      continue;
    }

    // Match metadata lines like "- **Status**: pending"
    if (currentGoal) {
      const statusMatch = trimmed.match(/^\*\*(Status|状态)\*\*:\s*(\w+)/);
      if (statusMatch) {
        currentGoal.status = statusMatch[2] as RoadmapGoal['status'];
        continue;
      }

      const priorityMatch = trimmed.match(/^\*\*(Priority|优先级)\*\*:\s*(\w+)/);
      if (priorityMatch) {
        currentGoal.priority = priorityMatch[2] as RoadmapGoal['priority'];
        continue;
      }

      const zhTitleMatch = trimmed.match(/^\*\*(TitleZh|中文标题)\*\*:\s+(.+)$/);
      if (zhTitleMatch) {
        currentGoal.titleZh = zhTitleMatch[1].trim();
        continue;
      }

      const descMatch = trimmed.match(/^\*\*(Description|描述)\*\*:\s+(.+)$/);
      if (descMatch) {
        currentGoal.description = descMatch[1].trim();
        continue;
      }

      const descZhMatch = trimmed.match(/^\*\*(DescriptionZh|中文描述)\*\*:\s+(.+)$/);
      if (descZhMatch) {
        currentGoal.descriptionZh = descZhMatch[1].trim();
        continue;
      }
    }
  }

  if (currentGoal && currentGoal.id) {
    goals.push(currentGoal as RoadmapGoal);
  }

  return goals;
}

function parseQuartersFromContent(content: string): RoadmapQuarter[] {
  const quarters: RoadmapQuarter[] = [];
  const quarterBlocks = content.split(/^##\s+Q(\d)/m);

  for (let i = 1; i < quarterBlocks.length; i += 2) {
    const qNum = parseInt(quarterBlocks[i]);
    const qContent = quarterBlocks[i + 1] || '';

    // Extract quarter title from first line
    const titleMatch = qContent.match(/^([^\n]+)/);
    const title = titleMatch ? titleMatch[1].trim() : `Q${qNum}`;

    // Extract year from content
    const yearMatch = qContent.match(/(20\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

    const goals = parseGoalsFromContent(qContent);

    quarters.push({
      id: `${year}-Q${qNum}`,
      year,
      quarter: qNum as 1 | 2 | 3 | 4,
      title,
      titleZh: title, // Could be enhanced with explicit zh title
      goals,
    });
  }

  return quarters;
}

function parseRoadmapFile(filePath: string): Roadmap | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) return null;

    const quarters = parseQuartersFromContent(content);
    const fileName = path.basename(filePath, '.md');
    const now = new Date().toISOString();

    return {
      id: fileName,
      title: fm.title,
      titleZh: fm.title_zh,
      description: fm.description,
      descriptionZh: fm.description_zh,
      type: fm.type,
      owner: fm.owner,
      startDate: fm.start_date,
      endDate: fm.end_date,
      quarters,
      linked_ideas: fm.linked_ideas,
      linked_experiments: fm.linked_experiments,
      tags: fm.tags,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    console.error(`[roadmap] Failed to parse ${filePath}:`, err);
    return null;
  }
}

/** List all roadmaps with summary info */
export function listRoadmaps(): RoadmapSummary[] {
  if (!fs.existsSync(ROADMAP_DIR)) {
    return [];
  }

  const files = fs.readdirSync(ROADMAP_DIR).filter(f => f.endsWith('.md'));
  const summaries: RoadmapSummary[] = [];

  for (const file of files) {
    const roadmap = parseRoadmapFile(path.join(ROADMAP_DIR, file));
    if (!roadmap) continue;

    let completedGoals = 0;
    let inProgressGoals = 0;

    for (const q of roadmap.quarters) {
      for (const g of q.goals) {
        if (g.status === 'completed') completedGoals++;
        else if (g.status === 'in-progress') inProgressGoals++;
      }
    }

    summaries.push({
      id: roadmap.id,
      title: roadmap.title,
      titleZh: roadmap.titleZh,
      description: roadmap.description,
      descriptionZh: roadmap.descriptionZh,
      type: roadmap.type,
      owner: roadmap.owner,
      startDate: roadmap.startDate,
      endDate: roadmap.endDate,
      totalGoals: roadmap.quarters.reduce((sum, q) => sum + q.goals.length, 0),
      completedGoals,
      inProgressGoals,
      quarters: roadmap.quarters.map(q => q.id),
      tags: roadmap.tags,
    });
  }

  // Sort by start date descending
  summaries.sort((a, b) => b.startDate.localeCompare(a.startDate));

  return summaries;
}

/** Get a single roadmap by ID */
export function getRoadmap(id: string): Roadmap | null {
  const filePath = path.join(ROADMAP_DIR, `${id}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return parseRoadmapFile(filePath);
}

/** Get all roadmap IDs for static path generation */
export function getAllRoadmapIds(): string[] {
  if (!fs.existsSync(ROADMAP_DIR)) {
    return [];
  }
  return fs.readdirSync(ROADMAP_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

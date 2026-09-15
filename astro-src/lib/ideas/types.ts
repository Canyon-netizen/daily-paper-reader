// astro-src/lib/ideas/types.ts
// Ideas module TypeScript types

/** Lifecycle status for an idea */
export type IdeaStatus = 'draft' | 'active' | 'promoted' | 'archived';

/** Reference to a paper by canonical arXiv ID */
export interface PaperRef {
  arxivId: string;
  context?: string; // Why this paper is relevant
}

/** Source of idea creation */
export type IdeaSource = 'paper-analyzer' | 'topic-frontier' | 'topic-approach' | 'manual';

/** Methodology nested structure for idea */
export interface IdeaMethodology {
  /** Observation - what was observed */
  observation?: string;
  /** Hypothesis - derived hypothesis */
  hypothesis?: string;
  /** Method - methodology description */
  method?: string;
  /** Findings - experimental findings */
  findings?: string;
}

/**
 * 历史快照 —— 每次 idea 状态或描述发生有意义的变化时,留一份。
 * E.1.2: idea versioning。version 从 1 开始单调递增。
 * 注意:初始创建时也会记录 v1,这样 version 字段语义统一。
 */
export interface IdeaVersion {
  version: number;
  timestamp: number;
  title: string;
  description: string;
  status: IdeaStatus;
  /** version 之间的 diff hint(纯描述性,不影响还原) */
  changeNote?: string;
}

/** Main Idea interface */
export interface Idea {
  /** kebab-case slug, auto-generated from title */
  id: string;
  /** Title, 1-100 chars */
  title: string;
  /** Detailed description, markdown */
  description: string;
  /** Methodology section (optional, default collapsed) */
  methodology?: IdeaMethodology;
  /** Lifecycle status */
  status: IdeaStatus;
  /** Papers related to this idea (canonical IDs) */
  relatedPapers: string[];
  /** Concepts this idea relates to */
  relatedConcepts: string[];
  /** User-defined tags */
  tags: string[];
  /** Source of idea creation */
  source?: IdeaSource;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
  /** E.1.2: 版本快照数组(旧 idea 可能没有 → undefined 视为空) */
  versions?: IdeaVersion[];
  /** E.1.2: 当前 version 号(若没有 versions 则视为 1) */
  currentVersion?: number;
}

/** Storage document structure */
export interface IdeasDoc {
  schemaVersion: 2;
  ideas: Record<string, Idea>;
}

/** Storage key constant */
export const IDEAS_KEY = 'dpr_ideas_v1';

/**
 * E.1.3: idea status 转换图。
 *
 * 状态语义:
 *   draft    — 还在脑子里,未开始任何探索
 *   active   — 正在调研 / 验证中
 *   promoted — 通过验证,升级为正式 research 项目
 *   archived — 已死 / 重复,不再 follow
 *
 * 转换规则:
 *   draft → active, archived
 *   active → promoted, archived
 *   promoted → active (退回), archived
 *   archived → draft, active
 *
 * 故意不允许:
 *   - draft → promoted(必须先 active)
 *   - promoted → draft(只能先回 active)
 *   - 自我循环(同状态之间不产生新版本)
 */
export const IDEA_STATUS_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  draft: ['active', 'archived'],
  active: ['promoted', 'archived'],
  promoted: ['active', 'archived'],
  archived: ['draft', 'active'],
};

/** 判断 from→to 是否合法转换。 */
export function canTransitionIdeaStatus(from: IdeaStatus, to: IdeaStatus): boolean {
  if (from === to) return false;
  return IDEA_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Create a new idea with generated ID */
export function createIdeaData(
  title: string,
  description: string,
  relatedPapers: string[] = [],
  tags: string[] = [],
  source?: IdeaSource
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
    source,
    createdAt: now,
    updatedAt: now,
    versions: [{ version: 1, timestamp: now, title, description, status: 'draft' }],
    currentVersion: 1,
  };
}
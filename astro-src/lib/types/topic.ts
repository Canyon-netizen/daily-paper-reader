// /lib/types/topic.ts — Topic session / report / candidate / debate 纯类型。
// 全部为 persistent / 跨模块传输用 DTO,运行时构造放 llm-clean/。
//
// 这些类型被多个 producer / consumer 共用:
//   - scripts/topic-search/* (producer:LLM response → topic session)、
//   - scripts/topic-search/state.ts (centralized in-memory session)、
//   - UI 渲染 / pages/topic.astro / sidebar chat.
//
// 不放算法、不放副作用。

import type { AnalysisResult, ArxivEntry } from '../../scripts/paper-analyzer';
import type { SubQ } from './subq';
import type { Facet } from './facet';
import type { ResourceTier } from './resource-tier';

export interface Candidate {
  arxivId: string;
  entry: ArxivEntry;
  selected: boolean;
}

export interface Summary {
  arxivId: string;
  subqId: string;
  summary: AnalysisResult;
  generatedAt: number;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** localStorage 序列化的单个主题会话。 */
export interface TopicSession {
  id: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  /** 阶段 1 拆解出的研究维度(显式 facet 层)。旧 session 无此字段 → undefined,
   *  UI 检测到空则隐藏 facet panel。 */
  facets?: Facet[];
  subqs: SubQ[];
  candidatesBySubq: Record<string, Candidate[]>;
  /** 阶段 3 子方向 group 折叠状态:subqId → 是否展开。 */
  candGroupExpanded?: Record<string, boolean>;
  /** 阶段 3 算力档位筛选器:'all' 显示全部;指定档位只显示该档位(可总结过)或显示 chip「未知」的候选。
   *  默认 'all'(旧 session 无此字段 → undefined,UI 视作 'all')。 */
  candResourceFilter?: ResourceTier | 'all';
  summaries: Summary[];
  chats: Record<string, ChatMsg[]>;
  /** 报告追问历史(阶段 5)。 */
  reportChats?: ChatMsg[];
  /** 主题报告(阶段 5 产物)。 */
  report?: TopicReport;
  /** 最近一次 doDecompose 拆解时参考的论文 ID。 */
  referenceSeedArxivIds?: string[];
  /** PR-6: Elo 辩论 stage 进度。 */
  debateProgress?: DebateProgress | null;
}

/** PR-6: 单个 idea 的 Elo 辩论快照。 */
export interface DebateIdea {
  id: string;
  title: string;
  /** 起始 Elo 评分(默认 1200)。 */
  elo_rating: number;
  /** 累计参与匹配次数。 */
  matches: number;
  /** 累计获胜次数(不含 tie)。 */
  wins: number;
  /** 单场失败明细。 */
  debate_errors?: Array<{ round: number; error: string }>;
  /** 单场辩论记录(transcript + result)。 */
  debate_log?: Array<any>;
}

export interface DebateProgress {
  sessionId: string;
  /** Swiss 配对后所有参与辩论的 idea 快照(按最终 elo_rating 降序)。 */
  ideas: DebateIdea[];
  /** 辩论所用 personas。 */
  personas: string[];
  /** 最近一次辩论时间戳。 */
  updatedAt: number;
}

/** localStorage schema 版本号(topic-search.ts 内部使用)。 */
export interface SessionStore {
  version: number;
  currentId: string | null;
  sessions: Record<string, TopicSession>;
}

// ============================================================================
// TopicReport (LLM-emitted 主题报告)
// ============================================================================

export interface TopicReportDimensionPaper {
  arxivId: string;
  role: string;       // 截断 24
  key: string;        // 截断 120
  method?: string;    // 截断 120
  result?: string;    // 截断 120
  note?: string;      // 截断 120
}

/** 研究思路(目标 5 的核心交付):把"做这个方向"拆成 idea + pipeline + 难度。 */
export interface ResearchApproach {
  /** 一句话核心思路:这个维度可以怎样入手/借鉴(≤ 80 字)。 */
  idea: string;
  /** 实施步骤:每步 ≤ 40 字,2-5 步。 */
  pipeline: string[];
  /** 实施难度(low / medium / high):对个人研究者或小团队。 */
  difficulty: 'low' | 'medium' | 'high';
  /** 预估耗时(周),1-52。LLM 估不出来时省略。 */
  estimatedTimeWeeks?: number;
  /** 对应的 nextStep.id(双向 anchor),可省略。 */
  tiedNextStep?: string;
}

export interface TopicReportDimension {
  name: string;                                  // 截断 30
  description?: string;                          // 截断 160
  papers: TopicReportDimensionPaper[];           // ≥ 1
  /** 目标 5:这个维度对应的研究思路(LLM 输出,可省略)。 */
  researchApproach?: ResearchApproach;
}

export interface TopicReport {
  overview: string;                              // 截断 800
  dimensions: TopicReportDimension[];            // 2-6
  methodsComparison?: string;                     // 截断 600
  sharedFindings: string[];                      // 截断 120/条, 最长 8
  gaps: string[];                                // 截断 120/条, 最长 6
  /** 下一步建议:每条带稳定 id + 文本,可被 dimension.researchApproach.tiedNextStep 反向引用(目标 5)。
   *  旧 session 可能是 string[] → normalizeReportTopic 入口兼容迁移成对象。 */
  nextSteps: Array<{ id: string; text: string; tiedDimensionName?: string }>;
  /** 前沿研究方向:聚合论文里"还没充分做"或"可能拓展"的方向,显式结构化(目标 3)。
   *  name 方向名,description 一句话解释(≤ 80 字),paperArxivIds 关联论文 ID。 */
  frontierDirections?: TopicReportFrontierDirection[];   // 0-4 条
  /** 主题级算力档位:综合覆盖论文的 compute_requirements 得出(目标 4)。 */
  resourceTier?: ResourceTier;                   // 默认 'unknown'
  generatedAt: number;
  relatedArxivIds: string[];
  incrementallyAddedArxivIds?: string[];
}

/** 单条前沿方向(目标 3 的核心交付)。 */
export interface TopicReportFrontierDirection {
  name: string;                                  // 截断 24
  description: string;                           // 截断 80
  paperArxivIds: string[];                       // 关联论文 ID(去版本号)
}
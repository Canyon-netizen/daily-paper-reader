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

export interface TopicReportDimension {
  name: string;                                  // 截断 30
  description?: string;                          // 截断 160
  papers: TopicReportDimensionPaper[];           // ≥ 1
}

export interface TopicReport {
  overview: string;                              // 截断 800
  dimensions: TopicReportDimension[];            // 2-6
  methodsComparison?: string;                     // 截断 600
  sharedFindings: string[];                      // 截断 120/条, 最长 8
  gaps: string[];                                // 截断 120/条, 最长 6
  nextSteps: string[];                           // 截断 120/条, 最长 6
  generatedAt: number;
  relatedArxivIds: string[];
  incrementallyAddedArxivIds?: string[];
}
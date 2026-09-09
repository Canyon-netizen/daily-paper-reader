/**
 * agents/types.ts — 多智能体科研自动化循环的类型契约。
 *
 * 背景:
 *   - 三智能体(Designer / Feedback / Modifier)闭环的输入 / 输出 / 持久化 schema。
 *   - 单一真相源:本文件。`agents/types.mjs` 是 Node CLI 镜像(无类型)。
 *   - 落盘:archive/<project_id>/rounds/round_<NNN>.json (与 topic-v2 同约定)
 *
 * 设计原则:
 *   - **零外部依赖**:除 types 外不 import,Node 与浏览器通吃。
 *   - **稳定 schema**:round_record 是 append-only 不可变日志,字段只能 +
 *     不能改 / 删(向后兼容)。
 *   - **gate 阈值独立**:score / elo 与 depth 解耦,见 agents/gate.ts。
 */

import type { UserLibrary } from '../user-libraries/types';

// ---------------------------------------------------------------------------
// Proposal — Designer 输出
// ---------------------------------------------------------------------------

export type ProposalType =
  | 'add_paper'
  | 'create_draft'
  | 'experiment_plan'
  | 'literature_review'
  | 'rebuttal';

export interface ProposalEvidence {
  paperIds: string[];          // canonical arxivId 列表
  quotes?: string[];           // 关键引用片段(可选,debug 用)
}

export interface ProposalTarget {
  projectId?: string;          // 默认 = 输入 project
  stageId?: string;            // add_paper / create_draft 时目标 stage
  arxivIds?: string[];         // add_paper 的待加论文
  draftTitle?: string;         // create_draft 的标题
}

export interface Proposal {
  id: string;                  // cuid
  round: number;
  type: ProposalType;
  title: string;               // 1 行(中文, < 64 字)
  rationale: string;           // 1-2 句
  evidence: ProposalEvidence;
  target: ProposalTarget;
  estimated_effort: 'low' | 'medium' | 'high';
  risk: string;                // 1 句主要风险
  created_at: number;          // epoch ms
}

// ---------------------------------------------------------------------------
// Critique — Feedback 输出
// ---------------------------------------------------------------------------

export type PersonaName = 'methodologist' | 'engineer' | 'skeptic';

export interface CritiqueScores {
  methodologist: number;       // 0-10
  engineer: number;
  skeptic: number;
}

export interface Critique {
  proposal_id: string;
  scores: CritiqueScores;
  total: number;               // 加权平均(初版:三 persona 等权)
  critique: string;            // 1-2 段(综合三 persona 观点)
  elo: number;                 // Elo 评分,initial = ELO_INITIAL
  matches: number;
  wins: number;
  persona_attribution: Record<PersonaName, string>;  // 每 persona 最尖锐的一句
}

// ---------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------

export type GateDecision = 'promoted' | 'candidate' | 'sketch' | 'rejected';

export interface GateVerdict {
  proposal_id: string;
  decision: GateDecision;
  reasons: string[];           // 为什么这样判
}

// ---------------------------------------------------------------------------
// Action — Modifier 输出
// ---------------------------------------------------------------------------

export type ActionKind =
  | 'add_paper_to_stage'
  | 'create_draft_outline'
  | 'archive_round_summary'
  | 'no_op';

export interface ModifierAction {
  id: string;
  kind: ActionKind;
  proposal_id: string;
  payload: Record<string, unknown>;  // 写盘内容
  applied_at: number;
}

export interface ModifierSkip {
  proposal_id: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// RoundRecord — 完整落盘(append-only)
// ---------------------------------------------------------------------------

export interface RoundInput {
  project: UserLibrary;
  candidates?: { arxivId: string; title: string; tldr?: string }[];
  user_goal?: string;
  project_state?: {
    paper_count: number;
    draft_count: number;
    last_activity_at?: number;
  };
  /**
   * 历史 round 摘要(由 orchestrator / CLI resume 注入)。
   * Designer 会读取最近 N 轮的 promoted/applied/rejected 标题,
   * 避免重复提议已做过的动作。
   */
  previous_rounds?: PreviousRoundSummary[];
}

export interface PreviousRoundSummary {
  round: number;
  promoted_titles: string[];   // gate 判 promoted 的 proposal 标题
  applied_titles: string[];    // modifier 实际写入的 proposal 标题
  rejected_titles: string[];   // gate 判 rejected 的 proposal 标题
}

export interface RoundRecord {
  schema_version: 1;
  round: number;
  project_id: string;
  started_at: number;
  finished_at: number;

  designer: {
    proposals: Proposal[];
    prompt_summary: string;        // 实际 prompt 的 < 200 字摘要
    model: string;
  };

  feedback: {
    critiques: Critique[];
    judge_calls: number;           // LLM 调用次数
    total_tokens: number;          // 估算
  };

  gate: {
    verdicts: GateVerdict[];
    promoted: string[];            // proposal_id 列表(快捷)
    candidate: string[];
    sketch: string[];
    rejected: string[];
  };

  modifier: {
    applied: ModifierAction[];
    skipped: ModifierSkip[];
  };

  // 调试 / 后续引用
  meta: {
    session_id: string;            // 与 topic-v2 同,archive/<session>/rounds/
    dry_run: boolean;
    designer_run_id?: string;
    feedback_run_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Re-export 旧 schema 路径
// ---------------------------------------------------------------------------

export interface ProjectActivity {
  id: string;
  projectId: string;
  arxivId?: string;
  kind: 'agent_round' | 'proposal_promoted' | 'proposal_rejected' | 'modifier_action';
  proposalId?: string;
  detail?: string;
  at: number;
}

// ---------------------------------------------------------------------------
// 字段默认值 / 工厂函数(便于 JS 直接调用,镜像 types.mjs)
// ---------------------------------------------------------------------------

export function makeEmptyProposal(round: number): Omit<Proposal, 'id'> & { id: string } {
  return {
    id: '',
    round,
    type: 'add_paper',
    title: '',
    rationale: '',
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'medium',
    risk: '',
    created_at: Date.now(),
  };
}

export function makeEmptyCritique(proposal_id: string): Critique {
  return {
    proposal_id,
    scores: { methodologist: 0, engineer: 0, skeptic: 0 },
    total: 0,
    critique: '',
    elo: 1200,
    matches: 0,
    wins: 0,
    persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
  };
}

export interface MakeRoundRecordInput {
  round: number;
  project_id: string;
  session_id?: string;
  dry_run?: boolean;
}

export function makeRoundRecord(input: MakeRoundRecordInput): RoundRecord {
  return {
    schema_version: 1,
    round: input.round,
    project_id: input.project_id,
    started_at: Date.now(),
    finished_at: 0,
    designer: { proposals: [], prompt_summary: '', model: '' },
    feedback: { critiques: [], judge_calls: 0, total_tokens: 0 },
    gate: {
      verdicts: [],
      promoted: [],
      candidate: [],
      sketch: [],
      rejected: [],
    },
    modifier: { applied: [], skipped: [] },
    meta: {
      session_id: input.session_id || input.project_id,
      dry_run: !!input.dry_run,
    },
  };
}
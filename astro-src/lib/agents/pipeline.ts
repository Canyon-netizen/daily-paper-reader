/**
 * lib/agents/pipeline.ts — typed mirror of pipeline.mjs (iter #70).
 *
 * Phase A shim pattern(同 export-bundle / paper-compiler / synthesis-pdf /
 * synthesis-diff / evaluator / web-search):.mjs 是 runtime 真相源,.ts 只
 * 声明 type contract + re-export。
 */

import type { RoundInput } from './types';
import type { UpstreamAdapter } from './modifier';

export type PipelineStage =
  | 'p_ideate_research_question'
  | 'p_review_literature'
  | 'p_design_experiment_plan'
  | 'p_write_paper_draft'
  | 'p_simulate_peer_review'
  | 'p_revise_paper'
  | 'p_export_final_paper';

export interface PipelineStageLabel {
  zh: string;
  en: string;
  short: string;
}

export interface PipelineGateSpec {
  minDeliverables: number;
  minTotalScore: number;
  minArxivRefs: number;
  requireForAdvance: string[];
  notes: string;
}

export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'gate_failed' | 'skipped' | 'error';

export interface Deliverable {
  kind: string;
  arxivIds: string[];
  totalScore: number | null;
  proposalId?: string;
  round?: number | null;
  payload?: Record<string, unknown>;
}

export interface StageGateResult {
  passed: boolean;
  reasons: string[];
  gate: PipelineGateSpec | null;
}

export interface StageRecord {
  stage: PipelineStage;
  stageIdx: number;
  startedAt: number;
  finishedAt: number;
  status: StageStatus;
  gate: StageGateResult;
  deliverables: Deliverable[];
  roundRecord?: Record<string, unknown> | null;
  error?: string;
}

export interface PipelineConfig {
  sessionId: string;
  goal: string;
  project: RoundInput['project'];
  candidates?: RoundInput['candidates'];
  caller?: {
    callLLM(opts: {
      system: string;
      user: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
    }): Promise<string>;
  };
  model?: string;
  gatePreset?: 'conservative' | 'balanced' | 'aggressive';
  maxStages?: number;
  startStageIdx?: number;
  skipStages?: PipelineStage[];
  adapter?: UpstreamAdapter;
  dryRun?: boolean;
  projectInput?: RoundInput;
}

export interface PipelineRunResult {
  stages: StageRecord[];
  stoppedReason: 'pending' | 'completed' | 'gate_failed' | 'max_stages' | 'error' | 'cancelled' | 'paused';
  currentStage: PipelineStage | null;
}

export interface PipelineSummary {
  totalStages: number;
  completedStages: number;
  gateFailedStages: number;
  skippedStages: number;
  erroredStages: number;
  totalDeliverables: number;
  stageBreakdown: Record<string, number>;
  stoppedReason: string;
  currentStage: PipelineStage | null;
}

export {
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  PIPELINE_GATES,
  STAGE_TO_PROPOSAL_TYPE,
  STAGE_DELIVERABLE_DIRS,
  buildPipelinePlan,
  evaluateStageGate,
  advancePipeline,
  runPipelineStage,
  runPipeline,
  formatPipelinePlanText,
  summarizePipeline,
  toJSON,
} from './pipeline.mjs';

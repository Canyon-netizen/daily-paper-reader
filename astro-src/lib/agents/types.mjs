/**
 * agents/types.mjs — types.ts 的 JavaScript 镜像(无类型注解)
 *
 * 改任一文件必须同步另一份;`scripts/agents-mirror.test.mjs` 守护漂移。
 */

// ---------------------------------------------------------------------------
// 常量 / 枚举(JS 没有 TS 的 union type,用字符串常量)
// ---------------------------------------------------------------------------

export const PROPOSAL_TYPES = [
  'add_paper',
  'create_draft',
  'experiment_plan',
  'literature_review',
  'rebuttal',
];

export const PERSONA_NAMES = ['methodologist', 'engineer', 'skeptic'];

export const GATE_DECISIONS = ['promoted', 'candidate', 'sketch', 'rejected'];

export const ACTION_KINDS = [
  'add_paper_to_stage',
  'create_draft_outline',
  'archive_round_summary',
  'no_op',
];

export const ESTIMATED_EFFORTS = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// 字段默认值 / 工厂函数(便于 JS 直接调用)
// ---------------------------------------------------------------------------

export function makeEmptyProposal(round) {
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

export function makeEmptyCritique(proposal_id) {
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

export function makeRoundRecord(input) {
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
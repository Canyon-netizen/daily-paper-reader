// astro-src/lib/agents/modifier.fixtures.ts
//
// R7 F.3.5: modifier 4 种 deliverable 类型的 fixture。
//
// 4 类型(对应 modifier 处理 writing 的 case 分支):
//   1. create_draft     → 新建 draft
//   2. literature_review → 新建综述
//   3. rebuttal         → 反驳 reviewer
//   4. expand_draft     → 扩写既有 draft
//
// 每个 fixture 含:proposal + expectedActions(期望的 ModifierAction[] 骨架)
//                 + expectedSkipped(跳过的原因)

import type { ModifierAction, ModifierSkip, Proposal, ProposalType } from './types';

export interface ModifierFixture {
  id: string;
  type: 'create_draft' | 'literature_review' | 'rebuttal' | 'expand_draft';
  scenario: 'happy' | 'insufficient_citations' | 'no_adapter_method';
  proposal: Proposal;
  expectedActionsCount: number;
  expectedSkipReason?: string;
}

function makeBaseProposal(
  id: string,
  type: ProposalType,
  paperIds: string[],
  target: Record<string, unknown> = {},
): Proposal {
  return {
    id,
    type,
    title: `Modifier fixture ${id}`,
    rationale: 'because',
    risk: 'low',
    evidence: { paperIds, quotes: [] },
    target,
    feedbackScore: 0.7,
  };
}

// 1. create_draft happy — 3 papers
const createDraftHappy: ModifierFixture = {
  id: 'fix-mod-cd-happy',
  type: 'create_draft',
  scenario: 'happy',
  proposal: makeBaseProposal(
    'p_cd_001',
    'create_draft',
    ['2506.12345', '2506.67890', '2506.11111'],
    { draftTitle: 'A Survey of X', libraryId: 'lib_x' },
  ),
  expectedActionsCount: 1,  // create_draft_outline
};

// 2. create_draft 不达标 — < 3 papers (会触发 cross-ref skip)
const createDraftInsufficient: ModifierFixture = {
  id: 'fix-mod-cd-insufficient',
  type: 'create_draft',
  scenario: 'insufficient_citations',
  proposal: makeBaseProposal(
    'p_cd_002',
    'create_draft',
    ['2506.12345'],
    { draftTitle: 'Tiny Draft' },
  ),
  expectedActionsCount: 0,
  expectedSkipReason: 'cross-reference 不达标',
};

// 3. literature_review happy
const litReviewHappy: ModifierFixture = {
  id: 'fix-mod-lr-happy',
  type: 'literature_review',
  scenario: 'happy',
  proposal: makeBaseProposal(
    'p_lr_001',
    'literature_review',
    ['2506.12345', '2506.67890', '2506.11111', '2506.22222'],
    { reviewTopic: 'RLHF' },
  ),
  expectedActionsCount: 1,
};

// 4. rebuttal happy
const rebuttalHappy: ModifierFixture = {
  id: 'fix-mod-rb-happy',
  type: 'rebuttal',
  scenario: 'happy',
  proposal: makeBaseProposal(
    'p_rb_001',
    'rebuttal',
    ['2506.12345', '2506.67890', '2506.11111'],
    { draftId: 'd_x', reviewerComment: 'Need baseline' },
  ),
  expectedActionsCount: 1,
};

// 5. expand_draft happy
const expandDraftHappy: ModifierFixture = {
  id: 'fix-mod-ed-happy',
  type: 'expand_draft',
  scenario: 'happy',
  proposal: makeBaseProposal(
    'p_ed_001',
    'expand_draft',
    ['2506.12345', '2506.67890', '2506.11111'],
    { draftId: 'd_x', section: 'related_work' },
  ),
  expectedActionsCount: 1,
};

export const MODIFIER_FIXTURES: ModifierFixture[] = [
  createDraftHappy,
  createDraftInsufficient,
  litReviewHappy,
  rebuttalHappy,
  expandDraftHappy,
];

/** 按 type 分组 */
export const MODIFIER_FIXTURES_BY_TYPE: Record<ModifierFixture['type'], ModifierFixture[]> = {
  create_draft: [],
  literature_review: [],
  rebuttal: [],
  expand_draft: [],
};
for (const f of MODIFIER_FIXTURES) {
  MODIFIER_FIXTURES_BY_TYPE[f.type].push(f);
}

/** 跑一个 fixture 的简单 dry-run 验证 — 仅检查 cross-ref + 期望 action count */
export interface ModifierRunResult {
  fixture: ModifierFixture;
  ok: boolean;
  crossRefOk: boolean;
  reason?: string;
}

/** 跑 fixture dry-run(只跑 cross-ref 检查,不调 adapter) */
export function dryRunModifierFixture(
  fixture: ModifierFixture,
  checkCrossRef: (p: Proposal) => { ok: boolean; reason?: string },
): ModifierRunResult {
  const cr = checkCrossRef(fixture.proposal);
  return {
    fixture,
    ok: cr.ok === (fixture.expectedActionsCount > 0),
    crossRefOk: cr.ok,
    reason: cr.reason,
  };
}

/** 期望 action 形状(只检查 kind,具体 id / 时间略)。 */
export function expectedActionKinds(type: ModifierFixture['type']): string[] {
  switch (type) {
    case 'create_draft':
    case 'literature_review':
    case 'rebuttal':
      return ['create_draft_outline'];
    case 'expand_draft':
      return ['expand_draft_section'];
  }
}
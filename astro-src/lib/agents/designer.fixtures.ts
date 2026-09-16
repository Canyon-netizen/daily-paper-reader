// astro-src/lib/agents/designer.fixtures.ts
//
// R7 F.1.5: designer proposal fixture — 每种 type 2 个 fixture,
// 覆盖 happy path + edge case。给 designer pipeline 的 few-shot / 测试用。
//
// 设计原则:
//   - fixture 都是自包含的,无需读外部资源(论文库 / LLM)
//   - 字段对齐 Proposal schema(target / evidence / rationale / risk)
//   - evidence.paperIds 用合法 arxiv ID 格式

import type { Proposal, ProposalType } from './types';

export interface DesignerFixture {
  /** 唯一 id,debug 用 */
  id: string;
  type: ProposalType;
  /** fixture 描述(happy / edge / 等) */
  scenario: 'happy' | 'edge' | 'minimal';
  proposal: Proposal;
}

// ---------------------------------------------------------------------------
// add_paper — 2 fixture
// ---------------------------------------------------------------------------

const addPaperHappy: DesignerFixture = {
  id: 'fix-add-paper-happy',
  type: 'add_paper',
  scenario: 'happy',
  proposal: {
    id: 'fix_ap_001',
    type: 'add_paper',
    title: 'Add Transformer paper to RL project stage 2',
    rationale: 'Transformer is foundational to modern RL agents',
    risk: 'low — paper already validated in library',
    evidence: {
      paperIds: ['2506.12345', '2506.67890'],
      quotes: ['Attention is all you need'],
    },
    target: {
      projectId: 'p_rl_agents',
      stageId: 'stage_2_literature',
      arxivIds: ['2506.12345'],
    },
    feedbackScore: 0.9,
  },
};

const addPaperEdge: DesignerFixture = {
  id: 'fix-add-paper-edge',
  type: 'add_paper',
  scenario: 'edge',
  proposal: {
    id: 'fix_ap_002',
    type: 'add_paper',
    title: 'Add orphan paper to default stage',
    rationale: 'Paper has no clear stage mapping; use default',
    risk: 'medium — default stage may not match project intent',
    evidence: {
      paperIds: ['2506.99999'],
      quotes: [],
    },
    target: {
      projectId: 'p_exploratory',
      // stageId 故意空 → 测试 fallback 逻辑
      arxivIds: [],
    },
    feedbackScore: 0.5,
  },
};

// ---------------------------------------------------------------------------
// create_draft — 2 fixture
// ---------------------------------------------------------------------------

const createDraftHappy: DesignerFixture = {
  id: 'fix-create-draft-happy',
  type: 'create_draft',
  scenario: 'happy',
  proposal: {
    id: 'fix_cd_001',
    type: 'create_draft',
    title: 'Draft: A Survey of LLM Reasoning',
    rationale: 'Synthesize 12 reasoning papers into a structured review',
    risk: 'low — well-defined topic',
    evidence: {
      paperIds: ['2506.12345', '2506.67890', '2506.11111'],
      quotes: ['Chain-of-thought prompting...'],
    },
    target: {
      draftTitle: 'A Survey of LLM Reasoning',
      libraryId: 'lib_reasoning',
    },
    feedbackScore: 0.85,
  },
};

const createDraftEdge: DesignerFixture = {
  id: 'fix-create-draft-edge',
  type: 'create_draft',
  scenario: 'edge',
  proposal: {
    id: 'fix_cd_002',
    type: 'create_draft',
    title: 'Draft: minimal title',
    rationale: 'No papers to reference (cross-ref will fail)',
    risk: 'high — missing evidence',
    evidence: {
      paperIds: [],
      quotes: [],
    },
    target: {
      draftTitle: 'Minimal Draft',
    },
    feedbackScore: 0.2,
  },
};

// ---------------------------------------------------------------------------
// experiment_plan — 2 fixture
// ---------------------------------------------------------------------------

const experimentPlanHappy: DesignerFixture = {
  id: 'fix-exp-plan-happy',
  type: 'experiment_plan',
  scenario: 'happy',
  proposal: {
    id: 'fix_ep_001',
    type: 'experiment_plan',
    title: 'Experiment: Ablate attention heads on RL agent',
    rationale: 'Test if attention head sparsity improves sample efficiency',
    risk: 'low — known baseline',
    evidence: {
      paperIds: ['2506.12345', '2506.67890'],
      quotes: ['Head pruning reduces 30% compute'],
    },
    target: {
      projectId: 'p_rl_agents',
      hypothesis: 'Pruning 50% of attention heads maintains ≥ 95% performance',
    },
    feedbackScore: 0.8,
  },
};

const experimentPlanEdge: DesignerFixture = {
  id: 'fix-exp-plan-edge',
  type: 'experiment_plan',
  scenario: 'edge',
  proposal: {
    id: 'fix_ep_002',
    type: 'experiment_plan',
    title: 'Experiment: untested hypothesis',
    rationale: 'No supporting evidence',
    risk: 'high — speculative',
    evidence: {
      paperIds: [],
      quotes: [],
    },
    target: {
      hypothesis: 'Unknown',
    },
    feedbackScore: 0.1,
  },
};

// ---------------------------------------------------------------------------
// literature_review — 2 fixture
// ---------------------------------------------------------------------------

const litReviewHappy: DesignerFixture = {
  id: 'fix-lit-review-happy',
  type: 'literature_review',
  scenario: 'happy',
  proposal: {
    id: 'fix_lr_001',
    type: 'literature_review',
    title: 'Review: RLHF in 2024-2026',
    rationale: 'Recent RLHF papers show convergence on Direct Preference Optimization',
    risk: 'low — well-covered topic',
    evidence: {
      paperIds: ['2506.12345', '2506.67890', '2506.11111', '2506.22222'],
      quotes: ['DPO replaces RLHF for many use cases'],
    },
    target: {
      reviewTopic: 'RLHF',
      yearRange: [2024, 2026],
    },
    feedbackScore: 0.88,
  },
};

const litReviewEdge: DesignerFixture = {
  id: 'fix-lit-review-edge',
  type: 'literature_review',
  scenario: 'edge',
  proposal: {
    id: 'fix_lr_002',
    type: 'literature_review',
    title: 'Review: niche topic with few papers',
    rationale: 'Only 2 papers found',
    risk: 'medium — narrow coverage',
    evidence: {
      paperIds: ['2506.12345', '2506.67890'],
      quotes: [],
    },
    target: {
      reviewTopic: 'Niche topic',
    },
    feedbackScore: 0.4,
  },
};

// ---------------------------------------------------------------------------
// rebuttal — 2 fixture
// ---------------------------------------------------------------------------

const rebuttalHappy: DesignerFixture = {
  id: 'fix-rebuttal-happy',
  type: 'rebuttal',
  scenario: 'happy',
  proposal: {
    id: 'fix_rb_001',
    type: 'rebuttal',
    title: 'Rebuttal: reviewer asks for baseline comparison',
    rationale: 'Add 3 baseline papers for fair comparison',
    risk: 'low — straightforward addition',
    evidence: {
      paperIds: ['2506.12345', '2506.67890', '2506.11111'],
      quotes: ['Standard baselines: MAML, Reptile, ...'],
    },
    target: {
      draftId: 'd_my_paper',
      reviewerComment: 'Missing baseline comparison',
    },
    feedbackScore: 0.9,
  },
};

const rebuttalEdge: DesignerFixture = {
  id: 'fix-rebuttal-edge',
  type: 'rebuttal',
  scenario: 'edge',
  proposal: {
    id: 'fix_rb_002',
    type: 'rebuttal',
    title: 'Rebuttal: vague reviewer comment',
    rationale: 'No specific evidence cited',
    risk: 'high — may not address concern',
    evidence: {
      paperIds: [],
      quotes: [],
    },
    target: {
      reviewerComment: 'The paper is unclear',
    },
    feedbackScore: 0.3,
  },
};

// ---------------------------------------------------------------------------
// expand_draft — 2 fixture
// ---------------------------------------------------------------------------

const expandDraftHappy: DesignerFixture = {
  id: 'fix-expand-draft-happy',
  type: 'expand_draft',
  scenario: 'happy',
  proposal: {
    id: 'fix_ed_001',
    type: 'expand_draft',
    title: 'Expand: add related work section',
    rationale: 'Cover 4 recent surveys',
    risk: 'low — additive change',
    evidence: {
      paperIds: ['2506.12345', '2506.67890', '2506.11111'],
      quotes: [],
    },
    target: {
      draftId: 'd_my_paper',
      section: 'related_work',
    },
    feedbackScore: 0.8,
  },
};

const expandDraftEdge: DesignerFixture = {
  id: 'fix-expand-draft-edge',
  type: 'expand_draft',
  scenario: 'edge',
  proposal: {
    id: 'fix_ed_002',
    type: 'expand_draft',
    title: 'Expand: rewrite entire paper',
    rationale: 'Too broad scope',
    risk: 'high — likely to break structure',
    evidence: {
      paperIds: [],
      quotes: [],
    },
    target: {
      draftId: 'd_my_paper',
      section: 'all',
    },
    feedbackScore: 0.2,
  },
};

// ---------------------------------------------------------------------------
// cite_paper — 2 fixture
// ---------------------------------------------------------------------------

const citePaperHappy: DesignerFixture = {
  id: 'fix-cite-paper-happy',
  type: 'cite_paper',
  scenario: 'happy',
  proposal: {
    id: 'fix_cp_001',
    type: 'cite_paper',
    title: 'Cite: add foundation reference to draft',
    rationale: 'Missing citation for foundational claim',
    risk: 'low — single citation addition',
    evidence: {
      paperIds: ['2506.12345'],
      quotes: ['Foundational work on RL agents'],
    },
    target: {
      draftId: 'd_my_paper',
      arxivId: '2506.12345',
    },
    feedbackScore: 0.95,
  },
};

const citePaperEdge: DesignerFixture = {
  id: 'fix-cite-paper-edge',
  type: 'cite_paper',
  scenario: 'edge',
  proposal: {
    id: 'fix_cp_002',
    type: 'cite_paper',
    title: 'Cite: paper not in library',
    rationale: 'Citation would be to nonexistent paper',
    risk: 'high — invalid citation',
    evidence: {
      paperIds: [],
      quotes: [],
    },
    target: {
      draftId: 'd_my_paper',
      arxivId: 'invalid-id',
    },
    feedbackScore: 0.1,
  },
};

// ---------------------------------------------------------------------------
// archive_paper — 2 fixture
// ---------------------------------------------------------------------------

const archivePaperHappy: DesignerFixture = {
  id: 'fix-archive-paper-happy',
  type: 'archive_paper',
  scenario: 'happy',
  proposal: {
    id: 'fix_ar_001',
    type: 'archive_paper',
    title: 'Archive: low-quality paper',
    rationale: 'Paper has centrality < 0.1, not relevant to project',
    risk: 'low — archive is reversible',
    evidence: {
      paperIds: ['2506.12345'],
      quotes: ['Marginal relevance'],
    },
    target: {
      projectId: 'p_main',
      arxivId: '2506.12345',
      reason: 'low_centrality',
    },
    feedbackScore: 0.7,
  },
};

const archivePaperEdge: DesignerFixture = {
  id: 'fix-archive-paper-edge',
  type: 'archive_paper',
  scenario: 'edge',
  proposal: {
    id: 'fix_ar_002',
  type: 'archive_paper',
    title: 'Archive: milestone paper (DON\'T!)',
    risk: 'critical — losing important work',
    rationale: 'Mistaken classification — this paper is a milestone',
    evidence: {
      paperIds: ['2506.12345'],
      quotes: ['Landmark work on attention'],
    },
    target: {
      projectId: 'p_main',
      arxivId: '2506.12345',
      reason: 'auto_cleanup',
    },
    feedbackScore: 0.0,
  },
};

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

export const DESIGNER_FIXTURES: DesignerFixture[] = [
  addPaperHappy, addPaperEdge,
  createDraftHappy, createDraftEdge,
  experimentPlanHappy, experimentPlanEdge,
  litReviewHappy, litReviewEdge,
  rebuttalHappy, rebuttalEdge,
  expandDraftHappy, expandDraftEdge,
  citePaperHappy, citePaperEdge,
  archivePaperHappy, archivePaperEdge,
];

/** 按 type 分组 */
export const FIXTURES_BY_TYPE: Record<ProposalType, DesignerFixture[]> = {} as Record<ProposalType, DesignerFixture[]>;
for (const f of DESIGNER_FIXTURES) {
  if (!FIXTURES_BY_TYPE[f.type]) FIXTURES_BY_TYPE[f.type] = [];
  FIXTURES_BY_TYPE[f.type].push(f);
}
// astro-src/lib/agents/feedback.fixtures.ts
//
// R7 F.2.5: feedback 评分 fixture — 5 个维度各 1 个 fixture。
//
// 5 个维度:
//   1. citation_validity
//   2. methodology
//   3. reproducibility
//   4. novelty
//   5. overall (聚合分)
//
// 每个 fixture 是 { proposalId, scores: {维度: 0..1}, comment }。

export interface FeedbackFixture {
  id: string;
  proposalId: string;
  /** 5 维度评分,0..1 */
  scores: {
    citation_validity: number;
    methodology: number;
    reproducibility: number;
    novelty: number;
    overall: number;
  };
  /** 评论 */
  comment: string;
}

// 1. citation_validity — 高:所有 paperId 合法
const citationHigh: FeedbackFixture = {
  id: 'fix-fb-citation-high',
  proposalId: 'p_strong',
  scores: {
    citation_validity: 1.0,
    methodology: 0.7,
    reproducibility: 0.6,
    novelty: 0.8,
    overall: 0.78,
  },
  comment: 'All cited arxiv IDs are valid and in local library',
};

// 2. citation_validity 低:有 invalid arxiv id
const citationLow: FeedbackFixture = {
  id: 'fix-fb-citation-low',
  proposalId: 'p_weak',
  scores: {
    citation_validity: 0.2,
    methodology: 0.7,
    reproducibility: 0.6,
    novelty: 0.8,
    overall: 0.55,
  },
  comment: '2 of 4 paperIds do not resolve in local library',
};

// 3. methodology — 高:对照实验 + 消融
const methodologyHigh: FeedbackFixture = {
  id: 'fix-fb-method-high',
  proposalId: 'p_method_strict',
  scores: {
    citation_validity: 0.9,
    methodology: 0.95,
    reproducibility: 0.85,
    novelty: 0.6,
    overall: 0.85,
  },
  comment: 'Includes 3 baselines and 2 ablations',
};

// 4. reproducibility — 低:无代码 / 数据
const reproducibilityLow: FeedbackFixture = {
  id: 'fix-fb-repro-low',
  proposalId: 'p_no_code',
  scores: {
    citation_validity: 0.9,
    methodology: 0.7,
    reproducibility: 0.1,
    novelty: 0.85,
    overall: 0.6,
  },
  comment: 'No code or data released; experiments hard to verify',
};

// 5. novelty — 高:全新方向
const noveltyHigh: FeedbackFixture = {
  id: 'fix-fb-novelty-high',
  proposalId: 'p_breakthrough',
  scores: {
    citation_validity: 0.8,
    methodology: 0.6,
    reproducibility: 0.5,
    novelty: 0.98,
    overall: 0.7,
  },
  comment: 'First to combine RL with vision-language models in this way',
};

export const FEEDBACK_FIXTURES: FeedbackFixture[] = [
  citationHigh,
  citationLow,
  methodologyHigh,
  reproducibilityLow,
  noveltyHigh,
];

/** 按维度索引 — 找该维度评最高/最低的样本 */
export function fixturesByDimension(dim: keyof FeedbackFixture['scores']): FeedbackFixture[] {
  return [...FEEDBACK_FIXTURES].sort((a, b) => b.scores[dim] - a.scores[dim]);
}

/** 给定 proposalId 找对应 fixture(可能多对多) */
export function fixturesForProposal(proposalId: string): FeedbackFixture[] {
  return FEEDBACK_FIXTURES.filter((f) => f.proposalId === proposalId);
}
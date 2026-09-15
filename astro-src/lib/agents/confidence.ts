// astro-src/lib/agents/confidence.ts
//
// R7 F.1.3: designer confidence scoring。
//
// 给每条 proposal 一个 0-1 的 confidence ——「LLM 觉得这条 proposal 值得做的把握」。
// 计算来源:
//   - 证据强度:evidence.paperIds 数量 + quotes 数量(论文越多 / 引用越具体越好)
//   - 同类型历史成功率:历史上同 type 的 proposal 被 user 采纳率
//   - target 是否完整:target.draftTitle / target.stageId / target.arxivIds 都有
//   - estimated_effort 反向:effort=high 的 proposal confidence 适度下调(风险高)
//
// 不依赖 LLM,纯启发式 —— 给 LLM 自己输出的 confidence 字段做兜底校准,或者
// 在 stub 模式(无 LLM key)下生成可信分数。

import type { Proposal, ProposalType } from './types';

export interface ConfidenceBreakdown {
  score: number;          // 0..1
  evidenceScore: number;  // 0..1
  typeAdoptionScore: number;
  targetCompleteness: number;
  effortPenalty: number;
}

/** 默认权重,UI / 测试可以覆盖。 */
export const DEFAULT_CONFIDENCE_WEIGHTS = {
  evidence: 0.35,
  typeAdoption: 0.30,
  target: 0.25,
  effort: 0.10,
};

/**
 * 计算 confidence + breakdown。
 *
 *   typeAdoptionByType  = { [type]: 0..1 } 历史上同 type 的 proposal 被采纳率
 *                          undefined → 当 0.5 兜底
 */
export function computeConfidence(
  proposal: Pick<Proposal, 'type' | 'evidence' | 'target' | 'estimated_effort'>,
  opts: {
    typeAdoptionByType?: Partial<Record<ProposalType, number>>;
    weights?: typeof DEFAULT_CONFIDENCE_WEIGHTS;
  } = {},
): ConfidenceBreakdown {
  const w = opts.weights ?? DEFAULT_CONFIDENCE_WEIGHTS;

  // 1. evidence score
  const paperCount = proposal.evidence?.paperIds?.length ?? 0;
  const quoteCount = proposal.evidence?.quotes?.length ?? 0;
  // 1 paper = 0.3, 2 = 0.55, 3 = 0.75, 5+ = 1.0 (饱和)
  const paperScore = Math.min(1, paperCount / 5);
  const quoteScore = Math.min(1, quoteCount / 3);
  const evidenceScore = clamp01(paperScore * 0.7 + quoteScore * 0.3);

  // 2. type adoption score
  const adoption = opts.typeAdoptionByType?.[proposal.type];
  const typeAdoptionScore = typeof adoption === 'number' ? clamp01(adoption) : 0.5;

  // 3. target completeness
  let targetScore = 0;
  if (proposal.target) {
    if (proposal.type === 'add_paper' || proposal.type === 'cite_paper' || proposal.type === 'archive_paper') {
      // 这些类型至少要有 arxivIds
      if ((proposal.target.arxivIds?.length ?? 0) > 0) targetScore += 0.5;
      if (proposal.target.stageId) targetScore += 0.5;
    } else if (proposal.type === 'create_draft' || proposal.type === 'expand_draft') {
      if (proposal.target.draftTitle) targetScore += 0.7;
      if (proposal.target.projectId) targetScore += 0.3;
    } else {
      // experiment_plan / literature_review / rebuttal: projectId 够用
      if (proposal.target.projectId) targetScore += 1.0;
      else targetScore += 0.3;
    }
  }
  const targetCompleteness = clamp01(targetScore);

  // 4. effort penalty:high → 0.4, medium → 0.7, low → 1.0
  const effortPenalty = proposal.estimated_effort === 'high' ? 0.4
    : proposal.estimated_effort === 'medium' ? 0.7
    : 1.0;

  // 加权平均
  const score = clamp01(
    evidenceScore * w.evidence
    + typeAdoptionScore * w.typeAdoption
    + targetCompleteness * w.target
    + effortPenalty * w.effort,
  );

  return {
    score,
    evidenceScore,
    typeAdoptionScore,
    targetCompleteness,
    effortPenalty,
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * 阈值 → 文字档位,UI 直接展示。
 *   ≥ 0.7 → 高
 *   ≥ 0.4 → 中
 *   <  0.4 → 低
 */
export function confidenceTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}
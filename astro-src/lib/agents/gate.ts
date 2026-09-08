/**
 * agents/gate.ts — Gate 过滤函数(纯函数,无 LLM 调用)
 *
 * 背景:
 *   - Designer 输出 proposals,Feedback 给出 critiques,Gate 做最终决策。
 *   - 阈值沿用 idea-lifecycle.ts:GATE_THRESHOLDS 的保守梯度。
 *   - 设计原则:**宁可漏判(下一轮重提),不可错判(写入破坏性动作)**。
 *
 * 决策表(默认阈值,可整体替换为 conservative/aggressive):
 *   - score >= 8 AND elo >= 1280  → promoted(可写 project + 落 archive)
 *   - score >= 6 AND elo >= 1232  → candidate(可写 archive,不动 project)
 *   - score >= 4                  → sketch(只记录,不写)
 *   - score <  4                  → rejected(直接丢弃)
 *
 * 与 idea-lifecycle.ts 的区别:
 *   - 这里输入是 round-level critique(score / elo),不是辩论级(elo / matches / wins)
 *   - 因此 elo 阈值略微放宽(round 一次给多个 persona,单 critique 的 elo 起步高)
 */

import type {
  Critique,
  GateDecision,
  GateVerdict,
  Proposal,
} from './types';

// ---------------------------------------------------------------------------
// 阈值常量(可整体替换)
// ---------------------------------------------------------------------------

export const GATE_THRESHOLDS = {
  conservative: {
    promoted: { minScore: 8.5, minElo: 1280 },
    candidate: { minScore: 7.0, minElo: 1250 },
    sketch: { minScore: 5.0 },
  },
  balanced: {
    promoted: { minScore: 8.0, minElo: 1280 },
    candidate: { minScore: 6.0, minElo: 1232 },
    sketch: { minScore: 4.0 },
  },
  aggressive: {
    promoted: { minScore: 7.0, minElo: 1232 },
    candidate: { minScore: 5.0, minElo: 1200 },
    sketch: { minScore: 3.0 },
  },
} as const;

export type GatePreset = keyof typeof GATE_THRESHOLDS;

// ---------------------------------------------------------------------------
// 单条 critique → decision
// ---------------------------------------------------------------------------

export function decideProposal(
  critique: Critique,
  preset: GatePreset = 'balanced',
): GateVerdict {
  const t = GATE_THRESHOLDS[preset];
  const reasons: string[] = [];

  if (critique.total >= t.promoted.minScore && critique.elo >= t.promoted.minElo) {
    reasons.push(
      `score=${critique.total.toFixed(1)} >= ${t.promoted.minScore} AND elo=${critique.elo} >= ${t.promoted.minElo}`,
    );
    return { proposal_id: critique.proposal_id, decision: 'promoted', reasons };
  }

  if (critique.total >= t.candidate.minScore && critique.elo >= t.candidate.minElo) {
    reasons.push(
      `score=${critique.total.toFixed(1)} >= ${t.candidate.minScore} AND elo=${critique.elo} >= ${t.candidate.minElo}`,
    );
    return { proposal_id: critique.proposal_id, decision: 'candidate', reasons };
  }

  if (critique.total >= t.sketch.minScore) {
    reasons.push(
      `score=${critique.total.toFixed(1)} >= ${t.sketch.minScore} (kept as sketch)`,
    );
    return { proposal_id: critique.proposal_id, decision: 'sketch', reasons };
  }

  reasons.push(`score=${critique.total.toFixed(1)} < ${t.sketch.minScore} (rejected)`);
  return { proposal_id: critique.proposal_id, decision: 'rejected', reasons };
}

// ---------------------------------------------------------------------------
// 批量 gate
// ---------------------------------------------------------------------------

export function gateProposals(
  proposals: Proposal[],
  critiques: Critique[],
  preset: GatePreset = 'balanced',
): GateVerdict[] {
  const critiqueById = new Map<string, Critique>();
  for (const c of critiques) critiqueById.set(c.proposal_id, c);

  const verdicts: GateVerdict[] = [];
  for (const p of proposals) {
    const c = critiqueById.get(p.id);
    if (!c) {
      verdicts.push({
        proposal_id: p.id,
        decision: 'sketch',
        reasons: ['no critique (LLM call failed?) — kept as sketch'],
      });
      continue;
    }
    verdicts.push(decideProposal(c, preset));
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// 按 decision 分桶
// ---------------------------------------------------------------------------

export function partitionByDecision(
  verdicts: GateVerdict[],
): Record<GateDecision, string[]> {
  const out: Record<GateDecision, string[]> = {
    promoted: [],
    candidate: [],
    sketch: [],
    rejected: [],
  };
  for (const v of verdicts) out[v.decision].push(v.proposal_id);
  return out;
}

// ---------------------------------------------------------------------------
// 安全护栏:防止 promoted 但 risk 标记 catastrophic
// ---------------------------------------------------------------------------

const CATASTROPHIC_RISK_PATTERNS = [
  /不可逆/,
  /\bcatastrophic\b/i,
  /数据丢失/,
  /生产环境破坏/,
];

export function isCatastrophicRisk(proposal: Proposal): boolean {
  return CATASTROPHIC_RISK_PATTERNS.some((re) => re.test(proposal.risk));
}

/**
 * 即使 gate 判为 promoted,如果 risk 标记 catastrophic,降级到 candidate。
 * 留给人类 review。
 */
export function applySafetyOverride(
  verdict: GateVerdict,
  proposal: Proposal,
): GateVerdict {
  if (verdict.decision === 'promoted' && isCatastrophicRisk(proposal)) {
    return {
      ...verdict,
      decision: 'candidate',
      reasons: [...verdict.reasons, 'SAFETY: catastrophic risk → demoted to candidate'],
    };
  }
  return verdict;
}
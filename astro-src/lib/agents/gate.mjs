/**
 * agents/gate.mjs — gate.ts 的 JavaScript 镜像。
 *
 * 单一真相源:gate.ts(浏览器侧,带类型)
 *   ↕  行为必须一致(由 scripts/agents-mirror.test.mjs 守护)
 * 镜像文件:gate.mjs(Node CLI 直接 import)
 *
 * 改任一文件务必同步另一份。
 */

// ---------------------------------------------------------------------------
// 阈值常量(与 gate.ts 同源)
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
};

// ---------------------------------------------------------------------------
// 单条 critique → decision
// ---------------------------------------------------------------------------

export function decideProposal(critique, preset = 'balanced') {
  const t = GATE_THRESHOLDS[preset] || GATE_THRESHOLDS.balanced;
  const reasons = [];

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

export function gateProposals(proposals, critiques, preset = 'balanced') {
  const critiqueById = new Map();
  for (const c of critiques) critiqueById.set(c.proposal_id, c);

  const verdicts = [];
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

export function partitionByDecision(verdicts) {
  const out = { promoted: [], candidate: [], sketch: [], rejected: [] };
  for (const v of verdicts) out[v.decision].push(v.proposal_id);
  return out;
}

// ---------------------------------------------------------------------------
// 安全护栏
// ---------------------------------------------------------------------------

const CATASTROPHIC_RISK_PATTERNS = [
  /不可逆/,
  /\bcatastrophic\b/i,
  /数据丢失/,
  /生产环境破坏/,
];

export function isCatastrophicRisk(proposal) {
  return CATASTROPHIC_RISK_PATTERNS.some((re) => re.test(proposal.risk || ''));
}

export function applySafetyOverride(verdict, proposal) {
  if (verdict.decision === 'promoted' && isCatastrophicRisk(proposal)) {
    return {
      ...verdict,
      decision: 'candidate',
      reasons: [
        ...verdict.reasons,
        'SAFETY: catastrophic risk → demoted to candidate',
      ],
    };
  }
  return verdict;
}
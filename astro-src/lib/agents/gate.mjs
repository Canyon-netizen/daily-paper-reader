// astro-src/lib/agents/gate.ts
var GATE_THRESHOLDS = {
  conservative: {
    promoted: { minScore: 8.5, minElo: 1280 },
    candidate: { minScore: 7, minElo: 1250 },
    sketch: { minScore: 5 }
  },
  balanced: {
    promoted: { minScore: 8, minElo: 1280 },
    candidate: { minScore: 6, minElo: 1232 },
    sketch: { minScore: 4 }
  },
  aggressive: {
    promoted: { minScore: 7, minElo: 1232 },
    candidate: { minScore: 5, minElo: 1200 },
    sketch: { minScore: 3 }
  }
};
function decideProposal(critique, preset = "balanced") {
  const t = GATE_THRESHOLDS[preset];
  const reasons = [];
  if (critique.total >= t.promoted.minScore && critique.elo >= t.promoted.minElo) {
    reasons.push(
      `score=${critique.total.toFixed(1)} >= ${t.promoted.minScore} AND elo=${critique.elo} >= ${t.promoted.minElo}`
    );
    return { proposal_id: critique.proposal_id, decision: "promoted", reasons };
  }
  if (critique.total >= t.candidate.minScore && critique.elo >= t.candidate.minElo) {
    reasons.push(
      `score=${critique.total.toFixed(1)} >= ${t.candidate.minScore} AND elo=${critique.elo} >= ${t.candidate.minElo}`
    );
    return { proposal_id: critique.proposal_id, decision: "candidate", reasons };
  }
  if (critique.total >= t.sketch.minScore) {
    reasons.push(
      `score=${critique.total.toFixed(1)} >= ${t.sketch.minScore} (kept as sketch)`
    );
    return { proposal_id: critique.proposal_id, decision: "sketch", reasons };
  }
  reasons.push(`score=${critique.total.toFixed(1)} < ${t.sketch.minScore} (rejected)`);
  return { proposal_id: critique.proposal_id, decision: "rejected", reasons };
}
function gateProposals(proposals, critiques, preset = "balanced") {
  const critiqueById = /* @__PURE__ */ new Map();
  for (const c of critiques) critiqueById.set(c.proposal_id, c);
  const verdicts = [];
  for (const p of proposals) {
    const c = critiqueById.get(p.id);
    if (!c) {
      verdicts.push({
        proposal_id: p.id,
        decision: "sketch",
        reasons: ["no critique (LLM call failed?) \u2014 kept as sketch"]
      });
      continue;
    }
    verdicts.push(decideProposal(c, preset));
  }
  return verdicts;
}
function partitionByDecision(verdicts) {
  const out = {
    promoted: [],
    candidate: [],
    sketch: [],
    rejected: []
  };
  for (const v of verdicts) out[v.decision].push(v.proposal_id);
  return out;
}
var CATASTROPHIC_RISK_PATTERNS = [
  /不可逆/,
  /\bcatastrophic\b/i,
  /数据丢失/,
  /生产环境破坏/
];
function isCatastrophicRisk(proposal) {
  return CATASTROPHIC_RISK_PATTERNS.some((re) => re.test(proposal.risk));
}
function applySafetyOverride(verdict, proposal) {
  if (verdict.decision === "promoted" && isCatastrophicRisk(proposal)) {
    return {
      ...verdict,
      decision: "candidate",
      reasons: [...verdict.reasons, "SAFETY: catastrophic risk \u2192 demoted to candidate"]
    };
  }
  return verdict;
}
export {
  GATE_THRESHOLDS,
  applySafetyOverride,
  decideProposal,
  gateProposals,
  isCatastrophicRisk,
  partitionByDecision
};

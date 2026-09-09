/**
 * tests/test_agents_compare.mjs — Session comparison 纯逻辑守护。
 *
 * /agents/compare/ 的核心计算是 computeStats(sid):从 RoundRecord[] 派生
 * SessionStats。把它从 .astro 里拷出来测,守护:
 *   - avg score / avg Elo 算法
 *   - applied rate (applied / proposals,避免除零)
 *   - trend (per-round avg)
 *   - top applied titles(从 modifier.applied 抓 proposal_id 对应 title)
 *
 * 跑法:node tests/test_agents_compare.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 镜像 astro-src/pages/agents/compare.astro 里的 computeStats
function computeStats(recs, sid) {
  if (recs.length === 0) return null;
  const allCritiques = recs.flatMap((r) => r.feedback.critiques);
  const avgScore = allCritiques.length
    ? allCritiques.reduce((a, c) => a + c.total, 0) / allCritiques.length
    : 0;
  const avgElo = allCritiques.length
    ? allCritiques.reduce((a, c) => a + c.elo, 0) / allCritiques.length
    : 0;
  const applied = recs.reduce((a, r) => a + r.modifier.applied.length, 0);
  const proposals = recs.reduce((a, r) => a + r.designer.proposals.length, 0);
  const lastActivity = Math.max(...recs.map((r) => r.finished_at));
  const trend = recs.map((r) => {
    const cs = r.feedback.critiques;
    const avg = cs.length ? cs.reduce((a, c) => a + c.total, 0) / cs.length : 0;
    return { round: r.round, avgScore: avg };
  });
  const topApplied = recs
    .flatMap((r) => r.modifier.applied.map((a) => {
      const proposal = r.designer.proposals.find((p) => p.id === a.proposal_id);
      return proposal?.title ?? a.payload?.title ?? a.proposal_id;
    }))
    .filter(Boolean)
    .slice(0, 3);
  return {
    sid,
    rounds: recs.length,
    proposals,
    avgScore,
    avgElo,
    applied,
    appliedRate: proposals ? applied / proposals : 0,
    lastActivity,
    trend,
    topAppliedTitles: topApplied,
  };
}

function mkCritique(proposalId, total, elo = 1200) {
  return {
    proposal_id: proposalId,
    scores: { methodologist: total, engineer: total, skeptic: total },
    total,
    critique: 't', elo,
    matches: 0, wins: 0,
    persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
  };
}

function mkProposal(id, title) {
  return {
    id, type: 'literature_review', title, rationale: 'r',
    evidence: { paperIds: [] }, target: {},
    estimated_effort: 'low', risk: 'low', created_at: 0,
  };
}

function mkRecord(round, proposals, critiques, applied) {
  return {
    schema_version: 1, round,
    project_id: 'test', started_at: 1000 + round, finished_at: 1000 + round + 1,
    designer: { proposals, prompt_summary: '', model: 'stub' },
    feedback: { critiques, judge_calls: 1, total_tokens: 100 },
    gate: { verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [] },
    modifier: { applied, skipped: [] },
    meta: { session_id: 'test', dry_run: true },
  };
}

describe('computeStats', () => {
  it('returns null for empty session', () => {
    assert.equal(computeStats([], 'x'), null);
  });

  it('handles session with no critiques (avgScore=0, avgElo=0, appliedRate=0)', () => {
    const recs = [mkRecord(1, [mkProposal('p', 't')], [], [])];
    const s = computeStats(recs, 'empty-crit');
    assert.equal(s.rounds, 1);
    assert.equal(s.proposals, 1);
    assert.equal(s.avgScore, 0);
    assert.equal(s.avgElo, 0);
    assert.equal(s.applied, 0);
    assert.equal(s.appliedRate, 0);
    assert.deepEqual(s.trend, [{ round: 1, avgScore: 0 }]);
  });

  it('aggregates avg score + avg elo across rounds', () => {
    const recs = [
      mkRecord(1, [mkProposal('p', 't1')], [mkCritique('p', 6)], []),
      mkRecord(2, [mkProposal('p', 't2')], [mkCritique('p', 8, 1240)], []),
    ];
    const s = computeStats(recs, 'agg');
    assert.equal(s.avgScore, 7);
    assert.equal(s.avgElo, (1200 + 1240) / 2);
    assert.equal(s.applied, 0);
  });

  it('computes applied rate (applied / proposals) avoiding div-by-zero', () => {
    const noProposals = [mkRecord(1, [], [mkCritique('p', 5)], [])];
    assert.equal(computeStats(noProposals, 'np').appliedRate, 0);

    const recs = [
      mkRecord(1, [mkProposal('a', 'A'), mkProposal('b', 'B')],
        [mkCritique('a', 8), mkCritique('b', 8)],
        [{ id: 'x', kind: 'no_op', proposal_id: 'a', payload: {}, applied_at: 0 }]),
    ];
    assert.equal(computeStats(recs, 'r').appliedRate, 0.5);
  });

  it('captures lastActivity from the latest finished_at', () => {
    const recs = [
      mkRecord(1, [], [], []),
      mkRecord(2, [], [], []),
      mkRecord(3, [], [], []),
    ];
    recs[0].finished_at = 100;
    recs[1].finished_at = 500;
    recs[2].finished_at = 300;
    assert.equal(computeStats(recs, 'last').lastActivity, 500);
  });

  it('top applied titles look up proposal_id → title from that round', () => {
    const recs = [
      mkRecord(1,
        [mkProposal('p1', 'First Paper Title'), mkProposal('p2', 'Second')],
        [mkCritique('p1', 9), mkCritique('p2', 7)],
        [
          { id: 'a', kind: 'create_draft_outline', proposal_id: 'p1', payload: {}, applied_at: 0 },
          { id: 'b', kind: 'add_paper_to_stage', proposal_id: 'p2', payload: {}, applied_at: 0 },
        ]),
    ];
    const s = computeStats(recs, 'top');
    assert.deepEqual(s.topAppliedTitles, ['First Paper Title', 'Second']);
  });

  it('top applied falls back to payload.title or proposal_id if proposal not found', () => {
    const recs = [
      mkRecord(1,
        [mkProposal('p1', 'Title-A')],
        [mkCritique('p1', 9)],
        [
          { id: 'a', kind: 'create_draft_outline', proposal_id: 'p1', payload: { title: 'Payload Title' }, applied_at: 0 },
          { id: 'b', kind: 'no_op', proposal_id: 'missing-id', payload: {}, applied_at: 0 },
        ]),
    ];
    const s = computeStats(recs, 'fallback');
    // p1 found by id → uses Title-A; missing-id not found → falls back to id itself
    assert.deepEqual(s.topAppliedTitles, ['Title-A', 'missing-id']);
  });

  it('trend is per-round avg of critique.total', () => {
    const recs = [
      mkRecord(1, [], [mkCritique('a', 4), mkCritique('b', 6)], []),     // avg 5
      mkRecord(2, [], [mkCritique('a', 8), mkCritique('b', 10)], []),    // avg 9
    ];
    const s = computeStats(recs, 'trend');
    assert.deepEqual(s.trend, [
      { round: 1, avgScore: 5 },
      { round: 2, avgScore: 9 },
    ]);
  });
});

describe('comparison invariants', () => {
  it('two sessions side-by-side: derived stats are independent', () => {
    const recsA = [
      mkRecord(1, [mkProposal('p', 'A')], [mkCritique('p', 9, 1280)],
        [{ id: 'x', kind: 'no_op', proposal_id: 'p', payload: {}, applied_at: 0 }]),
    ];
    const recsB = [
      mkRecord(1, [mkProposal('p', 'B')], [mkCritique('p', 5, 1200)], []),
    ];
    const a = computeStats(recsA, 'A');
    const b = computeStats(recsB, 'B');
    assert.ok(a.avgScore > b.avgScore, 'A.score > B.score');
    assert.ok(a.avgElo > b.avgElo, 'A.elo > B.elo');
    assert.ok(a.applied > b.applied, 'A.applied > B.applied');
    assert.equal(a.appliedRate, 1);
    assert.equal(b.appliedRate, 0);
  });

  it('sorting sessions by applied rate surfaces "most productive" first', () => {
    const recs1 = [mkRecord(1, [mkProposal('p', 'P')], [mkCritique('p', 9)],
      [{ id: 'x', kind: 'no_op', proposal_id: 'p', payload: {}, applied_at: 0 }])];
    const recs2 = [mkRecord(1, [mkProposal('p', 'P')], [mkCritique('p', 9)], [])];
    const stats = [computeStats(recs2, 'lazy'), computeStats(recs1, 'productive')];
    stats.sort((a, b) => b.appliedRate - a.appliedRate);
    assert.equal(stats[0].sid, 'productive');
    assert.equal(stats[1].sid, 'lazy');
  });
});

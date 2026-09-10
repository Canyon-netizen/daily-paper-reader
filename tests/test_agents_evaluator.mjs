/**
 * tests/test_agents_evaluator.mjs — Evaluator 4th agent unit test.
 *
 * 覆盖:buildEvaluationReport / formatEvaluationReportText / toJSON
 *
 * 跑法:node --test tests/test_agents_evaluator.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEvaluationReport,
  formatEvaluationReportText,
  toJSON,
} from '../astro-src/lib/agents/evaluator.mjs';

// helper: 构造 1 个 round
function mkRound({ type = 'add_paper', paperIds = [], decision = 'candidate' } = {}) {
  return {
    round: 1,
    proposal: {
      id: 'p1',
      type,
      title: 'T',
      rationale: 'r',
      evidence: { paperIds },
      risk: 'k',
    },
    gate: { decision },
    actions: [],
  };
}

// -----------------------------------------------------------------------
// 1. 空输入 → overall = 0,scores 全部 clamp 到 [0,1]
// -----------------------------------------------------------------------
test('empty input gives overall 0 and clamped sub-scores', () => {
  const r = buildEvaluationReport({ meta: {}, rounds: [], deliverables: [], syntheses: [] });
  assert.equal(r.scores.overall, 0);
  assert.equal(r.scores.coverage, 0);
  assert.equal(r.scores.alignment, 0);
  assert.equal(r.scores.consistency, 0);
  assert.equal(r.scores.synthesisCoverage, 0);
  assert.equal(r.counts.rounds, 0);
  assert.equal(r.counts.deliverables, 0);
  assert.equal(r.counts.syntheses, 0);
  assert.equal(r.counts.arxivIds, 0);
});

// -----------------------------------------------------------------------
// 2. coverage:多 paper + 多 type → coverage 高
// -----------------------------------------------------------------------
test('coverage rises with more arxiv ids and proposal types', () => {
  const rounds = [
    mkRound({ type: 'add_paper', paperIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }),
    mkRound({ type: 'create_draft' }),
    mkRound({ type: 'experiment_plan' }),
    mkRound({ type: 'literature_review' }),
    mkRound({ type: 'rebuttal' }),
  ];
  const r = buildEvaluationReport({ rounds });
  // 8 arxiv + 5 type 应该是 coverage = 1
  assert.equal(r.scores.coverage, 1);
  assert.equal(r.counts.arxivIds, 8);
  assert.equal(r.counts.proposalTypes, 5);
});

// -----------------------------------------------------------------------
// 3. coverage:少 paper 少 type → coverage 低
// -----------------------------------------------------------------------
test('coverage is partial with few arxiv ids / types', () => {
  const rounds = [mkRound({ type: 'add_paper', paperIds: ['a'] })];
  const r = buildEvaluationReport({ rounds });
  // arxiv 1/8 = 0.125; type 1/4 = 0.25; coverage = 0.6*0.125 + 0.4*0.25 = 0.075 + 0.1 = 0.175
  assert.equal(r.scores.coverage, 0.175);
});

// -----------------------------------------------------------------------
// 4. alignment:有 goal 时按 type 重合度算
// -----------------------------------------------------------------------
test('alignment uses goal.proposal_types overlap when goal present', () => {
  const meta = { goal: { proposal_types: ['add_paper', 'experiment_plan', 'NONEXISTENT'] } };
  const rounds = [mkRound({ type: 'add_paper' }), mkRound({ type: 'experiment_plan' })];
  const r = buildEvaluationReport({ meta, rounds });
  // overlap 2 / goal 3 = 0.666...
  assert.ok(Math.abs(r.scores.alignment - 2 / 3) < 1e-9);
  assert.equal(r.details.alignment.mode, 'goal_alignment');
});

// -----------------------------------------------------------------------
// 5. alignment:无 goal 时退化为 rationale + risk 覆盖率
// -----------------------------------------------------------------------
test('alignment falls back to rationale coverage when no goal', () => {
  const rounds = [mkRound(), mkRound(), mkRound()];
  const r = buildEvaluationReport({ rounds });
  // 全部有 rationale+risk → 1.0
  assert.equal(r.scores.alignment, 1);
  assert.equal(r.details.alignment.mode, 'rationale_coverage');
});

// -----------------------------------------------------------------------
// 6. consistency:全部同一 decision → 1.0
// -----------------------------------------------------------------------
test('consistency is 1.0 when all decisions identical', () => {
  const rounds = [
    mkRound({ decision: 'promoted' }),
    mkRound({ decision: 'promoted' }),
    mkRound({ decision: 'promoted' }),
    mkRound({ decision: 'promoted' }),
  ];
  const r = buildEvaluationReport({ rounds });
  assert.equal(r.scores.consistency, 1);
  assert.equal(r.details.consistency.transitions, 0);
});

// -----------------------------------------------------------------------
// 7. consistency:决策频繁切换 → 低分
// -----------------------------------------------------------------------
test('consistency drops with decision churn', () => {
  const rounds = [
    mkRound({ decision: 'promoted' }),
    mkRound({ decision: 'rejected' }),
    mkRound({ decision: 'promoted' }),
    mkRound({ decision: 'rejected' }),
  ];
  const r = buildEvaluationReport({ rounds });
  // 3 transitions / 3 possible = 1.0 churn → 0 consistency
  assert.equal(r.scores.consistency, 0);
});

// -----------------------------------------------------------------------
// 8. consistency:1 round → 0.5(中性)
// -----------------------------------------------------------------------
test('consistency is 0.5 with single round (neutral)', () => {
  const r = buildEvaluationReport({ rounds: [mkRound()] });
  assert.equal(r.scores.consistency, 0.5);
});

// -----------------------------------------------------------------------
// 9. synthesisCoverage:有 5 deliverable + 1 synthesis → 1.0
// -----------------------------------------------------------------------
test('synthesisCoverage is 1.0 with ≥5 deliverables + ≥1 synthesis', () => {
  const deliverables = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }));
  const syntheses = [{ id: 's1' }];
  const r = buildEvaluationReport({ deliverables, syntheses });
  assert.equal(r.scores.synthesisCoverage, 1);
});

// -----------------------------------------------------------------------
// 10. synthesisCoverage:有 deliverable 但无 synthesis → 0.5
// -----------------------------------------------------------------------
test('synthesisCoverage is 0.5 with deliverables but no synthesis', () => {
  const deliverables = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }));
  const r = buildEvaluationReport({ deliverables });
  assert.equal(r.scores.synthesisCoverage, 0.5);
});

// -----------------------------------------------------------------------
// 11. overall:高分输入
// -----------------------------------------------------------------------
test('overall is high when all sub-scores are high', () => {
  const rounds = [
    mkRound({ type: 'add_paper', paperIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], decision: 'promoted' }),
    mkRound({ type: 'create_draft', decision: 'promoted' }),
    mkRound({ type: 'experiment_plan', decision: 'promoted' }),
    mkRound({ type: 'literature_review', decision: 'promoted' }),
  ];
  const deliverables = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }));
  const syntheses = [{ id: 's1' }];
  const r = buildEvaluationReport({ rounds, deliverables, syntheses });
  assert.equal(r.scores.coverage, 1);            // 8 arxiv + 4 type
  assert.equal(r.scores.alignment, 1);           // 全部有 rationale
  assert.equal(r.scores.consistency, 1);         // 全部 promoted
  assert.equal(r.scores.synthesisCoverage, 1);   // 5 deliverables + 1 synthesis
  assert.equal(r.scores.overall, 1);
});

// -----------------------------------------------------------------------
// 12. overall:任何子分 < 1 → overall < 1
// -----------------------------------------------------------------------
test('overall is less than 1 when any sub-score is partial', () => {
  const rounds = [mkRound()];
  const r = buildEvaluationReport({ rounds });
  assert.ok(r.scores.overall > 0 && r.scores.overall < 1);
});

// -----------------------------------------------------------------------
// 13. formatEvaluationReportText:空报告
// -----------------------------------------------------------------------
test('formatEvaluationReportText handles empty report', () => {
  const r = buildEvaluationReport({});
  const s = formatEvaluationReportText(r);
  assert.match(s, /Overall: 0\.0%/);
  assert.match(s, /coverage/);
  assert.match(s, /alignment/);
  assert.match(s, /consistency/);
  assert.match(s, /synthesisCoverage/);
});

// -----------------------------------------------------------------------
// 14. formatEvaluationReportText:有 goal 时打印
// -----------------------------------------------------------------------
test('formatEvaluationReportText includes goal when set', () => {
  const r = buildEvaluationReport({ meta: { goal: 'study foo' } });
  const s = formatEvaluationReportText(r);
  assert.match(s, /Goal: study foo/);
});

// -----------------------------------------------------------------------
// 15. toJSON:stable round-trip
// -----------------------------------------------------------------------
test('toJSON round-trips through JSON.parse', () => {
  const r = buildEvaluationReport({
    rounds: [mkRound()],
    deliverables: [{ id: 'd1' }],
    syntheses: [{ id: 's1' }],
  });
  const j = toJSON(r);
  const parsed = JSON.parse(j);
  assert.deepEqual(parsed.scores, r.scores);
  assert.equal(parsed.counts.rounds, 1);
});

// -----------------------------------------------------------------------
// 16. version field is stable = 1
// -----------------------------------------------------------------------
test('report version field equals 1', () => {
  const r = buildEvaluationReport({});
  assert.equal(r.version, 1);
});

// -----------------------------------------------------------------------
// 17. generatedAt:可被 override
// -----------------------------------------------------------------------
test('generatedAt can be overridden', () => {
  const r = buildEvaluationReport({ generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(r.generatedAt, '2026-01-01T00:00:00.000Z');
});

// -----------------------------------------------------------------------
// 18. goal string passthrough
// -----------------------------------------------------------------------
test('goal string passes through to report.goal', () => {
  const r = buildEvaluationReport({ meta: { goal: 'foo bar' } });
  assert.equal(r.goal, 'foo bar');
});

// -----------------------------------------------------------------------
// 19. coverage 用 deliverable.arxivIds 也算
// -----------------------------------------------------------------------
test('coverage counts arxiv ids from deliverables too', () => {
  const rounds = [];
  const deliverables = Array.from({ length: 8 }, (_, i) => ({
    id: `d${i}`,
    arxivIds: [`arxiv${i}`],
  }));
  const r = buildEvaluationReport({ rounds, deliverables });
  // 8 distinct arxiv + 0 types → 0.6*1 + 0.4*0 = 0.6
  assert.equal(r.scores.coverage, 0.6);
});

// -----------------------------------------------------------------------
// 20. 输入非法(missing meta / wrong types)不抛
// -----------------------------------------------------------------------
test('handles malformed input without throwing', () => {
  assert.doesNotThrow(() => buildEvaluationReport({
    meta: null,
    rounds: null,
    deliverables: 'string not array',
    syntheses: undefined,
  }));
  const r = buildEvaluationReport({
    meta: null,
    rounds: null,
    deliverables: 'string not array',
    syntheses: undefined,
  });
  assert.equal(r.scores.overall, 0);
});
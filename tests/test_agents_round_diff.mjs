/**
 * tests/test_agents_round_diff.mjs — round diff 纯逻辑守护。
 *
 * iter #16:用户跑完一轮想知道"这一轮比上一轮做了什么":
 *   - 新增 proposals(标题列表)
 *   - 移除 proposals(标题列表)
 *   - 新增 applied actions(按 target 分组)
 *   - 平均分 delta(score)
 *   - 平均 Elo delta
 *
 * 纯函数,跟 DOM 解耦。
 *
 * 跑法:node tests/test_agents_round_diff.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function diffRounds(prev, curr) {
  const prevTitles = new Set((prev?.designer?.proposals ?? []).map((p) => p.title));
  const currTitles = new Set((curr?.designer?.proposals ?? []).map((p) => p.title));
  const addedTitles = [...currTitles].filter((t) => !prevTitles.has(t));
  const removedTitles = [...prevTitles].filter((t) => !currTitles.has(t));

  // applied diff:用 proposal_id 找 title
  const proposalById = new Map();
  for (const p of curr?.designer?.proposals ?? []) proposalById.set(p.id, p.title);
  for (const p of prev?.designer?.proposals ?? []) if (!proposalById.has(p.id)) proposalById.set(p.id, p.title);

  const prevAppliedIds = new Set((prev?.modifier?.applied ?? []).map((a) => a.proposal_id));
  const newApplied = (curr?.modifier?.applied ?? []).filter((a) => !prevAppliedIds.has(a.proposal_id));
  const newAppliedTitles = newApplied
    .map((a) => proposalById.get(a.proposal_id) ?? a.proposal_id);

  function avgScores(rec) {
    const cs = rec?.feedback?.critiques ?? [];
    if (cs.length === 0) return null;
    return cs.reduce((a, c) => a + c.total, 0) / cs.length;
  }
  function avgElo(rec) {
    const cs = rec?.feedback?.critiques ?? [];
    if (cs.length === 0) return null;
    return cs.reduce((a, c) => a + c.elo, 0) / cs.length;
  }

  const prevScore = avgScores(prev);
  const currScore = avgScores(curr);
  const prevElo = avgElo(prev);
  const currElo = avgElo(curr);

  return {
    addedTitles,
    removedTitles,
    newAppliedTitles,
    scoreDelta: prevScore === null || currScore === null ? null : currScore - prevScore,
    eloDelta: prevElo === null || currElo === null ? null : currElo - prevElo,
    prevScore,
    currScore,
    prevElo,
    currElo,
  };
}

function mkProposal(id, title) {
  return { id, title };
}

function mkRec(round, opts = {}) {
  const proposals = (opts.proposals ?? []).map((p) =>
    typeof p === 'string' ? mkProposal(p, p) : p,
  );
  const applied = (opts.applied ?? []).map((p) =>
    typeof p === 'string' ? { proposal_id: p } : p,
  );
  const critiques = opts.critiques === undefined
    ? []
    : opts.critiques.map((total, i) => ({
        proposal_id: proposals[i]?.id ?? `p${i}`,
        total,
        elo: opts.elo ?? 1200,
      }));
  return {
    round,
    designer: { proposals },
    feedback: { critiques },
    modifier: { applied },
  };
}

describe('diffRounds', () => {
  it('returns empty diffs for null prev', () => {
    const curr = mkRec(1, { proposals: ['A', 'B'], applied: ['A'], critiques: [5] });
    const d = diffRounds(null, curr);
    assert.ok(!d.scoreDelta, 'no score delta when prev is null');
    assert.equal(d.addedTitles.length, 2);  // both are "new"
  });

  it('shows added/removed titles', () => {
    const prev = mkRec(1, { proposals: ['A', 'B'] });
    const curr = mkRec(2, { proposals: ['B', 'C'] });
    const d = diffRounds(prev, curr);
    assert.deepEqual(d.addedTitles, ['C']);
    assert.deepEqual(d.removedTitles, ['A']);
  });

  it('detects newly applied proposals', () => {
    const prev = mkRec(1, { proposals: ['A', 'B'], applied: ['A'] });
    const curr = mkRec(2, { proposals: ['A', 'B'], applied: ['A', 'B'] });
    const d = diffRounds(prev, curr);
    assert.deepEqual(d.newAppliedTitles, ['B']);
  });

  it('computes score delta correctly', () => {
    const prev = mkRec(1, { proposals: ['A'], critiques: [4] });
    const curr = mkRec(2, { proposals: ['B'], critiques: [7] });
    const d = diffRounds(prev, curr);
    assert.equal(d.prevScore, 4);
    assert.equal(d.currScore, 7);
    assert.equal(d.scoreDelta, 3);
  });

  it('handles multiple critiques (avg)', () => {
    const prev = mkRec(1, { proposals: ['A', 'B'], critiques: [4, 6] });  // avg 5
    const curr = mkRec(2, { proposals: ['C', 'D'], critiques: [7, 9] });  // avg 8
    const d = diffRounds(prev, curr);
    assert.equal(d.scoreDelta, 3);
  });

  it('returns null deltas when either side has no critiques', () => {
    const prev = mkRec(1, { proposals: ['A'] });  // no critiques
    const curr = mkRec(2, { proposals: ['A'], critiques: [5] });
    const d = diffRounds(prev, curr);
    assert.equal(d.scoreDelta, null);
    assert.equal(d.currScore, 5);
    assert.equal(d.prevScore, null);
  });

  it('computes elo delta when elo changes', () => {
    const prev = mkRec(1, { proposals: ['A'], critiques: [5], elo: 1200 });
    const curr = mkRec(2, { proposals: ['A'], critiques: [7], elo: 1240 });
    const d = diffRounds(prev, curr);
    assert.equal(d.eloDelta, 40);
  });

  it('empty applied on both sides → no new applied', () => {
    const prev = mkRec(1, { proposals: ['A'] });
    const curr = mkRec(2, { proposals: ['A'] });
    const d = diffRounds(prev, curr);
    assert.equal(d.newAppliedTitles.length, 0);
  });

  it('handles proposals with object {id, title} shape', () => {
    const prev = mkRec(1, {
      proposals: [
        { id: 'p1', title: 'Try contrastive loss' },
        { id: 'p2', title: 'Try larger batch' },
      ],
    });
    const curr = mkRec(2, {
      proposals: [
        { id: 'p2', title: 'Try larger batch' },
        { id: 'p3', title: 'Add data augmentation' },
      ],
      applied: [{ proposal_id: 'p3' }],
    });
    const d = diffRounds(prev, curr);
    assert.deepEqual(d.addedTitles, ['Add data augmentation']);
    assert.deepEqual(d.removedTitles, ['Try contrastive loss']);
    assert.deepEqual(d.newAppliedTitles, ['Add data augmentation']);
  });
});

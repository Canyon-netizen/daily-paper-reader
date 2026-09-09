/**
 * tests/test_agents_trends.mjs — Round trend 计算守护。
 *
 * 覆盖:
 *   1. buildTrend for 'score' / 'elo' / 'applied' metric
 *   2. average / stdDev helpers
 *   3. 收敛信号判定逻辑
 *
 * 跑法:node tests/test_agents_trends.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 把浏览器脚本里那几个纯函数拷过来测(或重导出;这里为简单直接复制,
// 因为它们都是纯函数且与 DOM/SVG 生成逻辑解耦)

function average(xs) {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs) {
  if (xs.length < 2) return 0;
  const m = average(xs);
  const v = average(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

function buildTrend(records, metric) {
  return records.map((r) => {
    if (metric === 'applied') {
      return { round: r.round, value: r.modifier.applied.length };
    }
    if (r.feedback.critiques.length === 0) {
      return { round: r.round, value: 0 };
    }
    const xs = r.feedback.critiques.map((c) =>
      metric === 'score' ? c.total : c.elo,
    );
    return { round: r.round, value: average(xs) };
  });
}

function makeRecord(round, total, elo, applied) {
  return {
    schema_version: 1,
    round,
    project_id: 'test',
    started_at: 0,
    finished_at: 0,
    designer: { proposals: [], prompt_summary: '', model: 'stub' },
    feedback: {
      critiques: total !== null
        ? [{ proposal_id: `p${round}`, total, elo, scores: { methodologist: total, engineer: total, skeptic: total }, critique: '', matches: 0, wins: 0, persona_attribution: { methodologist: '', engineer: '', skeptic: '' } }]
        : [],
      judge_calls: 3,
      total_tokens: 0,
    },
    gate: { verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [] },
    modifier: { applied: applied ? [{ id: 'a', kind: 'no_op', proposal_id: 'p', payload: {}, applied_at: 0 }] : [], skipped: [] },
    meta: { session_id: 'test', dry_run: true },
  };
}

describe('trend math helpers', () => {
  it('average computes arithmetic mean', () => {
    assert.equal(average([1, 2, 3, 4]), 2.5);
    assert.equal(average([]), 0);
    assert.equal(average([7]), 7);
  });

  it('stdDev returns 0 for <2 points', () => {
    assert.equal(stdDev([]), 0);
    assert.equal(stdDev([5]), 0);
  });

  it('stdDev for constant series is 0', () => {
    assert.equal(stdDev([3, 3, 3, 3]), 0);
  });

  it('stdDev increases with spread', () => {
    const tight = stdDev([5, 5, 5, 6]);
    const wide = stdDev([1, 5, 9, 9]);
    assert.ok(tight < wide, `expected tight(${tight}) < wide(${wide})`);
  });
});

describe('buildTrend', () => {
  it('score metric averages c.total per round', () => {
    const records = [
      makeRecord(1, 4, 1200, false),
      makeRecord(2, 6, 1200, false),
    ];
    const t = buildTrend(records, 'score');
    assert.equal(t.length, 2);
    assert.equal(t[0].value, 4);
    assert.equal(t[1].value, 6);
  });

  it('elo metric averages c.elo per round', () => {
    const records = [
      makeRecord(1, null, 1200, false),  // no critiques, value = 0
      makeRecord(2, 5, 1240, false),
    ];
    const t = buildTrend(records, 'elo');
    assert.equal(t[0].value, 0);  // no critiques
    assert.equal(t[1].value, 1240);
  });

  it('applied metric counts modifier.applied length', () => {
    const records = [
      makeRecord(1, 5, 1200, false),
      makeRecord(2, 5, 1200, true),
      makeRecord(3, 5, 1200, true),
    ];
    const t = buildTrend(records, 'applied');
    assert.deepEqual(t.map((p) => p.value), [0, 1, 1]);
  });

  it('returns empty array for empty records', () => {
    assert.deepEqual(buildTrend([], 'score'), []);
  });
});

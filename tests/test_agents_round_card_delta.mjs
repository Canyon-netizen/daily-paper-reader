/**
 * tests/test_agents_round_card_delta.mjs — iter #28 round card 增量 + sparkline
 *
 * 在每个 round 卡片右上角显示:
 *   - ↑ +0.4  ← avg score delta vs 上一 round(没有 prev → "—")
 *   - ↓ -0.3
 *   - 0       (delta 在 ±0.05 内)
 *   - mini sparkline:SVG path 显示该 round 在所有 rounds 中的 avg score
 *
 * 纯函数:
 *   - avgScore(rec):平均 score(没 critique → null)
 *   - scoreDelta(prev, curr):curr.avg - prev.avg(任一为 null → null)
 *   - deltaBadge(delta):{ sign: '+' | '-' | '0' | 'none', color: 'pos'|'neg'|'zero'|'none', text }
 *   - buildSparkline(scores, opts):返回 SVG path d=""(数组长度 < 2 → null)
 *
 * 跑法:node tests/test_agents_round_card_delta.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function avgScore(rec) {
  const cs = rec?.feedback?.critiques;
  if (!Array.isArray(cs) || cs.length === 0) return null;
  return cs.reduce((a, c) => a + (Number(c.total) || 0), 0) / cs.length;
}

function scoreDelta(prev, curr) {
  const p = avgScore(prev);
  const c = avgScore(curr);
  if (p === null || c === null) return null;
  return c - p;
}

function deltaBadge(delta) {
  if (delta === null || !isFinite(delta)) {
    return { sign: 'none', color: 'none', text: '—', value: null };
  }
  if (delta > 0.05) {
    return { sign: '+', color: 'pos', text: `+${delta.toFixed(2)}`, value: delta };
  }
  if (delta < -0.05) {
    return { sign: '-', color: 'neg', text: delta.toFixed(2), value: delta };
  }
  return { sign: '0', color: 'zero', text: '0', value: 0 };
}

/**
 * 生成 sparkline 的 SVG path。
 * scores: 数字数组(已按 round 顺序排好)
 * opts: { width, height, padding }
 * 返回 { d, points } 或 { d: null } 当长度 < 2
 */
function buildSparkline(scores, opts = {}) {
  const { width: w = 80, height: h = 24, padding: p = 3 } = opts;
  if (!Array.isArray(scores) || scores.length < 2) return { d: null, points: [] };
  const valid = scores.filter((s) => Number.isFinite(s));
  if (valid.length < 2) return { d: null, points: [] };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const dx = (w - 2 * p) / (valid.length - 1);
  const points = valid.map((s, i) => {
    const x = p + i * dx;
    const y = p + (h - 2 * p) * (1 - (s - min) / range);
    return [x, y];
  });
  const d = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  return { d, points };
}

describe('avgScore', () => {
  it('returns mean of totals', () => {
    assert.equal(avgScore({ feedback: { critiques: [{ total: 6 }, { total: 8 }] } }), 7);
  });
  it('returns null when no critiques', () => {
    assert.equal(avgScore({ feedback: { critiques: [] } }), null);
    assert.equal(avgScore({}), null);
    assert.equal(avgScore(null), null);
  });
  it('coerces non-number total to 0', () => {
    assert.equal(avgScore({ feedback: { critiques: [{ total: 5 }, { total: 'x' }] } }), 2.5);
  });
});

describe('scoreDelta', () => {
  it('computes curr - prev', () => {
    const prev = { feedback: { critiques: [{ total: 6 }] } };
    const curr = { feedback: { critiques: [{ total: 7 }] } };
    assert.equal(scoreDelta(prev, curr), 1);
  });
  it('negative when curr worse', () => {
    const prev = { feedback: { critiques: [{ total: 7 }] } };
    const curr = { feedback: { critiques: [{ total: 5 }] } };
    assert.equal(scoreDelta(prev, curr), -2);
  });
  it('null when either is null', () => {
    assert.equal(scoreDelta(null, { feedback: { critiques: [{ total: 5 }] } }), null);
    assert.equal(scoreDelta({ feedback: { critiques: [{ total: 5 }] } }, null), null);
    assert.equal(scoreDelta(null, null), null);
  });
});

describe('deltaBadge', () => {
  it('positive → +N.NN with color pos', () => {
    const b = deltaBadge(0.5);
    assert.equal(b.sign, '+');
    assert.equal(b.color, 'pos');
    assert.equal(b.text, '+0.50');
  });
  it('small positive (≤0.05) → zero', () => {
    const b = deltaBadge(0.03);
    assert.equal(b.color, 'zero');
  });
  it('negative → N.NN (no sign) with color neg', () => {
    const b = deltaBadge(-0.4);
    assert.equal(b.sign, '-');
    assert.equal(b.color, 'neg');
    assert.equal(b.text, '-0.40');
  });
  it('zero (within ±0.05) → "0" color zero', () => {
    assert.equal(deltaBadge(0).text, '0');
    assert.equal(deltaBadge(0.02).color, 'zero');
    assert.equal(deltaBadge(-0.04).color, 'zero');
  });
  it('null → "—" color none', () => {
    const b = deltaBadge(null);
    assert.equal(b.text, '—');
    assert.equal(b.color, 'none');
  });
  it('non-finite → "—"', () => {
    assert.equal(deltaBadge(NaN).text, '—');
    assert.equal(deltaBadge(Infinity).text, '—');
  });
});

describe('buildSparkline', () => {
  it('returns null d when < 2 valid points', () => {
    assert.equal(buildSparkline([]).d, null);
    assert.equal(buildSparkline([5]).d, null);
    assert.equal(buildSparkline([null, null]).d, null);
  });
  it('produces SVG path for valid scores', () => {
    const r = buildSparkline([5, 6, 7, 8]);
    assert.ok(r.d.startsWith('M'));
    assert.ok(r.d.includes('L'));
    assert.equal(r.points.length, 4);
  });
  it('normalizes range — min at top, max at bottom of inner box', () => {
    const { points } = buildSparkline([1, 5, 10], { width: 30, height: 20, padding: 0 });
    // points[0] should be at y = 20 (lowest, bottom), points[2] at y = 0 (highest, top)
    assert.equal(points[0][1], 20);
    assert.equal(points[2][1], 0);
  });
  it('handles all-equal scores (range=0 fallback)', () => {
    const r = buildSparkline([5, 5, 5]);
    assert.ok(r.d.startsWith('M'));
    assert.equal(r.points.length, 3);
  });
  it('ignores null entries', () => {
    const r = buildSparkline([null, 5, 6, null, 7]);
    assert.equal(r.points.length, 3);
  });
});

describe('end-to-end: round cards with delta + sparkline', () => {
  it('session with 4 rounds of improving scores', () => {
    const rounds = [
      { round: 1, feedback: { critiques: [{ total: 5 }] } },
      { round: 2, feedback: { critiques: [{ total: 6 }] } },
      { round: 3, feedback: { critiques: [{ total: 6.5 }] } },
      { round: 4, feedback: { critiques: [{ total: 7.5 }] } },
    ];
    // 每个 round 的 badge
    const badges = rounds.map((r, i) => ({
      round: r.round,
      badge: deltaBadge(scoreDelta(i > 0 ? rounds[i - 1] : null, r)),
      avg: avgScore(r),
    }));
    assert.equal(badges[0].badge.color, 'none');  // 第一轮无 delta
    assert.equal(badges[1].badge.color, 'pos');   // 5 → 6
    assert.equal(badges[2].badge.color, 'pos');   // 6 → 6.5
    assert.equal(badges[3].badge.color, 'pos');   // 6.5 → 7.5
    // sparkline
    const spark = buildSparkline(rounds.map(avgScore));
    assert.ok(spark.d.startsWith('M'));
    assert.equal(spark.points.length, 4);
  });
  it('round with no critiques gets "—" badge and breaks sparkline', () => {
    const rounds = [
      { round: 1, feedback: { critiques: [{ total: 5 }] } },
      { round: 2, feedback: { critiques: [] } },  // empty!
    ];
    assert.equal(deltaBadge(scoreDelta(rounds[0], rounds[1])).text, '—');
    // 过滤 null/无效,只剩 1 个有效点
    const spark = buildSparkline(rounds.map(avgScore));
    assert.equal(spark.d, null);
  });
});
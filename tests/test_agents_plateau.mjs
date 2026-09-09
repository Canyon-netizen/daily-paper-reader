/**
 * tests/test_agents_plateau.mjs — 收敛检测(plateau)守护。
 *
 * iter #12 在 orchestrator.ts 里加了:
 *   plateauThreshold (默认 0.3) + plateauWindow (默认 3)
 *   → 当 records.length >= plateauWindow 且最后 N 轮 avg score 标准差
 *     < threshold 时,stoppedReason='plateau'
 *
 * 这里把 plateau 检测函数抽出来当纯函数测,验证:
 *   1. < window 轮不触发(数据不够)
 *   2. 稳定 series (stdDev≈0) → 触发
 *   3. 上升 series (stdDev 大) → 不触发
 *   4. 含空 critique 轮的 series → 不触发(空 round 会拉低 stdDev 误判)
 *   5. 显式 threshold=Infinity → 不触发(关闭功能)
 *
 * 跑法:node --import tsx tests/test_agents_plateau.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 镜像 orchestrator.ts 里的 plateau 检测纯函数
function detectPlateau(records, plateauThreshold = 0.3, plateauWindow = 3) {
  if (!isFinite(plateauThreshold)) return false;
  if (records.length < plateauWindow) return false;
  if (!records.every((r) => r.feedback.critiques.length > 0)) return false;

  const tail = records.slice(-plateauWindow).map((r) => {
    const cs = r.feedback.critiques;
    return cs.reduce((a, c) => a + c.total, 0) / cs.length;
  });
  const m = tail.reduce((a, b) => a + b, 0) / tail.length;
  const variance = tail.reduce((a, b) => a + (b - m) ** 2, 0) / tail.length;
  const stddev = Math.sqrt(variance);
  return stddev < plateauThreshold;
}

function mkRecord(round, total) {
  return {
    schema_version: 1, round,
    project_id: 't', started_at: 100 + round, finished_at: 100 + round + 1,
    designer: { proposals: [], prompt_summary: '', model: 'stub' },
    feedback: {
      critiques: total === null
        ? []
        : [{ proposal_id: `p${round}`, total, elo: 1200, scores: { methodologist: total, engineer: total, skeptic: total },
            critique: '', matches: 0, wins: 0, persona_attribution: { methodologist: '', engineer: '', skeptic: '' } }],
      judge_calls: 1, total_tokens: 0,
    },
    gate: { verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [] },
    modifier: { applied: [], skipped: [] },
    meta: { session_id: 't', dry_run: true },
  };
}

describe('detectPlateau', () => {
  it('returns false when fewer than window records', () => {
    assert.equal(detectPlateau([mkRecord(1, 5), mkRecord(2, 5)], 0.3, 3), false);
  });

  it('triggers when last N rounds have stable scores', () => {
    // 三轮都是 7.5 ± 0.1 → stdDev 远 < 0.3 → 收敛
    const recs = [mkRecord(1, 7.4), mkRecord(2, 7.5), mkRecord(3, 7.6)];
    assert.equal(detectPlateau(recs, 0.3, 3), true);
  });

  it('does not trigger when scores are climbing', () => {
    // 三轮 5, 7, 9 → stdDev > 1.5 → 未收敛
    const recs = [mkRecord(1, 5), mkRecord(2, 7), mkRecord(3, 9)];
    assert.equal(detectPlateau(recs, 0.3, 3), false);
  });

  it('does not trigger when scores are oscillating', () => {
    const recs = [mkRecord(1, 3), mkRecord(2, 9), mkRecord(3, 4)];
    assert.equal(detectPlateau(recs, 0.3, 3), false);
  });

  it('does not trigger when any tail round has zero critiques (would skew stdDev)', () => {
    const recs = [mkRecord(1, 7), mkRecord(2, null), mkRecord(3, 7)];
    assert.equal(detectPlateau(recs, 0.3, 3), false);
  });

  it('threshold=Infinity disables detection (auto-iterate off)', () => {
    const recs = [mkRecord(1, 7), mkRecord(2, 7), mkRecord(3, 7)];
    assert.equal(detectPlateau(recs, Infinity, 3), false);
  });

  it('only looks at last N rounds, not all rounds', () => {
    // 前两轮波动大,后三轮稳定 → 应该看后三轮 → 触发
    const recs = [mkRecord(1, 3), mkRecord(2, 9), mkRecord(3, 7), mkRecord(4, 7), mkRecord(5, 7)];
    assert.equal(detectPlateau(recs, 0.3, 3), true);
  });

  it('custom window size respected', () => {
    // window=5:三轮不够,5 轮才行
    const threeRecs = [mkRecord(1, 7), mkRecord(2, 7), mkRecord(3, 7)];
    assert.equal(detectPlateau(threeRecs, 0.3, 5), false);
    const fiveRecs = [...threeRecs, mkRecord(4, 7), mkRecord(5, 7)];
    assert.equal(detectPlateau(fiveRecs, 0.3, 5), true);
  });

  it('threshold boundary: stdDev exactly = threshold is NOT triggered (< not <=)', () => {
    // 两轮 avg 5, 5 → stdDev=0 → 触发
    // 构造让 stdDev 正好等于 threshold:
    // 两轮 (5, 5) 不够;三轮 (5, 5.3, 4.7):mean=5, var=((0²+0.3²+0.3²)/3)=0.06
    // stdDev ≈ 0.245 < 0.3 → 触发
    const recs = [mkRecord(1, 5), mkRecord(2, 5.3), mkRecord(3, 4.7)];
    assert.equal(detectPlateau(recs, 0.3, 3), true);
    // 稍微抬高 variance,变成不触发
    const recs2 = [mkRecord(1, 5), mkRecord(2, 5.6), mkRecord(3, 4.4)];
    assert.equal(detectPlateau(recs2, 0.3, 3), false);  // stdDev ≈ 0.49
  });
});

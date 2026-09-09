/**
 * tests/test_agents_tokens.mjs — token 用量与成本估算的纯逻辑守护。
 *
 * iter #13 在 /agents/ 页面顶部加了一个 token panel:
 *   - 总 tokens (本次 run 累计)
 *   - 估算费用 ($)
 *   - 每轮条形图 (last 8 rounds)
 *
 * 这里把"从 RoundRecord[] 算聚合"和"按 $/M rate 算成本"抽成纯函数测,
 * 避免 UI 渲染 bug 被静默吞掉。
 *
 * 跑法:node tests/test_agents_tokens.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 镜像 index.astro 里的聚合纯函数
function aggregateTokens(records) {
  const perRound = records.map((r, i) => ({
    round: r.round ?? i + 1,
    tokens: Number(r.feedback?.total_tokens) || 0,
    proposals: r.designer?.proposals?.length ?? 0,
    critiques: r.feedback?.critiques?.length ?? 0,
  }));
  const total = perRound.reduce((a, b) => a + b.tokens, 0);
  return { total, perRound };
}

function estimateCost(totalTokens, ratePerMTok) {
  if (!isFinite(ratePerMTok) || ratePerMTok < 0) return 0;
  // totalTokens 是 tokens 数,$/M 是每百万 tokens 多少美元
  return (totalTokens / 1_000_000) * ratePerMTok;
}

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function mkRec(round, tokens) {
  return {
    round,
    feedback: { total_tokens: tokens, critiques: [{ proposal_id: 'p1', total: 5 }] },
    designer: { proposals: [{ id: 'p1' }] },
  };
}

describe('aggregateTokens', () => {
  it('returns zero for empty record list', () => {
    const { total, perRound } = aggregateTokens([]);
    assert.equal(total, 0);
    assert.equal(perRound.length, 0);
  });

  it('sums per-round tokens into a total', () => {
    const recs = [mkRec(1, 2500), mkRec(2, 3000), mkRec(3, 4500)];
    const { total, perRound } = aggregateTokens(recs);
    assert.equal(total, 10_000);
    assert.equal(perRound.length, 3);
    assert.equal(perRound[0].tokens, 2500);
    assert.equal(perRound[2].round, 3);
  });

  it('tolerates missing feedback (treats as 0)', () => {
    const recs = [mkRec(1, 1000), { round: 2 }];
    const { total } = aggregateTokens(recs);
    assert.equal(total, 1000);
  });

  it('tolerates missing total_tokens (NaN-safe via || 0)', () => {
    const recs = [mkRec(1, NaN), mkRec(2, 500)];
    const { total, perRound } = aggregateTokens(recs);
    // NaN || 0 → 0; NaN check: Number(NaN) is NaN, NaN || 0 = 0
    assert.equal(perRound[0].tokens, 0);
    assert.equal(total, 500);
  });

  it('keeps round index falling back to position when round missing', () => {
    const recs = [{}, mkRec(2, 100)];
    const { perRound } = aggregateTokens(recs);
    assert.equal(perRound[0].round, 1);
    assert.equal(perRound[1].round, 2);
  });
});

describe('estimateCost', () => {
  it('returns 0 for empty tokens', () => {
    assert.equal(estimateCost(0, 0.5), 0);
  });
  it('multiplies tokens/1e6 by rate', () => {
    // 1M tokens @ $0.50/M = $0.50
    assert.equal(estimateCost(1_000_000, 0.5), 0.5);
  });
  it('1k tokens @ $1.00/M = $0.001', () => {
    assert.equal(estimateCost(1000, 1.0), 0.001);
  });
  it('rejects negative or non-finite rate', () => {
    assert.equal(estimateCost(1_000_000, -0.5), 0);
    assert.equal(estimateCost(1_000_000, NaN), 0);
    assert.equal(estimateCost(1_000_000, Infinity), 0);
  });
  it('rate=0 is valid (free local model) → $0', () => {
    assert.equal(estimateCost(50_000, 0), 0);
  });
});

describe('formatTokens', () => {
  it('shows plain <1000 numbers as-is', () => {
    assert.equal(formatTokens(0), '0');
    assert.equal(formatTokens(999), '999');
  });
  it('shows thousands with k suffix', () => {
    assert.equal(formatTokens(1000), '1.0k');
    assert.equal(formatTokens(25500), '25.5k');
    assert.equal(formatTokens(999_999), '1000.0k');
  });
  it('shows millions with M suffix', () => {
    assert.equal(formatTokens(1_000_000), '1.00M');
    assert.equal(formatTokens(2_500_000), '2.50M');
  });
});

describe('integration: aggregate → cost → format', () => {
  it('produces a coherent summary for a 5-round auto-iter session', () => {
    const recs = [
      mkRec(1, 2500), mkRec(2, 3000), mkRec(3, 3200),
      mkRec(4, 2900), mkRec(5, 2800),
    ];
    const { total, perRound } = aggregateTokens(recs);
    assert.equal(total, 14_400);
    const cost = estimateCost(total, 0.5);
    assert.equal(cost, 0.0072);
    assert.equal(formatTokens(total), '14.4k');
    // 同样跑一轮的 cost 应当 < $0.01,合理
    assert.ok(cost < 0.01, `cost $${cost} should be < $0.01`);
    // per-round 都 ≥ 2500(proposal 数 ≥ 1)
    assert.ok(perRound.every((p) => p.tokens >= 2500));
  });
});

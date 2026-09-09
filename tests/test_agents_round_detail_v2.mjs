/**
 * tests/test_agents_round_detail_v2.mjs — iter #27 round detail page polish
 *
 * Helper functions for the round detail page:
 *   - breakdownTokens(rec):按 designer / feedback / modifier 拆分 token 用量
 *     (实际 JSON 只有 feedback.total_tokens 聚合,所以这里估计各部分比例)
 *   - roundNavFor(sessionId, currentRound, allRounds):返回 prev/next round 信息
 *   - formatTokenCount(n) / formatDuration(ms)
 *   - appliedBadgeClass(kind) / skippedBadgeClass(reason)
 *
 * 跑法:node tests/test_agents_round_detail_v2.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 按比例拆分 token:designer 占 60%,feedback 占 30%,modifier 占 10%
 * (经验值,实际 JSON 只有聚合的 feedback.total_tokens)
 */
function breakdownTokens(rec) {
  const total = rec?.feedback?.total_tokens ?? 0;
  return {
    designer: Math.round(total * 0.60),
    feedback: Math.round(total * 0.30),
    modifier: Math.max(0, total - Math.round(total * 0.60) - Math.round(total * 0.30)),
    total,
  };
}

/**
 * 列出当前 session 的所有 round numbers(已排序),返回 prev/next
 */
function roundNavFor(currentRound, allRounds) {
  const sorted = allRounds.slice().sort((a, b) => a - b);
  const idx = sorted.indexOf(currentRound);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? sorted[idx - 1] : null,
    next: idx < sorted.length - 1 ? sorted[idx + 1] : null,
  };
}

/**
 * 格式化 token 数为 "1.2K" / "3.4M" / "567"
 */
function formatTokenCount(n) {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/**
 * 格式化毫秒为 "1.5s" / "1m 23s"
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

/**
 * Modifier action 的 badge class
 * 不同 kind 给不同颜色:create_draft_outline → green,
 * archive_round_summary → blue, add_paper_to_stage → purple,其他 → gray
 */
function appliedBadgeClass(kind) {
  if (kind === 'create_draft_outline') return 'badge badge-high';
  if (kind === 'archive_round_summary') return 'badge badge-mid';
  if (kind === 'add_paper_to_stage') return 'badge badge-low';
  return 'badge badge-none';
}

/**
 * Skipped reason 的分类
 * 'no_op' → low (可接受跳过)
 * 'duplicate' / 'already_exists' → mid (重复)
 * 其他 → none (异常)
 */
function skippedBadgeClass(reason) {
  const r = String(reason ?? '').toLowerCase();
  if (r.includes('no_op') || r.includes('noop')) return 'badge badge-low';
  if (r.includes('duplicate') || r.includes('already')) return 'badge badge-mid';
  return 'badge badge-none';
}

/**
 * 渲染 nav 链接(side buttons):"← R3 | R5 →"
 */
function renderNavLabel(prev, next) {
  if (prev == null && next == null) return null;
  return {
    prev: prev == null ? null : `← R${prev}`,
    next: next == null ? null : `R${next} →`,
  };
}

describe('breakdownTokens', () => {
  it('splits total into 60/30/10 ratio', () => {
    const b = breakdownTokens({ feedback: { total_tokens: 1000 } });
    assert.equal(b.designer, 600);
    assert.equal(b.feedback, 300);
    assert.equal(b.modifier, 100);
    assert.equal(b.total, 1000);
  });
  it('handles missing rec gracefully', () => {
    const b = breakdownTokens(null);
    assert.equal(b.total, 0);
    assert.equal(b.designer, 0);
  });
  it('handles zero tokens', () => {
    const b = breakdownTokens({ feedback: { total_tokens: 0 } });
    assert.equal(b.total, 0);
  });
  it('modifier = total - designer - feedback (no negative)', () => {
    const b = breakdownTokens({ feedback: { total_tokens: 100 } });
    assert.ok(b.modifier >= 0);
    assert.equal(b.designer + b.feedback + b.modifier, b.total);
  });
});

describe('roundNavFor', () => {
  it('finds prev and next in middle', () => {
    const nav = roundNavFor(3, [1, 2, 3, 4, 5]);
    assert.equal(nav.prev, 2);
    assert.equal(nav.next, 4);
  });
  it('no prev when at start', () => {
    const nav = roundNavFor(1, [1, 2, 3]);
    assert.equal(nav.prev, null);
    assert.equal(nav.next, 2);
  });
  it('no next when at end', () => {
    const nav = roundNavFor(5, [1, 3, 5]);
    assert.equal(nav.prev, 3);
    assert.equal(nav.next, null);
  });
  it('single round → both null', () => {
    const nav = roundNavFor(1, [1]);
    assert.equal(nav.prev, null);
    assert.equal(nav.next, null);
  });
  it('not found → both null', () => {
    const nav = roundNavFor(99, [1, 2, 3]);
    assert.equal(nav.prev, null);
    assert.equal(nav.next, null);
  });
  it('handles unsorted input', () => {
    const nav = roundNavFor(3, [5, 1, 3, 2]);
    assert.equal(nav.prev, 2);
    assert.equal(nav.next, 5);
  });
});

describe('formatTokenCount', () => {
  it('formats sub-thousand as integer', () => {
    assert.equal(formatTokenCount(0), '0');
    assert.equal(formatTokenCount(567), '567');
  });
  it('formats thousands with K suffix', () => {
    assert.equal(formatTokenCount(1500), '1.5K');
    assert.equal(formatTokenCount(999999), '1000.0K');
  });
  it('formats millions with M suffix', () => {
    assert.equal(formatTokenCount(1_200_000), '1.2M');
  });
  it('handles negative / non-finite', () => {
    assert.equal(formatTokenCount(-1), '0');
    assert.equal(formatTokenCount(NaN), '0');
    assert.equal(formatTokenCount(Infinity), '0');
  });
});

describe('formatDuration', () => {
  it('under 1 second → ms', () => {
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(999), '999ms');
  });
  it('under 1 minute → seconds', () => {
    assert.equal(formatDuration(1500), '1.5s');
    assert.equal(formatDuration(59999), '60.0s');  // boundary
  });
  it('over 1 minute → m + s', () => {
    assert.equal(formatDuration(83_000), '1m 23s');
    assert.equal(formatDuration(125_000), '2m 5s');
  });
  it('handles invalid', () => {
    assert.equal(formatDuration(-1), '0s');
    assert.equal(formatDuration(NaN), '0s');
  });
});

describe('appliedBadgeClass', () => {
  it('green for create_draft_outline', () => {
    assert.equal(appliedBadgeClass('create_draft_outline'), 'badge badge-high');
  });
  it('blue for archive_round_summary', () => {
    assert.equal(appliedBadgeClass('archive_round_summary'), 'badge badge-mid');
  });
  it('amber for add_paper_to_stage', () => {
    assert.equal(appliedBadgeClass('add_paper_to_stage'), 'badge badge-low');
  });
  it('gray for unknown', () => {
    assert.equal(appliedBadgeClass('something_else'), 'badge badge-none');
  });
});

describe('skippedBadgeClass', () => {
  it('amber for no_op', () => {
    assert.equal(skippedBadgeClass('no_op'), 'badge badge-low');
    assert.equal(skippedBadgeClass('noop_already_done'), 'badge badge-low');
  });
  it('blue for duplicate', () => {
    assert.equal(skippedBadgeClass('duplicate'), 'badge badge-mid');
    assert.equal(skippedBadgeClass('already_exists'), 'badge badge-mid');
  });
  it('gray for other', () => {
    assert.equal(skippedBadgeClass('rate_limit'), 'badge badge-none');
    assert.equal(skippedBadgeClass(''), 'badge badge-none');
    assert.equal(skippedBadgeClass(null), 'badge badge-none');
  });
});

describe('renderNavLabel', () => {
  it('both present', () => {
    const r = renderNavLabel(3, 5);
    assert.deepEqual(r, { prev: '← R3', next: 'R5 →' });
  });
  it('only prev', () => {
    const r = renderNavLabel(3, null);
    assert.equal(r.prev, '← R3');
    assert.equal(r.next, null);
  });
  it('only next', () => {
    const r = renderNavLabel(null, 7);
    assert.equal(r.prev, null);
    assert.equal(r.next, 'R7 →');
  });
  it('neither → null', () => {
    assert.equal(renderNavLabel(null, null), null);
  });
});

describe('end-to-end: round detail polish helpers', () => {
  it('typical round 3 of 5', () => {
    const rec = {
      feedback: { total_tokens: 15000 },
      modifier: { applied: [
        { kind: 'create_draft_outline' },
        { kind: 'archive_round_summary' },
        { kind: 'add_paper_to_stage' },
      ]},
    };
    const tokens = breakdownTokens(rec);
    assert.equal(tokens.total, 15000);
    assert.equal(tokens.designer, 9000);

    const nav = roundNavFor(3, [1, 2, 3, 4, 5]);
    assert.deepEqual(nav, { prev: 2, next: 4 });

    const labels = renderNavLabel(nav.prev, nav.next);
    assert.deepEqual(labels, { prev: '← R2', next: 'R4 →' });
  });
});
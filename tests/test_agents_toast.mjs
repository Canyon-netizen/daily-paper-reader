/**
 * tests/test_agents_toast.mjs — Toast 通知系统纯逻辑守护。
 *
 * iter #25:用户反馈"有些按钮点击没有反馈"。现状:
 *   - 复制/导出/报告 → 静默改 statusText(底部一行小字,容易错过)
 *   - 删除/导入失败 → alert() 弹窗(打断操作)
 *   - 标签保存 → 只在 statusText 显示一行
 *
 * 现在加统一的 Toast 系统:
 *   - 右下角浮层,3 秒自动消失
 *   - 4 个 variant:success / error / warning / info
 *   - 头部带图标 + 关闭按钮
 *   - 同时可叠 N 条,新 toast 在最上面
 *
 * 这里只测 toast() 纯函数 + queue 行为,不碰 DOM。
 *
 * 跑法:node tests/test_agents_toast.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const VALID_VARIANTS = new Set(['success', 'error', 'warning', 'info']);

/**
 * 创建一条 toast message 对象,带唯一 id 和时间戳。
 * - message 必填,trim 后不能为空
 * - variant 可选,默认 'info'
 * - durationMs 默认 3000
 * - id 用计数器生成,保证 unique
 */
function makeToast(message, variant = 'info', durationMs = 3000, counter = { n: 0 }) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('message must be a non-empty string');
  }
  if (!VALID_VARIANTS.has(variant)) {
    throw new Error(`invalid variant: ${variant}`);
  }
  if (typeof durationMs !== 'number' || !isFinite(durationMs) || durationMs < 0) {
    throw new Error('durationMs must be a finite non-negative number');
  }
  counter.n++;
  return {
    id: `t${counter.n}`,
    message: message.trim(),
    variant,
    durationMs,
    createdAt: Date.now(),
  };
}

/**
 * 把新 toast push 到队列;同时返回因新 toast 进来而需要 dismiss 的旧 toast id。
 * 限制:同 variant 同时只显示 MAX_PER_VARIANT 条,超出时移除最旧(同样 variant)
 * 返回: { queue, dismissIds }
 */
const MAX_PER_VARIANT = 5;
function enqueueToast(queue, toast) {
  const sameVariant = queue.filter((t) => t.variant === toast.variant);
  const dismissIds = [];
  if (sameVariant.length >= MAX_PER_VARIANT) {
    // 移除同 variant 最旧的
    const oldest = sameVariant[0];
    dismissIds.push(oldest.id);
  }
  const next = queue.filter((t) => !dismissIds.includes(t.id));
  next.push(toast);
  return { queue: next, dismissIds };
}

/**
 * 移除指定 id 的 toast(用户点 X 或者自动 dismiss)
 */
function dismissToast(queue, id) {
  return queue.filter((t) => t.id !== id);
}

/**
 * 自动 dismiss:返回到了 expire 时间的 toast id 列表
 * queue 里的每条 toast 都有 createdAt + durationMs
 */
function getExpiredToasts(queue, now = Date.now()) {
  return queue.filter((t) => now - t.createdAt >= t.durationMs).map((t) => t.id);
}

describe('makeToast', () => {
  it('creates a toast with sensible defaults', () => {
    const t = makeToast('Hello');
    assert.equal(t.message, 'Hello');
    assert.equal(t.variant, 'info');
    assert.equal(t.durationMs, 3000);
    assert.ok(t.id.startsWith('t'));
  });
  it('trims whitespace from message', () => {
    const t = makeToast('  hi  ');
    assert.equal(t.message, 'hi');
  });
  it('unique id per call', () => {
    const c = { n: 0 };
    const a = makeToast('a', 'info', 1000, c);
    const b = makeToast('b', 'info', 1000, c);
    assert.notEqual(a.id, b.id);
  });
  it('throws on empty message', () => {
    assert.throws(() => makeToast(''), /non-empty/);
    assert.throws(() => makeToast('   '), /non-empty/);
    assert.throws(() => makeToast(null), /non-empty/);
    assert.throws(() => makeToast(42), /non-empty/);
  });
  it('throws on invalid variant', () => {
    assert.throws(() => makeToast('hi', 'critical'), /invalid variant/);
    assert.throws(() => makeToast('hi', ''), /invalid variant/);
  });
  it('accepts all 4 valid variants', () => {
    for (const v of ['success', 'error', 'warning', 'info']) {
      const t = makeToast('x', v);
      assert.equal(t.variant, v);
    }
  });
  it('throws on bad durationMs', () => {
    assert.throws(() => makeToast('hi', 'info', -1), /durationMs/);
    assert.throws(() => makeToast('hi', 'info', NaN), /durationMs/);
    assert.throws(() => makeToast('hi', 'info', Infinity), /durationMs/);
  });
});

describe('enqueueToast', () => {
  const ctr = { n: 0 };
  it('appends to empty queue', () => {
    const t = makeToast('a', 'info', 3000, ctr);
    const { queue, dismissIds } = enqueueToast([], t);
    assert.equal(queue.length, 1);
    assert.equal(dismissIds.length, 0);
    assert.equal(queue[0].id, t.id);
  });
  it('keeps different variants together', () => {
    const { queue } = enqueueToast([], makeToast('a', 'success', 3000, ctr));
    const { queue: q2 } = enqueueToast(queue, makeToast('b', 'error', 3000, ctr));
    const { queue: q3 } = enqueueToast(q2, makeToast('c', 'info', 3000, ctr));
    assert.equal(q3.length, 3);
    assert.deepEqual(q3.map((t) => t.variant), ['success', 'error', 'info']);
  });
  it('evicts oldest same-variant when limit reached', () => {
    const c = { n: 100 };
    let q = [];
    for (let i = 0; i < MAX_PER_VARIANT; i++) {
      q = enqueueToast(q, makeToast(`info-${i}`, 'info', 3000, c)).queue;
    }
    assert.equal(q.length, MAX_PER_VARIANT);
    const oldestId = q[0].id;
    const { queue: q2, dismissIds } = enqueueToast(q, makeToast('info-new', 'info', 3000, c));
    assert.equal(dismissIds.length, 1);
    assert.equal(dismissIds[0], oldestId);  // 最旧的被踢
    assert.equal(q2.length, MAX_PER_VARIANT);
  });
  it('error variant does not evict success', () => {
    const c = { n: 200 };
    let q = [];
    // 填满 success
    for (let i = 0; i < MAX_PER_VARIANT; i++) {
      q = enqueueToast(q, makeToast(`ok-${i}`, 'success', 3000, c)).queue;
    }
    // 加 error 不应该 evict success
    const { queue: q2, dismissIds } = enqueueToast(q, makeToast('oops', 'error', 3000, c));
    assert.equal(dismissIds.length, 0);
    assert.equal(q2.length, MAX_PER_VARIANT + 1);
  });
});

describe('dismissToast', () => {
  it('removes by id', () => {
    const c = { n: 300 };
    const t1 = makeToast('a', 'info', 3000, c);
    const t2 = makeToast('b', 'info', 3000, c);
    const queue = [t1, t2];
    const next = dismissToast(queue, t1.id);
    assert.equal(next.length, 1);
    assert.equal(next[0].id, t2.id);
  });
  it('no-op when id missing', () => {
    const c = { n: 400 };
    const queue = [makeToast('a', 'info', 3000, c)];
    const next = dismissToast(queue, 't999');
    assert.equal(next.length, 1);
  });
});

describe('getExpiredToasts', () => {
  it('returns nothing when none expired', () => {
    const t = makeToast('a', 'info', 3000);
    const expired = getExpiredToasts([t], t.createdAt + 1000);
    assert.equal(expired.length, 0);
  });
  it('returns id when expired', () => {
    const t = makeToast('a', 'info', 1000);
    const expired = getExpiredToasts([t], t.createdAt + 1500);
    assert.deepEqual(expired, [t.id]);
  });
  it('boundary: equal to durationMs counts as expired', () => {
    const t = makeToast('a', 'info', 1000);
    const expired = getExpiredToasts([t], t.createdAt + 1000);
    assert.deepEqual(expired, [t.id]);
  });
  it('mixed queue — only expired ones returned', () => {
    const a = makeToast('a', 'info', 1000);  // expires at a.createdAt + 1000
    const b = makeToast('b', 'info', 5000);  // still alive
    const now = a.createdAt + 2000;
    const expired = getExpiredToasts([a, b], now);
    assert.deepEqual(expired, [a.id]);
  });
});

describe('end-to-end queue lifecycle', () => {
  it('enqueue → time passes → expire → dismiss', () => {
    let queue = [];
    const t1 = makeToast('first', 'info', 1000, { n: 0 });
    const t2 = makeToast('second', 'info', 2000, { n: 1 });
    queue = enqueueToast(queue, t1).queue;
    queue = enqueueToast(queue, t2).queue;
    assert.equal(queue.length, 2);
    // 1.5s 后:t1 过期,t2 还活着
    const now1 = t1.createdAt + 1500;
    const expired1 = getExpiredToasts(queue, now1);
    assert.deepEqual(expired1, [t1.id]);
    queue = dismissToast(queue, t1.id);
    assert.equal(queue.length, 1);
    // 2.5s 后:t2 也过期
    const now2 = t2.createdAt + 2500;
    const expired2 = getExpiredToasts(queue, now2);
    assert.deepEqual(expired2, [t2.id]);
    queue = dismissToast(queue, t2.id);
    assert.equal(queue.length, 0);
  });
});

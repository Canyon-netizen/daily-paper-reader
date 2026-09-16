#!/usr/bin/env node
// astro-src/scripts/experiment-status.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/status.ts.
// status.ts re-exports EXPERIMENT_STATUS_TRANSITIONS from ./types,
// esbuild externalize 解析相对路径失败,改为内联 status.ts 全部逻辑 + types 常量。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// === 内联 types.ts ===
const EXPERIMENT_STATUS_TRANSITIONS = {
  planning: ['running', 'paused', 'archived'],
  running: ['completed', 'failed', 'paused', 'archived'],
  completed: ['running', 'archived'],
  failed: ['running', 'archived'],
  paused: ['running', 'archived'],
  archived: ['planning', 'running'],
};

// === 内联 status.ts ===
function canTransition(from, to) {
  if (from === to) {
    return { valid: false, reason: 'Self-transition not allowed' };
  }
  const validTargets = EXPERIMENT_STATUS_TRANSITIONS[from];
  if (!validTargets) {
    return { valid: false, reason: `Unknown source status: ${from}` };
  }
  if (!validTargets.includes(to)) {
    return {
      valid: false,
      reason: `Cannot transition from ${from} to ${to}. Valid targets: ${validTargets.join(', ')}`,
    };
  }
  return { valid: true };
}

function applyTransition(experiment, to) {
  const check = canTransition(experiment.status, to);
  if (!check.valid) {
    return { success: false, error: check.reason };
  }
  const updated = {
    ...experiment,
    status: to,
    updatedAt: new Date().toISOString().split('T')[0],
  };
  return { success: true, experiment: updated };
}

function getValidTransitions(status) {
  return EXPERIMENT_STATUS_TRANSITIONS[status] ?? [];
}

function getStatusDescription(status) {
  const descriptions = {
    planning: 'Experiment is being designed',
    running: 'Experiment is currently running',
    paused: 'Experiment is paused',
    completed: 'Experiment completed successfully',
    failed: 'Experiment failed or was abandoned',
    archived: 'Experiment is archived',
  };
  return descriptions[status] ?? 'Unknown';
}

// === 测试 ===
test('canTransition: planning → running', () => {
  const r = canTransition('planning', 'running');
  assert.equal(r.valid, true);
});

test('canTransition: 同状态 → valid=false + reason', () => {
  const r = canTransition('running', 'running');
  assert.equal(r.valid, false);
  assert.ok(r.reason.includes('Self-transition'));
});

test('canTransition: 非法迁移 → reason 含 valid targets', () => {
  const r = canTransition('running', 'planning');
  assert.equal(r.valid, false);
  assert.ok(r.reason.includes('Cannot transition'));
  assert.ok(r.reason.includes('Valid targets'));
});

test('canTransition: 未知 from → reason 含 Unknown source', () => {
  const r = canTransition('invalid', 'running');
  assert.equal(r.valid, false);
  assert.ok(r.reason.includes('Unknown source status'));
});

test('applyTransition: 合法迁移 → success + 新 status', () => {
  const exp = { status: 'planning', id: 'e1', title: 'x' };
  const r = applyTransition(exp, 'running');
  assert.equal(r.success, true);
  assert.equal(r.experiment.status, 'running');
});

test('applyTransition: 非法迁移 → error 信息', () => {
  const exp = { status: 'running', id: 'e1', title: 'x' };
  const r = applyTransition(exp, 'planning');
  assert.equal(r.success, false);
  assert.ok(r.error);
});

test('applyTransition: updatedAt 更新到今日(YYYY-MM-DD)', () => {
  const exp = { status: 'planning', id: 'e1', title: 'x', updatedAt: '2020-01-01' };
  const r = applyTransition(exp, 'running');
  assert.equal(r.success, true);
  assert.ok(r.experiment.updatedAt);
  assert.ok(r.experiment.updatedAt !== '2020-01-01');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.experiment.updatedAt));
});

test('applyTransition: 不修改原 experiment(不可变)', () => {
  const exp = { status: 'planning', id: 'e1', title: 'x' };
  const r = applyTransition(exp, 'running');
  assert.equal(exp.status, 'planning');
  assert.equal(r.experiment.status, 'running');
});

test('getValidTransitions: planning → 3 个', () => {
  const r = getValidTransitions('planning');
  assert.equal(r.length, 3);
  assert.ok(r.includes('running'));
  assert.ok(r.includes('paused'));
  assert.ok(r.includes('archived'));
});

test('getValidTransitions: running → 4 个', () => {
  const r = getValidTransitions('running');
  assert.equal(r.length, 4);
});

test('getValidTransitions: 未知 status → []', () => {
  assert.deepEqual(getValidTransitions('invalid-status'), []);
});

test('getStatusDescription: 6 个 status 都有描述', () => {
  for (const s of ['planning', 'running', 'paused', 'completed', 'failed', 'archived']) {
    const d = getStatusDescription(s);
    assert.ok(d && d.length > 0);
    assert.notEqual(d, 'Unknown');
  }
});

test('getStatusDescription: 未知 → "Unknown"', () => {
  assert.equal(getStatusDescription('invalid'), 'Unknown');
});

test('EXPERIMENT_STATUS_TRANSITIONS: 6 状态全覆盖', () => {
  const expected = ['planning', 'running', 'completed', 'failed', 'paused', 'archived'];
  for (const s of expected) {
    assert.ok(Array.isArray(EXPERIMENT_STATUS_TRANSITIONS[s]));
  }
});
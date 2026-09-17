#!/usr/bin/env node
// astro-src/scripts/experiments-status.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/status.ts.
// EXPERIMENT_STATUS_TRANSITIONS (re-export) + canTransition + applyTransition +
// getValidTransitions + getStatusDescription。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/experiments/status.ts');
const {
  EXPERIMENT_STATUS_TRANSITIONS,
  canTransition,
  applyTransition,
  getValidTransitions,
  getStatusDescription,
} = mod;

// ---------- EXPERIMENT_STATUS_TRANSITIONS ----------
test('EXPERIMENT_STATUS_TRANSITIONS: 6 statuses', () => {
  assert.equal(Object.keys(EXPERIMENT_STATUS_TRANSITIONS).length, 6);
});

test('EXPERIMENT_STATUS_TRANSITIONS: planning → 3 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.planning.length, 3);
});

test('EXPERIMENT_STATUS_TRANSITIONS: running → 4 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.running.length, 4);
});

test('EXPERIMENT_STATUS_TRANSITIONS: completed → 2 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.completed.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: failed → 2 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.failed.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: paused → 2 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.paused.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: archived → 2 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.archived.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: planning 不含 completed', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.planning.includes('completed'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: completed 不含 failed', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.completed.includes('failed'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: running 不含 planning', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.running.includes('planning'));
});

// ---------- canTransition ----------
test('canTransition: planning → running → valid', () => {
  const r = canTransition('planning', 'running');
  assert.equal(r.valid, true);
});

test('canTransition: running → completed → valid', () => {
  assert.equal(canTransition('running', 'completed').valid, true);
});

test('canTransition: archived → planning → valid (复活)', () => {
  assert.equal(canTransition('archived', 'planning').valid, true);
});

test('canTransition: planning → completed → invalid', () => {
  const r = canTransition('planning', 'completed');
  assert.equal(r.valid, false);
  assert.match(r.reason, /Cannot transition/);
});

test('canTransition: completed → failed → invalid', () => {
  const r = canTransition('completed', 'failed');
  assert.equal(r.valid, false);
});

test('canTransition: self-transition → invalid', () => {
  for (const s of ['planning', 'running', 'completed', 'failed', 'paused', 'archived']) {
    const r = canTransition(s, s);
    assert.equal(r.valid, false);
    assert.match(r.reason, /Self-transition/);
  }
});

test('canTransition: 未知 from → invalid', () => {
  const r = canTransition('weird-state', 'running');
  assert.equal(r.valid, false);
  assert.match(r.reason, /Unknown source/);
});

test('canTransition: reason 含 from / to', () => {
  const r = canTransition('running', 'planning');
  assert.match(r.reason, /running/);
  assert.match(r.reason, /planning/);
});

// ---------- applyTransition ----------
test('applyTransition: 合法 → 改 status', () => {
  const exp = { id: 'e1', status: 'planning', updatedAt: '2026-01-01' };
  const r = applyTransition(exp, 'running');
  assert.equal(r.success, true);
  assert.equal(r.experiment.status, 'running');
});

test('applyTransition: 合法 → updatedAt 是日期', () => {
  const exp = { id: 'e1', status: 'planning', updatedAt: '2026-01-01' };
  const r = applyTransition(exp, 'running');
  assert.match(r.experiment.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test('applyTransition: 不修改原 experiment', () => {
  const exp = { id: 'e1', status: 'planning', updatedAt: '2026-01-01' };
  applyTransition(exp, 'running');
  assert.equal(exp.status, 'planning');
  assert.equal(exp.updatedAt, '2026-01-01');
});

test('applyTransition: 非法 → success false', () => {
  const exp = { id: 'e1', status: 'planning', updatedAt: '2026-01-01' };
  const r = applyTransition(exp, 'completed');
  assert.equal(r.success, false);
  assert.match(r.error, /Cannot transition/);
});

test('applyTransition: 保留其它字段', () => {
  const exp = { id: 'e1', status: 'planning', updatedAt: '2026-01-01', title: 'exp A' };
  const r = applyTransition(exp, 'running');
  assert.equal(r.experiment.id, 'e1');
  assert.equal(r.experiment.title, 'exp A');
});

test('applyTransition: self-transition → fail', () => {
  const exp = { id: 'e1', status: 'running', updatedAt: '2026-01-01' };
  const r = applyTransition(exp, 'running');
  assert.equal(r.success, false);
});

// ---------- getValidTransitions ----------
test('getValidTransitions: planning → 3 items', () => {
  const r = getValidTransitions('planning');
  assert.equal(r.length, 3);
});

test('getValidTransitions: running 含 completed', () => {
  assert.ok(getValidTransitions('running').includes('completed'));
});

test('getValidTransitions: 未知状态 → 空数组', () => {
  assert.deepEqual(getValidTransitions('weird-state'), []);
});

test('getValidTransitions: 返回原数组拷贝?同引用?', () => {
  const r1 = getValidTransitions('planning');
  const r2 = getValidTransitions('planning');
  assert.deepEqual(r1, r2);
  // r1 和 r2 内容相同;可能不是同引用,但内容一致
});

test('getValidTransitions: archived 含 planning', () => {
  assert.ok(getValidTransitions('archived').includes('planning'));
});

// ---------- getStatusDescription ----------
test('getStatusDescription: planning → 设计中', () => {
  // 原文 'Experiment is being designed' — 用 'designed' (past participle) 匹配
  assert.match(getStatusDescription('planning'), /designed/);
});

test('getStatusDescription: running → running', () => {
  assert.match(getStatusDescription('running'), /running/);
});

test('getStatusDescription: paused → paused', () => {
  assert.match(getStatusDescription('paused'), /paused/);
});

test('getStatusDescription: completed → completed', () => {
  assert.match(getStatusDescription('completed'), /completed successfully/);
});

test('getStatusDescription: failed → failed', () => {
  assert.match(getStatusDescription('failed'), /failed/);
});

test('getStatusDescription: archived → archived', () => {
  assert.match(getStatusDescription('archived'), /archived/);
});

test('getStatusDescription: 未知 → Unknown', () => {
  assert.equal(getStatusDescription('weird-state'), 'Unknown');
});

test('getStatusDescription: 6 个 status 都有 description', () => {
  const all = ['planning', 'running', 'paused', 'completed', 'failed', 'archived'];
  for (const s of all) {
    const d = getStatusDescription(s);
    assert.ok(typeof d === 'string' && d.length > 0);
    assert.notEqual(d, 'Unknown');
  }
});

// ---------- 转换图闭环 ---
test('experiments 状态转换图: running → paused → running 可走', () => {
  assert.equal(canTransition('running', 'paused').valid, true);
  assert.equal(canTransition('paused', 'running').valid, true);
});

test('experiments 状态转换图: failed → running 可走 (重做)', () => {
  assert.equal(canTransition('failed', 'running').valid, true);
});

test('experiments 状态转换图: archived → running 可走 (复活)', () => {
  assert.equal(canTransition('archived', 'running').valid, true);
});

test('experiments 状态转换图: completed → archived 可走', () => {
  assert.equal(canTransition('completed', 'archived').valid, true);
});
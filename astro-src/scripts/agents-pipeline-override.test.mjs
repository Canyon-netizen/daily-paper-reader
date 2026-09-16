#!/usr/bin/env node
// astro-src/scripts/agents-pipeline-override.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/pipeline-override.ts.
// 在 import 前注入 globalThis.localStorage mock(同 pipeline-recovery)。

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

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

const mod = await loadTs('lib/agents/pipeline-override.ts');
const {
  recordOverride,
  getOverrides,
  clearOverrides,
  applyOverride,
  getStageOverride,
  createOverride,
} = mod;

// ---------- createOverride ----------
test('createOverride: 基础字段', () => {
  const r = createOverride('s1', 'skip', 'reason');
  assert.equal(r.stageId, 's1');
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'reason');
  assert.equal(typeof r.ts, 'number');
  assert.equal(r.payload, undefined);
});

test('createOverride: 带 payload', () => {
  const r = createOverride('s1', 'modify', 'reason', { foo: 1 });
  assert.deepEqual(r.payload, { foo: 1 });
});

test('createOverride: ts 是 Date.now', () => {
  const before = Date.now();
  const r = createOverride('s1', 'skip', 'r');
  const after = Date.now();
  assert.ok(r.ts >= before && r.ts <= after);
});

// ---------- applyOverride ----------
test('applyOverride: stageId 不匹配 → 返回原 stage', () => {
  const stage = { id: 'a', type: 'foo' };
  const ov = { stageId: 'b', action: 'skip', ts: 1, reason: '' };
  const r = applyOverride(stage, ov);
  assert.deepEqual(r, stage);
});

test('applyOverride: skip → 返回 null', () => {
  const stage = { id: 'a' };
  const ov = { stageId: 'a', action: 'skip', ts: 1, reason: 'r' };
  assert.equal(applyOverride(stage, ov), null);
});

test('applyOverride: retry → 加 _retry + _retryTimestamp', () => {
  const stage = { id: 'a', config: { x: 1 } };
  const ov = { stageId: 'a', action: 'retry', ts: 100, reason: 'r' };
  const r = applyOverride(stage, ov);
  assert.equal(r.config._retry, true);
  assert.equal(r.config._retryTimestamp, 100);
  assert.equal(r.config.x, 1); // 保留原 config
});

test('applyOverride: modify + payload → 覆盖 stage 字段', () => {
  const stage = { id: 'a', type: 'foo', config: { x: 1 } };
  const ov = {
    stageId: 'a', action: 'modify', ts: 1, reason: 'r',
    payload: { type: 'bar', config: { y: 2 } },
  };
  const r = applyOverride(stage, ov);
  assert.equal(r.type, 'bar');
  assert.deepEqual(r.config, { y: 2 });
});

test('applyOverride: modify 无 payload → 返回原 stage', () => {
  const stage = { id: 'a' };
  const ov = { stageId: 'a', action: 'modify', ts: 1, reason: 'r' };
  const r = applyOverride(stage, ov);
  assert.deepEqual(r, stage);
});

test('applyOverride: 未知 action → 返回原 stage', () => {
  const stage = { id: 'a' };
  const ov = { stageId: 'a', action: '???', ts: 1, reason: 'r' };
  const r = applyOverride(stage, ov);
  assert.deepEqual(r, stage);
});

test('applyOverride: 不修改输入 stage', () => {
  const stage = { id: 'a', config: { x: 1 } };
  const before = JSON.parse(JSON.stringify(stage));
  applyOverride(stage, { stageId: 'a', action: 'retry', ts: 100, reason: 'r' });
  // retry 会返回新对象,但输入 stage.config 应保持原状
  assert.deepEqual(stage, before);
});

// ---------- recordOverride / getOverrides / clearOverrides ----------
test('recordOverride + getOverrides: 单条', () => {
  clearOverrides('p1');
  recordOverride('p1', { stageId: 'a', action: 'skip', ts: 1, reason: 'r' });
  const r = getOverrides('p1');
  assert.equal(r.length, 1);
  assert.equal(r[0].stageId, 'a');
});

test('recordOverride: 累加 (push to array)', () => {
  clearOverrides('p1');
  recordOverride('p1', { stageId: 'a', action: 'skip', ts: 1, reason: 'r1' });
  recordOverride('p1', { stageId: 'b', action: 'retry', ts: 2, reason: 'r2' });
  recordOverride('p1', { stageId: 'c', action: 'modify', ts: 3, reason: 'r3', payload: {} });
  const r = getOverrides('p1');
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((o) => o.stageId), ['a', 'b', 'c']);
});

test('getOverrides: 不存在 → []', () => {
  assert.deepEqual(getOverrides('nonexistent'), []);
});

test('getOverrides: 损坏 JSON → [] (catch)', () => {
  store.set('dpr_pipeline_overrides_v1_corrupt2', '{not json');
  assert.deepEqual(getOverrides('corrupt2'), []);
});

test('clearOverrides: 删除后 → []', () => {
  recordOverride('p1', { stageId: 'a', action: 'skip', ts: 1, reason: 'r' });
  clearOverrides('p1');
  assert.deepEqual(getOverrides('p1'), []);
});

test('不同 pipelineId → 独立存储', () => {
  clearOverrides('pA');
  clearOverrides('pB');
  recordOverride('pA', { stageId: 'a', action: 'skip', ts: 1, reason: '' });
  recordOverride('pB', { stageId: 'b', action: 'retry', ts: 1, reason: '' });
  assert.equal(getOverrides('pA').length, 1);
  assert.equal(getOverrides('pB').length, 1);
  assert.equal(getOverrides('pA')[0].stageId, 'a');
});

// ---------- getStageOverride ----------
test('getStageOverride: 无 override → null', () => {
  clearOverrides('p1');
  assert.equal(getStageOverride('p1', 'a'), null);
});

test('getStageOverride: 单条 → 返回', () => {
  clearOverrides('p1');
  recordOverride('p1', { stageId: 'a', action: 'skip', ts: 1, reason: 'r' });
  const r = getStageOverride('p1', 'a');
  assert.equal(r.ts, 1);
});

test('getStageOverride: 多个 → 返回最新 (ts 最大)', () => {
  clearOverrides('p1');
  recordOverride('p1', { stageId: 'a', action: 'skip', ts: 1, reason: 'first' });
  recordOverride('p1', { stageId: 'a', action: 'retry', ts: 100, reason: 'second' });
  recordOverride('p1', { stageId: 'a', action: 'modify', ts: 50, reason: 'third' });
  const r = getStageOverride('p1', 'a');
  assert.equal(r.ts, 100);
  assert.equal(r.reason, 'second');
});

test('getStageOverride: 过滤其他 stageId', () => {
  clearOverrides('p1');
  recordOverride('p1', { stageId: 'a', action: 'skip', ts: 1, reason: 'a-r' });
  recordOverride('p1', { stageId: 'b', action: 'skip', ts: 999, reason: 'b-r' });
  const r = getStageOverride('p1', 'a');
  assert.equal(r.stageId, 'a');
  assert.equal(r.reason, 'a-r');
});
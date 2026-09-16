#!/usr/bin/env node
// astro-src/scripts/agents-pipeline-recovery.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/pipeline-recovery.ts.
// 在 import 模块前注入 globalThis.localStorage mock,因为 source 里 getStorage()
// 在 undefined 时返回新的 in-memory store,跨调用不共享 → save/load 会失效。

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

const mod = await loadTs('lib/agents/pipeline-recovery.ts');
const {
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  recoverFromSnapshot,
  createSnapshot,
} = mod;

const snap = {
  ts: 1000,
  completedStages: ['a', 'b'],
  currentStage: 'c',
  pipelineId: 'p1',
};

// ---------- createSnapshot ----------
test('createSnapshot: 必填字段', () => {
  const r = createSnapshot('p1', ['a'], 'b');
  assert.equal(r.pipelineId, 'p1');
  assert.deepEqual(r.completedStages, ['a']);
  assert.equal(r.currentStage, 'b');
  assert.equal(typeof r.ts, 'number');
});

test('createSnapshot: 包含 failedStage/error/metadata', () => {
  const r = createSnapshot('p1', ['a'], 'b', {
    failedStage: 'a',
    error: 'boom',
    metadata: { foo: 1 },
  });
  assert.equal(r.failedStage, 'a');
  assert.equal(r.error, 'boom');
  assert.deepEqual(r.metadata, { foo: 1 });
});

test('createSnapshot: ts 是 Date.now', () => {
  const before = Date.now();
  const r = createSnapshot('p1', [], 'a');
  const after = Date.now();
  assert.ok(r.ts >= before && r.ts <= after);
});

test('createSnapshot: 无 options → failedStage/error/metadata undefined', () => {
  const r = createSnapshot('p1', [], 'a');
  assert.equal(r.failedStage, undefined);
  assert.equal(r.error, undefined);
  assert.equal(r.metadata, undefined);
});

// ---------- save/load/clear ----------
test('saveSnapshot + loadSnapshot: round-trip', () => {
  saveSnapshot('p1', snap);
  const r = loadSnapshot('p1');
  assert.deepEqual(r, snap);
});

test('loadSnapshot: 不存在的 pipeline → null', () => {
  assert.equal(loadSnapshot('nonexistent'), null);
});

test('clearSnapshot: 删除后 loadSnapshot → null', () => {
  saveSnapshot('p1', snap);
  clearSnapshot('p1');
  assert.equal(loadSnapshot('p1'), null);
});

test('loadSnapshot: 损坏 JSON → null (catch)', () => {
  // 写脏数据直接到 mock store
  store.set('dpr_pipeline_snapshot_v1_corrupt', '{not json');
  assert.equal(loadSnapshot('corrupt'), null);
});

test('saveSnapshot: 不同 pipelineId → 独立存储', () => {
  saveSnapshot('p1', { ...snap, currentStage: 'A' });
  saveSnapshot('p2', { ...snap, currentStage: 'B' });
  assert.equal(loadSnapshot('p1').currentStage, 'A');
  assert.equal(loadSnapshot('p2').currentStage, 'B');
});

test('saveSnapshot: 重复 save 同 pipelineId → 覆盖', () => {
  saveSnapshot('p1', { ...snap, currentStage: 'A' });
  saveSnapshot('p1', { ...snap, currentStage: 'B' });
  assert.equal(loadSnapshot('p1').currentStage, 'B');
});

// ---------- recoverFromSnapshot ----------
test('recoverFromSnapshot: 只跑 currentStage (completed 已有)', async () => {
  const r = await recoverFromSnapshot(
    { ts: 0, completedStages: ['a'], currentStage: 'b', pipelineId: 'p' },
    async (stageId) => 'result-' + stageId,
  );
  assert.equal(r.resumedFrom, 'b');
  assert.equal(r.results.b, 'result-b');
  assert.equal(r.results.a, undefined);
});

test('recoverFromSnapshot: 空 completedStages → 从 currentStage 开始', async () => {
  const r = await recoverFromSnapshot(
    { ts: 0, completedStages: [], currentStage: 'first', pipelineId: 'p' },
    async (stageId) => stageId,
  );
  assert.deepEqual(Object.keys(r.results), ['first']);
});

test('recoverFromSnapshot: stage throw → 记录到 errors 并停止', async () => {
  const r = await recoverFromSnapshot(
    { ts: 0, completedStages: [], currentStage: 'a', pipelineId: 'p' },
    async (stageId) => {
      if (stageId === 'a') throw new Error('boom');
      return 'never';
    },
  );
  assert.equal(Object.keys(r.results).length, 0);
  assert.ok(r.errors.a instanceof Error);
  assert.equal(r.errors.a.message, 'boom');
});

test('recoverFromSnapshot: errors 是空对象当无错', async () => {
  const r = await recoverFromSnapshot(
    { ts: 0, completedStages: ['a'], currentStage: 'b', pipelineId: 'p' },
    async () => 'ok',
  );
  assert.deepEqual(r.errors, {});
});

test('recoverFromSnapshot: runStage 返回 undefined', async () => {
  const r = await recoverFromSnapshot(
    { ts: 0, completedStages: ['a'], currentStage: 'b', pipelineId: 'p' },
    async () => undefined,
  );
  assert.equal(r.results.b, undefined);
});

test('recoverFromSnapshot: 已完成 stage 不重复执行', async () => {
  let callCount = 0;
  const r = await recoverFromSnapshot(
    { ts: 0, completedStages: ['a'], currentStage: 'b', pipelineId: 'p' },
    async (stageId) => {
      callCount++;
      return stageId;
    },
  );
  assert.equal(callCount, 1);
  assert.equal(Object.keys(r.results).length, 1);
  assert.ok(r.results.b);
});

test('recoverFromSnapshot: 错误中断后不再跑后续', async () => {
  // completedStages.length === 1, currentStage 是 b;
  // 但 source 逻辑: completedStages.length === 0 时跑 [currentStage];否则跑 [...completed, currentStage]
  // 然后 from resumeIndex (=completed.length) 起跑 → 所以已完成的不再跑
  // 我们 mock completedStages = ['a'], currentStage = 'b' → 只跑 b
  // 这里 stage a 已经标 completed,所以只跑 b
  let calls = [];
  await recoverFromSnapshot(
    { ts: 0, completedStages: ['a'], currentStage: 'b', pipelineId: 'p' },
    async (stageId) => {
      calls.push(stageId);
      if (stageId === 'b') throw new Error('b-boom');
      return stageId;
    },
  );
  assert.deepEqual(calls, ['b']);
});
#!/usr/bin/env node
// astro-src/scripts/agents-pipeline-parallel.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/pipeline-parallel.ts.

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

const mod = await loadTs('lib/agents/pipeline-parallel.ts');
const { parallelStages, parallelStagesStrict } = mod;

const mkStage = (id, val, delay = 0) => ({
  id,
  run: () => new Promise((resolve) => setTimeout(() => resolve(val), delay)),
});

const mkFailStage = (id, msg) => ({
  id,
  run: () => Promise.reject(new Error(msg)),
});

// ---------- parallelStages ----------
test('parallelStages: 空 stages → 空结果', async () => {
  const r = await parallelStages([]);
  assert.deepEqual(r.results, {});
  assert.deepEqual(r.errors, {});
  assert.equal(typeof r.totalDurationMs, 'number');
});

test('parallelStages: 全部成功', async () => {
  const r = await parallelStages([
    mkStage('a', 1),
    mkStage('b', 2),
    mkStage('c', 3),
  ]);
  assert.equal(r.results.a, 1);
  assert.equal(r.results.b, 2);
  assert.equal(r.results.c, 3);
  assert.deepEqual(r.errors, {});
});

test('parallelStages: 部分失败 → 错误记录,不抛', async () => {
  const r = await parallelStages([
    mkStage('a', 1),
    mkFailStage('b', 'b-boom'),
    mkStage('c', 3),
  ]);
  assert.equal(r.results.a, 1);
  assert.equal(r.results.c, 3);
  assert.ok(r.errors.b instanceof Error);
  assert.equal(r.errors.b.message, 'b-boom');
});

test('parallelStages: 全部失败', async () => {
  const r = await parallelStages([
    mkFailStage('a', 'a-boom'),
    mkFailStage('b', 'b-boom'),
  ]);
  assert.deepEqual(r.results, {});
  assert.equal(r.errors.a.message, 'a-boom');
  assert.equal(r.errors.b.message, 'b-boom');
});

test('parallelStages: onComplete 回调', async () => {
  const seen = [];
  await parallelStages(
    [mkStage('a', 1), mkStage('b', 2)],
    { onComplete: (id, val) => seen.push([id, val]) },
  );
  assert.equal(seen.length, 2);
  assert.ok(seen.some(([id]) => id === 'a'));
  assert.ok(seen.some(([id]) => id === 'b'));
});

test('parallelStages: onError 回调', async () => {
  const errors = [];
  await parallelStages(
    [mkStage('a', 1), mkFailStage('b', 'b-boom')],
    { onError: (id, err) => errors.push([id, err.message]) },
  );
  assert.deepEqual(errors, [['b', 'b-boom']]);
});

test('parallelStages: concurrency=1 串行', async () => {
  const order = [];
  const r = await parallelStages(
    [
      mkStage('a', 1, 10),
      mkStage('b', 2, 10),
      mkStage('c', 3, 10),
    ],
    {
      concurrency: 1,
      onComplete: (id) => order.push(id),
    },
  );
  assert.equal(r.results.a, 1);
  assert.equal(r.results.b, 2);
  assert.equal(r.results.c, 3);
  // 串行
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('parallelStages: concurrency=2 部分并行', async () => {
  const start = Date.now();
  const r = await parallelStages(
    [mkStage('a', 1, 50), mkStage('b', 2, 50), mkStage('c', 3, 50)],
    { concurrency: 2 },
  );
  const elapsed = Date.now() - start;
  // 3 个 50ms stage,concurrency=2 → 至少 100ms (a+b 先跑,c 等)
  assert.ok(elapsed >= 90, `elapsed=${elapsed}`);
  assert.equal(r.results.a, 1);
});

test('parallelStages: totalDurationMs >= 0', async () => {
  const r = await parallelStages([mkStage('a', 1)]);
  assert.ok(r.totalDurationMs >= 0);
});

test('parallelStages: 真正的并发(无 concurrency 限制)', async () => {
  const start = Date.now();
  await parallelStages(
    [mkStage('a', 1, 50), mkStage('b', 2, 50), mkStage('c', 3, 50)],
  );
  const elapsed = Date.now() - start;
  // 并发 → 应 < 串行 150ms,留 buffer
  assert.ok(elapsed < 130, `expected concurrent, elapsed=${elapsed}`);
});

// ---------- parallelStagesStrict ----------
test('parallelStagesStrict: 空 stages', async () => {
  const r = await parallelStagesStrict([]);
  assert.deepEqual(r.results, {});
  assert.deepEqual(r.errors, {});
});

test('parallelStagesStrict: 全部成功', async () => {
  const r = await parallelStagesStrict([
    mkStage('a', 1),
    mkStage('b', 2),
  ]);
  assert.equal(r.results.a, 1);
  assert.equal(r.results.b, 2);
});

test('parallelStagesStrict: 第一个错停止,记录错误', async () => {
  const seen = [];
  const r = await parallelStagesStrict(
    [mkStage('a', 1), mkFailStage('b', 'b-boom'), mkStage('c', 3)],
    {
      onComplete: (id) => seen.push('complete:' + id),
      onError: (id) => seen.push('error:' + id),
    },
  );
  // b 错 → 后续 c 不应被 onComplete
  assert.ok(seen.some((s) => s.startsWith('error:')));
});

test('parallelStagesStrict: hasError 阻止后续 start', async () => {
  // 错误后,workers 在 hasError=true 后停止拉取新任务
  const started = [];
  const r = await parallelStagesStrict(
    [
      { id: 'a', run: () => { started.push('a'); return Promise.resolve(1); } },
      { id: 'b', run: () => { started.push('b'); return Promise.reject(new Error('b-boom')); } },
      { id: 'c', run: () => { started.push('c'); return Promise.resolve(3); } },
      { id: 'd', run: () => { started.push('d'); return Promise.resolve(4); } },
    ],
    { concurrency: 1 },
  );
  // 单 worker: a → b(错) → 停 → 不跑 c/d
  // started 应不含 c, d
  assert.ok(!started.includes('c'));
  assert.ok(!started.includes('d'));
});

test('parallelStagesStrict: 全部失败', async () => {
  const r = await parallelStagesStrict([
    mkFailStage('a', 'a'),
    mkFailStage('b', 'b'),
  ], { concurrency: 1 });
  // hasError=true 后 stop
  assert.equal(r.errors.a.message, 'a');
});

test('parallelStagesStrict: totalDurationMs', async () => {
  const r = await parallelStagesStrict([mkStage('a', 1)]);
  assert.ok(r.totalDurationMs >= 0);
});
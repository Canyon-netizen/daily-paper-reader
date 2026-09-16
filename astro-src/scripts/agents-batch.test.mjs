#!/usr/bin/env node
// astro-src/scripts/agents-batch.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/batch.ts.

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

const mod = await loadTs('lib/agents/batch.ts');
const { batchPrompts, calculateOptimalBatchSize } = mod;

test('batchPrompts: 空数组 → 0 batches', () => {
  const r = batchPrompts([]);
  assert.deepEqual(r.batches, []);
  assert.equal(r.metadata.total, 0);
  assert.equal(r.metadata.batchCount, 0);
});

test('batchPrompts: 默认 batchSize=10', () => {
  const prompts = Array.from({ length: 25 }, (_, i) => 'p' + i);
  const r = batchPrompts(prompts);
  // 25/10 = 3 batches(10, 10, 5)
  assert.equal(r.batches.length, 3);
  assert.equal(r.batches[0].length, 10);
  assert.equal(r.batches[1].length, 10);
  assert.equal(r.batches[2].length, 5);
  assert.equal(r.metadata.batchSize, 10);
  assert.equal(r.metadata.total, 25);
});

test('batchPrompts: 自定义 batchSize', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e'], { batchSize: 2 });
  // 5/2 = 3 batches(2,2,1)
  assert.equal(r.batches.length, 3);
  assert.deepEqual(r.batches[0], ['a', 'b']);
  assert.deepEqual(r.batches[1], ['c', 'd']);
  assert.deepEqual(r.batches[2], ['e']);
});

test('batchPrompts: 整除边界', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd'], { batchSize: 2 });
  assert.equal(r.batches.length, 2);
  assert.deepEqual(r.batches[0], ['a', 'b']);
  assert.deepEqual(r.batches[1], ['c', 'd']);
});

test('batchPrompts: 单元素 batchSize', () => {
  const r = batchPrompts(['a', 'b', 'c'], { batchSize: 1 });
  assert.equal(r.batches.length, 3);
  assert.deepEqual(r.batches[0], ['a']);
});

test('batchPrompts: 顺序保持', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd'], { batchSize: 2 });
  assert.deepEqual(r.batches.flat(), ['a', 'b', 'c', 'd']);
});

test('calculateOptimalBatchSize: total=0 → 10', () => {
  assert.equal(calculateOptimalBatchSize(0), 10);
});

test('calculateOptimalBatchSize: total < 0 → 10', () => {
  assert.equal(calculateOptimalBatchSize(-5), 10);
});

test('calculateOptimalBatchSize: 默认 maxConcurrent=5', () => {
  // total=100 → ceil(100/5) = 20
  assert.equal(calculateOptimalBatchSize(100), 20);
});

test('calculateOptimalBatchSize: 自定义 maxConcurrent', () => {
  // total=20, maxConcurrent=4 → ceil(20/4) = 5
  assert.equal(calculateOptimalBatchSize(20, 4), 5);
});

test('calculateOptimalBatchSize: 不整除时向上取整', () => {
  // total=21, maxConcurrent=5 → ceil(21/5) = 5
  assert.equal(calculateOptimalBatchSize(21, 5), 5);
});

test('calculateOptimalBatchSize: total=1', () => {
  // ceil(1/5) = 1
  assert.equal(calculateOptimalBatchSize(1), 1);
});
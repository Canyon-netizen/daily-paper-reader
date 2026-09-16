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

// ---------- batchPrompts ----------
test('batchPrompts: 空数组 → 0 batch', () => {
  const r = batchPrompts([]);
  assert.deepEqual(r.batches, []);
  assert.equal(r.metadata.total, 0);
  assert.equal(r.metadata.batchCount, 0);
});

test('batchPrompts: 默认 batchSize=10', () => {
  const r = batchPrompts(['a', 'b']);
  assert.equal(r.metadata.batchSize, 10);
});

test('batchPrompts: < batchSize → 1 batch', () => {
  const r = batchPrompts(['a', 'b', 'c']);
  assert.equal(r.batches.length, 1);
  assert.deepEqual(r.batches[0], ['a', 'b', 'c']);
  assert.equal(r.metadata.batchCount, 1);
});

test('batchPrompts: 精确整除', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e', 'f'], { batchSize: 2 });
  assert.equal(r.batches.length, 3);
  assert.deepEqual(r.batches, [['a', 'b'], ['c', 'd'], ['e', 'f']]);
});

test('batchPrompts: 余数 batch', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e'], { batchSize: 2 });
  assert.equal(r.batches.length, 3);
  assert.deepEqual(r.batches[2], ['e']);
});

test('batchPrompts: batchSize=1 → 每个 prompt 单独 batch', () => {
  const r = batchPrompts(['a', 'b'], { batchSize: 1 });
  assert.equal(r.batches.length, 2);
  assert.deepEqual(r.batches[0], ['a']);
});

test('batchPrompts: metadata 字段', () => {
  const r = batchPrompts(['a', 'b', 'c'], { batchSize: 2 });
  assert.equal(r.metadata.total, 3);
  assert.equal(r.metadata.batchCount, 2);
  assert.equal(r.metadata.batchSize, 2);
});

test('batchPrompts: batchSize=100 → 1 batch', () => {
  const r = batchPrompts(['a', 'b', 'c'], { batchSize: 100 });
  assert.equal(r.batches.length, 1);
});

test('batchPrompts: 不修改输入数组', () => {
  const orig = ['a', 'b', 'c'];
  batchPrompts(orig, { batchSize: 2 });
  assert.deepEqual(orig, ['a', 'b', 'c']);
});

// ---------- calculateOptimalBatchSize ----------
test('calculateOptimalBatchSize: total=0 → 10', () => {
  assert.equal(calculateOptimalBatchSize(0), 10);
});

test('calculateOptimalBatchSize: total 负数 → 10', () => {
  assert.equal(calculateOptimalBatchSize(-5), 10);
});

test('calculateOptimalBatchSize: 默认 maxConcurrent=5', () => {
  // 25 / 5 = 5
  assert.equal(calculateOptimalBatchSize(25), 5);
});

test('calculateOptimalBatchSize: 自定义 maxConcurrent', () => {
  // 100 / 10 = 10
  assert.equal(calculateOptimalBatchSize(100, 10), 10);
});

test('calculateOptimalBatchSize: 整除 → 精确', () => {
  assert.equal(calculateOptimalBatchSize(50, 5), 10);
});

test('calculateOptimalBatchSize: 非整除 → ceil', () => {
  // 7 / 3 = 2.33 → ceil = 3
  assert.equal(calculateOptimalBatchSize(7, 3), 3);
});

test('calculateOptimalBatchSize: 1 prompt / 5 concurrent → ceil(1/5)=1', () => {
  assert.equal(calculateOptimalBatchSize(1, 5), 1);
});
#!/usr/bin/env node
// astro-src/scripts/agents-batch.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/batch.ts.
// batchPrompts (split prompts into batches) +
// calculateOptimalBatchSize (total / maxConcurrent)。

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
test('batchPrompts: 空数组 → 空 batches', () => {
  const r = batchPrompts([]);
  assert.deepEqual(r.batches, []);
  assert.equal(r.metadata.total, 0);
  assert.equal(r.metadata.batchCount, 0);
  assert.equal(r.metadata.batchSize, 10); // 默认 batchSize=10
});

test('batchPrompts: 单元素', () => {
  const r = batchPrompts(['only']);
  assert.equal(r.batches.length, 1);
  assert.deepEqual(r.batches[0], ['only']);
  assert.equal(r.metadata.total, 1);
  assert.equal(r.metadata.batchCount, 1);
});

test('batchPrompts: 正好 batchSize 个 → 1 个 batch', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e'], { batchSize: 5 });
  assert.equal(r.batches.length, 1);
  assert.equal(r.batches[0].length, 5);
});

test('batchPrompts: 超过 batchSize → 多 batch', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e', 'f'], { batchSize: 2 });
  assert.equal(r.batches.length, 3);
  assert.deepEqual(r.batches[0], ['a', 'b']);
  assert.deepEqual(r.batches[1], ['c', 'd']);
  assert.deepEqual(r.batches[2], ['e', 'f']);
});

test('batchPrompts: 余数不足 batchSize', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e'], { batchSize: 3 });
  // 5 个 / 3 = 2 个 batch (3 + 2)
  assert.equal(r.batches.length, 2);
  assert.equal(r.batches[0].length, 3);
  assert.equal(r.batches[1].length, 2);
});

test('batchPrompts: batchSize=1 → 每元素独立', () => {
  const r = batchPrompts(['a', 'b', 'c'], { batchSize: 1 });
  assert.equal(r.batches.length, 3);
  assert.deepEqual(r.batches[0], ['a']);
  assert.deepEqual(r.batches[1], ['b']);
  assert.deepEqual(r.batches[2], ['c']);
});

test('batchPrompts: 默认 batchSize=10', () => {
  const r = batchPrompts(['a', 'b', 'c']);
  assert.equal(r.metadata.batchSize, 10);
  assert.equal(r.batches.length, 1);
});

test('batchPrompts: metadata.total 正确', () => {
  const r = batchPrompts(['a', 'b', 'c', 'd', 'e'], { batchSize: 2 });
  assert.equal(r.metadata.total, 5);
  assert.equal(r.metadata.batchCount, 3);
});

test('batchPrompts: 不修改原数组', () => {
  const orig = ['a', 'b', 'c'];
  batchPrompts(orig, { batchSize: 2 });
  assert.deepEqual(orig, ['a', 'b', 'c']);
});

test('batchPrompts: 无 opts 用默认', () => {
  const r = batchPrompts(['a', 'b']);
  assert.equal(r.metadata.batchSize, 10);
});

// ---------- calculateOptimalBatchSize ----------
test('calculateOptimalBatchSize: total=0 → 默认 10', () => {
  assert.equal(calculateOptimalBatchSize(0), 10);
});

test('calculateOptimalBatchSize: total=-1 → 默认 10', () => {
  assert.equal(calculateOptimalBatchSize(-1), 10);
});

test('calculateOptimalBatchSize: total=10, maxConcurrent=5 → 2', () => {
  assert.equal(calculateOptimalBatchSize(10, 5), 2);
});

test('calculateOptimalBatchSize: total=5, maxConcurrent=5 → 1', () => {
  assert.equal(calculateOptimalBatchSize(5, 5), 1);
});

test('calculateOptimalBatchSize: total=11, maxConcurrent=5 → ceil(2.2)=3', () => {
  assert.equal(calculateOptimalBatchSize(11, 5), 3);
});

test('calculateOptimalBatchSize: total=100, maxConcurrent=10 → 10', () => {
  assert.equal(calculateOptimalBatchSize(100, 10), 10);
});

test('calculateOptimalBatchSize: 默认 maxConcurrent=5', () => {
  assert.equal(calculateOptimalBatchSize(20), 4);
});

test('calculateOptimalBatchSize: maxConcurrent=1 → 等于 total', () => {
  assert.equal(calculateOptimalBatchSize(7, 1), 7);
});

// ---------- 集成 ---
test('集成: batchPrompts + calculateOptimalBatchSize', () => {
  // total=20 prompts,想分 5 个并发 → batch=4 → 5 个 batch
  const total = 20;
  const maxC = 5;
  const size = calculateOptimalBatchSize(total, maxC);
  const r = batchPrompts(Array.from({ length: total }, (_, i) => `p${i}`), {
    batchSize: size,
  });
  assert.equal(r.metadata.batchCount, 5);
  assert.equal(r.batches[0].length, 4);
});
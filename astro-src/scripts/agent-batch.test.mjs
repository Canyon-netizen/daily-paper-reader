#!/usr/bin/env node
// astro-src/scripts/agent-batch.test.mjs
//
// Tests for R7 AP.6 batched LLM call helper.

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
    platform: 'node',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/batch.ts');
const { batchPrompts, calculateOptimalBatchSize } = mod;

test('batchPrompts: empty array returns empty', () => {
  const result = batchPrompts([]);
  assert.deepEqual(result.batches, []);
  assert.equal(result.metadata.total, 0);
  assert.equal(result.metadata.batchCount, 0);
});

test('batchPrompts: splits into correct number of batches', () => {
  const prompts = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11'];
  const result = batchPrompts(prompts, { batchSize: 5 });
  assert.equal(result.batches.length, 3);
  assert.equal(result.batches[0].length, 5);
  assert.equal(result.batches[2].length, 1);
});

test('batchPrompts: default batch size is 10', () => {
  const prompts = Array.from({ length: 25 }, (_, i) => `p${i}`);
  const result = batchPrompts(prompts);
  assert.equal(result.metadata.batchSize, 10);
  assert.equal(result.batches.length, 3);
});

test('calculateOptimalBatchSize: returns correct size', () => {
  assert.equal(calculateOptimalBatchSize(100, 5), 20);
  assert.equal(calculateOptimalBatchSize(50, 10), 5);
  assert.equal(calculateOptimalBatchSize(0), 10);
  assert.equal(calculateOptimalBatchSize(7, 3), 3);
});

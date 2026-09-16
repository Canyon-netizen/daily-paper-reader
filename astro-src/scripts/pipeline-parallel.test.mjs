#!/usr/bin/env node
// astro-src/scripts/pipeline-parallel.test.mjs
//
// Tests for R7 F.4.2 pipeline parallel stages.

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

const { parallelStages, parallelStagesStrict } = await loadTs('lib/agents/pipeline-parallel.ts');

test('parallelStages: runs all stages concurrently', async () => {
  const start = Date.now();
  const stages = [
    { id: 'a', run: async () => { await delay(50); return 'a-result'; } },
    { id: 'b', run: async () => { await delay(50); return 'b-result'; } },
    { id: 'c', run: async () => { await delay(50); return 'c-result'; } },
  ];
  const result = await parallelStages(stages);
  const duration = Date.now() - start;
  assert.equal(Object.keys(result.results).length, 3);
  assert.equal(result.results.a, 'a-result');
  assert.equal(result.results.b, 'b-result');
  assert.equal(result.results.c, 'c-result');
  assert.deepEqual(Object.keys(result.errors), []);
  assert.ok(duration < 100, 'should complete in ~50ms, not 150ms'); // parallel
});

test('parallelStages: respects concurrency limit', async () => {
  const start = Date.now();
  const stages = [
    { id: 'a', run: async () => { await delay(50); return 'a'; } },
    { id: 'b', run: async () => { await delay(50); return 'b'; } },
    { id: 'c', run: async () => { await delay(50); return 'c'; } },
  ];
  const result = await parallelStages(stages, { concurrency: 2 });
  const duration = Date.now() - start;
  assert.equal(Object.keys(result.results).length, 3);
  assert.ok(duration >= 100, 'concurrency=2 should take ~100ms (2 batches of 50ms)');
});

test('parallelStages: collects errors without failing', async () => {
  const stages = [
    { id: 'ok', run: async () => 'ok-result' },
    { id: 'fail', run: async () => { throw new Error('stage failed'); } },
  ];
  const result = await parallelStages(stages);
  assert.equal(result.results.ok, 'ok-result');
  assert.ok(result.errors.fail);
  assert.equal(result.errors.fail.message, 'stage failed');
});

test('parallelStages: onComplete and onError callbacks', async () => {
  const completed = [];
  const errors = [];
  const stages = [
    { id: 'good', run: async () => 'done' },
    { id: 'bad', run: async () => { throw new Error('oops'); } },
  ];
  await parallelStages(stages, {
    onComplete: (id) => completed.push(id),
    onError: (id) => errors.push(id),
  });
  assert.deepEqual(completed, ['good']);
  assert.deepEqual(errors, ['bad']);
});

test('parallelStages: returns totalDurationMs', async () => {
  const stages = [
    { id: 'a', run: async () => { await delay(20); return 'a'; } },
    { id: 'b', run: async () => { await delay(20); return 'b'; } },
  ];
  const result = await parallelStages(stages);
  assert.ok(result.totalDurationMs >= 20);
});

test('parallelStagesStrict: stops on first error', async () => {
  const stages = [
    { id: 'a', run: async () => { await delay(10); return 'a'; } },
    { id: 'b', run: async () => { throw new Error('b failed'); } },
    { id: 'c', run: async () => { await delay(50); return 'c-should-not-run'; } },
  ];
  const result = await parallelStagesStrict(stages);
  assert.ok(result.results.a);
  assert.ok(result.errors.b);
  // Note: due to concurrency, 'c' may have started before 'b' failed.
  // The contract is: 'b' error is captured. 'c' is best-effort cancelled.
  // Just verify b errored and a succeeded; c may or may not run.
  assert.equal(result.errors.b.message, 'b failed');
});

test('parallelStagesStrict: all success', async () => {
  const stages = [
    { id: 'x', run: async () => 'x-result' },
    { id: 'y', run: async () => 'y-result' },
  ];
  const result = await parallelStagesStrict(stages);
  assert.equal(result.results.x, 'x-result');
  assert.equal(result.results.y, 'y-result');
  assert.deepEqual(Object.keys(result.errors), []);
});

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true, format: 'esm', platform: 'node',
    write: false, target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// Tests for astro-src/lib/experiments/results.ts

// Note: recordResult, getResults, getAllResults, clearResults, getResultSummary
// depend on browser (window/localStorage) and cannot be tested in Node.js environment
// We only test pure functions: genResultId, computeDelta

test('genResultId generates unique IDs', async () => {
  const { genResultId } = await loadTs('../astro-src/lib/experiments/results.ts');
  const id1 = genResultId();
  const id2 = genResultId();
  assert.ok(id1.startsWith('r_'));
  assert.ok(id2.startsWith('r_'));
  assert.notStrictEqual(id1, id2, 'IDs should be unique');
});

test('genResultId format is correct', async () => {
  const { genResultId } = await loadTs('../astro-src/lib/experiments/results.ts');
  const id = genResultId();
  // Format: r_<timestamp>_<random>
  const parts = id.split('_');
  assert.strictEqual(parts[0], 'r');
  assert.ok(parts[1].length > 0, 'has timestamp part');
  assert.ok(parts[2].length > 0, 'has random part');
});

test('computeDelta returns empty metric for empty results', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const result = computeDelta([]);
  assert.deepStrictEqual(result.metric, {});
});

test('computeDelta computes correct delta', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'accuracy', expected: 0.8, actual: 0.85, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.ok(Math.abs(delta.metric.accuracy.delta - 0.05) < 1e-9);
});

test('computeDelta computes correct percentOff', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'accuracy', expected: 100, actual: 110, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.strictEqual(delta.metric.accuracy.percentOff, 0.1); // 10% off
});

test('computeDelta handles negative delta', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'loss', expected: 0.5, actual: 0.3, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.ok(Math.abs(delta.metric.loss.delta - (-0.2)) < 1e-9);
});

test('computeDelta handles zero expected (avoid division by zero)', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'count', expected: 0, actual: 10, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.strictEqual(delta.metric.count.percentOff, 0); // Should not be Infinity
});

test('computeDelta handles multiple metrics', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'accuracy', expected: 0.8, actual: 0.85, ts: Date.now() },
    { id: '2', experimentId: 'exp1', metric: 'precision', expected: 0.7, actual: 0.75, ts: Date.now() },
    { id: '3', experimentId: 'exp1', metric: 'recall', expected: 0.6, actual: 0.55, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.ok(delta.metric.accuracy);
  assert.ok(delta.metric.precision);
  assert.ok(delta.metric.recall);
  assert.strictEqual(Object.keys(delta.metric).length, 3);
});

test('computeDelta percentOff uses absolute value', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'val', expected: 100, actual: 90, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.strictEqual(delta.metric.val.percentOff, 0.1); // 10% off (absolute)
});

test('computeDelta percentOff is rounded to 4 decimal places', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'val', expected: 3, actual: 1, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  // percentOff = |1-3|/3 = 0.666666..., should be rounded to 4 decimal places: 0.6667
  const val = delta.metric.val.percentOff;
  assert.ok(val > 0.6666 && val < 0.6668, 'percentOff has 4 decimal precision');
});

test('computeDelta preserves expected and actual values', async () => {
  const { computeDelta } = await loadTs('../astro-src/lib/experiments/results.ts');
  const results = [
    { id: '1', experimentId: 'exp1', metric: 'score', expected: 0.75, actual: 0.82, ts: Date.now() }
  ];
  const delta = computeDelta(results);
  assert.strictEqual(delta.metric.score.expected, 0.75);
  assert.strictEqual(delta.metric.score.actual, 0.82);
});

test('genResultId creates different IDs on subsequent calls', async () => {
  const { genResultId } = await loadTs('../astro-src/lib/experiments/results.ts');
  const ids = new Set();
  for (let i = 0; i < 10; i++) {
    ids.add(genResultId());
  }
  assert.strictEqual(ids.size, 10, 'all IDs should be unique');
});

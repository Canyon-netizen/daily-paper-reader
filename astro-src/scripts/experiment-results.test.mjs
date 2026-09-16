#!/usr/bin/env node
// astro-src/scripts/experiment-results.test.mjs
//
// Tests for R7 E.2.3 experiment result tracking.

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

const mod = await loadTs('lib/experiments/results.ts');
const { computeDelta, genResultId } = mod;

test('computeDelta: calculates delta and percentOff', () => {
  const results = [
    { id: '1', experimentId: 'exp', metric: 'accuracy', expected: 0.9, actual: 0.81, ts: Date.now() },
    { id: '2', experimentId: 'exp', metric: 'latency', expected: 100, actual: 110, ts: Date.now() },
  ];

  const delta = computeDelta(results);

  assert.ok(delta.metric['accuracy']);
  assert.ok(Math.abs(delta.metric['accuracy'].delta - (-0.09)) < 0.0001);
  assert.ok(Math.abs(delta.metric['accuracy'].percentOff - 0.1) < 0.0001); // 10% off

  assert.equal(delta.metric['latency'].delta, 10);
  assert.equal(delta.metric['latency'].percentOff, 0.1);
});

test('computeDelta: handles zero expected value', () => {
  const results = [
    { id: '1', experimentId: 'exp', metric: 'count', expected: 0, actual: 5, ts: Date.now() },
  ];

  const delta = computeDelta(results);
  assert.equal(delta.metric['count'].percentOff, 0); // avoid division by zero
});

test('computeDelta: empty results', () => {
  const delta = computeDelta([]);
  assert.deepEqual(delta.metric, {});
});

test('computeDelta: single metric', () => {
  const results = [
    { id: '1', experimentId: 'exp', metric: 'score', expected: 100, actual: 95, ts: Date.now() },
  ];

  const delta = computeDelta(results);
  assert.equal(delta.metric['score'].delta, -5);
  assert.equal(delta.metric['score'].percentOff, 0.05);
});

test('genResultId: generates unique IDs', () => {
  const id1 = genResultId();
  const id2 = genResultId();
  assert.notEqual(id1, id2);
  assert.ok(id1.startsWith('r_'));
});

test('genResultId: format', () => {
  const id = genResultId();
  assert.ok(id.length > 10);
});

#!/usr/bin/env node
// astro-src/scripts/experiment-results.test.mjs
//
// Tests for R7 E.2.3 experiment result tracking.

import { test, beforeEach } from 'node:test';
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
const { recordResult, getResults, computeDelta, clearResults, getResultSummary, genResultId } = mod;

// Mock localStorage
const mockStorage = new Map();
const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  mockStorage.clear();
  // @ts-ignore
  globalThis.localStorage = {
    getItem: (key: string) => mockStorage.get(key) || null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
  };
});

test('recordResult: creates result with ID and timestamp', () => {
  const result = recordResult('exp-1', {
    metric: 'accuracy',
    expected: 0.9,
    actual: 0.85,
    unit: '%',
  });

  assert.ok(result.id);
  assert.equal(result.experimentId, 'exp-1');
  assert.equal(result.metric, 'accuracy');
  assert.equal(result.expected, 0.9);
  assert.equal(result.actual, 0.85);
  assert.equal(result.unit, '%');
  assert.ok(result.ts);
});

test('getResults: returns results for specific experiment', () => {
  recordResult('exp-1', { metric: 'm1', expected: 1, actual: 0.9 });
  recordResult('exp-1', { metric: 'm2', expected: 2, actual: 1.8 });
  recordResult('exp-2', { metric: 'm1', expected: 1, actual: 1.1 });

  const results1 = getResults('exp-1');
  assert.equal(results1.length, 2);

  const results2 = getResults('exp-2');
  assert.equal(results2.length, 1);
});

test('computeDelta: calculates delta and percentOff', () => {
  const results = [
    { id: '1', experimentId: 'exp', metric: 'accuracy', expected: 0.9, actual: 0.81, ts: Date.now() },
    { id: '2', experimentId: 'exp', metric: 'latency', expected: 100, actual: 110, ts: Date.now() },
  ];

  const delta = computeDelta(results);

  assert.ok(delta.metric['accuracy']);
  assert.equal(delta.metric['accuracy'].delta, -0.09);
  assert.equal(delta.metric['accuracy'].percentOff, 0.1); // 10% off

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

test('clearResults: removes results for experiment', () => {
  recordResult('exp-1', { metric: 'm1', expected: 1, actual: 0.9 });
  clearResults('exp-1');

  const results = getResults('exp-1');
  assert.equal(results.length, 0);
});

test('getResultSummary: returns summary stats', () => {
  recordResult('exp-1', { metric: 'accuracy', expected: 1.0, actual: 0.9 });
  recordResult('exp-1', { metric: 'f1', expected: 0.8, actual: 0.75 });

  const summary = getResultSummary('exp-1');
  assert.equal(summary.count, 2);
  assert.equal(summary.metrics.length, 2);
  assert.ok(summary.avgPercentOff > 0);
});

test('genResultId: generates unique IDs', () => {
  const id1 = genResultId();
  const id2 = genResultId();
  assert.notEqual(id1, id2);
});

// Restore original localStorage
test.after(() => {
  globalThis.localStorage = originalLocalStorage;
});

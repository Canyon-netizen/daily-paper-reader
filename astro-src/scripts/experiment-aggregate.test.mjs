#!/usr/bin/env node
// astro-src/scripts/experiment-aggregate.test.mjs
//
// Tests for R7 LP.4 experiment metrics aggregation.

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

const mod = await loadTs('lib/experiments/aggregate.ts');
const { aggregateMetrics, formatAggregation } = mod;

test('aggregateMetrics: empty array returns zeros', () => {
  const result = aggregateMetrics([]);
  assert.equal(result.count, 0);
  assert.equal(result.mean, 0);
  assert.equal(result.median, 0);
});

test('aggregateMetrics: single value', () => {
  const result = aggregateMetrics([42]);
  assert.equal(result.count, 1);
  assert.equal(result.mean, 42);
  assert.equal(result.median, 42);
  assert.equal(result.min, 42);
  assert.equal(result.max, 42);
  assert.equal(result.stddev, 0);
});

test('aggregateMetrics: odd count median', () => {
  const result = aggregateMetrics([1, 2, 3, 4, 5]);
  assert.equal(result.mean, 3);
  assert.equal(result.median, 3);
});

test('aggregateMetrics: even count median', () => {
  const result = aggregateMetrics([1, 2, 3, 4]);
  assert.equal(result.mean, 2.5);
  assert.equal(result.median, 2.5);
});

test('aggregateMetrics: population stddev', () => {
  // Values: 2, 4, 4, 4, 5, 5, 7, 9
  // mean = 5
  // variance = (9+1+1+1+0+0+4+16)/8 = 4
  // stddev = 2
  const result = aggregateMetrics([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(result.mean, 5);
  assert.equal(result.stddev, 2);
});

test('aggregateMetrics: float precision', () => {
  const result = aggregateMetrics([0.1, 0.2, 0.3]);
  // mean = 0.2
  assert.ok(Math.abs(result.mean - 0.2) < 0.0001);
});

test('aggregateMetrics: handles negative numbers', () => {
  const result = aggregateMetrics([-5, -1, 0, 1, 5]);
  assert.equal(result.min, -5);
  assert.equal(result.max, 5);
  assert.equal(result.mean, 0);
});

test('aggregateMetrics: large numbers', () => {
  const result = aggregateMetrics([1e10, 1e10, 1e10]);
  assert.equal(result.mean, 1e10);
});

test('formatAggregation: returns formatted string', () => {
  const result = aggregateMetrics([1, 2, 3, 4, 5]);
  const formatted = formatAggregation(result);
  assert.ok(formatted.includes('n=5'));
  assert.ok(formatted.includes('mean='));
});

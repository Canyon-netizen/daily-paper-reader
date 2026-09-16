#!/usr/bin/env node
// astro-src/scripts/experiment-aggregate.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/aggregate.ts.

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

const mod = await loadTs('lib/experiments/aggregate.ts');
const { aggregateMetrics, formatAggregation } = mod;

test('aggregateMetrics: 空数组 → 全 0', () => {
  const r = aggregateMetrics([]);
  assert.equal(r.mean, 0);
  assert.equal(r.median, 0);
  assert.equal(r.stddev, 0);
  assert.equal(r.min, 0);
  assert.equal(r.max, 0);
  assert.equal(r.count, 0);
});

test('aggregateMetrics: count 字段', () => {
  const r = aggregateMetrics([1, 2, 3]);
  assert.equal(r.count, 3);
});

test('aggregateMetrics: mean', () => {
  const r = aggregateMetrics([1, 2, 3, 4, 5]);
  assert.equal(r.mean, 3);
});

test('aggregateMetrics: median 奇数取中位', () => {
  const r = aggregateMetrics([1, 2, 3, 4, 5]);
  assert.equal(r.median, 3);
});

test('aggregateMetrics: median 偶数取平均', () => {
  const r = aggregateMetrics([1, 2, 3, 4]);
  assert.equal(r.median, 2.5);
});

test('aggregateMetrics: median 排序后取中位(无序输入)', () => {
  const r = aggregateMetrics([5, 1, 3, 2, 4]);
  assert.equal(r.median, 3);
});

test('aggregateMetrics: min/max', () => {
  const r = aggregateMetrics([3, 1, 4, 1, 5, 9, 2, 6]);
  assert.equal(r.min, 1);
  assert.equal(r.max, 9);
});

test('aggregateMetrics: stddev(总体标准差)', () => {
  // [2, 4, 4, 4, 5, 5, 7, 9] mean=5, 各值平方差和 = 32, variance = 32/8 = 4, stddev = 2
  const r = aggregateMetrics([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.stddev, 2);
});

test('aggregateMetrics: 全相同值 stddev=0', () => {
  const r = aggregateMetrics([5, 5, 5, 5]);
  assert.equal(r.stddev, 0);
});

test('aggregateMetrics: 单值 mean=median=min=max=该值', () => {
  const r = aggregateMetrics([7]);
  assert.equal(r.mean, 7);
  assert.equal(r.median, 7);
  assert.equal(r.min, 7);
  assert.equal(r.max, 7);
  assert.equal(r.stddev, 0);
});

test('aggregateMetrics: 浮点保留 6 位', () => {
  const r = aggregateMetrics([1, 2]);
  // mean=1.5, median=1.5, stddev=0.5
  assert.equal(r.mean, 1.5);
  assert.equal(r.median, 1.5);
  assert.equal(r.stddev, 0.5);
});

test('aggregateMetrics: 含负数', () => {
  const r = aggregateMetrics([-1, 1]);
  assert.equal(r.mean, 0);
  assert.equal(r.min, -1);
  assert.equal(r.max, 1);
  assert.equal(r.stddev, 1); // variance=1, sqrt=1
});

test('formatAggregation: 空 → "No data"', () => {
  const r = aggregateMetrics([]);
  assert.equal(formatAggregation(r), 'No data');
});

test('formatAggregation: 含 n/mean/median/stddev/range', () => {
  const r = aggregateMetrics([1, 2, 3, 4, 5]);
  const s = formatAggregation(r);
  assert.ok(s.includes('n=5'));
  assert.ok(s.includes('mean=3.00'));
  assert.ok(s.includes('median=3.00'));
  assert.ok(s.includes('stddev='));
  assert.ok(s.includes('range=[1, 5]'));
});

test('formatAggregation: toFixed 2 位', () => {
  const r = aggregateMetrics([1, 2, 3]);
  const s = formatAggregation(r);
  // mean = 2
  assert.ok(s.includes('mean=2.00'));
});
#!/usr/bin/env node
// astro-src/scripts/experiments-aggregate.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/aggregate.ts.
// aggregateMetrics + 统计字段 mean / stddev (population) / median + formatAggregation。

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

// ---------- empty ----------
test('aggregateMetrics: 空数组 → 0 字段', () => {
  const r = aggregateMetrics([]);
  assert.equal(r.count, 0);
  assert.equal(r.mean, 0);
  assert.equal(r.median, 0);
  assert.equal(r.stddev, 0);
  assert.equal(r.min, 0);
  assert.equal(r.max, 0);
});

// ---------- single element ----------
test('aggregateMetrics: [5] → mean=median=min=max=5', () => {
  const r = aggregateMetrics([5]);
  assert.equal(r.count, 1);
  assert.equal(r.mean, 5);
  assert.equal(r.median, 5);
  assert.equal(r.min, 5);
  assert.equal(r.max, 5);
  assert.equal(r.stddev, 0);
});

// ---------- two elements ----------
test('aggregateMetrics: [1, 3] → mean=2', () => {
  const r = aggregateMetrics([1, 3]);
  assert.equal(r.mean, 2);
  assert.equal(r.median, 2);
  assert.equal(r.min, 1);
  assert.equal(r.max, 3);
});

test('aggregateMetrics: [1, 3] → median=2', () => {
  // (1+3)/2 = 2
  const r = aggregateMetrics([1, 3]);
  assert.equal(r.median, 2);
});

test('aggregateMetrics: [1, 3] → stddev=1 (population)', () => {
  // mean=2, 偏差平方 = 1, 1, 方差 = 1, stddev = 1
  const r = aggregateMetrics([1, 3]);
  assert.equal(r.stddev, 1);
});

// ---------- odd count median ----------
test('aggregateMetrics: [1, 2, 3] → median=2', () => {
  const r = aggregateMetrics([1, 2, 3]);
  assert.equal(r.median, 2);
});

test('aggregateMetrics: [1, 2, 3] → mean=2, stddev=√(2/3)≈0.816', () => {
  const r = aggregateMetrics([1, 2, 3]);
  assert.equal(r.mean, 2);
  // 方差 = ((1-2)^2 + (2-2)^2 + (3-2)^2)/3 = 2/3 ≈ 0.6667
  // stddev = √(2/3) ≈ 0.8164965809
  assert.ok(Math.abs(r.stddev - Math.sqrt(2 / 3)) < 1e-5);
});

// ---------- even count median ----------
test('aggregateMetrics: [1, 2, 3, 4] → median=2.5', () => {
  // (2+3)/2 = 2.5
  const r = aggregateMetrics([1, 2, 3, 4]);
  assert.equal(r.median, 2.5);
});

// ---------- unsorted input ----------
test('aggregateMetrics: 乱序输入排序后正确', () => {
  const r = aggregateMetrics([3, 1, 4, 1, 5]);
  assert.equal(r.min, 1);
  assert.equal(r.max, 5);
  // mean = (3+1+4+1+5)/5 = 14/5 = 2.8
  assert.equal(r.mean, 2.8);
  // sorted = [1, 1, 3, 4, 5], mid=2 → median = 3
  assert.equal(r.median, 3);
});

// ---------- population stddev 验证 ---
test('aggregateMetrics: [2, 4, 4, 4, 5, 5, 7, 9] → stddev=2 (经典示例)', () => {
  // 维基百科 population stddev 例子:mean=5, stddev=2
  const r = aggregateMetrics([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.mean, 5);
  assert.equal(r.stddev, 2);
});

// ---------- 不修改原数组 ---
test('aggregateMetrics: 不修改输入', () => {
  const arr = [3, 1, 2];
  aggregateMetrics(arr);
  assert.deepEqual(arr, [3, 1, 2]);
});

// ---------- 负数 ----------
test('aggregateMetrics: 含负数', () => {
  const r = aggregateMetrics([-2, -1, 0, 1, 2]);
  assert.equal(r.mean, 0);
  assert.equal(r.median, 0);
  assert.equal(r.min, -2);
  assert.equal(r.max, 2);
});

// ---------- 浮点 ---
test('aggregateMetrics: 浮点精度', () => {
  const r = aggregateMetrics([0.1, 0.2, 0.3]);
  // mean = 0.2
  assert.ok(Math.abs(r.mean - 0.2) < 1e-6);
});

// ---------- 相同元素 ---
test('aggregateMetrics: 全相同 → stddev=0', () => {
  const r = aggregateMetrics([5, 5, 5, 5]);
  assert.equal(r.mean, 5);
  assert.equal(r.median, 5);
  assert.equal(r.stddev, 0);
  assert.equal(r.min, 5);
  assert.equal(r.max, 5);
});

// ---------- 大数组 ---
test('aggregateMetrics: 100 元素', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const r = aggregateMetrics(arr);
  assert.equal(r.count, 100);
  assert.equal(r.mean, 49.5);
  assert.equal(r.min, 0);
  assert.equal(r.max, 99);
  // median = (49+50)/2 = 49.5
  assert.equal(r.median, 49.5);
});

// ---------- round6 精度 ---
test('aggregateMetrics: mean 含浮点 → 四舍五入到 6 位', () => {
  // 1/3 = 0.333333333...
  const r = aggregateMetrics([1, 0, 0]);
  assert.equal(r.mean, 0.333333);
});

// ---------- formatAggregation ----------
test('formatAggregation: 空 → "No data"', () => {
  const r = aggregateMetrics([]);
  assert.equal(formatAggregation(r), 'No data');
});

test('formatAggregation: 单值', () => {
  const r = aggregateMetrics([5]);
  const s = formatAggregation(r);
  assert.match(s, /n=1/);
  assert.match(s, /mean=5\.00/);
});

test('formatAggregation: 含 range', () => {
  const r = aggregateMetrics([1, 2, 3]);
  const s = formatAggregation(r);
  assert.match(s, /\[1, 3\]/);
});

test('formatAggregation: 含 median/stddev', () => {
  const r = aggregateMetrics([1, 2, 3]);
  const s = formatAggregation(r);
  assert.match(s, /median=/);
  assert.match(s, /stddev=/);
});

// ---------- 集成 ---
test('aggregate + format: 正常路径', () => {
  const r = aggregateMetrics([1, 2, 3, 4, 5]);
  const s = formatAggregation(r);
  assert.match(s, /n=5/);
  assert.match(s, /mean=3\.00/);
});
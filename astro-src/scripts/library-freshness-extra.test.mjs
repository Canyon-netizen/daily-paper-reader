#!/usr/bin/env node
// astro-src/scripts/library-freshness-extra.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-freshness.ts freshness helpers.

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

const mod = await loadTs('lib/library-freshness.ts');
const {
  freshnessFromTimestamp,
  freshnessFromLatestDate,
  freshnessFromDays,
} = mod;

const NOW = new Date('2026-09-16T12:00:00Z');

test('freshnessFromTimestamp: 0 → 空库', () => {
  const f = freshnessFromTimestamp(0, NOW.getTime());
  assert.equal(f.color, 'gray');
  assert.equal(f.daysAgo, -1);
  assert.equal(f.label, '空库');
});

test('freshnessFromTimestamp: 负数 → 空库', () => {
  const f = freshnessFromTimestamp(-100, NOW.getTime());
  assert.equal(f.color, 'gray');
});

test('freshnessFromTimestamp: NaN → 空库', () => {
  const f = freshnessFromTimestamp(NaN, NOW.getTime());
  assert.equal(f.color, 'gray');
});

test('freshnessFromTimestamp: 今天 → green', () => {
  const f = freshnessFromTimestamp(NOW.getTime(), NOW.getTime());
  assert.equal(f.color, 'green');
  assert.equal(f.daysAgo, 0);
});

test('freshnessFromTimestamp: 5 天前 → green', () => {
  const fiveDaysAgo = NOW.getTime() - 5 * 24 * 60 * 60 * 1000;
  const f = freshnessFromTimestamp(fiveDaysAgo, NOW.getTime());
  assert.equal(f.color, 'green');
  assert.equal(f.daysAgo, 5);
});

test('freshnessFromTimestamp: 15 天前 → yellow', () => {
  const ts = NOW.getTime() - 15 * 24 * 60 * 60 * 1000;
  const f = freshnessFromTimestamp(ts, NOW.getTime());
  assert.equal(f.color, 'yellow');
});

test('freshnessFromTimestamp: 60 天前 → orange', () => {
  const ts = NOW.getTime() - 60 * 24 * 60 * 60 * 1000;
  const f = freshnessFromTimestamp(ts, NOW.getTime());
  assert.equal(f.color, 'orange');
});

test('freshnessFromTimestamp: 200 天前 → red', () => {
  const ts = NOW.getTime() - 200 * 24 * 60 * 60 * 1000;
  const f = freshnessFromTimestamp(ts, NOW.getTime());
  assert.equal(f.color, 'red');
});

test('freshnessFromLatestDate: 合法日期 → 计算 daysAgo', () => {
  const date = '2026-09-10';
  const f = freshnessFromLatestDate(date, NOW);
  assert.equal(f.daysAgo, 6);
  assert.equal(f.color, 'green'); // ≤ 7
});

test('freshnessFromLatestDate: 空 → 空库', () => {
  const f = freshnessFromLatestDate(null, NOW);
  assert.equal(f.color, 'gray');
});

test('freshnessFromLatestDate: 非法格式 → 空库', () => {
  const f = freshnessFromLatestDate('2026/09/10', NOW);
  assert.equal(f.color, 'gray');
});

test('freshnessFromLatestDate: 未来日期 → 视为今天', () => {
  const future = '2030-01-01';
  const f = freshnessFromLatestDate(future, NOW);
  assert.equal(f.color, 'green');
  assert.equal(f.daysAgo, 0);
});

test('freshnessFromDays: 边界 0 → green', () => {
  const f = freshnessFromDays(0);
  assert.equal(f.color, 'green');
});

test('freshnessFromDays: 边界 1 → green', () => {
  const f = freshnessFromDays(1);
  assert.equal(f.color, 'green');
});

test('freshnessFromDays: 边界 7 → green', () => {
  const f = freshnessFromDays(7);
  assert.equal(f.color, 'green');
});

test('freshnessFromDays: 边界 8 → yellow', () => {
  const f = freshnessFromDays(8);
  assert.equal(f.color, 'yellow');
});

test('freshnessFromDays: 30 → yellow', () => {
  const f = freshnessFromDays(30);
  assert.equal(f.color, 'yellow');
});

test('freshnessFromDays: 31 → orange', () => {
  const f = freshnessFromDays(31);
  assert.equal(f.color, 'orange');
});

test('freshnessFromDays: 90 → orange', () => {
  const f = freshnessFromDays(90);
  assert.equal(f.color, 'orange');
});

test('freshnessFromDays: 91 → red', () => {
  const f = freshnessFromDays(91);
  assert.equal(f.color, 'red');
});

test('freshnessFromDays: label 月份近似', () => {
  const f = freshnessFromDays(60);
  assert.equal(f.label, '2 个月前');
});

test('freshnessFromDays: label 天数', () => {
  const f = freshnessFromDays(15);
  assert.equal(f.label, '15 天前');
});

test('freshnessFromDays: daysAgo=-1 → gray', () => {
  const f = freshnessFromDays(-1);
  assert.equal(f.color, 'gray');
});

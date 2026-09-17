#!/usr/bin/env node
// astro-src/scripts/library-freshness.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-freshness.ts.
// freshnessFromTimestamp + freshnessFromLatestDate + freshnessFromDays.

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

// ---------- freshnessFromTimestamp ----------
test('freshnessFromTimestamp: updatedAt=0 → 空库', () => {
  const r = freshnessFromTimestamp(0, 1000);
  assert.equal(r.color, 'gray');
  assert.equal(r.daysAgo, -1);
  assert.equal(r.label, '空库');
});

test('freshnessFromTimestamp: 负数 → 空库', () => {
  const r = freshnessFromTimestamp(-100, 1000);
  assert.equal(r.color, 'gray');
});

test('freshnessFromTimestamp: NaN → 空库', () => {
  const r = freshnessFromTimestamp(NaN, 1000);
  assert.equal(r.color, 'gray');
});

test('freshnessFromTimestamp: Infinity → 空库', () => {
  const r = freshnessFromTimestamp(Infinity, 1000);
  assert.equal(r.color, 'gray');
});

test('freshnessFromTimestamp: 0 → 1d', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now, now);
  assert.equal(r.daysAgo, 0);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('freshnessFromTimestamp: 1 天前 → green 今天更新', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 86400 * 1000, now);
  // daysAgo = 1 → green 今天更新 (daysAgo <= 1)
  assert.equal(r.daysAgo, 1);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('freshnessFromTimestamp: 7 天前 → green N 天前', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 7 * 86400 * 1000, now);
  assert.equal(r.daysAgo, 7);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '7 天前');
});

test('freshnessFromTimestamp: 8 天前 → yellow', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 8 * 86400 * 1000, now);
  assert.equal(r.color, 'yellow');
  assert.equal(r.label, '8 天前');
});

test('freshnessFromTimestamp: 30 天前 → yellow', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 30 * 86400 * 1000, now);
  assert.equal(r.color, 'yellow');
});

test('freshnessFromTimestamp: 31 天前 → orange', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 31 * 86400 * 1000, now);
  assert.equal(r.color, 'orange');
  assert.match(r.label, /个月前/);
});

test('freshnessFromTimestamp: 90 天前 → orange', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 90 * 86400 * 1000, now);
  assert.equal(r.color, 'orange');
});

test('freshnessFromTimestamp: 91 天前 → red', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 91 * 86400 * 1000, now);
  assert.equal(r.color, 'red');
  assert.match(r.label, /个月前/);
});

test('freshnessFromTimestamp: 365 天前 → red 12 个月前', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now - 365 * 86400 * 1000, now);
  assert.equal(r.color, 'red');
  assert.equal(r.label, '12 个月前');
});

test('freshnessFromTimestamp: future updatedAt → daysAgo = floor(negative)', () => {
  const now = 1700000000000;
  const r = freshnessFromTimestamp(now + 1000, now);
  // daysAgo = floor(-1000/86400000) = -1 → 空库
  assert.equal(r.color, 'gray');
});

// ---------- freshnessFromLatestDate ----------
test('freshnessFromLatestDate: null → 空库', () => {
  const r = freshnessFromLatestDate(null);
  assert.equal(r.color, 'gray');
  assert.equal(r.label, '空库');
});

test('freshnessFromLatestDate: undefined → 空库', () => {
  const r = freshnessFromLatestDate(undefined);
  assert.equal(r.color, 'gray');
});

test('freshnessFromLatestDate: 空字符串 → 空库', () => {
  const r = freshnessFromLatestDate('');
  assert.equal(r.color, 'gray');
});

test('freshnessFromLatestDate: 非 YYYY-MM-DD → 空库', () => {
  const r = freshnessFromLatestDate('not-a-date');
  assert.equal(r.color, 'gray');
});

test('freshnessFromLatestDate: 错误格式 2026/09/10 → 空库', () => {
  const r = freshnessFromLatestDate('2026/09/10');
  assert.equal(r.color, 'gray');
});

test('freshnessFromLatestDate: 今日 → 今天更新', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = freshnessFromLatestDate('2026-09-17', now);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('freshnessFromLatestDate: 7 天前 → green', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = freshnessFromLatestDate('2026-09-10', now);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '7 天前');
});

test('freshnessFromLatestDate: 30 天前 → yellow', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = freshnessFromLatestDate('2026-08-18', now);
  assert.equal(r.color, 'yellow');
});

test('freshnessFromLatestDate: 31 天前 → orange', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = freshnessFromLatestDate('2026-08-17', now);
  assert.equal(r.color, 'orange');
});

test('freshnessFromLatestDate: future date (daysAgo < 0) → 今天更新', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  // future date 比 today 晚 → daysAgo < 0 → "今天更新"
  const r = freshnessFromLatestDate('2026-09-20', now);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
  assert.equal(r.daysAgo, 0);
});

test('freshnessFromLatestDate: 90 天前 → orange', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = freshnessFromLatestDate('2026-06-19', now);
  assert.equal(r.color, 'orange');
});

test('freshnessFromLatestDate: 91 天前 → red', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = freshnessFromLatestDate('2026-06-18', now);
  assert.equal(r.color, 'red');
});

// ---------- freshnessFromDays ----------
test('freshnessFromDays: 负数 → 空库', () => {
  const r = freshnessFromDays(-1);
  assert.equal(r.color, 'gray');
  assert.equal(r.daysAgo, -1);
});

test('freshnessFromDays: 0 → 今天更新', () => {
  assert.equal(freshnessFromDays(0).color, 'green');
  assert.equal(freshnessFromDays(0).label, '今天更新');
});

test('freshnessFromDays: 1 → 今天更新 (边界 <=1)', () => {
  const r = freshnessFromDays(1);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('freshnessFromDays: 2 → green N 天前', () => {
  const r = freshnessFromDays(2);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '2 天前');
});

test('freshnessFromDays: 7 → green 边界', () => {
  const r = freshnessFromDays(7);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '7 天前');
});

test('freshnessFromDays: 8 → yellow', () => {
  assert.equal(freshnessFromDays(8).color, 'yellow');
});

test('freshnessFromDays: 30 → yellow 边界', () => {
  assert.equal(freshnessFromDays(30).color, 'yellow');
});

test('freshnessFromDays: 31 → orange', () => {
  const r = freshnessFromDays(31);
  assert.equal(r.color, 'orange');
  // 31/30 = 1.x → Math.floor = 1 → '1 个月前'
  assert.equal(r.label, '1 个月前');
});

test('freshnessFromDays: 60 → orange 2 个月前', () => {
  const r = freshnessFromDays(60);
  assert.equal(r.color, 'orange');
  assert.equal(r.label, '2 个月前');
});

test('freshnessFromDays: 90 → orange 边界', () => {
  const r = freshnessFromDays(90);
  assert.equal(r.color, 'orange');
  assert.equal(r.label, '3 个月前');
});

test('freshnessFromDays: 91 → red', () => {
  const r = freshnessFromDays(91);
  assert.equal(r.color, 'red');
  assert.equal(r.label, '3 个月前');
});

test('freshnessFromDays: 180 → red 6 个月前', () => {
  const r = freshnessFromDays(180);
  assert.equal(r.color, 'red');
  assert.equal(r.label, '6 个月前');
});

test('freshnessFromDays: 365 → red 12 个月前', () => {
  const r = freshnessFromDays(365);
  assert.equal(r.color, 'red');
  assert.equal(r.label, '12 个月前');
});

test('freshnessFromDays: 1000 → red 33 个月前', () => {
  const r = freshnessFromDays(1000);
  assert.equal(r.color, 'red');
  assert.equal(r.label, '33 个月前');
});
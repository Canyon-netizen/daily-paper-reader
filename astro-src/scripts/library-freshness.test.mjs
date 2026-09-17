#!/usr/bin/env node
// astro-src/scripts/library-freshness.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-freshness.ts.
// freshnessFromTimestamp (ms → Freshness) +
// freshnessFromLatestDate (YYYY-MM-DD → Freshness) +
// freshnessFromDays (days → Freshness) 颜色 + label 阈值。

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

const DAY = 1000 * 60 * 60 * 24;
const NOW = Date.UTC(2026, 8, 15); // 2026-09-15 UTC

// ---------- freshnessFromTimestamp ---
test('ts: 0 → 空库', () => {
  const r = freshnessFromTimestamp(0, NOW);
  assert.equal(r.daysAgo, -1);
  assert.equal(r.color, 'gray');
  assert.equal(r.label, '空库');
});

test('ts: 负数 → 空库', () => {
  const r = freshnessFromTimestamp(-100, NOW);
  assert.equal(r.daysAgo, -1);
});

test('ts: NaN → 空库', () => {
  const r = freshnessFromTimestamp(NaN, NOW);
  assert.equal(r.daysAgo, -1);
});

test('ts: Infinity → 空库', () => {
  const r = freshnessFromTimestamp(Infinity, NOW);
  assert.equal(r.daysAgo, -1);
});

test('ts: 0.5 天前 → 今天', () => {
  // (NOW - 12h) / day = 0.5 → floor = 0 → 今天更新
  const r = freshnessFromTimestamp(NOW - 12 * 60 * 60 * 1000, NOW);
  assert.equal(r.daysAgo, 0);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('ts: 1 天前 → 今天(<=1)', () => {
  const r = freshnessFromTimestamp(NOW - DAY, NOW);
  assert.equal(r.daysAgo, 1);
  assert.equal(r.color, 'green');
});

test('ts: 7 天前 → green', () => {
  const r = freshnessFromTimestamp(NOW - 7 * DAY, NOW);
  assert.equal(r.color, 'green');
  assert.match(r.label, /天前/);
});

test('ts: 8 天前 → yellow', () => {
  const r = freshnessFromTimestamp(NOW - 8 * DAY, NOW);
  assert.equal(r.color, 'yellow');
});

test('ts: 30 天前 → yellow(<=30)', () => {
  const r = freshnessFromTimestamp(NOW - 30 * DAY, NOW);
  assert.equal(r.color, 'yellow');
});

test('ts: 31 天前 → orange', () => {
  const r = freshnessFromTimestamp(NOW - 31 * DAY, NOW);
  assert.equal(r.color, 'orange');
  assert.match(r.label, /个月前/);
});

test('ts: 90 天前 → orange', () => {
  const r = freshnessFromTimestamp(NOW - 90 * DAY, NOW);
  assert.equal(r.color, 'orange');
});

test('ts: 91 天前 → red', () => {
  const r = freshnessFromTimestamp(NOW - 91 * DAY, NOW);
  assert.equal(r.color, 'red');
});

test('ts: 365 天前 → red', () => {
  const r = freshnessFromTimestamp(NOW - 365 * DAY, NOW);
  assert.equal(r.color, 'red');
});

test('ts: 默认 now=Date.now()', () => {
  // 仅检查不抛 + 返回有效对象
  const r = freshnessFromTimestamp(Date.now());
  assert.ok(['green', 'yellow', 'orange', 'red', 'gray'].includes(r.color));
});

// ---------- freshnessFromLatestDate ---
test('date: null → 空库', () => {
  const r = freshnessFromLatestDate(null, new Date(NOW));
  assert.equal(r.color, 'gray');
});

test('date: undefined → 空库', () => {
  const r = freshnessFromLatestDate(undefined, new Date(NOW));
  assert.equal(r.color, 'gray');
});

test('date: 空字符串 → 空库', () => {
  const r = freshnessFromLatestDate('', new Date(NOW));
  assert.equal(r.color, 'gray');
});

test('date: 非法格式 → 空库', () => {
  const r = freshnessFromLatestDate('2026/09/15', new Date(NOW));
  assert.equal(r.color, 'gray');
});

test('date: "abc" → 空库', () => {
  const r = freshnessFromLatestDate('abc', new Date(NOW));
  assert.equal(r.color, 'gray');
});

test('date: 同一天 → 今天', () => {
  const r = freshnessFromLatestDate('2026-09-15', new Date(NOW));
  assert.equal(r.daysAgo, 0);
  assert.equal(r.color, 'green');
});

test('date: 1 天前 → 今天', () => {
  const r = freshnessFromLatestDate('2026-09-14', new Date(NOW));
  assert.equal(r.daysAgo, 1);
  assert.equal(r.color, 'green');
});

test('date: 5 天前 → green', () => {
  const r = freshnessFromLatestDate('2026-09-10', new Date(NOW));
  assert.equal(r.color, 'green');
});

test('date: 10 天前 → yellow', () => {
  const r = freshnessFromLatestDate('2026-09-05', new Date(NOW));
  assert.equal(r.color, 'yellow');
});

test('date: 60 天前 → orange', () => {
  const r = freshnessFromLatestDate('2026-07-15', new Date(NOW));
  assert.equal(r.color, 'orange');
});

test('date: 180 天前 → red', () => {
  const r = freshnessFromLatestDate('2026-03-15', new Date(NOW));
  assert.equal(r.color, 'red');
});

test('date: 未来日期 → 当天(避免 race)', () => {
  const r = freshnessFromLatestDate('2099-01-01', new Date(NOW));
  assert.equal(r.daysAgo, 0);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('date: 默认 now=Date.now()', () => {
  const r = freshnessFromLatestDate('2020-01-01');
  assert.equal(r.color, 'red');
});

// ---------- freshnessFromDays ---
test('days: -1 → 空库', () => {
  const r = freshnessFromDays(-1);
  assert.equal(r.color, 'gray');
});

test('days: -100 → 空库', () => {
  const r = freshnessFromDays(-100);
  assert.equal(r.color, 'gray');
});

test('days: 0 → 今天更新', () => {
  const r = freshnessFromDays(0);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('days: 1 → 今天更新(<=1)', () => {
  const r = freshnessFromDays(1);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '今天更新');
});

test('days: 2 → "2 天前" green', () => {
  const r = freshnessFromDays(2);
  assert.equal(r.color, 'green');
  assert.equal(r.label, '2 天前');
});

test('days: 7 → "7 天前" green', () => {
  const r = freshnessFromDays(7);
  assert.equal(r.color, 'green');
});

test('days: 8 → "8 天前" yellow', () => {
  const r = freshnessFromDays(8);
  assert.equal(r.color, 'yellow');
});

test('days: 30 → "30 天前" yellow', () => {
  const r = freshnessFromDays(30);
  assert.equal(r.color, 'yellow');
});

test('days: 31 → "1 个月前" orange', () => {
  const r = freshnessFromDays(31);
  assert.equal(r.color, 'orange');
  assert.equal(r.label, '1 个月前');
});

test('days: 60 → "2 个月前" orange', () => {
  const r = freshnessFromDays(60);
  assert.equal(r.color, 'orange');
  assert.equal(r.label, '2 个月前');
});

test('days: 90 → orange', () => {
  const r = freshnessFromDays(90);
  assert.equal(r.color, 'orange');
});

test('days: 91 → red', () => {
  const r = freshnessFromDays(91);
  assert.equal(r.color, 'red');
});

test('days: 365 → "12 个月前" red', () => {
  const r = freshnessFromDays(365);
  assert.equal(r.color, 'red');
  assert.equal(r.label, '12 个月前');
});

test('days: 60 → Math.floor(60/30) = 2', () => {
  const r = freshnessFromDays(60);
  assert.match(r.label, /^2 个月前$/);
});

test('days: 边界 89 → orange', () => {
  const r = freshnessFromDays(89);
  assert.equal(r.color, 'orange');
});

// ---------- 集成 ---
test('集成: ts → date 一致', () => {
  // 同一天的 timestamp 与 date 字符串应给出相同结果
  const ts = Date.UTC(2026, 8, 10); // 2026-09-10
  const r1 = freshnessFromTimestamp(ts, NOW);
  const r2 = freshnessFromLatestDate('2026-09-10', new Date(NOW));
  assert.equal(r1.daysAgo, r2.daysAgo);
  assert.equal(r1.color, r2.color);
});
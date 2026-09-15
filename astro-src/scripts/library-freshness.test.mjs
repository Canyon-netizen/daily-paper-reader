#!/usr/bin/env node
// astro-src/scripts/library-freshness.test.mjs
//
// Tests for astro-src/lib/library-freshness.ts (R7 D.2.4).
//
// Run: node --test astro-src/scripts/library-freshness.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTsModule(relPath) {
  const src = readFileSync(join(__dirname, '..', relPath), 'utf8');
  const result = await esbuild.transform(src, { loader: 'ts', format: 'esm' });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(result.code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTsModule('lib/library-freshness.ts');
const { freshnessFromTimestamp, freshnessFromLatestDate, freshnessFromDays } = mod;

// ----- freshnessFromTimestamp -----

test('freshnessFromTimestamp: invalid timestamp -> empty', () => {
  const f = freshnessFromTimestamp(0);
  assert.equal(f.daysAgo, -1);
  assert.equal(f.label, '空库');
  assert.equal(f.color, 'gray');
});

test('freshnessFromTimestamp: 0d ago -> 今天更新 / green', () => {
  const now = new Date('2026-09-15T12:00:00Z').getTime();
  const f = freshnessFromTimestamp(now, now);
  assert.equal(f.daysAgo, 0);
  assert.equal(f.label, '今天更新');
  assert.equal(f.color, 'green');
});

test('freshnessFromTimestamp: 5d ago -> green', () => {
  const now = Date.now();
  const f = freshnessFromTimestamp(now - 5 * 24 * 60 * 60 * 1000, now);
  assert.equal(f.daysAgo, 5);
  assert.match(f.label, /5 天前/);
  assert.equal(f.color, 'green');
});

test('freshnessFromTimestamp: 30d ago -> yellow', () => {
  const now = Date.now();
  const f = freshnessFromTimestamp(now - 30 * 24 * 60 * 60 * 1000, now);
  assert.equal(f.color, 'yellow');
});

test('freshnessFromTimestamp: 60d ago -> orange / months', () => {
  const now = Date.now();
  const f = freshnessFromTimestamp(now - 60 * 24 * 60 * 60 * 1000, now);
  assert.equal(f.color, 'orange');
  assert.match(f.label, /个月前/);
});

test('freshnessFromTimestamp: 200d ago -> red', () => {
  const now = Date.now();
  const f = freshnessFromTimestamp(now - 200 * 24 * 60 * 60 * 1000, now);
  assert.equal(f.color, 'red');
});

// ----- freshnessFromLatestDate -----

test('freshnessFromLatestDate: null -> empty', () => {
  const f = freshnessFromLatestDate(null);
  assert.equal(f.color, 'gray');
});

test('freshnessFromLatestDate: today -> green', () => {
  const today = new Date('2026-09-15T00:00:00Z');
  const f = freshnessFromLatestDate('2026-09-15', today);
  assert.equal(f.color, 'green');
});

test('freshnessFromLatestDate: 3 days ago -> green', () => {
  const today = new Date('2026-09-15T00:00:00Z');
  const f = freshnessFromLatestDate('2026-09-12', today);
  assert.equal(f.daysAgo, 3);
  assert.equal(f.color, 'green');
});

test('freshnessFromLatestDate: invalid format -> empty', () => {
  const f = freshnessFromLatestDate('not-a-date');
  assert.equal(f.color, 'gray');
});

test('freshnessFromLatestDate: future date -> today (race)', () => {
  const today = new Date('2026-09-15T00:00:00Z');
  const f = freshnessFromLatestDate('2026-09-20', today);
  assert.equal(f.daysAgo, 0);
  assert.equal(f.color, 'green');
});

// ----- freshnessFromDays -----

test('freshnessFromDays: all threshold boundaries', () => {
  assert.equal(freshnessFromDays(0).color, 'green');
  assert.equal(freshnessFromDays(1).color, 'green');
  assert.equal(freshnessFromDays(2).color, 'green');
  assert.equal(freshnessFromDays(7).color, 'green');
  assert.equal(freshnessFromDays(8).color, 'yellow');
  assert.equal(freshnessFromDays(30).color, 'yellow');
  assert.equal(freshnessFromDays(31).color, 'orange');
  assert.equal(freshnessFromDays(90).color, 'orange');
  assert.equal(freshnessFromDays(91).color, 'red');
  assert.equal(freshnessFromDays(365).color, 'red');
});

test('freshnessFromDays: month rounding', () => {
  assert.equal(freshnessFromDays(60).label, '2 个月前');
  assert.equal(freshnessFromDays(120).label, '4 个月前');
});
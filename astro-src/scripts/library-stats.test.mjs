#!/usr/bin/env node
// astro-src/scripts/library-stats.test.mjs
//
// Tests for computeLibraryStats in astro-src/lib/library-stats.ts (R7 D.2.3).
//
// We use esbuild to compile the TS source at runtime (no tsx dependency).
// Same pattern as elo-debate-mirror.test.mjs but inline-loaded.

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
  // data: URL is the simplest way to evaluate transformed ESM
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(result.code).toString('base64');
  return import(dataUrl);
}

const tsModule = await loadTsModule('lib/library-stats.ts');
const computeLibraryStats = tsModule.computeLibraryStats;

const libRl = {
  id: 'rl',
  title: 'RL',
  tags: ['task:rl'],
};

const libAll = {
  id: 'all',
  title: 'All',
  tags: [],  // matches nothing
};

const libMas = {
  id: 'mas',
  title: 'MAS',
  tags: ['task:mas'],
};

const baseItems = [
  {
    id: '2501.00001',
    date: '2026-09-10',
    score: 0.9,
    authors: ['Alice', 'Bob', 'Charlie'],
    categories: { task: ['rl'], method: ['ppo'] },
  },
  {
    id: '2501.00002',
    date: '2026-09-05',
    score: 0.7,
    authors: ['Bob', 'Diana'],
    categories: { task: ['rl'], method: ['sac'] },
  },
  {
    id: '2501.00003',
    date: '2026-01-01',
    score: 0.5,
    authors: ['Eve'],
    categories: { task: ['mas'], method: ['dqn'] },
  },
  {
    id: '2501.00004',
    date: '2025-12-01',
    score: 0.0,  // missing score should be ignored in average
    authors: [],
    categories: { task: ['rl'] },
  },
];

test('paperCount: counts items matching any library tag', () => {
  const stats = computeLibraryStats(baseItems, libRl);
  assert.equal(stats.paperCount, 3);  // 2 with task:rl + 1 with task:rl + 0-score
});

test('paperCount: 0 when no tags match', () => {
  const stats = computeLibraryStats(baseItems, libAll);
  assert.equal(stats.paperCount, 0);
});

test('avgRelevanceScore: normalized to 0..1', () => {
  const stats = computeLibraryStats(baseItems, libRl);
  // (0.9 + 0.7 + 0.0) / 3 = 0.533...
  assert.ok(Math.abs(stats.avgRelevanceScore - 0.533) < 0.01);
  assert.equal(stats.scoreScale, 1);
});

test('avgRelevanceScore: scale 0..10 normalized', () => {
  const items = [
    { id: 'a', score: 7, categories: { task: ['rl'] } },
    { id: 'b', score: 9, categories: { task: ['rl'] } },
  ];
  const stats = computeLibraryStats(items, libRl);
  assert.equal(stats.scoreScale, 10);
  // rawAvg = 8, normalized = 0.8
  assert.ok(Math.abs(stats.avgRelevanceScore - 0.8) < 0.001);
});

test('avgRelevanceScore: missing scores excluded from mean', () => {
  const items = [
    { id: 'a', score: 0.8, categories: { task: ['rl'] } },
    { id: 'b', score: null, categories: { task: ['rl'] } },
    { id: 'c', categories: { task: ['rl'] } },  // no score field
  ];
  const stats = computeLibraryStats(items, libRl);
  assert.equal(stats.avgRelevanceScore, 0.8);
});

test('recentCount: counts papers within window', () => {
  const now = new Date('2026-09-15T00:00:00Z');
  const stats = computeLibraryStats(baseItems, libRl, { now, recentDays: 30 });
  // 2026-09-10 and 2026-09-05 are within 30 days of 2026-09-15
  assert.equal(stats.recentCount, 2);
});

test('recentCount: 0 when no recent papers', () => {
  const now = new Date('2026-09-15T00:00:00Z');
  const stats = computeLibraryStats(baseItems, libMas, { now, recentDays: 30 });
  assert.equal(stats.recentCount, 0);
});

test('categoryDistribution: counts dim:label hits', () => {
  const stats = computeLibraryStats(baseItems, libRl);
  // task:rl = 3, method:ppo = 1, method:sac = 1
  assert.equal(stats.categoryDistribution['task:rl'], 3);
  assert.equal(stats.categoryDistribution['method:ppo'], 1);
  assert.equal(stats.categoryDistribution['method:sac'], 1);
  // task:mas should not appear (filtered out by libRl.tags)
  assert.equal(stats.categoryDistribution['task:mas'], undefined);
});

test('topAuthors: top 5 by frequency, max 3 per paper', () => {
  const stats = computeLibraryStats(baseItems, libRl);
  assert.ok(stats.topAuthors.length <= 5);
  // Bob appears in 2 papers (paper 1 + paper 2), Alice in 1 paper.
  // So Bob should rank before Alice.
  const bobIdx = stats.topAuthors.indexOf('Bob');
  const aliceIdx = stats.topAuthors.indexOf('Alice');
  assert.ok(bobIdx >= 0, 'Bob present');
  assert.ok(aliceIdx >= 0, 'Alice present');
  assert.ok(bobIdx < aliceIdx, `Bob (${bobIdx}) should rank before Alice (${aliceIdx})`);
  // Eve excluded since her paper has task:mas
  assert.equal(stats.topAuthors.includes('Eve'), false);
});

test('oldestDate / newestDate: paper date range', () => {
  const stats = computeLibraryStats(baseItems, libRl);
  assert.equal(stats.oldestDate, '2025-12-01');
  assert.equal(stats.newestDate, '2026-09-10');
});

test('empty input -> zero stats without crash', () => {
  const stats = computeLibraryStats([], libRl);
  assert.equal(stats.paperCount, 0);
  assert.equal(stats.avgRelevanceScore, 0);
  assert.equal(stats.recentCount, 0);
  assert.deepEqual(stats.topAuthors, []);
  assert.equal(stats.oldestDate, null);
  assert.equal(stats.newestDate, null);
});

test('pure function: no mutation of inputs', () => {
  const items = baseItems.slice();
  const before = items.map((p) => p.id).join(',');
  computeLibraryStats(items, libRl);
  const after = items.map((p) => p.id).join(',');
  assert.equal(before, after);
});
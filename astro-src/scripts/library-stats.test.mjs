#!/usr/bin/env node
// astro-src/scripts/library-stats.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-stats.ts.
// computeLibraryStats: paperCount / avgRelevanceScore (scale-aware 0..1 vs 0..10) /
// recentCount / categoryDistribution / topAuthors / oldestDate / newestDate。

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

const mod = await loadTs('lib/library-stats.ts');
const { computeLibraryStats } = mod;

const mkLib = (overrides = {}) => ({
  id: 'rl',
  title: 'RL',
  titleZh: '强化学习',
  description: 'RL lib',
  descriptionZh: '强化学习库',
  tags: ['task:rl'],
  dimension: 'task',
  curator: 'core',
  hue: 'blue',
  ...overrides,
});

const mkPaper = (overrides = {}) => ({
  id: 'papers/x.md',
  date: '2026-09-01',
  score: 0.7,
  authors: ['Alice', 'Bob'],
  categories: { venue: [], task: ['rl'], method: [], type: [] },
  ...overrides,
});

const NOW = new Date(Date.UTC(2026, 8, 15)); // 2026-09-15

// ---------- basic ---
test('stats: 空 papers → 0/0/0', () => {
  const r = computeLibraryStats([], mkLib(), { now: NOW });
  assert.equal(r.paperCount, 0);
  assert.equal(r.avgRelevanceScore, 0);
  assert.equal(r.rawAvgScore, 0);
  assert.equal(r.recentCount, 0);
  assert.deepEqual(r.categoryDistribution, {});
  assert.deepEqual(r.topAuthors, []);
  assert.equal(r.oldestDate, null);
  assert.equal(r.newestDate, null);
});

test('stats: 单篇命中', () => {
  const r = computeLibraryStats([mkPaper()], mkLib(), { now: NOW });
  assert.equal(r.paperCount, 1);
});

test('stats: 不命中 tags → 不计入', () => {
  const r = computeLibraryStats(
    [mkPaper({ categories: { venue: [], task: [], method: [], type: [] } })],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.paperCount, 0);
});

test('stats: lib tags 多 → 任一命中即算', () => {
  const lib = mkLib({ tags: ['task:rl', 'task:reasoning'] });
  const r = computeLibraryStats(
    [mkPaper({ categories: { venue: [], task: ['reasoning'], method: [], type: [] } })],
    lib,
    { now: NOW },
  );
  assert.equal(r.paperCount, 1);
});

// ---------- score scale ---
test('stats: score 0..1 范围 → scale=1, avg 原样', () => {
  const r = computeLibraryStats(
    [mkPaper({ score: 0.5 }), mkPaper({ score: 0.8 })],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.scoreScale, 1);
  assert.equal(r.rawAvgScore, 0.65);
  assert.equal(r.avgRelevanceScore, 0.65); // 不归一
});

test('stats: score 0..10 范围 → scale=10, avg 归一到 0..1', () => {
  const r = computeLibraryStats(
    [mkPaper({ score: 7 }), mkPaper({ score: 9 })],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.scoreScale, 10);
  assert.equal(r.rawAvgScore, 8);
  assert.equal(r.avgRelevanceScore, 0.8);
});

test('stats: 混合 scale → 推断为 10(任何一个 >1)', () => {
  const r = computeLibraryStats(
    [mkPaper({ score: 0.5 }), mkPaper({ score: 8 })],
    mkLib(),
    { now: NOW },
  );
  // rawAvg = (0.5 + 8) / 2 = 4.25; 归一 4.25/10 = 0.425
  assert.equal(r.scoreScale, 10);
  assert.equal(r.rawAvgScore, 4.25);
  assert.equal(r.avgRelevanceScore, 0.425);
});

test('stats: score 字符串可解析', () => {
  const r = computeLibraryStats([mkPaper({ score: '0.6' })], mkLib(), { now: NOW });
  assert.equal(r.rawAvgScore, 0.6);
});

test('stats: score=null 跳过', () => {
  const r = computeLibraryStats([mkPaper({ score: null })], mkLib(), { now: NOW });
  assert.equal(r.rawAvgScore, 0);
  assert.equal(r.scoreScale, 1);
});

test('stats: score=undefined 跳过', () => {
  const r = computeLibraryStats([mkPaper({ score: undefined })], mkLib(), { now: NOW });
  assert.equal(r.rawAvgScore, 0);
});

test('stats: score=NaN 跳过', () => {
  const r = computeLibraryStats([mkPaper({ score: NaN })], mkLib(), { now: NOW });
  assert.equal(r.rawAvgScore, 0);
});

test('stats: score=Infinity 跳过', () => {
  const r = computeLibraryStats([mkPaper({ score: Infinity })], mkLib(), { now: NOW });
  assert.equal(r.rawAvgScore, 0);
});

test('stats: score 全 null → rawAvg=0', () => {
  const r = computeLibraryStats(
    [mkPaper({ score: null }), mkPaper({ score: undefined })],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.rawAvgScore, 0);
  assert.equal(r.paperCount, 2); // paperCount 不受 score 影响
});

// ---------- recentCount ---
test('stats: 30 天内 → 计入 recentCount', () => {
  // now = 2026-09-15, paper.date = '2026-09-01' → 14 天前 < 30 → recent
  const r = computeLibraryStats([mkPaper({ date: '2026-09-01' })], mkLib(), { now: NOW });
  assert.equal(r.recentCount, 1);
});

test('stats: 30 天前刚好 → 计入', () => {
  // cutoff = now - 30d; '2026-08-16' → diff = 30d → 刚好不在(< cut off 才算)
  // 实际 d >= cutoff: d = 2026-08-16, cutoff = 2026-08-16, equality 等
  // 注意 cutoff 是 now.getTime() - 30 * 24 * 60 * 60 * 1000(30 天整 ms)
  // '2026-08-16T00:00:00Z' = now - 30d 整
  const r = computeLibraryStats([mkPaper({ date: '2026-08-16' })], mkLib(), { now: NOW });
  assert.equal(r.recentCount, 1);
});

test('stats: 31 天前 → 不计入', () => {
  const r = computeLibraryStats([mkPaper({ date: '2026-08-15' })], mkLib(), { now: NOW });
  assert.equal(r.recentCount, 0);
});

test('stats: 自定义 recentDays', () => {
  const r = computeLibraryStats(
    [mkPaper({ date: '2026-09-10' })], // 5 天前
    mkLib(),
    { now: NOW, recentDays: 3 },
  );
  // 5 天前,不在 3 天内
  assert.equal(r.recentCount, 0);
});

test('stats: date 缺 → 不计入', () => {
  const r = computeLibraryStats([mkPaper({ date: '' })], mkLib(), { now: NOW });
  assert.equal(r.recentCount, 0);
});

test('stats: date 非法 → 不计入', () => {
  const r = computeLibraryStats([mkPaper({ date: '2026/09/01' })], mkLib(), { now: NOW });
  assert.equal(r.recentCount, 0);
});

// ---------- categoryDistribution ---
test('stats: cat 分布 → dim:label 计数', () => {
  const r = computeLibraryStats(
    [
      mkPaper({ categories: { venue: ['ICML'], task: ['rl'], method: [], type: [] } }),
      mkPaper({ categories: { venue: ['NeurIPS'], task: ['rl'], method: [], type: [] } }),
      mkPaper({ categories: { venue: ['ICML'], task: ['rl'], method: [], type: [] } }),
    ],
    mkLib({ tags: ['venue:ICML', 'venue:NeurIPS', 'task:rl'] }),
    { now: NOW },
  );
  assert.equal(r.categoryDistribution['venue:ICML'], 2);
  assert.equal(r.categoryDistribution['venue:NeurIPS'], 1);
  assert.equal(r.categoryDistribution['task:rl'], 3);
});

test('stats: cat 缺 categories → 空分布', () => {
  // categories=null → flattenTags → []; lib.tags = [] → 没有任何 t 命中
  // → selectPapers 选 0 篇 → paperCount=0
  const r = computeLibraryStats(
    [mkPaper({ categories: null })],
    mkLib({ tags: [] }),
    { now: NOW },
  );
  assert.equal(r.paperCount, 0);
  assert.deepEqual(r.categoryDistribution, {});
});

// ---------- topAuthors ---
test('stats: top 5 作者按频次排', () => {
  const r = computeLibraryStats(
    [
      mkPaper({ authors: ['Alice', 'Bob'] }),
      mkPaper({ authors: ['Alice', 'Charlie'] }),
      mkPaper({ authors: ['Alice', 'Dave'] }),
      mkPaper({ authors: ['Bob', 'Charlie'] }),
    ],
    mkLib(),
    { now: NOW },
  );
  // Alice: 3, Bob: 2, Charlie: 2, Dave: 1
  assert.equal(r.topAuthors[0], 'Alice');
  assert.ok(r.topAuthors.includes('Bob'));
  assert.ok(r.topAuthors.includes('Charlie'));
  // 只有 4 个不同作者,都在 top 5 内(只切前 5)
  assert.equal(r.topAuthors.length, 4);
});

test('stats: 作者切片到前 3', () => {
  // 每篇只取前 3 个作者
  const r = computeLibraryStats(
    [mkPaper({ authors: ['A', 'B', 'C', 'D', 'E'] })],
    mkLib(),
    { now: NOW },
  );
  assert.ok(r.topAuthors.includes('A'));
  assert.ok(r.topAuthors.includes('C'));
  assert.ok(!r.topAuthors.includes('E')); // 第 5 被切掉
});

test('stats: 空作者 → []', () => {
  const r = computeLibraryStats([mkPaper({ authors: [] })], mkLib(), { now: NOW });
  assert.deepEqual(r.topAuthors, []);
});

test('stats: 缺 authors 字段 → 不抛', () => {
  const r = computeLibraryStats([mkPaper({ authors: undefined })], mkLib(), { now: NOW });
  assert.deepEqual(r.topAuthors, []);
});

test('stats: 空字符串作者跳过', () => {
  const r = computeLibraryStats(
    [mkPaper({ authors: ['', 'Alice'] })],
    mkLib(),
    { now: NOW },
  );
  assert.deepEqual(r.topAuthors, ['Alice']);
});

// ---------- date range ---
test('stats: oldestDate/newestDate 排序', () => {
  const r = computeLibraryStats(
    [
      mkPaper({ date: '2026-08-01' }),
      mkPaper({ date: '2026-09-01' }),
      mkPaper({ date: '2026-07-15' }),
    ],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.oldestDate, '2026-07-15');
  assert.equal(r.newestDate, '2026-09-01');
});

test('stats: 非法 date 不计入 range', () => {
  const r = computeLibraryStats(
    [
      mkPaper({ date: '2026-08-01' }),
      mkPaper({ date: 'invalid' }),
      mkPaper({ date: '2026-09-01' }),
    ],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.oldestDate, '2026-08-01');
  assert.equal(r.newestDate, '2026-09-01');
});

test('stats: date 缺 → 不计入 range', () => {
  const r = computeLibraryStats(
    [
      mkPaper({ date: '2026-08-01' }),
      mkPaper({ date: undefined }),
    ],
    mkLib(),
    { now: NOW },
  );
  assert.equal(r.oldestDate, '2026-08-01');
});

// ---------- 集成 ---
test('集成: 完整 Library stats', () => {
  const r = computeLibraryStats(
    [
      mkPaper({
        date: '2026-09-10',
        score: 7,
        authors: ['Alice', 'Bob'],
        categories: { venue: ['ICML'], task: ['rl'], method: [], type: [] },
      }),
      mkPaper({
        date: '2026-08-01',
        score: 8,
        authors: ['Alice', 'Charlie'],
        categories: { venue: ['NeurIPS'], task: ['rl'], method: [], type: [] },
      }),
    ],
    mkLib({ tags: ['venue:ICML', 'venue:NeurIPS', 'task:rl'] }),
    { now: NOW },
  );
  assert.equal(r.paperCount, 2);
  assert.equal(r.scoreScale, 10);
  assert.equal(r.rawAvgScore, 7.5);
  assert.equal(r.avgRelevanceScore, 0.75);
  assert.equal(r.recentCount, 1); // 09-10 在 30 天内,08-01 不在
  assert.equal(r.topAuthors[0], 'Alice');
  assert.equal(r.oldestDate, '2026-08-01');
  assert.equal(r.newestDate, '2026-09-10');
});
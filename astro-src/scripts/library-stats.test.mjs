#!/usr/bin/env node
// astro-src/scripts/library-stats.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-stats.ts.
// computeLibraryStats — 纯函数,SSR 安全。

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
    external: ['node:*'],
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/library-stats.ts');
const { computeLibraryStats } = mod;

const lib = {
  id: 'rl',
  title: 'RL',
  titleZh: '强化学习',
  description: '',
  descriptionZh: '',
  tags: ['task:rl'],
  dimension: 'task',
  curator: '',
  hue: '',
};

const libMulti = {
  ...lib,
  id: 'multi',
  tags: ['task:rl', 'method:distillation'],
};

const paper = (overrides) => ({
  id: 'p1',
  date: '2026-09-10',
  score: 5,
  authors: ['Alice', 'Bob'],
  categories: { venue: [], task: ['rl'], method: [], type: [] },
  tags: [],
  ...overrides,
});

// ---------- paperCount ----------
test('computeLibraryStats: 空 papers', () => {
  const r = computeLibraryStats([], lib);
  assert.equal(r.paperCount, 0);
});

test('computeLibraryStats: 1 paper 命中', () => {
  const r = computeLibraryStats([paper()], lib);
  assert.equal(r.paperCount, 1);
});

test('computeLibraryStats: 命中过滤 — 无 tag 不计', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    paper({ id: 'b', categories: { venue: [], task: ['reasoning'], method: [], type: [] } }),
  ], lib);
  assert.equal(r.paperCount, 1);
});

test('computeLibraryStats: 多 tag lib 任一命中即入选', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', categories: { venue: [], task: [], method: ['distillation'], type: [] } }),
    paper({ id: 'b', categories: { venue: [], task: [], method: ['other'], type: [] } }),
  ], libMulti);
  assert.equal(r.paperCount, 1);
});

// ---------- avgRelevanceScore ----------
test('computeLibraryStats: score 0.5 (scale=1)', () => {
  const r = computeLibraryStats([paper({ score: 0.5 })], lib);
  assert.equal(r.scoreScale, 1);
  assert.equal(r.rawAvgScore, 0.5);
  assert.equal(r.avgRelevanceScore, 0.5);
});

test('computeLibraryStats: score 8 (scale=10 → 归一 0.8)', () => {
  const r = computeLibraryStats([paper({ score: 8 })], lib);
  assert.equal(r.scoreScale, 10);
  assert.equal(r.rawAvgScore, 8);
  assert.ok(Math.abs(r.avgRelevanceScore - 0.8) < 1e-9);
});

test('computeLibraryStats: score 1.5 → scale=10', () => {
  const r = computeLibraryStats([paper({ score: 1.5 })], lib);
  assert.equal(r.scoreScale, 10);
});

test('computeLibraryStats: score 1 → scale=1', () => {
  const r = computeLibraryStats([paper({ score: 1 })], lib);
  assert.equal(r.scoreScale, 1);
});

test('computeLibraryStats: 字符串 score 解析', () => {
  const r = computeLibraryStats([paper({ score: '7.5' })], lib);
  assert.equal(r.scoreScale, 10);
  assert.ok(Math.abs(r.rawAvgScore - 7.5) < 1e-9);
});

test('computeLibraryStats: score 字符串含字母 → skip', () => {
  const r = computeLibraryStats([paper({ score: 'abc' })], lib);
  assert.equal(r.rawAvgScore, 0);
});

test('computeLibraryStats: score null → skip', () => {
  const r = computeLibraryStats([paper({ score: null })], lib);
  assert.equal(r.rawAvgScore, 0);
});

test('computeLibraryStats: score undefined → skip', () => {
  const r = computeLibraryStats([paper({ score: undefined })], lib);
  assert.equal(r.rawAvgScore, 0);
});

test('computeLibraryStats: 多 papers score 平均', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', score: 4 }),
    paper({ id: 'b', score: 6 }),
  ], lib);
  // scale=10,rawAvg=5, normalized=0.5
  assert.equal(r.scoreScale, 10);
  assert.equal(r.rawAvgScore, 5);
  assert.ok(Math.abs(r.avgRelevanceScore - 0.5) < 1e-9);
});

test('computeLibraryStats: 混合 scale paper', () => {
  // 4 (scale=10) 和 0.5 (scale=1) 混合 → 任一 scale=10 → 全 scale=10
  const r = computeLibraryStats([
    paper({ id: 'a', score: 4 }),
    paper({ id: 'b', score: 0.5 }),
  ], lib);
  assert.equal(r.scoreScale, 10);
  // rawAvg = (4 + 0.5) / 2 = 2.25
  // 但 0.5 实际是 1-scale,被当作 0.5/1 在计算后比较
  // rawAvgScore 永远是 mean of input,这里 = 2.25
  // normalized = 2.25 / 10 = 0.225
  assert.ok(Math.abs(r.rawAvgScore - 2.25) < 1e-9);
});

// ---------- recentCount ----------
test('computeLibraryStats: 30 天内 → recent', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = computeLibraryStats([paper({ date: '2026-09-10' })], lib, { now });
  assert.equal(r.recentCount, 1);
});

test('computeLibraryStats: 30 天前 → NOT recent', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const r = computeLibraryStats([paper({ date: '2026-08-18' })], lib, { now });
  assert.equal(r.recentCount, 0);
});

test('computeLibraryStats: 无 date → NOT counted', () => {
  const r = computeLibraryStats([paper({ date: undefined })], lib);
  assert.equal(r.recentCount, 0);
});

test('computeLibraryStats: 自定义 recentDays=7 边界', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  // cutoff = now - 7d = 2026-09-10T12:00:00Z
  // paper date 2026-09-10T00:00:00Z < cutoff → NOT recent
  const r = computeLibraryStats([paper({ date: '2026-09-10' })], lib, { now, recentDays: 7 });
  assert.equal(r.recentCount, 0);
});

test('computeLibraryStats: 自定义 recentDays=8 边界包含', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  // cutoff = now - 8d = 2026-09-09T12:00:00Z
  // paper date 2026-09-10T00:00:00Z > cutoff → recent
  const r = computeLibraryStats([paper({ date: '2026-09-10' })], lib, { now, recentDays: 8 });
  assert.equal(r.recentCount, 1);
});

// ---------- categoryDistribution ----------
test('computeLibraryStats: categoryDistribution 累加', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    paper({ id: 'b', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    paper({ id: 'c', categories: { venue: [], task: ['reasoning'], method: [], type: [] } }),
  ], lib);
  assert.equal(r.categoryDistribution['task:rl'], 2);
  // 'reasoning' 不命中 lib → 不出现
  assert.equal(r.categoryDistribution['task:reasoning'], undefined);
});

test('computeLibraryStats: 4 dim 累加', () => {
  const r = computeLibraryStats([
    paper({ categories: { venue: ['ICML 2025'], task: ['rl'], method: ['distillation'], type: ['benchmark'] } }),
  ], lib);
  assert.equal(r.categoryDistribution['venue:ICML 2025'], 1);
  assert.equal(r.categoryDistribution['task:rl'], 1);
  assert.equal(r.categoryDistribution['method:distillation'], 1);
  assert.equal(r.categoryDistribution['type:benchmark'], 1);
});

test('computeLibraryStats: undefined category 不抛', () => {
  const r = computeLibraryStats([paper({ categories: undefined })], lib);
  assert.deepEqual(r.categoryDistribution, {});
});

// ---------- topAuthors ----------
test('computeLibraryStats: topAuthors 排序', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', authors: ['Alice', 'Bob'] }),
    paper({ id: 'b', authors: ['Alice', 'Charlie'] }),
    paper({ id: 'c', authors: ['Alice'] }),
  ], lib);
  // Alice=3, Bob=1, Charlie=1 → Alice, Bob/Charlie (顺序不定)
  assert.equal(r.topAuthors[0], 'Alice');
  assert.ok(r.topAuthors.length <= 5);
});

test('computeLibraryStats: topAuthors 限 5', () => {
  const r = computeLibraryStats([
    paper({
      id: 'p',
      authors: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
    }),
  ], lib);
  // 取前 3 个(per paper): a1, a2, a3
  assert.deepEqual(r.topAuthors.sort(), ['a1', 'a2', 'a3']);
});

test('computeLibraryStats: 空 authors → []', () => {
  const r = computeLibraryStats([paper({ authors: [] })], lib);
  assert.deepEqual(r.topAuthors, []);
});

test('computeLibraryStats: undefined authors → []', () => {
  const r = computeLibraryStats([paper({ authors: undefined })], lib);
  assert.deepEqual(r.topAuthors, []);
});

test('computeLibraryStats: 跳过空字符串作者', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', authors: ['', 'Alice'] }),
  ], lib);
  // 第一作者 '' 被跳过 → 只 Alice
  assert.deepEqual(r.topAuthors, ['Alice']);
});

// ---------- oldestDate / newestDate ----------
test('computeLibraryStats: 日期范围', () => {
  const r = computeLibraryStats([
    paper({ id: 'a', date: '2026-08-10' }),
    paper({ id: 'b', date: '2026-09-15' }),
    paper({ id: 'c', date: '2026-09-01' }),
  ], lib);
  assert.equal(r.oldestDate, '2026-08-10');
  assert.equal(r.newestDate, '2026-09-15');
});

test('computeLibraryStats: 无 date → null', () => {
  const r = computeLibraryStats([paper({ date: undefined })], lib);
  assert.equal(r.oldestDate, null);
  assert.equal(r.newestDate, null);
});

test('computeLibraryStats: 非法 date 跳过', () => {
  const r = computeLibraryStats([paper({ date: 'not-a-date' })], lib);
  assert.equal(r.oldestDate, null);
});

test('computeLibraryStats: 单 paper date', () => {
  const r = computeLibraryStats([paper({ date: '2026-09-10' })], lib);
  assert.equal(r.oldestDate, '2026-09-10');
  assert.equal(r.newestDate, '2026-09-10');
});

// ---------- 全空 ----------
test('computeLibraryStats: 空 lib 空 papers → 全 0/null', () => {
  const r = computeLibraryStats([], lib);
  assert.equal(r.paperCount, 0);
  assert.equal(r.avgRelevanceScore, 0);
  assert.equal(r.rawAvgScore, 0);
  assert.equal(r.scoreScale, 1);
  assert.equal(r.recentCount, 0);
  assert.deepEqual(r.categoryDistribution, {});
  assert.deepEqual(r.topAuthors, []);
  assert.equal(r.oldestDate, null);
  assert.equal(r.newestDate, null);
});
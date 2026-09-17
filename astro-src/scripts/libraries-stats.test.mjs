#!/usr/bin/env node
// astro-src/scripts/libraries-stats.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/stats.ts.
// computeLibraryStats (paperCount / uniqueAuthors / yearRange / topCategories)
// + getLibraryPapers。

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

const mod = await loadTs('lib/libraries/stats.ts');
const { computeLibraryStats, getLibraryPapers } = mod;

const mkLib = (overrides) => ({
  id: 'lib1',
  name: 'Test',
  tags: ['task:ml'],
  ...overrides,
});

const mkPaper = (overrides) => ({
  arxivId: 'p1',
  ...overrides,
});

// ---------- paperCount ----------
test('computeLibraryStats: paperCount = length', () => {
  const r = computeLibraryStats(mkLib(), [mkPaper(), mkPaper(), mkPaper()]);
  assert.equal(r.paperCount, 3);
});

test('computeLibraryStats: 空 papers → 0', () => {
  const r = computeLibraryStats(mkLib(), []);
  assert.equal(r.paperCount, 0);
});

// ---------- uniqueAuthors ----------
test('computeLibraryStats: uniqueAuthors 去重', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ authors: ['Alice', 'Bob'] }),
    mkPaper({ authors: ['Bob', 'Carol'] }),
  ]);
  assert.deepEqual(r.uniqueAuthors.sort(), ['Alice', 'Bob', 'Carol']);
});

test('computeLibraryStats: 缺 authors → []', () => {
  const r = computeLibraryStats(mkLib(), [mkPaper()]);
  assert.deepEqual(r.uniqueAuthors, []);
});

test('computeLibraryStats: 只取每篇前 3 作者', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ authors: ['A1', 'A2', 'A3', 'A4', 'A5'] }),
  ]);
  // 4, 5 不被收
  assert.ok(!r.uniqueAuthors.includes('A4'));
  assert.ok(!r.uniqueAuthors.includes('A5'));
});

test('computeLibraryStats: 空字符串作者被跳', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ authors: ['Alice', '', 'Bob'] }),
  ]);
  assert.ok(!r.uniqueAuthors.includes(''));
});

// ---------- yearRange ----------
test('computeLibraryStats: yearRange 从 date 抽', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ date: '2023-01-01' }),
    mkPaper({ date: '2025-06-01' }),
    mkPaper({ date: '2024-03-01' }),
  ]);
  assert.deepEqual(r.yearRange, [2023, 2025]);
});

test('computeLibraryStats: 无 date → [null, null]', () => {
  const r = computeLibraryStats(mkLib(), [mkPaper()]);
  assert.deepEqual(r.yearRange, [null, null]);
});

test('computeLibraryStats: 单一 date → 同年', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ date: '2024-05-01' }),
  ]);
  assert.deepEqual(r.yearRange, [2024, 2024]);
});

test('computeLibraryStats: 无效 date → 不计入', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ date: 'not-a-date' }),
    mkPaper({ date: '2024-01-01' }),
  ]);
  assert.deepEqual(r.yearRange, [2024, 2024]);
});

test('computeLibraryStats: date 用 ISO prefix', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ date: '2025-12-31T23:59:59Z' }),
  ]);
  assert.equal(r.yearRange[0], 2025);
});

// ---------- topCategories ----------
test('computeLibraryStats: topCategories dim:label', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ categories: { venue: ['NeurIPS'], task: ['classification'] } }),
  ]);
  const cat = r.topCategories.map((c) => c.cat);
  assert.ok(cat.includes('venue:NeurIPS'));
  assert.ok(cat.includes('task:classification'));
});

test('computeLibraryStats: count 累加', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ categories: { venue: ['NeurIPS'] } }),
    mkPaper({ categories: { venue: ['NeurIPS'] } }),
    mkPaper({ categories: { venue: ['ICML'] } }),
  ]);
  const neuron = r.topCategories.find((c) => c.cat === 'venue:NeurIPS');
  assert.equal(neuron.count, 2);
});

test('computeLibraryStats: 4 dim 都接受', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ categories: {
      venue: ['v'], task: ['t'], method: ['m'], type: ['ty'],
    } }),
  ]);
  const all = r.topCategories.map((c) => c.cat).sort();
  assert.ok(all.includes('venue:v'));
  assert.ok(all.includes('task:t'));
  assert.ok(all.includes('method:m'));
  assert.ok(all.includes('type:ty'));
});

test('computeLibraryStats: 缺 categories → 空', () => {
  const r = computeLibraryStats(mkLib(), [mkPaper()]);
  assert.deepEqual(r.topCategories, []);
});

test('computeLibraryStats: 顶层 slice 10', () => {
  // 构造 12 个不同 venue
  const papers = Array.from({ length: 12 }, (_, i) =>
    mkPaper({ categories: { venue: [`v${i}`] } })
  );
  const r = computeLibraryStats(mkLib(), papers);
  assert.equal(r.topCategories.length, 10);
});

test('computeLibraryStats: legacy query: tags 转为 task:', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ tags: ['query:llm'] }),
  ]);
  const cat = r.topCategories.find((c) => c.cat === 'task:llm');
  assert.ok(cat);
  assert.equal(cat.count, 1);
});

test('computeLibraryStats: 顶层 sort desc', () => {
  const r = computeLibraryStats(mkLib(), [
    mkPaper({ categories: { venue: ['a'] } }),
    mkPaper({ categories: { venue: ['a'] } }),
    mkPaper({ categories: { venue: ['a'] } }),
    mkPaper({ categories: { venue: ['b'] } }),
  ]);
  assert.ok(r.topCategories[0].count >= r.topCategories[1].count);
});

// ---------- getLibraryPapers ----------
test('getLibraryPapers: 按 library.tags 过滤', () => {
  const lib = mkLib({ tags: ['task:ml'] });
  const papers = [
    mkPaper({ tags: ['task:ml'] }),
    mkPaper({ tags: ['task:cv'] }),
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 1);
  assert.equal(r[0].tags[0], 'task:ml');
});

test('getLibraryPapers: categories 匹配', () => {
  const lib = mkLib({ tags: ['venue:NeurIPS'] });
  const papers = [
    mkPaper({ categories: { venue: ['NeurIPS'] } }),
    mkPaper({ categories: { venue: ['ICML'] } }),
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 1);
});

test('getLibraryPapers: 空 library.tags → 空', () => {
  const lib = mkLib({ tags: [] });
  const papers = [mkPaper({ tags: ['a'] })];
  const r = getLibraryPapers(papers, lib);
  assert.deepEqual(r, []);
});

test('getLibraryPapers: 多 tags 任一匹配', () => {
  const lib = mkLib({ tags: ['task:ml', 'task:cv'] });
  const papers = [
    mkPaper({ tags: ['task:ml'] }),
    mkPaper({ tags: ['task:cv'] }),
    mkPaper({ tags: ['task:nlp'] }),
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 2);
});

test('getLibraryPapers: 不修改原数组', () => {
  const lib = mkLib({ tags: ['task:ml'] });
  const papers = [mkPaper({ tags: ['task:ml'] })];
  getLibraryPapers(papers, lib);
  assert.equal(papers.length, 1);
});

// ---------- 集成 ---
test('集成: 完整 stats 流程', () => {
  const lib = mkLib();
  const papers = [
    mkPaper({
      date: '2024-01-01',
      authors: ['Alice', 'Bob'],
      categories: { venue: ['NeurIPS'], task: ['ml'] },
    }),
    mkPaper({
      date: '2025-06-01',
      authors: ['Bob', 'Carol'],
      categories: { venue: ['NeurIPS'] },
    }),
  ];
  const r = computeLibraryStats(lib, papers);
  assert.equal(r.paperCount, 2);
  assert.deepEqual(r.yearRange, [2024, 2025]);
  assert.equal(r.uniqueAuthors.length, 3);
  assert.ok(r.topCategories.length > 0);
});
#!/usr/bin/env node
// astro-src/scripts/library-stats.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/stats.ts.

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
    external: ['../libraries', './libraries'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/libraries/stats.ts');
const { computeLibraryStats, getLibraryPapers } = mod;

function mkLib(id, tags = []) {
  return { id, title: id, titleZh: id, description: '', descriptionZh: '', tags, dimension: 'task', curator: '', hue: '' };
}

function mkPaper(id, opts = {}) {
  return {
    arxivId: id,
    date: opts.date,
    authors: opts.authors,
    categories: opts.categories,
    tags: opts.tags,
  };
}

test('computeLibraryStats: 空论文 → 全空', () => {
  const r = computeLibraryStats(mkLib('rl'), []);
  assert.equal(r.paperCount, 0);
  assert.deepEqual(r.uniqueAuthors, []);
  assert.deepEqual(r.yearRange, [null, null]);
  assert.deepEqual(r.topCategories, []);
});

test('computeLibraryStats: paperCount = 论文数', () => {
  const papers = [mkPaper('p1'), mkPaper('p2'), mkPaper('p3')];
  const r = computeLibraryStats(mkLib('rl'), papers);
  assert.equal(r.paperCount, 3);
});

test('computeLibraryStats: unique authors 去重', () => {
  const papers = [
    mkPaper('p1', { authors: ['Alice', 'Bob'] }),
    mkPaper('p2', { authors: ['Alice', 'Carol'] }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  assert.equal(r.uniqueAuthors.length, 3);
  assert.ok(r.uniqueAuthors.includes('Alice'));
  assert.ok(r.uniqueAuthors.includes('Bob'));
  assert.ok(r.uniqueAuthors.includes('Carol'));
});

test('computeLibraryStats: 每篇只取前 3 个 author', () => {
  const papers = [
    mkPaper('p1', { authors: ['A', 'B', 'C', 'D', 'E'] }),
    mkPaper('p2', { authors: ['C', 'D'] }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  // p1 选 A,B,C; p2 选 C,D → 唯一 {A,B,C,D} = 4
  assert.equal(r.uniqueAuthors.length, 4);
  assert.ok(!r.uniqueAuthors.includes('E'));
});

test('computeLibraryStats: 空 author 跳过', () => {
  const papers = [
    mkPaper('p1', { authors: ['Alice', '', null] }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  assert.deepEqual(r.uniqueAuthors, ['Alice']);
});

test('computeLibraryStats: 缺 authors → []', () => {
  const r = computeLibraryStats(mkLib('rl'), [mkPaper('p1')]);
  assert.deepEqual(r.uniqueAuthors, []);
});

test('computeLibraryStats: yearRange 解析 date 头 4 位', () => {
  const papers = [
    mkPaper('p1', { date: '2022-05-01' }),
    mkPaper('p2', { date: '2024-01-15' }),
    mkPaper('p3', { date: '2023-08-01' }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  assert.deepEqual(r.yearRange, [2022, 2024]);
});

test('computeLibraryStats: 无 date → [null,null]', () => {
  const r = computeLibraryStats(mkLib('rl'), [mkPaper('p1')]);
  assert.deepEqual(r.yearRange, [null, null]);
});

test('computeLibraryStats: date 无效跳过', () => {
  const papers = [
    mkPaper('p1', { date: 'xxx-no-year' }),
    mkPaper('p2', { date: '2025-01-01' }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  assert.deepEqual(r.yearRange, [2025, 2025]);
});

test('computeLibraryStats: topCategories 用 dim:label 格式', () => {
  const papers = [
    mkPaper('p1', { categories: { task: ['rl'], method: ['td'] } }),
    mkPaper('p2', { categories: { task: ['rl'] } }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  const task_rl = r.topCategories.find((c) => c.cat === 'task:rl');
  const method_td = r.topCategories.find((c) => c.cat === 'method:td');
  assert.equal(task_rl.count, 2);
  assert.equal(method_td.count, 1);
});

test('computeLibraryStats: tags query:xxx → task:xxx 类别', () => {
  const papers = [
    mkPaper('p1', { tags: ['query:rl', 'venue:iclr'] }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  // query:rl → task:rl
  // venue:iclr 不以 query: 开头,不映射到 cat
  const task_rl = r.topCategories.find((c) => c.cat === 'task:rl');
  assert.ok(task_rl);
  assert.equal(task_rl.count, 1);
});

test('computeLibraryStats: topCategories 排序 desc + 截断 10', () => {
  const papers = Array.from({ length: 15 }, (_, i) =>
    mkPaper(`p${i}`, { categories: { task: ['rl'] } })
  );
  // 加一个 unique 的低频 category
  papers.push(mkPaper('px', { categories: { task: ['unique'] } }));
  const r = computeLibraryStats(mkLib('rl'), papers);
  assert.ok(r.topCategories.length <= 10);
  // rl category 出现 15 次 → 排序第一
  assert.equal(r.topCategories[0].cat, 'task:rl');
  assert.equal(r.topCategories[0].count, 15);
});

test('computeLibraryStats: 4 维度都收集(venue/task/method/type)', () => {
  const papers = [
    mkPaper('p1', { categories: { venue: ['iclr'], task: ['rl'], method: ['td'], type: ['survey'] } }),
  ];
  const r = computeLibraryStats(mkLib('rl'), papers);
  const cats = r.topCategories.map((c) => c.cat).sort();
  assert.ok(cats.includes('venue:iclr'));
  assert.ok(cats.includes('task:rl'));
  assert.ok(cats.includes('method:td'));
  assert.ok(cats.includes('type:survey'));
});

test('getLibraryPapers: 用 library.tags 匹配', () => {
  const lib = mkLib('rl', ['task:rl']);
  const papers = [
    mkPaper('p1', { categories: { task: ['rl'] } }),
    mkPaper('p2', { categories: { task: ['cv'] } }),
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, 'p1');
});

test('getLibraryPapers: 任一 tag 匹配即入选', () => {
  const lib = mkLib('multi', ['task:rl', 'method:td']);
  const papers = [
    mkPaper('p1', { categories: { method: ['td'] } }), // 匹配 method:td
    mkPaper('p2', { categories: { task: ['cv'] } }), // 不匹配
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 1);
});

test('getLibraryPapers: paper.tags 中 query:xxx → task:xxx 形式参与匹配', () => {
  const lib = mkLib('rl', ['task:rl']);
  const papers = [
    mkPaper('p1', { tags: ['query:rl'] }), // legacy → task:rl
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 1);
});

test('getLibraryPapers: paper.tags 不以 query: 开头按字面', () => {
  const lib = mkLib('foo', ['mytag']);
  const papers = [
    mkPaper('p1', { tags: ['mytag'] }),
    mkPaper('p2', { tags: ['other'] }),
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 1);
});

test('getLibraryPapers: 没有任何匹配 → []', () => {
  const lib = mkLib('rl', ['task:rl']);
  const papers = [
    mkPaper('p1', { categories: { task: ['cv'] } }),
  ];
  const r = getLibraryPapers(papers, lib);
  assert.equal(r.length, 0);
});
#!/usr/bin/env node
// astro-src/scripts/paper-relations-edges-util.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/edges-util.ts.
// buildNodes + topKEdges + tagSet.

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

const mod = await loadTs('lib/paper-relations/edges-util.ts');
const { buildNodes, topKEdges, tagSet } = mod;

const mkPaper = (overrides) => ({
  id: 'p1',
  arxivId: '2310.12345',
  title: 'Foo',
  title_zh: '',
  categories: { venue: [], task: [], method: [], type: [] },
  ...overrides,
});

// ---------- buildNodes ----------
test('buildNodes: 空数组', () => {
  assert.deepEqual(buildNodes([]), []);
});

test('buildNodes: 单 paper', () => {
  const r = buildNodes([mkPaper({ id: 'p1' })]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'p1');
  assert.equal(r[0].arxivId, '2310.12345');
  assert.equal(r[0].title, 'Foo');
});

test('buildNodes: 优先 title', () => {
  const r = buildNodes([mkPaper({ id: 'p1', title: 'English', title_zh: '中文' })]);
  assert.equal(r[0].title, 'English');
});

test('buildNodes: 无 title 用 title_zh', () => {
  const r = buildNodes([mkPaper({ id: 'p1', title: '', title_zh: '中文' })]);
  assert.equal(r[0].title, '中文');
});

test('buildNodes: 无 title/无 title_zh 用 id', () => {
  const r = buildNodes([mkPaper({ id: 'p1', title: '', title_zh: '' })]);
  assert.equal(r[0].title, 'p1');
});

test('buildNodes: tags 来自 flattenCategories', () => {
  const r = buildNodes([mkPaper({
    categories: { venue: ['ICML 2025'], task: ['rl'], method: [], type: [] },
  })]);
  assert.deepEqual(r[0].tags.sort(), ['task:rl', 'venue:ICML 2025']);
});

test('buildNodes: 无 categories → []', () => {
  const r = buildNodes([mkPaper({ categories: undefined })]);
  assert.deepEqual(r[0].tags, []);
});

// ---------- topKEdges ----------
const edge = (source, target, weight, type = 'jaccard', sharedTags = []) => ({
  source, target, weight, type, sharedTags,
});

test('topKEdges: k=0 → 原样', () => {
  const edges = [edge('a', 'b', 0.5)];
  assert.deepEqual(topKEdges(edges, 0), edges);
});

test('topKEdges: k 负 → 原样', () => {
  const edges = [edge('a', 'b', 0.5)];
  assert.deepEqual(topKEdges(edges, -1), edges);
});

test('topKEdges: k undefined → 原样', () => {
  const edges = [edge('a', 'b', 0.5)];
  assert.deepEqual(topKEdges(edges), edges);
});

test('topKEdges: 每 source 保留前 k 条 (按 weight 降序)', () => {
  const edges = [
    edge('a', 'b', 0.1),
    edge('a', 'c', 0.3),
    edge('a', 'd', 0.2),
    edge('a', 'e', 0.4),
  ];
  const r = topKEdges(edges, 2);
  // source a 保留 weight 最大的 2 条:0.4 (a→e), 0.3 (a→c)
  assert.equal(r.length, 2);
  assert.equal(r[0].target, 'e');
  assert.equal(r[1].target, 'c');
});

test('topKEdges: 多 source 独立裁剪', () => {
  const edges = [
    edge('a', 'b', 0.5),
    edge('a', 'c', 0.3),
    edge('x', 'b', 0.4),
    edge('x', 'c', 0.2),
  ];
  const r = topKEdges(edges, 1);
  // a: b (0.5), x: b (0.4)
  assert.equal(r.length, 2);
  assert.equal(r[0].target, 'b');
  assert.equal(r[0].source, 'a');
  assert.equal(r[1].source, 'x');
});

test('topKEdges: k > 边数 → 全留', () => {
  const edges = [edge('a', 'b', 0.5), edge('a', 'c', 0.3)];
  const r = topKEdges(edges, 5);
  assert.equal(r.length, 2);
});

test('topKEdges: 空数组', () => {
  assert.deepEqual(topKEdges([], 3), []);
});

test('topKEdges: 不修改输入', () => {
  const edges = [edge('a', 'b', 0.5), edge('a', 'c', 0.3)];
  const before = JSON.parse(JSON.stringify(edges));
  topKEdges(edges, 1);
  assert.deepEqual(edges, before);
});

// ---------- tagSet ----------
test('tagSet: 标准', () => {
  const r = tagSet(mkPaper({
    categories: { venue: ['ICML'], task: ['rl'], method: [], type: [] },
  }));
  assert.deepEqual([...r].sort(), ['task:rl', 'venue:ICML']);
});

test('tagSet: 去重 (flattenCategories 已去重)', () => {
  // categories 内 task: ['rl', 'rl'] → flattenCategories 去重
  const r = tagSet(mkPaper({
    categories: { venue: [], task: ['rl', 'rl'], method: [], type: [] },
  }));
  assert.deepEqual([...r], ['task:rl']);
});

test('tagSet: 空 categories → empty Set', () => {
  const r = tagSet(mkPaper({ categories: { venue: [], task: [], method: [], type: [] } }));
  assert.equal(r.size, 0);
});

test('tagSet: 返回 Set 不是 Array', () => {
  const r = tagSet(mkPaper({ categories: { venue: ['a'], task: [], method: [], type: [] } }));
  assert.ok(r instanceof Set);
});
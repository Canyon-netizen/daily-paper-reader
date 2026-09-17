#!/usr/bin/env node
// astro-src/scripts/paper-relations-jaccard.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/jaccard.ts.
// computeJaccardEdges — Jaccard 相似度 |A∩B|/|A∪B|。

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

const mod = await loadTs('lib/paper-relations/jaccard.ts');
const { computeJaccardEdges } = mod;

const mkPaper = (overrides) => ({
  id: 'p1',
  arxivId: '2310.12345',
  title: 'Foo',
  categories: { venue: [], task: [], method: [], type: [] },
  ...overrides,
});

// ---------- 基本 ----------
test('computeJaccardEdges: 0 paper → []', () => {
  assert.deepEqual(computeJaccardEdges([]), []);
});

test('computeJaccardEdges: 1 paper → []', () => {
  assert.deepEqual(computeJaccardEdges([mkPaper({ id: 'a', categories: { venue: ['ICML'], task: [], method: [], type: [] } })]), []);
});

test('computeJaccardEdges: 完全相同 → weight 1', () => {
  const cats = { venue: ['ICML'], task: ['rl'], method: [], type: [] };
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: cats }),
    mkPaper({ id: 'b', categories: cats }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 1);
  assert.equal(r[0].type, 'jaccard');
});

test('computeJaccardEdges: 完全不共享 → []', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: [], task: ['reasoning'], method: [], type: [] } }),
  ]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 部分共享 → jaccard = inter/union', () => {
  // a: {a, b}, b: {b, c}, c: {a, c}
  // a,b: inter=1, union=3 → 1/3
  const r = computeJaccardEdges([
    mkPaper({ id: 'p1', categories: { venue: ['a', 'b'], task: [], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: ['b', 'c'], task: [], method: [], type: [] } }),
  ]);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].weight - 1/3) < 1e-9);
});

test('computeJaccardEdges: 无向 — 只 i<j 一次', () => {
  const cats = { venue: ['ICML'], task: [], method: [], type: [] };
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: cats }),
    mkPaper({ id: 'b', categories: cats }),
  ]);
  // 无向图 → 1 条边(不是 2)
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'a');
  assert.equal(r[0].target, 'b');
});

test('computeJaccardEdges: sharedTags 透传 (含 dim 前缀)', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: ['x', 'y'], task: [], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: ['x', 'z'], task: [], method: [], type: [] } }),
  ]);
  // flattenCategories 输出 'venue:x','venue:y' → shared = ['venue:x']
  assert.deepEqual(r[0].sharedTags, ['venue:x']);
});

test('computeJaccardEdges: 3 papers → 3 edges', () => {
  // a,b,c 全共享 → 3 对 (ab, ac, bc)
  const cats = { venue: ['ICML'], task: [], method: [], type: [] };
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: cats }),
    mkPaper({ id: 'b', categories: cats }),
    mkPaper({ id: 'c', categories: cats }),
  ]);
  assert.equal(r.length, 3);
});

// ---------- 边界 ----------
test('computeJaccardEdges: 一方空标签 → 跳过', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: ['ICML'], task: [], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: [], task: [], method: [], type: [] } }),
  ]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 两方都空 → 跳过', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: [], task: [], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: [], task: [], method: [], type: [] } }),
  ]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 无 categories → 跳过', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: undefined }),
    mkPaper({ id: 'b', categories: undefined }),
  ]);
  assert.deepEqual(r, []);
});

// ---------- minWeight ----------
test('computeJaccardEdges: minWeight 过滤低权重', () => {
  // inter=1, union=3 → 0.33
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: ['a', 'b'], task: [], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: ['b', 'c'], task: [], method: [], type: [] } }),
  ], 0.5);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: minWeight 包含高权重', () => {
  const cats = { venue: ['x'], task: [], method: [], type: [] };
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: cats }),
    mkPaper({ id: 'b', categories: cats }),
  ], 0.5);
  // weight=1 ≥ 0.5
  assert.equal(r.length, 1);
});

test('computeJaccardEdges: minWeight=0 包含所有', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: ['a', 'b'], task: [], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: ['b', 'c'], task: [], method: [], type: [] } }),
  ], 0);
  assert.equal(r.length, 1);
});

// ---------- 跨 dim ----------
test('computeJaccardEdges: 跨 dim 共享也算', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: [], task: [], method: ['rl'], type: [] } }),
  ]);
  // 'task:rl' 与 'method:rl' 是不同 tag(flattenCategories 加 dim 前缀)→ 不共享
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 同 dim 共享 → 算', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'a', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'b', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 1);
});
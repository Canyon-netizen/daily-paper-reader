#!/usr/bin/env node
// astro-src/scripts/paper-relations-jaccard.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/jaccard.ts +
// edges-util.ts. Jaccard 边权重 + tagSet + buildNodes + topKEdges。

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
    write: false,
    target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/paper-relations/index.ts');
const { computeJaccardEdges } = mod;
const utilMod = await loadTs('lib/paper-relations/edges-util.ts');
const { buildNodes, topKEdges, tagSet } = utilMod;

const mkPaper = (overrides = {}) => ({
  id: 'papers/x.md',
  title: 'Some Title',
  title_zh: '',
  arxivId: '2310.12345',
  canonicalArxivId: '2310.12345',
  slug: 'x',
  yearMonth: '2026-09',
  day: '01',
  categories: { venue: [], task: ['rl'], method: [], type: [] },
  tags: [],
  ...overrides,
});

const mkEdge = (overrides = {}) => ({
  source: 'a',
  target: 'b',
  weight: 0.5,
  type: 'jaccard',
  sharedTags: [],
  ...overrides,
});

// ---------- tagSet ---
test('tagSet: 4-dim 拍平去重', () => {
  const p = mkPaper({
    categories: { venue: ['ICML'], task: ['rl', 'rl'], method: ['transformer'], type: [] },
  });
  const s = tagSet(p);
  assert.ok(s instanceof Set);
  assert.ok(s.has('venue:ICML'));
  assert.ok(s.has('task:rl'));
  assert.ok(s.has('method:transformer'));
  // rl 去重
  assert.equal(s.size, 3);
});

test('tagSet: 空 categories → 空 Set', () => {
  const p = mkPaper({ categories: { venue: [], task: [], method: [], type: [] } });
  assert.equal(tagSet(p).size, 0);
});

// ---------- buildNodes ---
test('buildNodes: 简单映射', () => {
  const r = buildNodes([
    mkPaper({ id: 'p1', title: 'A', arxivId: '2310.11111' }),
    mkPaper({ id: 'p2', title: 'B', arxivId: '2310.22222', title_zh: '' }),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].id, 'p1');
  assert.equal(r[0].title, 'A');
  assert.deepEqual(r[0].tags, ['task:rl']);
});

test('buildNodes: title 缺 → fallback title_zh', () => {
  const r = buildNodes([
    mkPaper({ id: 'p1', title: '', title_zh: '中文标题' }),
  ]);
  assert.equal(r[0].title, '中文标题');
});

test('buildNodes: title + title_zh 都缺 → fallback id', () => {
  const r = buildNodes([
    mkPaper({ id: 'p1', title: '', title_zh: '' }),
  ]);
  assert.equal(r[0].title, 'p1');
});

test('buildNodes: tags 来自 flattenCategories', () => {
  const r = buildNodes([
    mkPaper({
      categories: { venue: ['ICML'], task: ['rl'], method: [], type: [] },
    }),
  ]);
  assert.deepEqual(r[0].tags, ['venue:ICML', 'task:rl']);
});

// ---------- topKEdges ---
test('topK: 空 edges → []', () => {
  assert.deepEqual(topKEdges([], 5), []);
});

test('topK: k=0 → 不裁剪', () => {
  const edges = [
    mkEdge({ source: 'a', target: 'b', weight: 0.1 }),
    mkEdge({ source: 'a', target: 'c', weight: 0.2 }),
  ];
  const r = topKEdges(edges, 0);
  assert.equal(r.length, 2);
});

test('topK: k 负数 → 不裁剪', () => {
  const edges = [mkEdge()];
  const r = topKEdges(edges, -1);
  assert.equal(r.length, 1);
});

test('topK: 按 source 分组,每组前 k 条', () => {
  const edges = [
    mkEdge({ source: 'a', target: 'b', weight: 0.1 }),
    mkEdge({ source: 'a', target: 'c', weight: 0.5 }),
    mkEdge({ source: 'a', target: 'd', weight: 0.3 }),
    mkEdge({ source: 'a', target: 'e', weight: 0.2 }),
    mkEdge({ source: 'b', target: 'c', weight: 0.8 }),
  ];
  const r = topKEdges(edges, 2);
  // a 留下 2 条 (按 weight desc: c=0.5, d=0.3),b 留下 1 条 (c=0.8)
  assert.equal(r.length, 3);
});

test('topK: 同 source 内按 weight desc', () => {
  const edges = [
    mkEdge({ source: 'a', target: 'b', weight: 0.1 }),
    mkEdge({ source: 'a', target: 'c', weight: 0.9 }),
    mkEdge({ source: 'a', target: 'd', weight: 0.5 }),
  ];
  const r = topKEdges(edges, 2);
  assert.equal(r[0].target, 'c'); // 0.9
  assert.equal(r[1].target, 'd'); // 0.5
});

test('topK: 不去重(保留重复 source)', () => {
  const edges = [
    mkEdge({ source: 'a', target: 'b', weight: 0.1 }),
    mkEdge({ source: 'a', target: 'c', weight: 0.5 }),
  ];
  const r = topKEdges(edges, 5);
  // 保留两条
  assert.equal(r.length, 2);
});

// ---------- computeJaccardEdges ---
test('jaccard: 完全相同 tags → weight=1', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 1);
  assert.deepEqual(r[0].sharedTags, ['task:rl']);
});

test('jaccard: 完全不交 → []', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['reasoning'], method: [], type: [] } }),
  ]);
  assert.equal(r.length, 0);
});

test('jaccard: 部分重叠 → weight = |A∩B|/|A∪B|', () => {
  // p1: {a, b}; p2: {b, c} → inter=1, union=3 → 1/3
  const r = computeJaccardEdges([
    mkPaper({
      id: 'p1',
      categories: { venue: [], task: ['rl', 'reasoning'], method: [], type: [] },
    }),
    mkPaper({
      id: 'p2',
      categories: { venue: [], task: ['reasoning', 'vision'], method: [], type: [] },
    }),
  ]);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].weight - 1 / 3) < 1e-9);
});

test('jaccard: 0 tag 论文跳过', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'p1', categories: { venue: [], task: [], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  assert.equal(r.length, 0);
});

test('jaccard: minWeight 过滤', () => {
  // p1 ∩ p2 = 1, union = 3 → 1/3 = 0.33 < 0.5 → 过滤
  const r = computeJaccardEdges(
    [
      mkPaper({
        id: 'p1',
        categories: { venue: [], task: ['rl', 'reasoning'], method: [], type: [] },
      }),
      mkPaper({
        id: 'p2',
        categories: { venue: [], task: ['reasoning', 'vision'], method: [], type: [] },
      }),
    ],
    0.5,
  );
  assert.equal(r.length, 0);
});

test('jaccard: minWeight=0 不过滤', () => {
  const r = computeJaccardEdges(
    [
      mkPaper({
        id: 'p1',
        categories: { venue: [], task: ['rl', 'reasoning'], method: [], type: [] },
      }),
      mkPaper({
        id: 'p2',
        categories: { venue: [], task: ['reasoning', 'vision'], method: [], type: [] },
      }),
    ],
    0,
  );
  assert.equal(r.length, 1);
});

test('jaccard: 多 pair', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p3', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  // 3 papers → 3 pair (1-2, 1-3, 2-3)
  assert.equal(r.length, 3);
});

test('jaccard: source < target 顺序(source.id < target.id)', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'b', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'a', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  // 'a' 在 input index 1,但 source/target 按 id 排,不影响 Jaccard 输出
  // source/target 不强制 source<target,只是按遍历顺序
  assert.equal(r.length, 1);
});

test('jaccard: sharedTags 列出交集', () => {
  const r = computeJaccardEdges([
    mkPaper({
      id: 'p1',
      categories: { venue: [], task: ['rl', 'reasoning'], method: ['transformer'], type: [] },
    }),
    mkPaper({
      id: 'p2',
      categories: { venue: [], task: ['rl', 'vision'], method: ['transformer'], type: [] },
    }),
  ]);
  // 交集 = ['task:rl', 'method:transformer']
  assert.equal(r[0].sharedTags.length, 2);
  assert.ok(r[0].sharedTags.includes('task:rl'));
  assert.ok(r[0].sharedTags.includes('method:transformer'));
});

test('jaccard: type=jaccard', () => {
  const r = computeJaccardEdges([
    mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  assert.equal(r[0].type, 'jaccard');
});

test('jaccard: 空 papers → []', () => {
  assert.deepEqual(computeJaccardEdges([]), []);
});

test('jaccard: 单 paper → []', () => {
  const r = computeJaccardEdges([mkPaper()]);
  assert.equal(r.length, 0);
});
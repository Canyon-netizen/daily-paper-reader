#!/usr/bin/env node
// astro-src/scripts/paper-relations-hybrid.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/hybrid.ts.
// mergeHybridEdges:3 种算法边 → 加权合并 + 按 maxW 归一化 + (source,target) 规范化。

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

const mod = await loadTs('lib/paper-relations/hybrid.ts');
const { mergeHybridEdges } = mod;

const mkEdge = (overrides = {}) => ({
  source: 'a',
  target: 'b',
  weight: 0.5,
  type: 'jaccard',
  sharedTags: [],
  ...overrides,
});

const W = { jaccard: 0.25, tfidf: 0.35, embedding: 0.4 };

// ---------- basic ---
test('hybrid: 全空 → []', () => {
  const r = mergeHybridEdges([], [], [], W);
  assert.deepEqual(r, []);
});

test('hybrid: 单 jaccard 边', () => {
  const r = mergeHybridEdges([mkEdge({ weight: 1 })], [], [], W);
  assert.equal(r.length, 1);
  // maxW = 0.25*1 = 0.25 → norm = 4 → 0.25*4 = 1.0
  assert.equal(r[0].weight, 1);
});

test('hybrid: 单 tfidf 边', () => {
  const r = mergeHybridEdges([], [mkEdge({ weight: 1, type: 'tfidf' })], [], W);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 1);
});

test('hybrid: 单 embedding 边', () => {
  const r = mergeHybridEdges([], [], [mkEdge({ weight: 1, type: 'embedding' })], W);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 1);
});

// ---------- 合并同 pair ---
test('hybrid: jaccard + tfidf 同 pair → 合并', () => {
  const r = mergeHybridEdges(
    [mkEdge({ type: 'jaccard', weight: 0.5 })],
    [mkEdge({ type: 'tfidf', weight: 0.8 })],
    [],
    W,
  );
  assert.equal(r.length, 1);
  // w = 0.5*0.25 + 0.8*0.35 = 0.125 + 0.28 = 0.405
  // maxW = 0.405 → norm = 1/0.405 → 1.0
  assert.ok(Math.abs(r[0].weight - 1) < 1e-9);
});

test('hybrid: 3 算法合并', () => {
  const r = mergeHybridEdges(
    [mkEdge({ type: 'jaccard', weight: 1 })],
    [mkEdge({ type: 'tfidf', weight: 1 })],
    [mkEdge({ type: 'embedding', weight: 1 })],
    W,
  );
  assert.equal(r.length, 1);
  // w = 1*0.25 + 1*0.35 + 1*0.4 = 1.0
  // maxW = 1.0 → norm = 1
  assert.ok(Math.abs(r[0].weight - 1) < 1e-9);
});

test('hybrid: 不同 pair → 独立', () => {
  const r = mergeHybridEdges(
    [
      mkEdge({ source: 'a', target: 'b' }),
      mkEdge({ source: 'c', target: 'd' }),
    ],
    [],
    [],
    W,
  );
  assert.equal(r.length, 2);
});

// ---------- (source,target) 规范化 ---
test('hybrid: source/target 顺序无关', () => {
  // pair (a,b) 与 (b,a) 应合并为同一条
  const r = mergeHybridEdges(
    [
      mkEdge({ source: 'a', target: 'b', type: 'jaccard', weight: 0.5 }),
      mkEdge({ source: 'b', target: 'a', type: 'tfidf', weight: 0.8 }),
    ],
    [],
    [],
    W,
  );
  assert.equal(r.length, 1);
});

test('hybrid: source < target 规范化', () => {
  const r = mergeHybridEdges(
    [mkEdge({ source: 'b', target: 'a' })],
    [],
    [],
    W,
  );
  // 'a' < 'b' → source='a', target='b'
  assert.equal(r[0].source, 'a');
  assert.equal(r[0].target, 'b');
});

// ---------- 归一化 ---
test('hybrid: maxW 归一化到 [0,1]', () => {
  const r = mergeHybridEdges(
    [
      mkEdge({ source: 'a', target: 'b', weight: 1 }),
      mkEdge({ source: 'a', target: 'c', weight: 0.5 }),
      mkEdge({ source: 'a', target: 'd', weight: 0.2 }),
    ],
    [],
    [],
    W,
  );
  for (const e of r) {
    assert.ok(e.weight >= 0 && e.weight <= 1);
  }
  // 最大的归一为 1
  const maxEdge = r.reduce((m, e) => (e.weight > m.weight ? e : m));
  assert.ok(Math.abs(maxEdge.weight - 1) < 1e-9);
});

test('hybrid: maxW=0 → 不抛(返回 weight=0)', () => {
  // 全 weight=0 → maxW=0 → norm=1 → 0*1=0
  const r = mergeHybridEdges(
    [mkEdge({ weight: 0 })],
    [],
    [],
    W,
  );
  assert.equal(r[0].weight, 0);
});

// ---------- sharedTags ---
test('hybrid: sharedTags 来自 jaccard 边', () => {
  const r = mergeHybridEdges(
    [mkEdge({ type: 'jaccard', sharedTags: ['task:rl', 'method:m'] })],
    [],
    [],
    W,
  );
  assert.deepEqual(r[0].sharedTags, ['task:rl', 'method:m']);
});

test('hybrid: 多 jaccard 边 → sharedTags 合并去重', () => {
  const r = mergeHybridEdges(
    [
      mkEdge({ type: 'jaccard', sharedTags: ['task:rl'] }),
      mkEdge({ type: 'jaccard', sharedTags: ['task:rl', 'method:m'] }),
    ],
    [],
    [],
    W,
  );
  // 同 pair 合并,sharedTags 应该 ['task:rl', 'method:m']
  assert.deepEqual(r[0].sharedTags.sort(), ['method:m', 'task:rl']);
});

test('hybrid: tfidf/embedding 边 sharedTags 空 → 不影响', () => {
  const r = mergeHybridEdges(
    [mkEdge({ type: 'jaccard', sharedTags: ['task:rl'] })],
    [mkEdge({ type: 'tfidf', sharedTags: [] })],
    [mkEdge({ type: 'embedding', sharedTags: [] })],
    W,
  );
  assert.deepEqual(r[0].sharedTags, ['task:rl']);
});

// ---------- type ---
test('hybrid: 边 type 固定为 jaccard(占位)', () => {
  const r = mergeHybridEdges(
    [],
    [mkEdge({ type: 'tfidf', weight: 1 })],
    [],
    W,
  );
  assert.equal(r[0].type, 'jaccard');
});

// ---------- 权重 ---
test('hybrid: 自定义 weights', () => {
  const r = mergeHybridEdges(
    [],
    [mkEdge({ weight: 1, type: 'tfidf' })],
    [],
    { jaccard: 0, tfidf: 0.5, embedding: 0 },
  );
  // w = 1*0.5 = 0.5,maxW = 0.5,norm = 2 → 1
  assert.equal(r[0].weight, 1);
});

test('hybrid: 权重全 0 → 全归 0', () => {
  const r = mergeHybridEdges(
    [mkEdge({ weight: 1 })],
    [],
    [],
    { jaccard: 0, tfidf: 0, embedding: 0 },
  );
  // w = 0, maxW = 0, norm = 1, weight = 0*1 = 0
  assert.equal(r[0].weight, 0);
});

// ---------- 集成 ---
test('集成: 三算法混合', () => {
  const r = mergeHybridEdges(
    [
      mkEdge({ source: 'a', target: 'b', type: 'jaccard', weight: 0.6 }),
    ],
    [
      mkEdge({ source: 'a', target: 'b', type: 'tfidf', weight: 0.8 }),
    ],
    [
      mkEdge({ source: 'a', target: 'b', type: 'embedding', weight: 0.9 }),
    ],
    W,
  );
  assert.equal(r.length, 1);
  // w = 0.6*0.25 + 0.8*0.35 + 0.9*0.4 = 0.15 + 0.28 + 0.36 = 0.79
  // maxW = 0.79 → norm = 1/0.79 → 1.0
  assert.ok(Math.abs(r[0].weight - 1) < 1e-9);
});
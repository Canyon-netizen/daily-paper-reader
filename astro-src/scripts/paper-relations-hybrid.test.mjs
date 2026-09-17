#!/usr/bin/env node
// astro-src/scripts/paper-relations-hybrid.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/hybrid.ts mergeHybridEdges.

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

const mod = await loadTs('lib/paper-relations/hybrid.ts');
const { mergeHybridEdges } = mod;

const edge = (source, target, weight, type = 'jaccard', sharedTags = []) => ({
  source, target, weight, type, sharedTags,
});

// ---------- mergeHybridEdges ----------
test('mergeHybridEdges: 3 个空数组 → []', () => {
  const r = mergeHybridEdges([], [], [], { jaccard: 1, tfidf: 1, embedding: 1 });
  assert.deepEqual(r, []);
});

test('mergeHybridEdges: 单 jaccard 边 → 1 条边', () => {
  const r = mergeHybridEdges(
    [edge('a', 'b', 0.5, 'jaccard', ['t1'])],
    [], [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'a');
  assert.equal(r[0].target, 'b');
});

test('mergeHybridEdges: 边方向无关 (source<target 规范化)', () => {
  // 'b' < 'a' 时 source='b', target='a'
  const r = mergeHybridEdges(
    [edge('b', 'a', 0.5, 'jaccard')],
    [], [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  assert.equal(r[0].source, 'a');
  assert.equal(r[0].target, 'b');
});

test('mergeHybridEdges: 同 (source,target) 跨算法合并权重', () => {
  const r = mergeHybridEdges(
    [edge('a', 'b', 0.5, 'jaccard')],
    [edge('a', 'b', 0.4, 'tfidf')],
    [edge('a', 'b', 0.3, 'embedding')],
    { jaccard: 0.25, tfidf: 0.35, embedding: 0.4 },
  );
  assert.equal(r.length, 1);
  // weight = 0.5*0.25 + 0.4*0.35 + 0.3*0.4 = 0.125 + 0.14 + 0.12 = 0.385
  // maxW = 0.385, norm = 1/0.385 → weight = 1.0
  assert.ok(Math.abs(r[0].weight - 1) < 1e-9);
});

test('mergeHybridEdges: 同 key 双向 (a→b 与 b→a) 合并', () => {
  const r = mergeHybridEdges(
    [edge('a', 'b', 0.5, 'jaccard')],
    [edge('b', 'a', 0.3, 'tfidf')],
    [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  assert.equal(r.length, 1);
});

test('mergeHybridEdges: 权重归一化到 [0,1]', () => {
  const r = mergeHybridEdges(
    [edge('a', 'b', 0.5, 'jaccard')],
    [edge('c', 'd', 0.3, 'tfidf')],
    [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  // 两条边权重分别为 0.5 和 0.3
  // maxW = 0.5 → norm = 2 → 第二条归一化为 0.6
  for (const e of r) {
    assert.ok(e.weight >= 0 && e.weight <= 1);
  }
  // 最大权重的边归一化后 = 1
  const max = Math.max(...r.map((e) => e.weight));
  assert.equal(max, 1);
});

test('mergeHybridEdges: sharedTags 仅从 jaccard 边累加', () => {
  const r = mergeHybridEdges(
    [edge('a', 'b', 0.5, 'jaccard', ['t1', 't2'])],
    [edge('a', 'b', 0.4, 'tfidf', ['should-not-include'])],
    [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  assert.deepEqual(r[0].sharedTags.sort(), ['t1', 't2']);
});

test('mergeHybridEdges: sharedTags 去重', () => {
  const r = mergeHybridEdges(
    [
      edge('a', 'b', 0.5, 'jaccard', ['t1', 't2']),
      edge('a', 'b', 0.3, 'jaccard', ['t2', 't3']),
    ],
    [], [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  assert.deepEqual(r[0].sharedTags.sort(), ['t1', 't2', 't3']);
});

test('mergeHybridEdges: type 占位 = jaccard (hybrid 边无单类型)', () => {
  const r = mergeHybridEdges([], [], [edge('a', 'b', 0.5, 'embedding')], { jaccard: 1, tfidf: 1, embedding: 1 });
  assert.equal(r[0].type, 'jaccard');
});

test('mergeHybridEdges: 自环 (source===target)', () => {
  // source < target 总会规范化 → 同 key,合并权重
  const r = mergeHybridEdges(
    [edge('a', 'a', 0.5, 'jaccard')],
    [],
    [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  // 'a' < 'a' → false → source='a', target='a'
  assert.equal(r.length, 1);
});

test('mergeHybridEdges: maxW=0 → 归一化系数 = 1', () => {
  // 所有权重 0 → maxW = 0 → norm = 1
  const r = mergeHybridEdges(
    [edge('a', 'b', 0, 'jaccard')],
    [], [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  // weight = 0 * 1 = 0
  assert.equal(r[0].weight, 0);
});

test('mergeHybridEdges: 不同 key 独立', () => {
  const r = mergeHybridEdges(
    [edge('a', 'b', 0.5, 'jaccard'), edge('c', 'd', 0.3, 'jaccard')],
    [], [],
    { jaccard: 1, tfidf: 1, embedding: 1 },
  );
  assert.equal(r.length, 2);
  // maxW = 0.5 → 第二条归一化 0.6
  const cd = r.find((e) => e.source === 'c' || e.target === 'c');
  assert.equal(cd.weight, 0.6);
});

test('mergeHybridEdges: 不修改输入边数组', () => {
  const j = [edge('a', 'b', 0.5, 'jaccard', ['t1'])];
  const before = JSON.parse(JSON.stringify(j));
  mergeHybridEdges(j, [], [], { jaccard: 1, tfidf: 1, embedding: 1 });
  assert.deepEqual(j, before);
});
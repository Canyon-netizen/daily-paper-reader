#!/usr/bin/env node
// astro-src/scripts/paper-relations-jaccard.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/jaccard.ts.
//
// 备注:edges-util.ts 链上 flattenCategories (lib/paper.ts) 而 paper.ts 是
// orchestrator+disk,esbuild bundling 会拉进 paper-disk.mjs (node:fs/promises)
// 触发解析失败,数据 URL 也不能再 import 相对路径。inline 是唯一可行路径。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- inline flattenCategories (lib/paper.ts:383,纯函数) -----------------
function flattenCategories(c) {
  if (!c) return [];
  const out = [];
  const seen = new Set();
  for (const dim of ['venue', 'task', 'method', 'type']) {
    for (const label of c[dim] || []) {
      const k = `${dim}:${label}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

// --- inline tagSet (lib/paper-relations/edges-util.ts) -----------------
function tagSet(p) {
  return new Set(flattenCategories(p.categories));
}

// --- inline computeJaccardEdges (lib/paper-relations/jaccard.ts) ---------
function computeJaccardEdges(papers, minWeight = 0) {
  const tagSets = papers.map(tagSet);
  const out = [];
  for (let i = 0; i < papers.length; i++) {
    const Ai = tagSets[i];
    if (Ai.size === 0) continue;
    for (let j = i + 1; j < papers.length; j++) {
      const Aj = tagSets[j];
      if (Aj.size === 0) continue;
      let inter = 0;
      const shared = [];
      for (const t of Ai) {
        if (Aj.has(t)) {
          inter++;
          shared.push(t);
        }
      }
      if (inter === 0) continue;
      const union = Ai.size + Aj.size - inter;
      const w = inter / union;
      if (w < minWeight) continue;
      out.push({
        source: papers[i].id,
        target: papers[j].id,
        weight: w,
        type: 'jaccard',
        sharedTags: shared,
      });
    }
  }
  return out;
}

test('flattenCategories: 空 → []', () => {
  assert.deepEqual(flattenCategories(undefined), []);
  assert.deepEqual(flattenCategories(null), []);
});

test('flattenCategories: 4 dim 都生效,带前缀', () => {
  const r = flattenCategories({
    venue: ['ICML'],
    task: ['rl'],
    method: ['ppo'],
    type: ['benchmark'],
  });
  assert.deepEqual(r.sort(), ['method:ppo', 'task:rl', 'type:benchmark', 'venue:ICML']);
});

test('flattenCategories: 同 label 跨 dim 不去重', () => {
  // venue:rl vs task:rl 是不同的
  const r = flattenCategories({ venue: ['rl'], task: ['rl'] });
  assert.equal(r.length, 2);
});

test('flattenCategories: 同 dim 同 label 去重', () => {
  const r = flattenCategories({ task: ['rl', 'rl'] });
  assert.deepEqual(r, ['task:rl']);
});

test('flattenCategories: 缺失 dim 跳过', () => {
  const r = flattenCategories({ task: ['rl'] });
  assert.deepEqual(r, ['task:rl']);
});

test('computeJaccardEdges: 空 → []', () => {
  assert.deepEqual(computeJaccardEdges([]), []);
});

test('computeJaccardEdges: 0 tag papers 跳过', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: null },
    { id: 'p2', categories: null },
  ]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 单 paper → 无边', () => {
  const r = computeJaccardEdges([{ id: 'p1', categories: { task: ['rl'] } }]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 完全相同 tags → weight=1', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'] } },
    { id: 'p2', categories: { task: ['rl'] } },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 1);
  assert.deepEqual(r[0].sharedTags, ['task:rl']);
});

test('computeJaccardEdges: 完全不重叠 → 无边', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'] } },
    { id: 'p2', categories: { task: ['cv'] } },
  ]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: 部分重叠 weight 计算', () => {
  // A = {task:rl, method:ppo} size 2
  // B = {task:rl, method:cv} size 2
  // ∩ = {task:rl} size 1
  // ∪ = 3
  // w = 1/3
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'], method: ['ppo'] } },
    { id: 'p2', categories: { task: ['rl'], method: ['cv'] } },
  ]);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].weight - 1/3) < 1e-9);
  assert.deepEqual(r[0].sharedTags, ['task:rl']);
});

test('computeJaccardEdges: source/target 按 list 顺序', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'] } },
    { id: 'p2', categories: { task: ['rl'] } },
  ]);
  assert.equal(r[0].source, 'p1');
  assert.equal(r[0].target, 'p2');
});

test('computeJaccardEdges: 无向 (i<j 不重复)', () => {
  const r = computeJaccardEdges([
    { id: 'a', categories: { task: ['rl'] } },
    { id: 'b', categories: { task: ['rl'] } },
    { id: 'c', categories: { task: ['rl'] } },
  ]);
  // 3 papers, 3 choose 2 = 3 pairs
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(e => [e.source, e.target].sort()).map(p => p.join('-')).sort(),
    ['a-b', 'a-c', 'b-c']);
});

test('computeJaccardEdges: minWeight 阈值', () => {
  // 1/3 < 0.5 → 过滤掉
  const r = computeJaccardEdges(
    [
      { id: 'p1', categories: { task: ['rl'], method: ['ppo'] } },
      { id: 'p2', categories: { task: ['rl'], method: ['cv'] } },
    ],
    0.5,
  );
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: minWeight=0 包含所有非零', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'] } },
    { id: 'p2', categories: { task: ['rl'] } },
  ], 0);
  assert.equal(r.length, 1);
});

test('computeJaccardEdges: type=jaccard 标记', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'] } },
    { id: 'p2', categories: { task: ['rl'] } },
  ]);
  assert.equal(r[0].type, 'jaccard');
});

test('computeJaccardEdges: 多 dim 都贡献 sharedTags', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'], method: ['ppo'], venue: ['ICML'] } },
    { id: 'p2', categories: { task: ['rl'], method: ['ppo'], venue: ['ICML'] } },
  ]);
  assert.equal(r[0].sharedTags.length, 3);
});

test('computeJaccardEdges: 4 dim 全交 weight=1', () => {
  const cats = { task: ['rl'], method: ['ppo'], venue: ['ICML'], type: ['bench'] };
  const r = computeJaccardEdges([
    { id: 'p1', categories: cats },
    { id: 'p2', categories: cats },
  ]);
  assert.equal(r[0].weight, 1);
  assert.equal(r[0].sharedTags.length, 4);
});

test('computeJaccardEdges: categories undefined → 0 tags', () => {
  const r = computeJaccardEdges([
    { id: 'p1' },
    { id: 'p2' },
  ]);
  assert.deepEqual(r, []);
});

test('computeJaccardEdges: minWeight=0.5 临界 (weight=1 通过)', () => {
  const r = computeJaccardEdges([
    { id: 'p1', categories: { task: ['rl'] } },
    { id: 'p2', categories: { task: ['rl'] } },
  ], 0.5);
  assert.equal(r.length, 1);
});

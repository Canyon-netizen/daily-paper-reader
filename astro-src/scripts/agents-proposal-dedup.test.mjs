#!/usr/bin/env node
// astro-src/scripts/agents-proposal-dedup.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/proposal-dedup.ts.
// dedupeProposals (Jaccard 相似度 + 默认 0.8 threshold,保留首次出现)。

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

const mod = await loadTs('lib/agents/proposal-dedup.ts');
const { dedupeProposals } = mod;

const mkP = (id, title) => ({ id, title });

// ---------- 基本流程 ---
test('dedupeProposals: 空数组 → []', () => {
  assert.deepEqual(dedupeProposals([]), []);
});

test('dedupeProposals: 单元素 → [单]', () => {
  const r = dedupeProposals([mkP('a', 'T')]);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 不同 proposal 全部保留', () => {
  const r = dedupeProposals([
    mkP('a', 'apple'),
    mkP('b', 'banana'),
    mkP('c', 'cherry'),
  ]);
  assert.equal(r.length, 3);
});

test('dedupeProposals: 完全相同 → 保留首次', () => {
  const r = dedupeProposals([
    mkP('a', 'machine learning'),
    mkP('b', 'machine learning'),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'a');
});

// ---------- Jaccard 阈值 ---
test('dedupeProposals: 默认 threshold=0.8', () => {
  // 'foo bar' 和 'foo baz' 共享 1/3 → 0.333 < 0.8 → 保留
  const r = dedupeProposals([
    mkP('a', 'foo bar'),
    mkP('b', 'foo baz'),
  ]);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 高阈值 0.99 不去重', () => {
  const r = dedupeProposals([
    mkP('a', 'alpha beta'),
    mkP('b', 'alpha beta gamma'), // 2/3 = 0.667
  ], 0.99);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 低阈值 0.5 去重更多', () => {
  const r = dedupeProposals([
    mkP('a', 'foo bar'),
    mkP('b', 'foo bar baz'), // 2/3 = 0.667
  ], 0.5);
  assert.equal(r.length, 1);
});

test('dedupeProposals: threshold=1.0 完全相同才去重', () => {
  const r = dedupeProposals([
    mkP('a', 'foo bar'),
    mkP('b', 'foo bar baz'),
  ], 1.0);
  assert.equal(r.length, 2);
});

test('dedupeProposals: threshold=0 完全不查重', () => {
  const r = dedupeProposals([
    mkP('a', 'foo'),
    mkP('b', 'foo'),
  ], 0);
  // threshold=0: 'jaccard >= 0' 永远 true → 都视为重复,只留首个
  // 实际:0 也会触发 dedupe (>= 0 是 true)
  assert.equal(r.length, 1);
});

// ---------- 大小写 ---
test('dedupeProposals: 大小写归一化', () => {
  const r = dedupeProposals([
    mkP('a', 'Machine Learning'),
    mkP('b', 'machine learning'),
  ]);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 标点不影响', () => {
  const r = dedupeProposals([
    mkP('a', 'foo, bar!'),
    mkP('b', 'foo bar'),
  ]);
  // 标点 → 'foo bar' 共享
  assert.equal(r.length, 1);
});

// ---------- 链式去重 ---
test('dedupeProposals: 链式 (A 跟 B 重, B 跟 C 重 → 都去重)', () => {
  const r = dedupeProposals([
    mkP('a', 'foo bar'),
    mkP('b', 'foo bar baz'), // jaccard with a = 2/3 = 0.667 < 0.8
    mkP('c', 'foo bar qux'), // jaccard with a = 2/3 = 0.667 < 0.8
  ]);
  // 默认 0.8 阈值下不视重复 → 全留
  assert.equal(r.length, 3);
});

test('dedupeProposals: 链式 (阈值 0.5 → B 重于 A, C 重于 A 也重)', () => {
  const r = dedupeProposals([
    mkP('a', 'foo bar'),
    mkP('b', 'foo bar baz'),
    mkP('c', 'foo bar qux'),
  ], 0.5);
  // 'foo bar' 和 'foo bar baz' 共享 2/3 = 0.667 ≥ 0.5 → B 是 A 的 dup
  // 'foo bar' 和 'foo bar qux' 共享 2/3 ≥ 0.5 → C 是 A 的 dup
  assert.equal(r.length, 1);
});

// ---------- 边界 ---
test('dedupeProposals: 空 title → Set 空', () => {
  const r = dedupeProposals([
    mkP('a', ''),
    mkP('b', ''),
  ]);
  // 两边 Set 都空 → jaccard = 0 (size=0 && size=0 → return 0)
  // 0 < 0.8 → 不视重复
  assert.equal(r.length, 2);
});

test('dedupeProposals: 单字符 title', () => {
  const r = dedupeProposals([
    mkP('a', 'a'),
    mkP('b', 'a'),
  ]);
  assert.equal(r.length, 1);
});

// ---------- 返回新数组 ---
test('dedupeProposals: 返回新数组', () => {
  const orig = [mkP('a', 'foo'), mkP('b', 'bar')];
  const r = dedupeProposals(orig);
  assert.notEqual(r, orig);
});

test('dedupeProposals: 不修改原数组', () => {
  const orig = [
    mkP('a', 'machine learning'),
    mkP('b', 'machine learning'),
  ];
  dedupeProposals(orig);
  assert.equal(orig.length, 2);
});

// ---------- 集成 ---
test('dedupeProposals: 混合', () => {
  const r = dedupeProposals([
    mkP('1', 'transformer attention'),
    mkP('2', 'transformer attention mechanism'), // J=2/3=0.667 < 0.8 → 保留
    mkP('3', 'CNN convolution'),
    mkP('4', 'cnn convolution'), // J=1.0 with #3 → dup, 跳过
    mkP('5', 'GAN generation'),
  ]);
  // 结果:1, 2, 3, 5 (4 被 #3 dedupe)
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((p) => p.id), ['1', '2', '3', '5']);
});
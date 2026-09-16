#!/usr/bin/env node
// astro-src/scripts/concept-dedup.test.mjs
//
// Tests for R7 G.1.2 concept dedup.

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

const mod = await loadTs('lib/concepts/dedup.ts');
const {
  labelSimilarity,
  dedupBySlug,
  dedupByFuzzy,
  dedupConcepts,
} = mod;

// ----- labelSimilarity -----

test('labelSimilarity: 完全相同 → 1', () => {
  assert.equal(labelSimilarity('reinforcement learning', 'reinforcement learning'), 1);
});

test('labelSimilarity: 完全无关 → 接近 0', () => {
  const s = labelSimilarity('foo bar', 'baz qux');
  assert.ok(s < 0.3);
});

test('labelSimilarity: 中英混合部分相似', () => {
  const s = labelSimilarity('transformer 架构', 'transformer architecture');
  assert.ok(s > 0.35);
});

test('labelSimilarity: 中文 label 大致相似', () => {
  const s = labelSimilarity('强化学习', '强化学习算法');
  assert.ok(s > 0.5);
});

// ----- dedupBySlug -----

test('dedupBySlug: 同 slug 合并,label 取最长', () => {
  const r = dedupBySlug([
    { slug: 'rl', label: 'RL', sourceStage: 1, confidence: 0.5 },
    { slug: 'rl', label: 'Reinforcement Learning', sourceStage: 2, confidence: 0.9 },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].label, 'Reinforcement Learning');
  assert.equal(r[0].confidence, 0.9);
});

test('dedupBySlug: 不同 slug 不合并', () => {
  const r = dedupBySlug([
    { slug: 'rl', label: 'RL', sourceStage: 1, confidence: 0.5 },
    { slug: 'cv', label: 'CV', sourceStage: 1, confidence: 0.5 },
  ]);
  assert.equal(r.length, 2);
});

test('dedupBySlug: parent 取非空第一个', () => {
  const r = dedupBySlug([
    { slug: 'x', label: 'X', sourceStage: 1, confidence: 0.5 },  // no parent
    { slug: 'x', label: 'X', parent: 'p', sourceStage: 2, confidence: 0.5 },
  ]);
  // 第一个有 label=X 但 parent=undefined,第二个有 parent=p
  // 两者都进入 dedup;具体哪个 parent 取谁的要看顺序
  // 这里验证:最终 parent 是 'p'(被设置的那个)
  assert.equal(r[0].parent, 'p');
});

// ----- dedupByFuzzy -----

test('dedupByFuzzy: 高相似 label 合并', () => {
  const r = dedupByFuzzy([
    { slug: 'transformer', label: 'transformer', sourceStage: 2, confidence: 0.8 },
    { slug: 'transformer-architecture', label: 'transformer architecture', sourceStage: 2, confidence: 0.7 },
  ], { threshold: 0.45 });
  assert.equal(r.concepts.length, 1);
  assert.equal(r.merges.length, 1);
  // canonical 应该选 confidence 高的那个(transformer)
  assert.equal(r.concepts[0].slug, 'transformer');
});

test('dedupByFuzzy: 低相似不合并', () => {
  const r = dedupByFuzzy([
    { slug: 'a', label: 'attention', sourceStage: 2, confidence: 0.8 },
    { slug: 'b', label: 'convolution', sourceStage: 2, confidence: 0.8 },
  ]);
  assert.equal(r.concepts.length, 2);
  assert.equal(r.merges.length, 0);
});

test('dedupByFuzzy: 三 transitive 合并到一组', () => {
  const r = dedupByFuzzy([
    { slug: 'a', label: 'reinforcement learning', sourceStage: 2, confidence: 0.7 },
    { slug: 'b', label: 'reinforcement learning algorithm', sourceStage: 2, confidence: 0.7 },
    { slug: 'c', label: 'reinforcement learning algorithms', sourceStage: 2, confidence: 0.7 },
  ], { threshold: 0.7 });
  assert.equal(r.concepts.length, 1);
  assert.equal(r.merges.length, 2);
});

test('dedupByFuzzy: sameStageOnly 默认开启 → 跨 stage 不合并', () => {
  const r = dedupByFuzzy([
    { slug: 'a', label: 'transformer', sourceStage: 1, confidence: 0.8 },
    { slug: 'b', label: 'transformer architecture', sourceStage: 2, confidence: 0.8 },
  ], { threshold: 0.7 });
  // 默认 sameStageOnly=true → 跨 stage 不合并
  assert.equal(r.concepts.length, 2);
});

test('dedupByFuzzy: sameStageOnly=false → 跨 stage 也合并', () => {
  const r = dedupByFuzzy([
    { slug: 'a', label: 'transformer', sourceStage: 1, confidence: 0.8 },
    { slug: 'b', label: 'transformer architecture', sourceStage: 2, confidence: 0.8 },
  ], { threshold: 0.7, sameStageOnly: false });
  assert.equal(r.concepts.length, 1);
});

// ----- dedupConcepts -----

test('dedupConcepts: slug + fuzzy 串联', () => {
  const r = dedupConcepts([
    { slug: 'rl', label: 'RL', sourceStage: 1, confidence: 0.5 },
    { slug: 'rl', label: 'Reinforcement Learning', sourceStage: 1, confidence: 0.9 },
    { slug: 'reinforcement-learning', label: 'Reinforcement Learning', sourceStage: 1, confidence: 0.7 },
  ]);
  // 1. slug dedup:两个 'rl' 合并成 1 个(label=Reinforcement Learning, conf=0.9)
  // 2. fuzzy:'reinforcement-learning' 的 label=Reinforcement Learning 与 rl 完全相同 → 合并
  // 结果:1 个 concept
  assert.equal(r.concepts.length, 1);
});
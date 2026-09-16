#!/usr/bin/env node
// astro-src/scripts/elo-debate.test.mjs
//
// Tests for R7 polish: astro-src/lib/elo-debate.ts.
// 测试纯函数:expectedScore / updateElo / swissPairs + 常量。
// runMatch 因为依赖 LLM 回调,不在此测试。

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
    external: ['./types/topic', '../types/topic', './types/concept', '../types/concept'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/elo-debate.ts');
const {
  ELO_K,
  ELO_INITIAL,
  DEBATE_ROUNDS_DEFAULT,
  PERSONAS_DEFAULT,
  DEBATE_MAX_IDEAS_DEFAULT,
  expectedScore,
  updateElo,
  swissPairs,
} = mod;

test('常量:ELO_K=32', () => {
  assert.equal(ELO_K, 32);
});

test('常量:ELO_INITIAL=1200', () => {
  assert.equal(ELO_INITIAL, 1200);
});

test('常量:DEBATE_ROUNDS_DEFAULT=3', () => {
  assert.equal(DEBATE_ROUNDS_DEFAULT, 3);
});

test('常量:PERSONAS_DEFAULT 3 个中文 persona', () => {
  assert.equal(PERSONAS_DEFAULT.length, 3);
  assert.equal(PERSONAS_DEFAULT[0], '方法论者');
  assert.equal(PERSONAS_DEFAULT[1], '工程师');
  assert.equal(PERSONAS_DEFAULT[2], '怀疑论者');
});

test('常量:DEBATE_MAX_IDEAS_DEFAULT=8', () => {
  assert.equal(DEBATE_MAX_IDEAS_DEFAULT, 8);
});

test('expectedScore: 同分 → 0.5', () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
});

test('expectedScore: a 远高于 b → 接近 1', () => {
  const e = expectedScore(1600, 1200);
  assert.ok(e > 0.9);
  assert.ok(e < 1);
});

test('expectedScore: a 远低于 b → 接近 0', () => {
  const e = expectedScore(800, 1200);
  assert.ok(e < 0.1);
  assert.ok(e > 0);
});

test('expectedScore: 对称性 expectedScore(a,b)+expectedScore(b,a)=1', () => {
  for (const [a, b] of [[1200, 1200], [1300, 1100], [1500, 900]]) {
    const sum = expectedScore(a, b) + expectedScore(b, a);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum(${a},${b})=${sum}`);
  }
});

test('expectedScore: 400 分差 → 0.909', () => {
  const e = expectedScore(1600, 1200);
  assert.ok(Math.abs(e - 0.9090909) < 1e-3);
});

test('updateElo: a 胜,a 加分 b 减分', () => {
  const [na, nb] = updateElo(1200, 1200, 'a');
  assert.ok(na > 1200);
  assert.ok(nb < 1200);
});

test('updateElo: a 胜 K=32 平局各 +/-16', () => {
  const [na, nb] = updateElo(1200, 1200, 'a');
  // ea = 0.5 → a += 32 * (1 - 0.5) = 16
  assert.equal(na, 1216);
  assert.equal(nb, 1184);
});

test('updateElo: b 胜对称', () => {
  const [na, nb] = updateElo(1200, 1200, 'b');
  assert.equal(na, 1184);
  assert.equal(nb, 1216);
});

test('updateElo: tie 分数不变', () => {
  const [na, nb] = updateElo(1200, 1300, 'tie');
  assert.equal(na, 1200);
  assert.equal(nb, 1300);
});

test('updateElo: 强 vs 弱,a 胜时 a 加分少(低期望)', () => {
  const [naStrong] = updateElo(1500, 1100, 'a');
  // ea = expectedScore(1500,1100) = 0.909,加 32 * (1-0.909) = 2.9
  assert.ok(naStrong > 1500);
  assert.ok(naStrong < 1505); // 弱胜时加分小于平局
});

test('updateElo: 弱 vs 强,b 胜时 b 加分多(高期望)', () => {
  const [, nb] = updateElo(1100, 1500, 'b');
  // 1100 视角 ea=0.0909,eb=0.909
  // b += K*(1-eb) = 32*(1-0.909)=2.9; 但 a -= K*ea = 32*0.0909=2.9
  // b 实际得分 1502.9
  assert.ok(nb > 1500);
});

test('updateElo: 总分变化接近 0(a 胜 / b 胜 应接近守恒)', () => {
  const [na1, nb1] = updateElo(1200, 1200, 'a');
  const [na2, nb2] = updateElo(1200, 1200, 'b');
  // a 胜 / b 胜对称:总变化为 0
  const sum1 = na1 + nb1;
  const sum2 = na2 + nb2;
  assert.ok(Math.abs(sum1 - 2400) < 1e-9);
  assert.ok(Math.abs(sum2 - 2400) < 1e-9);
});

test('swissPairs: 空数组 → []', () => {
  assert.deepEqual(swissPairs([]), []);
});

test('swissPairs: 单个 idea → []', () => {
  const ideas = [{ id: 'a', elo_rating: 1200 }];
  assert.deepEqual(swissPairs(ideas), []);
});

test('swissPairs: 2 个 idea → 1 pair', () => {
  const ideas = [
    { id: 'a', elo_rating: 1200 },
    { id: 'b', elo_rating: 1300 },
  ];
  const pairs = swissPairs(ideas);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0].id, 'b'); // 高分在前
  assert.equal(pairs[0][1].id, 'a');
});

test('swissPairs: 3 个 idea → 1 pair(孤儿跳过)', () => {
  const ideas = [
    { id: 'a', elo_rating: 1200 },
    { id: 'b', elo_rating: 1300 },
    { id: 'c', elo_rating: 1100 },
  ];
  const pairs = swissPairs(ideas);
  assert.equal(pairs.length, 1); // 3 个只配 1 对
});

test('swissPairs: 4 个 idea → 2 pair', () => {
  const ideas = [
    { id: 'a', elo_rating: 1200 },
    { id: 'b', elo_rating: 1300 },
    { id: 'c', elo_rating: 1100 },
    { id: 'd', elo_rating: 1400 },
  ];
  const pairs = swissPairs(ideas);
  assert.equal(pairs.length, 2);
});

test('swissPairs: 按 elo_rating desc 排序', () => {
  const ideas = [
    { id: 'low', elo_rating: 1100 },
    { id: 'high', elo_rating: 1500 },
    { id: 'mid', elo_rating: 1300 },
    { id: 'lowest', elo_rating: 1000 },
  ];
  const pairs = swissPairs(ideas);
  // high+mid 一对, low+lowest 一对
  assert.equal(pairs[0][0].id, 'high');
  assert.equal(pairs[0][1].id, 'mid');
  assert.equal(pairs[1][0].id, 'low');
  assert.equal(pairs[1][1].id, 'lowest');
});

test('swissPairs: 缺 elo_rating 用 ELO_INITIAL 兜底', () => {
  const ideas = [
    { id: 'a' }, // 无 elo_rating
    { id: 'b' },
  ];
  const pairs = swissPairs(ideas);
  assert.equal(pairs.length, 1);
});

test('swissPairs: 不修改原数组', () => {
  const ideas = [
    { id: 'a', elo_rating: 1100 },
    { id: 'b', elo_rating: 1300 },
  ];
  const original = [...ideas];
  swissPairs(ideas);
  assert.deepEqual(ideas, original);
});
#!/usr/bin/env node
// astro-src/scripts/elo-debate.test.mjs
//
// Tests for R7 polish: astro-src/lib/elo-debate.ts.
// ELO_K / ELO_INITIAL / DEBATE_ROUNDS_DEFAULT / PERSONAS_DEFAULT 常量 +
// expectedScore + updateElo + swissPairs + runMatch + runDebateStage。

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
  runMatch,
  runDebateStage,
} = mod;

// ---------- 常量 ----------
test('ELO_K = 32', () => {
  assert.equal(ELO_K, 32);
});

test('ELO_INITIAL = 1200', () => {
  assert.equal(ELO_INITIAL, 1200);
});

test('DEBATE_ROUNDS_DEFAULT = 3', () => {
  assert.equal(DEBATE_ROUNDS_DEFAULT, 3);
});

test('PERSONAS_DEFAULT: 3 个中文人设', () => {
  assert.equal(PERSONAS_DEFAULT.length, 3);
  assert.match(PERSONAS_DEFAULT[0], /方法论/);
  assert.match(PERSONAS_DEFAULT[1], /工程/);
  assert.match(PERSONAS_DEFAULT[2], /怀疑论/);
});

test('DEBATE_MAX_IDEAS_DEFAULT = 8', () => {
  assert.equal(DEBATE_MAX_IDEAS_DEFAULT, 8);
});

// ---------- expectedScore ----------
test('expectedScore: 同 elo = 0.5', () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
});

test('expectedScore: 高 elo 100 分优势 → 0.64', () => {
  // 1 / (1 + 10^(-100/400)) = 1 / (1 + 10^(-0.25)) ≈ 1 / (1 + 0.5623) ≈ 0.6401
  const r = expectedScore(1300, 1200);
  assert.ok(Math.abs(r - 0.6401) < 0.001);
});

test('expectedScore: 低 elo → 期望 < 0.5', () => {
  assert.ok(expectedScore(1000, 1200) < 0.5);
});

test('expectedScore: 高 elo → 期望 > 0.5', () => {
  assert.ok(expectedScore(1400, 1200) > 0.5);
});

test('expectedScore: 对称 (a,b) + (b,a) = 1', () => {
  for (const [a, b] of [[1200, 1300], [1500, 1200], [1000, 1600]]) {
    const s = expectedScore(a, b);
    const t = expectedScore(b, a);
    assert.ok(Math.abs(s + t - 1) < 1e-9);
  }
});

test('expectedScore: a>>b → 接近 1', () => {
  assert.ok(expectedScore(2000, 1000) > 0.99);
});

test('expectedScore: a<<b → 接近 0', () => {
  assert.ok(expectedScore(1000, 2000) < 0.01);
});

// ---------- updateElo ----------
test('updateElo: a 胜 → a+, b-', () => {
  const [a, b] = updateElo(1200, 1200, 'a');
  assert.ok(a > 1200);
  assert.ok(b < 1200);
});

test('updateElo: b 胜 → a-, b+', () => {
  const [a, b] = updateElo(1200, 1200, 'b');
  assert.ok(a < 1200);
  assert.ok(b > 1200);
});

test('updateElo: tie → 不变', () => {
  const [a, b] = updateElo(1200, 1200, 'tie');
  assert.equal(a, 1200);
  assert.equal(b, 1200);
});

test('updateElo: 同 elo a 胜 → 差约 K*(1-0.5) = 16', () => {
  const [a, b] = updateElo(1200, 1200, 'a');
  assert.ok(Math.abs((a - 1200) - 16) < 0.01);
  assert.ok(Math.abs((1200 - b) - 16) < 0.01);
});

test('updateElo: 双方分数守恒(总和)', () => {
  // tie 总和不变,a/b 胜: a + b 守恒
  for (const w of ['a', 'b', 'tie']) {
    const [a, b] = updateElo(1500, 1400, w);
    assert.ok(Math.abs(a + b - (1500 + 1400)) < 0.001);
  }
});

// ---------- swissPairs ----------
test('swissPairs: 空数组 → 空对', () => {
  assert.deepEqual(swissPairs([]), []);
});

test('swissPairs: 1 个 → 空对', () => {
  assert.equal(swissPairs([{ elo_rating: 1200 }]).length, 0);
});

test('swissPairs: 2 个 → 1 对', () => {
  const r = swissPairs([{ id: 'a' }, { id: 'b' }]);
  assert.equal(r.length, 1);
});

test('swissPairs: 3 个 → 1 对 (1 个孤儿)', () => {
  const r = swissPairs([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.equal(r.length, 1);
});

test('swissPairs: 4 个 → 2 对', () => {
  const r = swissPairs([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  assert.equal(r.length, 2);
});

test('swissPairs: 按 elo 降序相邻配对', () => {
  const items = [
    { id: 'low', elo_rating: 1100 },
    { id: 'high', elo_rating: 1500 },
    { id: 'mid', elo_rating: 1300 },
    { id: 'top', elo_rating: 1700 },
  ];
  const r = swissPairs(items);
  // 排序后: top(1700), high(1500), mid(1300), low(1100)
  assert.equal(r[0][0].id, 'top');
  assert.equal(r[0][1].id, 'high');
  assert.equal(r[1][0].id, 'mid');
  assert.equal(r[1][1].id, 'low');
});

test('swissPairs: 缺 elo_rating 视为 ELO_INITIAL', () => {
  const r = swissPairs([
    { id: 'a' }, // undefined → 1200
    { id: 'b' }, // undefined → 1200
  ]);
  assert.equal(r.length, 1);
});

test('swissPairs: 不修改原数组', () => {
  const arr = [
    { id: 'low', elo_rating: 1100 },
    { id: 'high', elo_rating: 1500 },
  ];
  swissPairs(arr);
  assert.equal(arr[0].id, 'low');
});

// ---------- runMatch ----------
test('runMatch: a 胜 → winner=a, failed=false', async () => {
  const a = { id: 'a', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] };
  const b = { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] };
  const r = await runMatch(a, b, () => ({ winner: 'a', reason: 'a is better' }), () => 'speech');
  assert.equal(r.winner, 'a');
  assert.equal(r.failed, false);
  assert.equal(r.idea_a, 'a');
  assert.equal(r.idea_b, 'b');
});

test('runMatch: transcript 含 pro/con/judge 条目', async () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const r = await runMatch(a, b, () => ({ winner: 'a', reason: 'r' }), () => 'speech');
  // 3 rounds * 2 + 1 judge = 7
  assert.equal(r.transcript.length, 7);
  assert.equal(r.transcript[0].side, 'pro');
  assert.equal(r.transcript[1].side, 'con');
  assert.equal(r.transcript[6].side, 'judge');
});

test('runMatch: judge 抛错 → failed=true, winner=tie', async () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const r = await runMatch(a, b, () => { throw new Error('judge fail'); }, () => 'speech');
  assert.equal(r.failed, true);
  assert.equal(r.winner, 'tie');
  assert.match(r.error, /judge fail/);
});

test('runMatch: persona 抛错 → failed=true', async () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const r = await runMatch(a, b, () => ({ winner: 'a', reason: 'r' }), () => { throw new Error('p fail'); });
  assert.equal(r.failed, true);
});

test('runMatch: reason 字段透传', async () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const r = await runMatch(a, b, () => ({ winner: 'b', reason: 'good code' }), () => 'speech');
  assert.equal(r.reason, 'good code');
});

// ---------- runDebateStage ----------
test('runDebateStage: 全 tie → elo 不变, matches 增加', async () => {
  const ideas = [
    { id: 'a', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
    { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
  ];
  const r = await runDebateStage(ideas, {
    judgeFn: () => ({ winner: 'tie', reason: 'even' }),
    personaFn: () => 'speech',
  });
  // tie → +1 matches, elo 不变
  assert.equal(r.ranked[0].matches, 1);
  assert.equal(r.ranked[0].elo_rating, 1200);
});

test('runDebateStage: a 胜 → a elo+, b elo-', async () => {
  const ideas = [
    { id: 'a', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
    { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
  ];
  const r = await runDebateStage(ideas, {
    judgeFn: () => ({ winner: 'a', reason: 'a wins' }),
    personaFn: () => 'speech',
  });
  const rankedA = r.ranked.find((x) => x.id === 'a');
  const rankedB = r.ranked.find((x) => x.id === 'b');
  assert.ok(rankedA.elo_rating > 1200);
  assert.ok(rankedB.elo_rating < 1200);
  assert.equal(rankedA.wins, 1);
  assert.equal(rankedB.wins, 0);
});

test('runDebateStage: 失败 match 不更新 elo,记录 error', async () => {
  const ideas = [
    { id: 'a', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
    { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
  ];
  const r = await runDebateStage(ideas, {
    judgeFn: () => { throw new Error('fail'); },
    personaFn: () => 'speech',
  });
  // failed match 不更新 elo/matches/wins
  for (const x of r.ranked) {
    assert.equal(x.elo_rating, 1200);
    assert.equal(x.matches, 0);
    assert.equal(x.wins, 0);
    assert.equal(x.debate_errors.length, 1);
  }
});

test('runDebateStage: onProgress 回调被调', async () => {
  const ideas = [
    { id: 'a', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
    { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
  ];
  const calls = [];
  await runDebateStage(ideas, {
    judgeFn: () => ({ winner: 'tie', reason: '' }),
    personaFn: () => 's',
    onProgress: (m, idx, total) => {
      calls.push({ idx, total, id_a: m.idea_a });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idx, 1);
  assert.equal(calls[0].total, 1);
});

test('runDebateStage: maxIdeas 截断', async () => {
  const ideas = Array.from({ length: 12 }, (_, i) => ({
    id: `i${i}`, elo_rating: 1200 + i, matches: 0, wins: 0,
    debate_log: [], debate_errors: [],
  }));
  const r = await runDebateStage(ideas, {
    judgeFn: () => ({ winner: 'tie', reason: '' }),
    personaFn: () => 's',
    maxIdeas: 4,
  });
  // 4 个 → 2 对 → 2 matches
  assert.equal(r.matches.length, 2);
  assert.equal(r.ranked.length, 4);
});

test('runDebateStage: 不修改原 ideas', async () => {
  const orig = {
    id: 'a', elo_rating: 1200, matches: 0, wins: 0,
    debate_log: [], debate_errors: [],
  };
  const ideas = [
    orig,
    { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
  ];
  await runDebateStage(ideas, {
    judgeFn: () => ({ winner: 'a', reason: '' }),
    personaFn: () => 's',
  });
  // orig elo 没改
  assert.equal(orig.elo_rating, 1200);
});

test('runDebateStage: debate_log 累加 match', async () => {
  const ideas = [
    { id: 'a', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
    { id: 'b', elo_rating: 1200, matches: 0, wins: 0, debate_log: [], debate_errors: [] },
  ];
  const r = await runDebateStage(ideas, {
    judgeFn: () => ({ winner: 'a', reason: '' }),
    personaFn: () => 's',
  });
  for (const x of r.ranked) {
    assert.equal(x.debate_log.length, 1);
  }
});
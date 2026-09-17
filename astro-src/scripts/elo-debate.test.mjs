#!/usr/bin/env node
// astro-src/scripts/elo-debate.test.mjs
//
// Tests for R7 polish: astro-src/lib/elo-debate.ts.
// 常量 + expectedScore + updateElo + swissPairs +
// runMatch (per-match 失败隔离) + runDebateStage (top-K + Swiss + 排序)。

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

const mod = await loadTs('lib/elo-debate.ts');
const {
  ELO_K,
  ELO_INITIAL,
  DEBATE_ROUNDS_DEFAULT,
  DEBATE_MAX_IDEAS_DEFAULT,
  PERSONAS_DEFAULT,
  expectedScore,
  updateElo,
  swissPairs,
  runMatch,
  runDebateStage,
} = mod;

const mkIdea = (overrides = {}) => ({
  id: 'idea-' + Math.random().toString(36).slice(2, 8),
  title: 'Test Idea',
  elo_rating: ELO_INITIAL,
  matches: 0,
  wins: 0,
  debate_log: [],
  debate_errors: [],
  ...overrides,
});

// ---------- constants ---
test('常: ELO_K = 32', () => {
  assert.equal(ELO_K, 32);
});

test('常: ELO_INITIAL = 1200', () => {
  assert.equal(ELO_INITIAL, 1200);
});

test('常: DEBATE_ROUNDS_DEFAULT = 3', () => {
  assert.equal(DEBATE_ROUNDS_DEFAULT, 3);
});

test('常: DEBATE_MAX_IDEAS_DEFAULT = 8', () => {
  assert.equal(DEBATE_MAX_IDEAS_DEFAULT, 8);
});

test('常: PERSONAS_DEFAULT 长度 3', () => {
  assert.equal(PERSONAS_DEFAULT.length, 3);
});

// ---------- expectedScore ---
test('expected: 同 elo → 0.5', () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
});

test('expected: a 远高于 b → 接近 1', () => {
  const r = expectedScore(1600, 1200);
  assert.ok(r > 0.9);
});

test('expected: a 远低于 b → 接近 0', () => {
  const r = expectedScore(800, 1200);
  assert.ok(r < 0.1);
});

test('expected: 差 100 → ~0.64', () => {
  const r = expectedScore(1300, 1200);
  assert.ok(Math.abs(r - 0.64) < 0.01);
});

// ---------- updateElo ---
test('elo: a 胜 → a+, b-', () => {
  const [na, nb] = updateElo(1200, 1200, 'a');
  assert.ok(na > 1200);
  assert.ok(nb < 1200);
});

test('elo: b 胜 → a-, b+', () => {
  const [na, nb] = updateElo(1200, 1200, 'b');
  assert.ok(na < 1200);
  assert.ok(nb > 1200);
});

test('elo: tie → 都不变', () => {
  const [na, nb] = updateElo(1200, 1200, 'tie');
  assert.equal(na, 1200);
  assert.equal(nb, 1200);
});

test('elo: K=32 总变化 ≈ 32', () => {
  const [na, nb] = updateElo(1200, 1200, 'a');
  // a 期望得分 0.5 → 实际 1 → diff = 32*0.5 = 16
  // a = 1200 + 32*0.5 = 1216
  assert.equal(na, 1216);
  assert.equal(nb, 1184);
});

test('elo: 高分胜低分 → 变化小', () => {
  // a=1600, b=1200, a 胜:expected(a)=1/(1+10^(-1))=0.909
  // a += 32*(1 - 0.909) = 32*0.0909 ≈ 2.909
  const [na, nb] = updateElo(1600, 1200, 'a');
  assert.ok(Math.abs(na - 1602.909) < 0.01);
  assert.ok(Math.abs(nb - 1197.091) < 0.01);
});

// ---------- swissPairs ---
test('pairs: < 2 → []', () => {
  assert.deepEqual(swissPairs([]), []);
  assert.deepEqual(swissPairs([mkIdea()]), []);
});

test('pairs: 2 → 1 pair', () => {
  const r = swissPairs([mkIdea(), mkIdea()]);
  assert.equal(r.length, 1);
});

test('pairs: 3 → 1 pair(孤儿跳过)', () => {
  const r = swissPairs([mkIdea(), mkIdea(), mkIdea()]);
  assert.equal(r.length, 1);
});

test('pairs: 4 → 2 pairs', () => {
  const r = swissPairs([mkIdea(), mkIdea(), mkIdea(), mkIdea()]);
  assert.equal(r.length, 2);
});

test('pairs: 按 elo 降序相邻配对', () => {
  const a = mkIdea({ id: 'a', elo_rating: 1500 });
  const b = mkIdea({ id: 'b', elo_rating: 1300 });
  const c = mkIdea({ id: 'c', elo_rating: 1200 });
  const d = mkIdea({ id: 'd', elo_rating: 1100 });
  const r = swissPairs([d, b, a, c]); // 输入乱序
  // 排序后: a(1500), b(1300), c(1200), d(1100)
  // pair1: (a, b), pair2: (c, d)
  assert.equal(r[0][0].id, 'a');
  assert.equal(r[0][1].id, 'b');
  assert.equal(r[1][0].id, 'c');
  assert.equal(r[1][1].id, 'd');
});

test('pairs: 不修改原数组', () => {
  const items = [mkIdea(), mkIdea(), mkIdea(), mkIdea()];
  const orig = items.slice();
  swissPairs(items);
  assert.deepEqual(items, orig);
});

// ---------- runMatch ---
test('match: 基本场 → 3 rounds transcript', async () => {
  const a = mkIdea({ id: 'a' });
  const b = mkIdea({ id: 'b' });
  const judgeFn = async () => ({ winner: 'a', reason: 'good' });
  const personaFn = async () => 'argument';
  const r = await runMatch(a, b, judgeFn, personaFn);
  // 3 rounds × 2 = 6 transcript + 1 judge = 7
  assert.equal(r.transcript.length, 7);
  assert.equal(r.winner, 'a');
  assert.equal(r.failed, false);
});

test('match: judge 抛错 → failed=true, tie', async () => {
  const a = mkIdea();
  const b = mkIdea();
  const judgeFn = async () => { throw new Error('judge broke'); };
  const personaFn = async () => 'argument';
  const r = await runMatch(a, b, judgeFn, personaFn);
  assert.equal(r.failed, true);
  assert.equal(r.winner, 'tie');
  assert.match(r.error, /judge broke/);
});

test('match: persona 抛错 → failed=true', async () => {
  const judgeFn = async () => ({ winner: 'a', reason: 'r' });
  const personaFn = async () => { throw new Error('persona broke'); };
  const r = await runMatch(mkIdea(), mkIdea(), judgeFn, personaFn);
  assert.equal(r.failed, true);
});

test('match: idea_a/idea_b 透传', async () => {
  const a = mkIdea({ id: 'foo' });
  const b = mkIdea({ id: 'bar' });
  const r = await runMatch(a, b, async () => ({ winner: 'tie', reason: '' }), async () => 'x');
  assert.equal(r.idea_a, 'foo');
  assert.equal(r.idea_b, 'bar');
});

test('match: custom rounds 影响 transcript 长度', async () => {
  const r = await runMatch(mkIdea(), mkIdea(),
    async () => ({ winner: 'a', reason: '' }),
    async () => 'x',
    { rounds: 1 },
  );
  // 1 round × 2 + 1 judge = 3
  assert.equal(r.transcript.length, 3);
});

test('match: tie 结果', async () => {
  const r = await runMatch(mkIdea(), mkIdea(),
    async () => ({ winner: 'tie', reason: 'equal' }),
    async () => 'x',
  );
  assert.equal(r.winner, 'tie');
});

// ---------- runDebateStage ---
test('stage: 全胜 → elo 更新', async () => {
  const ideas = [
    mkIdea({ id: 'a' }),
    mkIdea({ id: 'b' }),
  ];
  const judgeFn = async (x, y) => ({ winner: x.id === 'a' ? 'a' : 'b', reason: 'ok' });
  const personaFn = async () => 'arg';
  const { ranked, matches } = await runDebateStage(ideas, { judgeFn, personaFn });
  assert.equal(ranked.length, 2);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].winner, 'a');
  // a 胜 → elo+
  assert.ok(ranked.find((i) => i.id === 'a').elo_rating > ELO_INITIAL);
  assert.ok(ranked.find((i) => i.id === 'b').elo_rating < ELO_INITIAL);
});

test('stage: matches/wins 累加', async () => {
  const ideas = [mkIdea({ id: 'a' }), mkIdea({ id: 'b' })];
  const { ranked } = await runDebateStage(ideas, {
    judgeFn: async (x) => ({ winner: x.id === 'a' ? 'a' : 'b', reason: '' }),
    personaFn: async () => 'x',
  });
  const a = ranked.find((i) => i.id === 'a');
  const b = ranked.find((i) => i.id === 'b');
  assert.equal(a.matches, 1);
  assert.equal(b.matches, 1);
  assert.equal(a.wins, 1);
  assert.equal(b.wins, 0);
});

test('stage: tie → matches 累加, elo 不变', async () => {
  const ideas = [mkIdea({ id: 'a' }), mkIdea({ id: 'b' })];
  const { ranked } = await runDebateStage(ideas, {
    judgeFn: async () => ({ winner: 'tie', reason: '' }),
    personaFn: async () => 'x',
  });
  for (const i of ranked) {
    assert.equal(i.matches, 1);
    assert.equal(i.wins, 0);
    assert.equal(i.elo_rating, ELO_INITIAL);
  }
});

test('stage: judge 失败 → failed, elo 不变', async () => {
  const ideas = [mkIdea({ id: 'a' }), mkIdea({ id: 'b' })];
  const { ranked, matches } = await runDebateStage(ideas, {
    judgeFn: async () => { throw new Error('boom'); },
    personaFn: async () => 'x',
  });
  assert.equal(matches[0].failed, true);
  // elo 不变
  for (const i of ranked) {
    assert.equal(i.elo_rating, ELO_INITIAL);
    assert.equal(i.matches, 0);
  }
});

test('stage: maxIdeas 截断', async () => {
  const ideas = [];
  for (let i = 0; i < 12; i++) {
    ideas.push(mkIdea({ id: 'i' + i, elo_rating: 1200 - i }));
  }
  const { ranked } = await runDebateStage(ideas, {
    judgeFn: async () => ({ winner: 'a', reason: '' }),
    personaFn: async () => 'x',
    maxIdeas: 4,
  });
  // 4 个参与,剩 8 个不进
  assert.equal(ranked.length, 4);
  // 取 elo 最高的 4 个(1200, 1199, 1198, 1197)
  assert.equal(ranked[0].id, 'i0');
  assert.equal(ranked[3].id, 'i3');
});

test('stage: ranked 按 elo 降序', async () => {
  const ideas = [
    mkIdea({ id: 'a', elo_rating: 1100 }),
    mkIdea({ id: 'b', elo_rating: 1500 }),
    mkIdea({ id: 'c', elo_rating: 1300 }),
    mkIdea({ id: 'd', elo_rating: 1200 }),
  ];
  const { ranked } = await runDebateStage(ideas, {
    judgeFn: async () => ({ winner: 'a', reason: '' }),
    personaFn: async () => 'x',
  });
  assert.equal(ranked[0].id, 'b');
  assert.equal(ranked[1].id, 'c');
  assert.equal(ranked[2].id, 'd');
  assert.equal(ranked[3].id, 'a');
});

test('stage: 不修改原数组', async () => {
  const ideas = [mkIdea({ id: 'a' }), mkIdea({ id: 'b' })];
  const orig = ideas.slice();
  await runDebateStage(ideas, {
    judgeFn: async () => ({ winner: 'a', reason: '' }),
    personaFn: async () => 'x',
  });
  for (let i = 0; i < ideas.length; i++) {
    assert.equal(ideas[i].id, orig[i].id);
  }
});

test('stage: 1 idea → 0 pair, 0 match', async () => {
  const { ranked, matches } = await runDebateStage([mkIdea({ id: 'a' })], {
    judgeFn: async () => ({ winner: 'a', reason: '' }),
    personaFn: async () => 'x',
  });
  assert.equal(matches.length, 0);
  assert.equal(ranked.length, 1);
});

test('stage: 3 ideas → 1 pair', async () => {
  const ideas = [mkIdea({ id: 'a' }), mkIdea({ id: 'b' }), mkIdea({ id: 'c' })];
  const { matches } = await runDebateStage(ideas, {
    judgeFn: async () => ({ winner: 'a', reason: '' }),
    personaFn: async () => 'x',
  });
  assert.equal(matches.length, 1);
});

test('stage: progress callback 触发', async () => {
  const ideas = [mkIdea({ id: 'a' }), mkIdea({ id: 'b' })];
  const calls = [];
  await runDebateStage(ideas, {
    judgeFn: async () => ({ winner: 'a', reason: '' }),
    personaFn: async () => 'x',
    onProgress: (m, idx, total) => calls.push({ idx, total }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idx, 1);
  assert.equal(calls[0].total, 1);
});
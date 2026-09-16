#!/usr/bin/env node
// astro-src/scripts/idea-lifecycle.test.mjs
//
// Tests for R7 E.1.x: astro-src/lib/idea-lifecycle.ts idea depth state machine.

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

const mod = await loadTs('lib/idea-lifecycle.ts');
const {
  IDEA_DEPTH_ORDER,
  GATE_THRESHOLDS,
  evaluatePromotion,
  applyPromotion,
} = mod;

const baseIdea = {
  id: 'idea-1',
  title: 'Test idea',
  elo_rating: 1200,
  matches: 0,
  wins: 0,
};

test('IDEA_DEPTH_ORDER: 数值顺序 0..3', () => {
  assert.equal(IDEA_DEPTH_ORDER.sketch, 0);
  assert.equal(IDEA_DEPTH_ORDER.candidate, 1);
  assert.equal(IDEA_DEPTH_ORDER.under_review, 2);
  assert.equal(IDEA_DEPTH_ORDER.promoted, 3);
});

test('GATE_THRESHOLDS: sketch → candidate minElo=1232 minWins=1', () => {
  assert.equal(GATE_THRESHOLDS.sketchToCandidate.minElo, 1232);
  assert.equal(GATE_THRESHOLDS.sketchToCandidate.minWins, 1);
});

test('GATE_THRESHOLDS: candidate → under_review minElo=1250 minMatches=2 minWins=1', () => {
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minElo, 1250);
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minMatches, 2);
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minWins, 1);
});

test('GATE_THRESHOLDS: under_review → promoted minElo=1280 minMatches=3 minWins=2', () => {
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minElo, 1280);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minMatches, 3);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minWins, 2);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.requiresNonLimitationSignal, true);
});

test('evaluatePromotion: 默认 sketch 不满足低 elo', () => {
  const decision = evaluatePromotion({ ...baseIdea, elo_rating: 1200, wins: 0 });
  assert.equal(decision, null);
});

test('evaluatePromotion: sketch → candidate 满足 elo + wins', () => {
  const decision = evaluatePromotion({ ...baseIdea, elo_rating: 1232, wins: 1 });
  assert.ok(decision);
  assert.equal(decision.from, 'sketch');
  assert.equal(decision.to, 'candidate');
});

test('evaluatePromotion: sketch 满足 elo 但 wins=0 不晋升', () => {
  const decision = evaluatePromotion({ ...baseIdea, elo_rating: 1300, wins: 0 });
  assert.equal(decision, null);
});

test('evaluatePromotion: sketch 满足 wins 但 elo 低不晋升', () => {
  const decision = evaluatePromotion({ ...baseIdea, elo_rating: 1100, wins: 5 });
  assert.equal(decision, null);
});

test('evaluatePromotion: candidate → under_review 满足所有条件', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1250,
    matches: 2,
    wins: 1,
    depth: 'candidate',
  });
  assert.ok(decision);
  assert.equal(decision.from, 'candidate');
  assert.equal(decision.to, 'under_review');
});

test('evaluatePromotion: candidate matches 不够不晋升', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1300,
    matches: 1,
    wins: 1,
    depth: 'candidate',
  });
  assert.equal(decision, null);
});

test('evaluatePromotion: under_review → promoted 全部满足 + 非 limitations signal', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1280,
    matches: 3,
    wins: 2,
    depth: 'under_review',
    signals: ['novelty'],
  });
  assert.ok(decision);
  assert.equal(decision.from, 'under_review');
  assert.equal(decision.to, 'promoted');
});

test('evaluatePromotion: under_review signals 只含 limitations 不晋升', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1300,
    matches: 4,
    wins: 3,
    depth: 'under_review',
    signals: ['limitations'],
  });
  assert.equal(decision, null);
});

test('evaluatePromotion: under_review signals 为空不晋升', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1300,
    matches: 4,
    wins: 3,
    depth: 'under_review',
    signals: [],
  });
  assert.equal(decision, null);
});

test('evaluatePromotion: promoted 顶级不晋升', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1500,
    matches: 10,
    wins: 8,
    depth: 'promoted',
  });
  assert.equal(decision, null);
});

test('evaluatePromotion: 单步晋升(不会跨级)', () => {
  // sketch idea 即使 elo=1500 也不会直接跳到 under_review
  const decision = evaluatePromotion({ ...baseIdea, elo_rating: 1500, wins: 5 });
  assert.ok(decision);
  assert.equal(decision.to, 'candidate'); // 不是 under_review
});

test('evaluatePromotion: 缺失 elo 视为默认 1200', () => {
  const idea = { id: 'x', title: 'no elo' }; // 无 elo_rating
  const decision = evaluatePromotion(idea);
  assert.equal(decision, null); // 1200 不够 1232
});

test('applyPromotion: 修改 depth + 设 promoted_at', () => {
  const idea = { ...baseIdea, depth: 'sketch' };
  const decision = {
    id: idea.id,
    from: 'sketch',
    to: 'candidate',
    reason: 'test',
  };
  const updated = applyPromotion(idea, decision);
  assert.equal(updated.depth, 'candidate');
  assert.ok(updated.promoted_at);
  // 应当是 ISO 字符串
  assert.ok(!Number.isNaN(Date.parse(updated.promoted_at)));
});

test('applyPromotion: 不修改原 idea(返回新对象)', () => {
  const idea = { ...baseIdea, depth: 'sketch' };
  const decision = { id: idea.id, from: 'sketch', to: 'candidate', reason: 'test' };
  const updated = applyPromotion(idea, decision);
  assert.notEqual(updated, idea);
  assert.equal(idea.depth, 'sketch'); // 原对象不变
});

test('evaluatePromotion: under_review 满足 Elo 但 wins=1 不晋升', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1300,
    matches: 4,
    wins: 1,
    depth: 'under_review',
    signals: ['novelty'],
  });
  assert.equal(decision, null);
});

test('evaluatePromotion: signals 数组含 limitations + novelty 时晋升(任一非 limitations)', () => {
  const decision = evaluatePromotion({
    ...baseIdea,
    elo_rating: 1280,
    matches: 3,
    wins: 2,
    depth: 'under_review',
    signals: ['limitations', 'novelty'],
  });
  assert.ok(decision);
});

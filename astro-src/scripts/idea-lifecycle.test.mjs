#!/usr/bin/env node
// astro-src/scripts/idea-lifecycle.test.mjs
//
// Tests for R7 polish: astro-src/lib/idea-lifecycle.mjs.
// IDEA_DEPTH_ORDER + GATE_THRESHOLDS + evaluatePromotion + applyPromotion。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
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

const mod = await loadMjs('lib/idea-lifecycle.mjs');
const {
  IDEA_DEPTH_ORDER,
  GATE_THRESHOLDS,
  evaluatePromotion,
  applyPromotion,
} = mod;

const mkIdea = (overrides) => ({
  id: 'i1',
  elo_rating: 1200,
  matches: 0,
  wins: 0,
  signals: [],
  ...overrides,
});

// ---------- IDEA_DEPTH_ORDER ----------
test('IDEA_DEPTH_ORDER: 4 levels', () => {
  assert.equal(Object.keys(IDEA_DEPTH_ORDER).length, 4);
});

test('IDEA_DEPTH_ORDER: sketch=0', () => {
  assert.equal(IDEA_DEPTH_ORDER.sketch, 0);
});

test('IDEA_DEPTH_ORDER: promoted=3', () => {
  assert.equal(IDEA_DEPTH_ORDER.promoted, 3);
});

test('IDEA_DEPTH_ORDER: 严格升序', () => {
  assert.ok(IDEA_DEPTH_ORDER.sketch < IDEA_DEPTH_ORDER.candidate);
  assert.ok(IDEA_DEPTH_ORDER.candidate < IDEA_DEPTH_ORDER.under_review);
  assert.ok(IDEA_DEPTH_ORDER.under_review < IDEA_DEPTH_ORDER.promoted);
});

// ---------- GATE_THRESHOLDS ----------
test('GATE_THRESHOLDS: sketchToCandidate', () => {
  assert.equal(GATE_THRESHOLDS.sketchToCandidate.minElo, 1232);
  assert.equal(GATE_THRESHOLDS.sketchToCandidate.minWins, 1);
});

test('GATE_THRESHOLDS: candidateToUnderReview', () => {
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minElo, 1250);
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minMatches, 2);
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minWins, 1);
});

test('GATE_THRESHOLDS: underReviewToPromoted', () => {
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minElo, 1280);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minMatches, 3);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minWins, 2);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.requiresNonLimitationSignal, true);
});

// ---------- evaluatePromotion: sketch ----------
test('evaluatePromotion: 默认 depth 视为 sketch', () => {
  const r = evaluatePromotion(mkIdea({ elo_rating: 1300, wins: 1 }));
  assert.notEqual(r, null);
  assert.equal(r.from, 'sketch');
  assert.equal(r.to, 'candidate');
});

test('evaluatePromotion: depth 缺省字段 → sketch', () => {
  const r = evaluatePromotion({ id: 'i1', elo_rating: 1300, wins: 1 });
  assert.notEqual(r, null);
});

test('evaluatePromotion: sketch 不满 → null', () => {
  // elo 高但 win=0
  assert.equal(evaluatePromotion(mkIdea({ elo_rating: 1300, wins: 0 })), null);
});

test('evaluatePromotion: sketch elo 不够 → null', () => {
  assert.equal(evaluatePromotion(mkIdea({ elo_rating: 1231, wins: 1 })), null);
});

test('evaluatePromotion: sketch 边界 elo 1232 → 通过', () => {
  assert.notEqual(evaluatePromotion(mkIdea({ elo_rating: 1232, wins: 1 })), null);
});

test('evaluatePromotion: sketch 默认 elo 1200 → null (elo 不够)', () => {
  assert.equal(evaluatePromotion(mkIdea()), null);
});

// ---------- candidate ----------
test('evaluatePromotion: candidate → under_review 满足', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1250,
    matches: 2,
    wins: 1,
  }));
  assert.notEqual(r, null);
  assert.equal(r.from, 'candidate');
  assert.equal(r.to, 'under_review');
});

test('evaluatePromotion: candidate matches 不足 → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1250,
    matches: 1,
    wins: 1,
  })), null);
});

test('evaluatePromotion: candidate wins 不足 → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1250,
    matches: 2,
    wins: 0,
  })), null);
});

test('evaluatePromotion: candidate elo 不足 → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1249,
    matches: 2,
    wins: 1,
  })), null);
});

// ---------- under_review ----------
test('evaluatePromotion: under_review → promoted 满足', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1280,
    matches: 3,
    wins: 2,
    signals: ['novelty'],
  }));
  assert.notEqual(r, null);
  assert.equal(r.to, 'promoted');
});

test('evaluatePromotion: under_review 仅 limitations → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: ['limitations'],
  })), null);
});

test('evaluatePromotion: under_review 空 signals → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: [],
  })), null);
});

test('evaluatePromotion: under_review limitations + novelty → 通过', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1280,
    matches: 3,
    wins: 2,
    signals: ['limitations', 'novelty'],
  }));
  assert.notEqual(r, null);
});

test('evaluatePromotion: under_review matches 不足 → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 2,
    wins: 2,
    signals: ['novelty'],
  })), null);
});

test('evaluatePromotion: under_review wins 不足 → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 1,
    signals: ['novelty'],
  })), null);
});

// ---------- 已 promoted ---
test('evaluatePromotion: 已 promoted → null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'promoted',
    elo_rating: 2000,
    matches: 10,
    wins: 10,
    signals: ['novelty'],
  })), null);
});

// ---------- 跨级 ---
test('evaluatePromotion: sketch 高 Elo 高 wins 也只升一级 (sketch→candidate)', () => {
  const r = evaluatePromotion(mkIdea({
    elo_rating: 1500,
    matches: 5,
    wins: 5,
    signals: ['novelty'],
  }));
  assert.equal(r.to, 'candidate');
  // 不到 candidate→under_review (depth 还是 sketch)
});

// ---------- 字段默认值 ---
test('evaluatePromotion: elo undefined → 默认 1200', () => {
  // elo undefined → 1200 → 不够 1232 → null
  const idea = mkIdea({ wins: 1 });
  delete idea.elo_rating;
  assert.equal(evaluatePromotion(idea), null);
});

test('evaluatePromotion: matches undefined → 默认 0', () => {
  const idea = mkIdea({
    depth: 'candidate',
    elo_rating: 1300,
    wins: 1,
  });
  delete idea.matches;
  assert.equal(evaluatePromotion(idea), null);
});

test('evaluatePromotion: wins undefined → 默认 0', () => {
  const idea = mkIdea({ elo_rating: 1300 });
  delete idea.wins;
  assert.equal(evaluatePromotion(idea), null);
});

// ---------- reason 字段 ---
test('evaluatePromotion: reason 含 Elo/wins', () => {
  const r = evaluatePromotion(mkIdea({ elo_rating: 1300, wins: 2 }));
  assert.match(r.reason, /elo 1300/);
  assert.match(r.reason, /wins 2/);
});

test('evaluatePromotion: under_review reason 含 signals', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: ['novelty', 'feasibility'],
  }));
  assert.match(r.reason, /signals=/);
  assert.match(r.reason, /novelty/);
});

// ---------- applyPromotion ---
test('applyPromotion: depth 改为 to', () => {
  const decision = {
    id: 'i1',
    from: 'sketch',
    to: 'candidate',
    reason: 'test',
  };
  const r = applyPromotion(mkIdea({ id: 'i1' }), decision);
  assert.equal(r.depth, 'candidate');
});

test('applyPromotion: promoted_at 是 ISO 字符串', () => {
  const decision = {
    id: 'i1',
    from: 'sketch',
    to: 'candidate',
    reason: 'test',
  };
  const r = applyPromotion(mkIdea({ id: 'i1' }), decision);
  assert.match(r.promoted_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('applyPromotion: 不修改原 idea', () => {
  const decision = {
    id: 'i1',
    from: 'sketch',
    to: 'candidate',
    reason: 'test',
  };
  const orig = mkIdea({ id: 'i1' });
  applyPromotion(orig, decision);
  // 原 idea 没 depth 字段 (默认是 sketch 在 parseDepth 里赋的)
  assert.equal(orig.depth, undefined);
  assert.equal(orig.promoted_at, undefined);
});

test('applyPromotion: 保留其他字段', () => {
  const decision = {
    id: 'i1',
    from: 'sketch',
    to: 'candidate',
    reason: 'test',
  };
  const orig = mkIdea({
    id: 'i1',
    elo_rating: 1300,
    wins: 1,
    signals: ['novelty'],
  });
  const r = applyPromotion(orig, decision);
  assert.equal(r.id, 'i1');
  assert.equal(r.elo_rating, 1300);
  assert.equal(r.wins, 1);
  assert.deepEqual(r.signals, ['novelty']);
});
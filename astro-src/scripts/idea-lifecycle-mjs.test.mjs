#!/usr/bin/env node
// astro-src/scripts/idea-lifecycle.test.mjs
//
// Tests for R7 polish: astro-src/lib/idea-lifecycle.mjs.
// Tests constants and pure functions from the .mjs file (not the .ts file).

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

test('IDEA_DEPTH_ORDER: candidate=1', () => {
  assert.equal(IDEA_DEPTH_ORDER.candidate, 1);
});

test('IDEA_DEPTH_ORDER: under_review=2', () => {
  assert.equal(IDEA_DEPTH_ORDER.under_review, 2);
});

test('IDEA_DEPTH_ORDER: promoted=3', () => {
  assert.equal(IDEA_DEPTH_ORDER.promoted, 3);
});

// ---------- GATE_THRESHOLDS ----------
test('GATE_THRESHOLDS: sketchToCandidate has minElo and minWins', () => {
  assert.equal(GATE_THRESHOLDS.sketchToCandidate.minElo, 1232);
  assert.equal(GATE_THRESHOLDS.sketchToCandidate.minWins, 1);
});

test('GATE_THRESHOLDS: candidateToUnderReview has all required fields', () => {
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minElo, 1250);
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minMatches, 2);
  assert.equal(GATE_THRESHOLDS.candidateToUnderReview.minWins, 1);
});

test('GATE_THRESHOLDS: underReviewToPromoted has all required fields', () => {
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minElo, 1280);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minMatches, 3);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.minWins, 2);
  assert.equal(GATE_THRESHOLDS.underReviewToPromoted.requiresNonLimitationSignal, true);
});

// ---------- evaluatePromotion: sketch promotion ----------
test('evaluatePromotion: sketch → candidate meets thresholds', () => {
  const r = evaluatePromotion(mkIdea({ elo_rating: 1300, wins: 1 }));
  assert.notEqual(r, null);
  assert.equal(r.from, 'sketch');
  assert.equal(r.to, 'candidate');
});

test('evaluatePromotion: sketch fails due to low elo', () => {
  assert.equal(evaluatePromotion(mkIdea({ elo_rating: 1231, wins: 1 })), null);
});

test('evaluatePromotion: sketch fails due to zero wins', () => {
  assert.equal(evaluatePromotion(mkIdea({ elo_rating: 1300, wins: 0 })), null);
});

test('evaluatePromotion: sketch boundary case - elo 1232, wins 1 passes', () => {
  assert.notEqual(evaluatePromotion(mkIdea({ elo_rating: 1232, wins: 1 })), null);
});

// ---------- evaluatePromotion: candidate promotion ----------
test('evaluatePromotion: candidate → under_review meets thresholds', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1300,
    matches: 2,
    wins: 1,
  }));
  assert.notEqual(r, null);
  assert.equal(r.from, 'candidate');
  assert.equal(r.to, 'under_review');
});

test('evaluatePromotion: candidate fails with insufficient matches', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1300,
    matches: 1,
    wins: 1,
  })), null);
});

test('evaluatePromotion: candidate fails with insufficient wins', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'candidate',
    elo_rating: 1300,
    matches: 2,
    wins: 0,
  })), null);
});

// ---------- evaluatePromotion: under_review promotion ----------
test('evaluatePromotion: under_review → promoted meets all thresholds with valid signal', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: ['novelty'],
  }));
  assert.notEqual(r, null);
  assert.equal(r.to, 'promoted');
});

test('evaluatePromotion: under_review fails with only limitations signal', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: ['limitations'],
  })), null);
});

test('evaluatePromotion: under_review fails with empty signals array', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: [],
  })), null);
});

test('evaluatePromotion: under_review passes with limitations + novelty', () => {
  const r = evaluatePromotion(mkIdea({
    depth: 'under_review',
    elo_rating: 1300,
    matches: 3,
    wins: 2,
    signals: ['limitations', 'novelty'],
  }));
  assert.notEqual(r, null);
  assert.equal(r.to, 'promoted');
});

// ---------- evaluatePromotion: already promoted ----------
test('evaluatePromotion: already promoted returns null', () => {
  assert.equal(evaluatePromotion(mkIdea({
    depth: 'promoted',
    elo_rating: 2000,
    matches: 10,
    wins: 10,
  })), null);
});

// ---------- evaluatePromotion: defaults ----------
test('evaluatePromotion: default elo is 1200', () => {
  const idea = mkIdea({ wins: 1 });
  delete idea.elo_rating;
  assert.equal(evaluatePromotion(idea), null); // 1200 < 1232
});

test('evaluatePromotion: default matches is 0', () => {
  const idea = mkIdea({
    depth: 'candidate',
    elo_rating: 1300,
    wins: 1,
  });
  delete idea.matches;
  assert.equal(evaluatePromotion(idea), null);
});

test('evaluatePromotion: default wins is 0', () => {
  const idea = mkIdea({
    depth: 'candidate',
    elo_rating: 1300,
    matches: 2,
  });
  delete idea.wins;
  assert.equal(evaluatePromotion(idea), null);
});

// ---------- applyPromotion ----------
test('applyPromotion: sets depth to to value', () => {
  const decision = { id: 'i1', from: 'sketch', to: 'candidate', reason: 'test' };
  const r = applyPromotion(mkIdea({ id: 'i1' }), decision);
  assert.equal(r.depth, 'candidate');
});

test('applyPromotion: sets promoted_at to ISO string', () => {
  const decision = { id: 'i1', from: 'sketch', to: 'candidate', reason: 'test' };
  const r = applyPromotion(mkIdea({ id: 'i1' }), decision);
  assert.match(r.promoted_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('applyPromotion: preserves other fields', () => {
  const decision = { id: 'i1', from: 'sketch', to: 'candidate', reason: 'test' };
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

test('applyPromotion: does not modify original idea', () => {
  const decision = { id: 'i1', from: 'sketch', to: 'candidate', reason: 'test' };
  const orig = mkIdea({ id: 'i1' });
  applyPromotion(orig, decision);
  assert.equal(orig.depth, undefined);
  assert.equal(orig.promoted_at, undefined);
});

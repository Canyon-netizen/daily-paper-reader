#!/usr/bin/env node
// astro-src/scripts/feedback.test.mjs
//
// Tests for R7 F.1.4 user feedback loop helpers.

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

const mod = await loadTs('lib/agents/feedback.ts');
const {
  recordFeedback,
  getFeedbackFor,
  adoptionRateByType,
  feedbackScoreByProposalId,
  tallyVotesByProposalId,
  summarizeFeedback,
  PROPOSAL_FEEDBACK_KEY,
} = mod;

function fb(proposalId, type, vote, createdAt = 1000, comment) {
  return { proposalId, type, vote, createdAt, comment };
}

// ----- recordFeedback -----

test('recordFeedback: append to empty list', () => {
  const out = recordFeedback(fb('p1', 'add_paper', 'up'));
  assert.equal(out.length, 1);
});

test('recordFeedback: same proposalId overwrites previous vote', () => {
  const out = recordFeedback(fb('p1', 'add_paper', 'down', 2000), [
    fb('p1', 'add_paper', 'up', 1000),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].vote, 'down');
});

test('recordFeedback: preserves other proposals', () => {
  const out = recordFeedback(fb('p2', 'cite_paper', 'up'), [
    fb('p1', 'add_paper', 'up'),
  ]);
  assert.equal(out.length, 2);
});

// ----- getFeedbackFor -----

test('getFeedbackFor: returns latest by createdAt', () => {
  const list = [
    fb('p1', 'add_paper', 'up', 1000),
    fb('p1', 'add_paper', 'down', 3000),
    fb('p1', 'add_paper', 'skip', 2000),
  ];
  const f = getFeedbackFor('p1', list);
  assert.equal(f.vote, 'down');
  assert.equal(f.createdAt, 3000);
});

test('getFeedbackFor: returns null when missing', () => {
  assert.equal(getFeedbackFor('nope', []), null);
});

// ----- adoptionRateByType -----

test('adoptionRateByType: skip does not count in denominator', () => {
  const stats = adoptionRateByType([
    fb('a', 'add_paper', 'up'),
    fb('b', 'add_paper', 'up'),
    fb('c', 'add_paper', 'skip'),
    fb('d', 'add_paper', 'skip'),
    fb('e', 'add_paper', 'down'),
  ]);
  assert.equal(stats.add_paper, 2 / 3);
});

test('adoptionRateByType: only skip → undefined (skip default 0.5 in confidence)', () => {
  const stats = adoptionRateByType([
    fb('a', 'add_paper', 'skip'),
    fb('b', 'add_paper', 'skip'),
  ]);
  assert.equal(stats.add_paper, undefined);
});

test('adoptionRateByType: empty list returns empty object', () => {
  assert.deepEqual(adoptionRateByType([]), {});
});

// ----- feedbackScoreByProposalId -----

test('feedbackScoreByProposalId: up=0.9, down=0.1, skip=0.5', () => {
  const map = feedbackScoreByProposalId([
    fb('a', 'add_paper', 'up'),
    fb('b', 'add_paper', 'down'),
    fb('c', 'add_paper', 'skip'),
  ]);
  assert.equal(map.a, 0.9);
  assert.equal(map.b, 0.1);
  assert.equal(map.c, 0.5);
});

// ----- tallyVotesByProposalId -----

test('tallyVotesByProposalId: counts per proposalId', () => {
  const tally = tallyVotesByProposalId([
    fb('p1', 'add_paper', 'up'),
    fb('p1', 'add_paper', 'up'),
    fb('p1', 'add_paper', 'down'),
    fb('p1', 'add_paper', 'skip'),
    fb('p2', 'cite_paper', 'up'),
  ]);
  assert.deepEqual(tally.p1, { up: 2, down: 1, skip: 1 });
  assert.deepEqual(tally.p2, { up: 1, down: 0, skip: 0 });
});

// ----- summarizeFeedback -----

test('summarizeFeedback: total + approvalRate', () => {
  const s = summarizeFeedback([
    fb('a', 'add_paper', 'up'),
    fb('b', 'add_paper', 'up'),
    fb('c', 'add_paper', 'down'),
    fb('d', 'add_paper', 'skip'),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.up, 2);
  assert.equal(s.down, 1);
  assert.equal(s.skip, 1);
  assert.equal(s.approvalRate, 2 / 3);
});

test('summarizeFeedback: only skip → approvalRate undefined', () => {
  const s = summarizeFeedback([fb('a', 'add_paper', 'skip')]);
  assert.equal(s.approvalRate, undefined);
});

// ----- key -----

test('PROPOSAL_FEEDBACK_KEY: stable string', () => {
  assert.equal(PROPOSAL_FEEDBACK_KEY, 'dpr_proposal_feedback_v1');
});
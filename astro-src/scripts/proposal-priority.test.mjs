#!/usr/bin/env node
// astro-src/scripts/proposal-priority.test.mjs
//
// Tests for R7 AP.3 proposal priority scoring.

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
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/priority.ts');
const { scoreProposalPriority } = mod;

test('scoreProposalPriority: default weights sum correctly', () => {
  const proposal = { id: 'p1', feedbackScore: 1, confidence: 1, evidenceSize: 1 };
  const score = scoreProposalPriority(proposal);
  assert.equal(score, 1);
});

test('scoreProposalPriority: all zeros gives 0.5', () => {
  const proposal = { id: 'p1' };
  const score = scoreProposalPriority(proposal);
  assert.equal(score, 0.5);
});

test('scoreProposalPriority: custom weights work', () => {
  const proposal = { id: 'p1', feedbackScore: 1, confidence: 0, evidenceSize: 0 };
  const score = scoreProposalPriority(proposal, { feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.2 });
  // feedback=1*0.5 + confidence=0*0.3 + evidence=0*0.2 = 0.5
  assert.equal(score, 0.5);
});

test('scoreProposalPriority: throws on invalid weights', () => {
  const proposal = { id: 'p1' };
  assert.throws(() => {
    scoreProposalPriority(proposal, { feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.1 });
  });
});

test('scoreProposalPriority: partial metrics use defaults', () => {
  const proposal = { id: 'p1', feedbackScore: 1 };
  const score = scoreProposalPriority(proposal);
  // feedback=1*0.5 + confidence=0.5*0.3 + evidence=0.5*0.2 = 0.5 + 0.15 + 0.1 = 0.75
  assert.equal(score, 0.75);
});

test('scoreProposalPriority: caps at 0 and 1', () => {
  const proposal = { id: 'p1', feedbackScore: 2, confidence: -1, evidenceSize: 0.5 };
  const score = scoreProposalPriority(proposal);
  assert.ok(score >= 0 && score <= 1);
});

test('scoreProposalPriority: real-world example', () => {
  const proposal = {
    id: 'p1',
    feedbackScore: 0.8,
    confidence: 0.9,
    evidenceSize: 0.6,
  };
  const score = scoreProposalPriority(proposal);
  // 0.8*0.5 + 0.9*0.3 + 0.6*0.2 = 0.4 + 0.27 + 0.12 = 0.79
  assert.ok(Math.abs(score - 0.79) < 0.001);
});

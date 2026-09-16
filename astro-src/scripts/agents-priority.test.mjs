#!/usr/bin/env node
// astro-src/scripts/agents-priority.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/priority.ts.

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

const mod = await loadTs('lib/agents/priority.ts');
const { scoreProposalPriority } = mod;

test('scoreProposalPriority: 默认权重 (0.5/0.3/0.2)', () => {
  const r = scoreProposalPriority({
    id: 'p1',
    feedbackScore: 1,
    confidence: 1,
    evidenceSize: 1,
  });
  // 1*0.5 + 1*0.3 + 1*0.2 = 1
  assert.equal(r, 1);
});

test('scoreProposalPriority: 缺 metrics → 默认 0.5', () => {
  const r = scoreProposalPriority({ id: 'p1' });
  // 0.5*0.5 + 0.5*0.3 + 0.5*0.2 = 0.5
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 全 0 → 0', () => {
  const r = scoreProposalPriority({
    id: 'p1',
    feedbackScore: 0,
    confidence: 0,
    evidenceSize: 0,
  });
  assert.equal(r, 0);
});

test('scoreProposalPriority: 权重和 ≠ 1 → throw', () => {
  assert.throws(
    () => scoreProposalPriority({ id: 'p1' }, { feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.1 }),
    /Weights must sum to 1/
  );
});

test('scoreProposalPriority: 权重浮点和 ≈ 1 通过', () => {
  // 0.5 + 0.3 + 0.2 = 1.0
  const r = scoreProposalPriority(
    { id: 'p1', feedbackScore: 0.5, confidence: 0.5, evidenceSize: 0.5 },
    { feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.2 }
  );
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 权重允许 0.001 误差', () => {
  const r = scoreProposalPriority(
    { id: 'p1' },
    { feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.2001 }
  );
  // sum = 1.0001,abs < 0.001 → 通过
  assert.equal(typeof r, 'number');
});

test('scoreProposalPriority: 权重 1.001 → throw', () => {
  assert.throws(
    () => scoreProposalPriority({ id: 'p1' }, { feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.201 }),
    /Weights must sum to 1/
  );
});

test('scoreProposalPriority: 夹紧到 [0,1](虽然 normalize 已夹紧)', () => {
  // feedback=1, confidence=1, evidence=1 → sum=1 → ok
  const r = scoreProposalPriority({
    id: 'p1',
    feedbackScore: 1,
    confidence: 1,
    evidenceSize: 1,
  });
  assert.ok(r >= 0 && r <= 1);
});

test('scoreProposalPriority: undefined metrics → 0.5', () => {
  // 0.5 * 0.5 + 0.5 * 0.3 + 0.5 * 0.2 = 0.5
  const r = scoreProposalPriority({ id: 'p1', feedbackScore: undefined, confidence: undefined, evidenceSize: undefined });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: null metrics → 0.5', () => {
  const r = scoreProposalPriority({ id: 'p1', feedbackScore: null, confidence: null, evidenceSize: null });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 高 feedback + 低 confidence', () => {
  const r = scoreProposalPriority({
    id: 'p1',
    feedbackScore: 1,
    confidence: 0,
    evidenceSize: 0,
  });
  // 1*0.5 + 0*0.3 + 0*0.2 = 0.5
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 自定义权重', () => {
  // confidence=1, others=0,confidenceWeight=1
  const r = scoreProposalPriority(
    { id: 'p1', feedbackScore: 0, confidence: 1, evidenceSize: 0 },
    { feedbackWeight: 0, confidenceWeight: 1, evidenceWeight: 0 }
  );
  assert.equal(r, 1);
});
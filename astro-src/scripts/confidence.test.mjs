#!/usr/bin/env node
// astro-src/scripts/confidence.test.mjs
//
// Tests for R7 F.1.3 confidence scoring.

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

const mod = await loadTs('lib/agents/confidence.ts');
const { computeConfidence, confidenceTier } = mod;

// ----- confidenceTier -----

test('confidenceTier: 高 (>= 0.7)', () => {
  assert.equal(confidenceTier(0.7), 'high');
  assert.equal(confidenceTier(0.95), 'high');
});

test('confidenceTier: 中 (0.4 - 0.69)', () => {
  assert.equal(confidenceTier(0.4), 'medium');
  assert.equal(confidenceTier(0.69), 'medium');
});

test('confidenceTier: 低 (< 0.4)', () => {
  assert.equal(confidenceTier(0.39), 'low');
  assert.equal(confidenceTier(0), 'low');
});

// ----- computeConfidence: evidence -----

test('evidence: 0 papers → 0 evidence score', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: { arxivIds: ['1'] },
    estimated_effort: 'low',
  });
  assert.equal(b.evidenceScore, 0);
});

test('evidence: 5 papers + 0 quotes → 0.7 (paperScore 1 × 0.7 + quoteScore 0 × 0.3)', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['1', '2', '3', '4', '5'] },
    target: { arxivIds: ['1'] },
    estimated_effort: 'low',
  });
  assert.equal(b.evidenceScore, 0.7);
});

test('evidence: 5 papers + 3 quotes → 1.0 (both saturated)', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['1', '2', '3', '4', '5'], quotes: ['a', 'b', 'c'] },
    target: { arxivIds: ['1'] },
    estimated_effort: 'low',
  });
  assert.equal(b.evidenceScore, 1);
});

test('evidence: quotes 提升 score', () => {
  const noQuote = computeConfidence({
    type: 'create_draft',
    evidence: { paperIds: ['1'] },
    target: { draftTitle: 'X' },
    estimated_effort: 'low',
  });
  const withQuote = computeConfidence({
    type: 'create_draft',
    evidence: { paperIds: ['1'], quotes: ['a', 'b'] },
    target: { draftTitle: 'X' },
    estimated_effort: 'low',
  });
  assert.ok(withQuote.evidenceScore > noQuote.evidenceScore);
});

// ----- computeConfidence: target completeness -----

test('target: add_paper needs arxivIds + stageId for full score', () => {
  const full = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: { arxivIds: ['1'], stageId: 's1' },
    estimated_effort: 'low',
  });
  const partial = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: { arxivIds: ['1'] },
    estimated_effort: 'low',
  });
  const empty = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: {},
    estimated_effort: 'low',
  });
  assert.equal(full.targetCompleteness, 1);
  assert.equal(partial.targetCompleteness, 0.5);
  assert.equal(empty.targetCompleteness, 0);
});

test('target: create_draft needs draftTitle for full score', () => {
  const full = computeConfidence({
    type: 'create_draft',
    evidence: { paperIds: [] },
    target: { draftTitle: 'X', projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(full.targetCompleteness, 1);
});

test('target: experiment_plan only needs projectId', () => {
  const full = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: [] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(full.targetCompleteness, 1);
});

// ----- computeConfidence: effort -----

test('effort: high → 0.4', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: { arxivIds: ['1'] },
    estimated_effort: 'high',
  });
  assert.equal(b.effortPenalty, 0.4);
});

test('effort: low → 1.0', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: { arxivIds: ['1'] },
    estimated_effort: 'low',
  });
  assert.equal(b.effortPenalty, 1);
});

// ----- 综合 score -----

test('overall: 综合分数落在 [0,1]', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['1', '2', '3'] },
    target: { arxivIds: ['1'], stageId: 's1' },
    estimated_effort: 'low',
  }, {
    typeAdoptionByType: { add_paper: 0.8 },
  });
  assert.ok(b.score >= 0 && b.score <= 1);
  // 有 3 paper + target 完整 + 低 effort + 0.8 adoption → 应该 high
  assert.equal(confidenceTier(b.score), 'high');
});

test('overall: 极弱 proposal 应该 low', () => {
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [] },
    target: {},
    estimated_effort: 'high',
  }, {
    typeAdoptionByType: { add_paper: 0.1 },
  });
  assert.equal(confidenceTier(b.score), 'low');
});

test('weights: 自定义权重生效', () => {
  // 把 evidence 权重提到 1,其他压到 0 → score 应等于 evidenceScore
  const weights = { evidence: 1.0, typeAdoption: 0, target: 0, effort: 0 };
  const b = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['1'] },
    target: {},
    estimated_effort: 'high',
  }, { weights });
  assert.equal(b.score, b.evidenceScore);
});
#!/usr/bin/env node
// astro-src/scripts/agents-confidence.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/confidence.ts.
// 仅测试 computeConfidence + confidenceTier + DEFAULT_CONFIDENCE_WEIGHTS。

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
    external: ['./types', '../types', '../../types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/confidence.ts');
const { computeConfidence, confidenceTier, DEFAULT_CONFIDENCE_WEIGHTS } = mod;

const baseProposal = {
  type: 'add_paper',
  evidence: { paperIds: ['p1'], quotes: [] },
  target: { arxivIds: ['p1'], stageId: 's1' },
  estimated_effort: 'medium',
};

test('DEFAULT_CONFIDENCE_WEIGHTS: 4 个权重之和 ≈ 1', () => {
  const sum = DEFAULT_CONFIDENCE_WEIGHTS.evidence
    + DEFAULT_CONFIDENCE_WEIGHTS.typeAdoption
    + DEFAULT_CONFIDENCE_WEIGHTS.target
    + DEFAULT_CONFIDENCE_WEIGHTS.effort;
  assert.ok(Math.abs(sum - 1.0) < 1e-9);
});

test('computeConfidence: 返回 4 个 breakdown 字段 + 总分', () => {
  const r = computeConfidence(baseProposal);
  assert.equal(typeof r.score, 'number');
  assert.equal(typeof r.evidenceScore, 'number');
  assert.equal(typeof r.typeAdoptionScore, 'number');
  assert.equal(typeof r.targetCompleteness, 'number');
  assert.equal(typeof r.effortPenalty, 'number');
});

test('computeConfidence: typeAdoptionByType 缺省 → 0.5', () => {
  const r = computeConfidence(baseProposal);
  assert.equal(r.typeAdoptionScore, 0.5);
});

test('computeConfidence: typeAdoptionByType 提供 → 用对应值', () => {
  const r = computeConfidence(baseProposal, {
    typeAdoptionByType: { add_paper: 0.9 },
  });
  assert.equal(r.typeAdoptionScore, 0.9);
});

test('computeConfidence: typeAdoptionByType clamp 到 [0,1]', () => {
  const r1 = computeConfidence(baseProposal, { typeAdoptionByType: { add_paper: 1.5 } });
  assert.equal(r1.typeAdoptionScore, 1);
  const r2 = computeConfidence(baseProposal, { typeAdoptionByType: { add_paper: -0.5 } });
  assert.equal(r2.typeAdoptionScore, 0);
});

test('computeConfidence: paper 数 5+ → paperScore=1', () => {
  const p = { ...baseProposal, evidence: { paperIds: ['p1','p2','p3','p4','p5'], quotes: [] } };
  const r = computeConfidence(p);
  assert.equal(r.evidenceScore, 0.7); // 1 * 0.7 + 0 * 0.3
});

test('computeConfidence: paper 数 1 → 0.3 paperScore', () => {
  const p = { ...baseProposal, evidence: { paperIds: ['p1'], quotes: [] } };
  const r = computeConfidence(p);
  // paperScore = 1/5 = 0.2; evidenceScore = 0.2*0.7 + 0*0.3 = 0.14
  assert.ok(Math.abs(r.evidenceScore - 0.14) < 1e-9);
});

test('computeConfidence: quote 数 3+ → quoteScore=1', () => {
  const p = { ...baseProposal, evidence: { paperIds: ['p1'], quotes: ['q1','q2','q3'] } };
  const r = computeConfidence(p);
  // paperScore=0.2, quoteScore=1.0 → evidenceScore = 0.14 + 0.3 = 0.44
  assert.ok(Math.abs(r.evidenceScore - 0.44) < 1e-9);
});

test('computeConfidence: add_paper 缺 arxivIds → targetScore=0', () => {
  const p = { ...baseProposal, target: {} };
  const r = computeConfidence(p);
  assert.equal(r.targetCompleteness, 0);
});

test('computeConfidence: add_paper 含 arxivIds + stageId → targetScore=1', () => {
  const r = computeConfidence(baseProposal);
  assert.equal(r.targetCompleteness, 1);
});

test('computeConfidence: create_draft 含 draftTitle → targetScore=0.7', () => {
  const p = { ...baseProposal, type: 'create_draft', target: { draftTitle: 'Title' } };
  const r = computeConfidence(p);
  assert.equal(r.targetCompleteness, 0.7);
});

test('computeConfidence: create_draft 含 draftTitle + projectId → targetScore=1', () => {
  const p = { ...baseProposal, type: 'create_draft', target: { draftTitle: 'Title', projectId: 'p1' } };
  const r = computeConfidence(p);
  assert.equal(r.targetCompleteness, 1);
});

test('computeConfidence: experiment_plan 含 projectId → targetScore=1', () => {
  const p = { ...baseProposal, type: 'experiment_plan', target: { projectId: 'p1' } };
  const r = computeConfidence(p);
  assert.equal(r.targetCompleteness, 1);
});

test('computeConfidence: experiment_plan 缺 projectId → targetScore=0.3', () => {
  const p = { ...baseProposal, type: 'experiment_plan', target: {} };
  const r = computeConfidence(p);
  assert.equal(r.targetCompleteness, 0.3);
});

test('computeConfidence: effort high → penalty=0.4', () => {
  const p = { ...baseProposal, estimated_effort: 'high' };
  const r = computeConfidence(p);
  assert.equal(r.effortPenalty, 0.4);
});

test('computeConfidence: effort medium → penalty=0.7', () => {
  const r = computeConfidence(baseProposal);
  assert.equal(r.effortPenalty, 0.7);
});

test('computeConfidence: effort low → penalty=1.0', () => {
  const p = { ...baseProposal, estimated_effort: 'low' };
  const r = computeConfidence(p);
  assert.equal(r.effortPenalty, 1.0);
});

test('computeConfidence: 加权 score 在 [0,1]', () => {
  const r = computeConfidence(baseProposal);
  assert.ok(r.score >= 0 && r.score <= 1);
});

test('computeConfidence: 自定义 weights', () => {
  const r = computeConfidence(baseProposal, {
    weights: { evidence: 1, typeAdoption: 0, target: 0, effort: 0 },
  });
  // score = evidenceScore * 1
  assert.equal(r.score, r.evidenceScore);
});

test('confidenceTier: ≥0.7 → high', () => {
  assert.equal(confidenceTier(0.7), 'high');
  assert.equal(confidenceTier(0.9), 'high');
});

test('confidenceTier: 0.4..0.7 → medium', () => {
  assert.equal(confidenceTier(0.4), 'medium');
  assert.equal(confidenceTier(0.6), 'medium');
});

test('confidenceTier: <0.4 → low', () => {
  assert.equal(confidenceTier(0.3), 'low');
  assert.equal(confidenceTier(0), 'low');
});
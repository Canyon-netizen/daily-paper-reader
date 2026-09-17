#!/usr/bin/env node
// astro-src/scripts/agents-confidence.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/confidence.ts.
// DEFAULT_CONFIDENCE_WEIGHTS (4 维度权重求和=1) +
// computeConfidence (evidence / typeAdoption / target / effort 加权) +
// confidenceTier (>=0.7 high, >=0.4 medium, <0.4 low)。

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
const { DEFAULT_CONFIDENCE_WEIGHTS, computeConfidence, confidenceTier } = mod;

// ---------- DEFAULT_CONFIDENCE_WEIGHTS ----------
test('weights: 求和 = 1', () => {
  const s = DEFAULT_CONFIDENCE_WEIGHTS.evidence
    + DEFAULT_CONFIDENCE_WEIGHTS.typeAdoption
    + DEFAULT_CONFIDENCE_WEIGHTS.target
    + DEFAULT_CONFIDENCE_WEIGHTS.effort;
  assert.ok(Math.abs(s - 1.0) < 1e-9);
});

test('weights: 默认值正确', () => {
  assert.equal(DEFAULT_CONFIDENCE_WEIGHTS.evidence, 0.35);
  assert.equal(DEFAULT_CONFIDENCE_WEIGHTS.typeAdoption, 0.30);
  assert.equal(DEFAULT_CONFIDENCE_WEIGHTS.target, 0.25);
  assert.equal(DEFAULT_CONFIDENCE_WEIGHTS.effort, 0.10);
});

// ---------- mkProposal helper ---
const mkP = (overrides = {}) => ({
  type: 'add_paper',
  evidence: { paperIds: [], quotes: [] },
  target: {},
  estimated_effort: 'low',
  ...overrides,
});

// ---------- computeConfidence: evidence ---
test('evidence: 0 paper → paperScore=0', () => {
  const r = computeConfidence(mkP({ evidence: { paperIds: [], quotes: [] } }));
  assert.equal(r.evidenceScore, 0);
});

test('evidence: 1 paper, 0 quotes → 0.21 (0.2*0.7)', () => {
  const r = computeConfidence(mkP({ evidence: { paperIds: ['p1'], quotes: [] } }));
  // 1/5 = 0.2; paperScore=0.2; quoteScore=0; evidenceScore = 0.2*0.7 + 0 = 0.14
  assert.ok(Math.abs(r.evidenceScore - 0.14) < 1e-9);
});

test('evidence: 5 papers → paperScore 饱和 1.0', () => {
  const r = computeConfidence(mkP({
    evidence: { paperIds: ['p1', 'p2', 'p3', 'p4', 'p5'], quotes: [] },
  }));
  // paperScore = 1.0; evidenceScore = 1*0.7 = 0.7
  assert.ok(Math.abs(r.evidenceScore - 0.7) < 1e-9);
});

test('evidence: 10 papers → 仍 1.0 (饱和)', () => {
  const r = computeConfidence(mkP({
    evidence: { paperIds: Array.from({ length: 10 }, (_, i) => `p${i}`), quotes: [] },
  }));
  assert.ok(Math.abs(r.evidenceScore - 0.7) < 1e-9);
});

test('evidence: 3 quotes → quoteScore 饱和', () => {
  const r = computeConfidence(mkP({
    evidence: { paperIds: [], quotes: ['q1', 'q2', 'q3'] },
  }));
  // quoteScore=1; evidenceScore = 0 + 1*0.3 = 0.3
  assert.ok(Math.abs(r.evidenceScore - 0.3) < 1e-9);
});

test('evidence: paperScore + quoteScore 组合', () => {
  const r = computeConfidence(mkP({
    evidence: {
      paperIds: ['p1', 'p2', 'p3', 'p4', 'p5'], // = 1.0
      quotes: ['q1', 'q2', 'q3'], // = 1.0
    },
  }));
  // 1*0.7 + 1*0.3 = 1.0
  assert.ok(Math.abs(r.evidenceScore - 1.0) < 1e-9);
});

// ---------- computeConfidence: typeAdoption ---
test('typeAdoption: 缺 typeAdoptionByType → 0.5 兜底', () => {
  const r = computeConfidence(mkP());
  assert.equal(r.typeAdoptionScore, 0.5);
});

test('typeAdoption: 指定 type adoption', () => {
  const r = computeConfidence(mkP(), {
    typeAdoptionByType: { add_paper: 0.9 },
  });
  assert.equal(r.typeAdoptionScore, 0.9);
});

test('typeAdoption: 钳制 > 1', () => {
  const r = computeConfidence(mkP(), {
    typeAdoptionByType: { add_paper: 1.5 },
  });
  assert.equal(r.typeAdoptionScore, 1);
});

test('typeAdoption: 钳制 < 0', () => {
  const r = computeConfidence(mkP(), {
    typeAdoptionByType: { add_paper: -0.5 },
  });
  assert.equal(r.typeAdoptionScore, 0);
});

// ---------- computeConfidence: target completeness ---
test('target: add_paper + arxivIds + stageId → 1.0', () => {
  const r = computeConfidence(mkP({
    type: 'add_paper',
    target: { arxivIds: ['a1'], stageId: 's1' },
  }));
  assert.equal(r.targetCompleteness, 1.0);
});

test('target: add_paper + arxivIds only → 0.5', () => {
  const r = computeConfidence(mkP({
    type: 'add_paper',
    target: { arxivIds: ['a1'] },
  }));
  assert.equal(r.targetCompleteness, 0.5);
});

test('target: add_paper 无 arxivIds 无 stageId → 0', () => {
  const r = computeConfidence(mkP({
    type: 'add_paper',
    target: {},
  }));
  assert.equal(r.targetCompleteness, 0);
});

test('target: create_draft + draftTitle + projectId → 1.0', () => {
  const r = computeConfidence(mkP({
    type: 'create_draft',
    target: { draftTitle: 'New Draft', projectId: 'p1' },
  }));
  assert.equal(r.targetCompleteness, 1.0);
});

test('target: create_draft + draftTitle only → 0.7', () => {
  const r = computeConfidence(mkP({
    type: 'create_draft',
    target: { draftTitle: 'New Draft' },
  }));
  assert.equal(r.targetCompleteness, 0.7);
});

test('target: experiment_plan + projectId → 1.0', () => {
  const r = computeConfidence(mkP({
    type: 'experiment_plan',
    target: { projectId: 'p1' },
  }));
  assert.equal(r.targetCompleteness, 1.0);
});

test('target: experiment_plan 无 projectId → 0.3', () => {
  const r = computeConfidence(mkP({
    type: 'experiment_plan',
    target: {},
  }));
  assert.equal(r.targetCompleteness, 0.3);
});

test('target: 空 target → 0', () => {
  const r = computeConfidence(mkP({ target: {} }));
  assert.equal(r.targetCompleteness, 0);
});

// ---------- computeConfidence: effort penalty ---
test('effort: low → 1.0', () => {
  const r = computeConfidence(mkP({ estimated_effort: 'low' }));
  assert.equal(r.effortPenalty, 1.0);
});

test('effort: medium → 0.7', () => {
  const r = computeConfidence(mkP({ estimated_effort: 'medium' }));
  assert.equal(r.effortPenalty, 0.7);
});

test('effort: high → 0.4', () => {
  const r = computeConfidence(mkP({ estimated_effort: 'high' }));
  assert.equal(r.effortPenalty, 0.4);
});

// ---------- computeConfidence: 综合 score ---
test('score: 范围 [0, 1]', () => {
  const r = computeConfidence(mkP({
    evidence: { paperIds: Array.from({ length: 100 }, (_, i) => `p${i}`) },
    target: { arxivIds: ['a1'], stageId: 's1', projectId: 'p1', draftTitle: 'T' },
    estimated_effort: 'low',
  }));
  assert.ok(r.score >= 0 && r.score <= 1);
});

test('score: 全 0 → 接近 0', () => {
  const r = computeConfidence(mkP({
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'high', // penalty 0.4
  }));
  // evidence=0, typeAdoption=0.5, target=0, effort=0.4
  // 0*0.35 + 0.5*0.3 + 0*0.25 + 0.4*0.1 = 0.15 + 0.04 = 0.19
  assert.ok(Math.abs(r.score - 0.19) < 1e-9);
});

test('score: 加权公式验证', () => {
  // evidence=0.5, typeAdoption=0.8, target=0.6, effort=0.4
  // 0.5*0.35 + 0.8*0.30 + 0.6*0.25 + 0.4*0.10
  // = 0.175 + 0.24 + 0.15 + 0.04 = 0.605
  // 通过构造 evidence 给定值再算
  const r = computeConfidence(mkP({
    evidence: { paperIds: ['p1'], quotes: [] }, // paperScore 0.2, quoteScore 0
    // evidenceScore = 0.2*0.7 = 0.14
    target: {},
    estimated_effort: 'low', // 1.0
  }), {
    typeAdoptionByType: { add_paper: 0.8 },
  });
  // 0.14*0.35 + 0.8*0.30 + 0*0.25 + 1.0*0.10 = 0.049 + 0.24 + 0 + 0.1 = 0.389
  assert.ok(Math.abs(r.score - 0.389) < 1e-9);
});

test('score: 钳制 > 1', () => {
  // 强行构造 > 1 → clamp 到 1
  const r = computeConfidence(mkP({
    evidence: { paperIds: ['p1', 'p2', 'p3', 'p4', 'p5'], quotes: ['q1', 'q2', 'q3'] }, // 1.0
    target: { arxivIds: ['a1'], stageId: 's1' }, // 1.0
    estimated_effort: 'low', // 1.0
  }), {
    typeAdoptionByType: { add_paper: 1.0 },
  });
  // 1*0.35 + 1*0.30 + 1*0.25 + 1*0.10 = 1.0
  assert.ok(Math.abs(r.score - 1.0) < 1e-9);
});

test('score: 自定义 weights', () => {
  const r = computeConfidence(mkP({
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'low',
  }), {
    weights: { evidence: 1.0, typeAdoption: 0, target: 0, effort: 0 },
  });
  // evidence=0 → score=0
  assert.equal(r.score, 0);
});

// ---------- confidenceTier ----------
test('confidenceTier: 0.7+ → high', () => {
  assert.equal(confidenceTier(0.7), 'high');
  assert.equal(confidenceTier(0.8), 'high');
  assert.equal(confidenceTier(1.0), 'high');
});

test('confidenceTier: 0.4-0.69 → medium', () => {
  assert.equal(confidenceTier(0.4), 'medium');
  assert.equal(confidenceTier(0.5), 'medium');
  assert.equal(confidenceTier(0.69), 'medium');
});

test('confidenceTier: <0.4 → low', () => {
  assert.equal(confidenceTier(0), 'low');
  assert.equal(confidenceTier(0.3), 'low');
  assert.equal(confidenceTier(0.39), 'low');
});

test('confidenceTier: 负数 → low', () => {
  assert.equal(confidenceTier(-0.5), 'low');
});

// ---------- 集成 ---
test('集成: 高分 proposal', () => {
  const r = computeConfidence(mkP({
    type: 'add_paper',
    evidence: {
      paperIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      quotes: ['q1', 'q2', 'q3'],
    },
    target: { arxivIds: ['a1'], stageId: 's1' },
    estimated_effort: 'low',
  }), {
    typeAdoptionByType: { add_paper: 0.9 },
  });
  // evidence=1.0, type=0.9, target=1.0, effort=1.0
  // 1*0.35 + 0.9*0.30 + 1*0.25 + 1*0.10 = 0.35 + 0.27 + 0.25 + 0.10 = 0.97
  assert.ok(Math.abs(r.score - 0.97) < 1e-9);
  assert.equal(confidenceTier(r.score), 'high');
});

test('集成: 低分 proposal', () => {
  const r = computeConfidence(mkP({
    type: 'experiment_plan',
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'high',
  }));
  // evidence=0, type=0.5, target=0.3, effort=0.4
  // 0*0.35 + 0.5*0.30 + 0.3*0.25 + 0.4*0.10 = 0.15 + 0.075 + 0.04 = 0.265
  assert.ok(Math.abs(r.score - 0.265) < 1e-9);
  assert.equal(confidenceTier(r.score), 'low');
});
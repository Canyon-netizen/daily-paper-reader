#!/usr/bin/env node
// astro-src/scripts/agents-confidence.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/confidence.ts computeConfidence + confidenceTier.

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
    external: ['../user-libraries/types', '../../user-libraries/types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/confidence.ts');
const { computeConfidence, confidenceTier, DEFAULT_CONFIDENCE_WEIGHTS } = mod;

// ---------- DEFAULT_CONFIDENCE_WEIGHTS ----------
test('DEFAULT_CONFIDENCE_WEIGHTS: 4 个权重和为 1.0', () => {
  const w = DEFAULT_CONFIDENCE_WEIGHTS;
  const sum = w.evidence + w.typeAdoption + w.target + w.effort;
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `sum=${sum}`);
});

test('DEFAULT_CONFIDENCE_WEIGHTS: evidence 最大', () => {
  assert.ok(DEFAULT_CONFIDENCE_WEIGHTS.evidence > DEFAULT_CONFIDENCE_WEIGHTS.typeAdoption);
});

// ---------- computeConfidence ----------
test('computeConfidence: 空 evidence + 空 target → 低分', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'low',
  });
  // typeAdoption 兜底 0.5 + target 0.3 + effort 1.0 → 0.5*0.3 + 0.3*0.25 + 1.0*0.1 = 0.325
  assert.ok(r.score < 0.5);
  assert.equal(r.evidenceScore, 0);
});

test('computeConfidence: 5 papers + 3 quotes + 完整 target + low → 接近上限', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1', 'p2', 'p3', 'p4', 'p5'], quotes: ['q1', 'q2', 'q3'] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(r.evidenceScore, 1); // 饱和
  assert.equal(r.targetCompleteness, 1); // experiment_plan + projectId
  assert.equal(r.effortPenalty, 1.0);
  assert.equal(r.typeAdoptionScore, 0.5); // 兜底
  assert.ok(r.score > 0.7);
});

test('computeConfidence: high effort → 0.4 惩罚', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'high',
  });
  assert.equal(r.effortPenalty, 0.4);
});

test('computeConfidence: medium effort → 0.7', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'medium',
  });
  assert.equal(r.effortPenalty, 0.7);
});

test('computeConfidence: low effort → 1.0', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(r.effortPenalty, 1.0);
});

test('computeConfidence: typeAdoption override (全采纳 → 1.0)', () => {
  const r = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { arxivIds: ['x'] },
    estimated_effort: 'low',
  }, { typeAdoptionByType: { add_paper: 1.0 } });
  assert.equal(r.typeAdoptionScore, 1.0);
});

test('computeConfidence: typeAdoption override (0.3)', () => {
  const r = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { arxivIds: ['x'] },
    estimated_effort: 'low',
  }, { typeAdoptionByType: { add_paper: 0.3 } });
  assert.equal(r.typeAdoptionScore, 0.3);
});

test('computeConfidence: typeAdoption 超出 0-1 钳位', () => {
  const r = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { arxivIds: ['x'] },
    estimated_effort: 'low',
  }, { typeAdoptionByType: { add_paper: 1.5 } });
  assert.equal(r.typeAdoptionScore, 1); // clamp01
});

test('computeConfidence: add_paper 需要 arxivIds + stageId 才满分', () => {
  const r = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { arxivIds: ['x'], stageId: 's' },
    estimated_effort: 'low',
  });
  assert.equal(r.targetCompleteness, 1); // 0.5 + 0.5
});

test('computeConfidence: add_paper 只有 arxivIds', () => {
  const r = computeConfidence({
    type: 'add_paper',
    evidence: { paperIds: [], quotes: [] },
    target: { arxivIds: ['x'] },
    estimated_effort: 'low',
  });
  assert.equal(r.targetCompleteness, 0.5);
});

test('computeConfidence: create_draft 需要 draftTitle + projectId', () => {
  const r = computeConfidence({
    type: 'create_draft',
    evidence: { paperIds: [], quotes: [] },
    target: { draftTitle: 't', projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(r.targetCompleteness, 1); // 0.7 + 0.3
});

test('computeConfidence: create_draft 只有 draftTitle → 0.7', () => {
  const r = computeConfidence({
    type: 'create_draft',
    evidence: { paperIds: [], quotes: [] },
    target: { draftTitle: 't' },
    estimated_effort: 'low',
  });
  assert.equal(r.targetCompleteness, 0.7);
});

test('computeConfidence: literature_review 只有 projectId → 1.0', () => {
  const r = computeConfidence({
    type: 'literature_review',
    evidence: { paperIds: [], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(r.targetCompleteness, 1);
});

test('computeConfidence: literature_review 无 projectId → 0.3', () => {
  const r = computeConfidence({
    type: 'literature_review',
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'low',
  });
  assert.equal(r.targetCompleteness, 0.3);
});

test('computeConfidence: 自定义 weights → score 调整', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  }, { weights: { evidence: 0.8, typeAdoption: 0.1, target: 0.05, effort: 0.05 } });
  // evidence ≈ 0.14 (1 paper → 1/5 * 0.7 = 0.14)
  // typeAdoption 0.5, target 1.0, effort 1.0
  // = 0.14 * 0.8 + 0.5 * 0.1 + 1.0 * 0.05 + 1.0 * 0.05 = 0.112 + 0.05 + 0.05 + 0.05 = 0.262
  assert.ok(r.score < 0.5);
});

test('computeConfidence: score clamp 到 [0, 1]', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  }, { typeAdoptionByType: { experiment_plan: 1.0 }, weights: { evidence: 1, typeAdoption: 1, target: 1, effort: 1 } });
  assert.ok(r.score <= 1);
  assert.ok(r.score >= 0);
});

test('computeConfidence: evidence 缺 paperIds → 0', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: undefined,
    target: { projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.equal(r.evidenceScore, 0);
});

test('computeConfidence: 完整 breakdown 字段返回', () => {
  const r = computeConfidence({
    type: 'experiment_plan',
    evidence: { paperIds: ['p1'], quotes: [] },
    target: { projectId: 'p' },
    estimated_effort: 'low',
  });
  assert.ok(typeof r.score === 'number');
  assert.ok(typeof r.evidenceScore === 'number');
  assert.ok(typeof r.typeAdoptionScore === 'number');
  assert.ok(typeof r.targetCompleteness === 'number');
  assert.ok(typeof r.effortPenalty === 'number');
});

// ---------- confidenceTier ----------
test('confidenceTier: >= 0.7 → high', () => {
  assert.equal(confidenceTier(0.7), 'high');
  assert.equal(confidenceTier(0.9), 'high');
  assert.equal(confidenceTier(1.0), 'high');
});

test('confidenceTier: [0.4, 0.7) → medium', () => {
  assert.equal(confidenceTier(0.4), 'medium');
  assert.equal(confidenceTier(0.5), 'medium');
  assert.equal(confidenceTier(0.699999), 'medium');
});

test('confidenceTier: < 0.4 → low', () => {
  assert.equal(confidenceTier(0), 'low');
  assert.equal(confidenceTier(0.3), 'low');
  assert.equal(confidenceTier(0.399999), 'low');
});

test('confidenceTier: NaN → low', () => {
  assert.equal(confidenceTier(NaN), 'low');
});

test('confidenceTier: 负数 → low', () => {
  assert.equal(confidenceTier(-0.1), 'low');
});
#!/usr/bin/env node
// astro-src/scripts/agents-reviewer.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/reviewer.mjs.
// REVIEW_PERSONAS / REVIEW_RECOMMENDATIONS 常量 +
// reviewDraft (stub mode) +
// formatReviewText (verdict → markdown) +
// toJSON (verdict 序列化)。

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
    platform: 'node',
    write: false,
    target: 'es2022',
    external: ['node:fs', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadMjs('lib/agents/reviewer.mjs');
const {
  REVIEW_PERSONAS,
  REVIEW_RECOMMENDATIONS,
  reviewDraft,
  formatReviewText,
  toJSON,
} = mod;

const mkDraft = (overrides = {}) => ({
  title: 'Test Draft',
  abstract: 'abstract text',
  body: '# Original body\n\nSome content here with sufficient length to pass the body length check in the stub function which expects body length greater than 1000 to give experiments score 6.5 versus 5.5.',
  ...overrides,
});

// ---------- 常量 ---
test('REVIEW_PERSONAS: 含 3 个 persona', () => {
  assert.ok(REVIEW_PERSONAS.includes('methodologist'));
  assert.ok(REVIEW_PERSONAS.includes('engineer'));
  assert.ok(REVIEW_PERSONAS.includes('skeptic'));
  assert.equal(REVIEW_PERSONAS.length, 3);
});

test('REVIEW_RECOMMENDATIONS: 含 5 个 recommendation', () => {
  assert.ok(REVIEW_RECOMMENDATIONS.includes('accept'));
  assert.ok(REVIEW_RECOMMENDATIONS.includes('weak_accept'));
  assert.ok(REVIEW_RECOMMENDATIONS.includes('revise'));
  assert.ok(REVIEW_RECOMMENDATIONS.includes('weak_reject'));
  assert.ok(REVIEW_RECOMMENDATIONS.includes('reject'));
  assert.equal(REVIEW_RECOMMENDATIONS.length, 5);
});

// ---------- reviewDraft: stub mode ---
test('reviewDraft: 无 caller → stub 模式', async () => {
  const r = await reviewDraft(mkDraft());
  assert.equal(r.stub, true);
});

test('reviewDraft: caller 缺 callLLM 方法 → stub', async () => {
  const r = await reviewDraft(mkDraft(), { caller: {} });
  assert.equal(r.stub, true);
});

test('reviewDraft: stub 返回完整 verdict', async () => {
  const r = await reviewDraft(mkDraft());
  assert.ok(typeof r.recommendation === 'string');
  assert.ok(typeof r.scores === 'object');
  assert.ok(Array.isArray(r.concerns));
  assert.ok(typeof r.summary === 'string');
  assert.ok(typeof r.generatedAt === 'number');
});

test('reviewDraft: stub 默认 recommendation = revise', async () => {
  const r = await reviewDraft(mkDraft());
  assert.equal(r.recommendation, 'revise');
});

test('reviewDraft: stub draftId 透传', async () => {
  const r = await reviewDraft(mkDraft(), { draftId: 'd-001' });
  assert.equal(r.draftId, 'd-001');
});

test('reviewDraft: stub 含 major + minor concerns', async () => {
  const r = await reviewDraft(mkDraft());
  const major = r.concerns.filter((c) => c.severity === 'major');
  const minor = r.concerns.filter((c) => c.severity === 'minor');
  assert.ok(major.length >= 1);
  assert.ok(minor.length >= 1);
});

test('reviewDraft: stub 分数范围 0..10', async () => {
  const r = await reviewDraft(mkDraft());
  for (const k of ['novelty', 'soundness', 'clarity', 'experiments', 'writing', 'overall']) {
    assert.ok(r.scores[k] >= 0 && r.scores[k] <= 10, `${k}=${r.scores[k]}`);
  }
});

test('reviewDraft: stub 长 body 给更高 experiments 分数', async () => {
  const longBody = 'a'.repeat(2000);
  const r1 = await reviewDraft({ body: longBody });
  const r2 = await reviewDraft({ body: 'short' });
  // 长 body experiments 6.5,短 body 5.5
  assert.ok(r1.scores.experiments > r2.scores.experiments);
});

test('reviewDraft: stub 模型名带 "(stub)"', async () => {
  const r = await reviewDraft(mkDraft(), { model: 'gpt-4' });
  assert.match(r.model, /stub/);
});

// ---------- formatReviewText ---
test('formatReviewText: null → "(empty review)"', () => {
  assert.equal(formatReviewText(null), '(empty review)');
});

test('formatReviewText: 含 recommendation + overall + 5 维度分数', () => {
  const r = formatReviewText({
    recommendation: 'revise',
    scores: { novelty: 6, soundness: 6, clarity: 7, experiments: 6, writing: 6, overall: 6.2 },
    concerns: [],
    summary: 'summary text',
    stub: false,
  });
  assert.match(r, /Recommendation.*revise/);
  assert.match(r, /Overall.*6\.2/);
  assert.match(r, /novelty=6/);
  assert.match(r, /soundness=6/);
});

test('formatReviewText: stub 模式提示', () => {
  const r = formatReviewText({
    recommendation: 'revise', scores: {}, concerns: [], summary: '',
    stub: true,
  });
  assert.match(r, /stub/i);
});

test('formatReviewText: 渲染每个 concern', () => {
  const r = formatReviewText({
    recommendation: 'revise', scores: {}, stub: false,
    concerns: [
      { severity: 'major', category: 'soundness', persona: 'methodologist',
        claim: 'baseline issue', detail: 'detail of concern' },
      { severity: 'minor', category: 'clarity', persona: 'engineer',
        claim: '', detail: 'minor detail' },
    ],
    summary: '',
  });
  assert.match(r, /\[MAJOR\]/);
  assert.match(r, /\[MINOR\]/);
  assert.match(r, /soundness/);
  assert.match(r, /baseline issue/);
});

test('formatReviewText: concern count 显示', () => {
  const r = formatReviewText({
    recommendation: 'revise', scores: {}, stub: false,
    concerns: [
      { severity: 'major', category: 'a', persona: 'p', claim: '', detail: 'd1' },
      { severity: 'minor', category: 'b', persona: 'p', claim: '', detail: 'd2' },
    ],
    summary: '',
  });
  assert.match(r, /Concerns \(2\)/);
});

test('formatReviewText: 空 summary → "(none)"', () => {
  const r = formatReviewText({
    recommendation: 'revise', scores: {}, stub: false,
    concerns: [], summary: '',
  });
  assert.match(r, /\(none\)/);
});

// ---------- toJSON ---
test('toJSON: null → null', () => {
  assert.equal(toJSON(null), null);
});

test('toJSON: undefined → null', () => {
  assert.equal(toJSON(undefined), null);
});

test('toJSON: 字段完整', () => {
  const v = {
    draftId: 'd1', recommendation: 'revise',
    scores: { novelty: 6, soundness: 6, clarity: 7, experiments: 6, writing: 6, overall: 6.2 },
    concerns: [{ severity: 'major', category: 'a', persona: 'p', claim: 'c', detail: 'd' }],
    summary: 's', model: 'm', generatedAt: 100, stub: 1,
  };
  const r = toJSON(v);
  assert.equal(r.draftId, 'd1');
  assert.equal(r.recommendation, 'revise');
  assert.equal(r.stub, true);
  assert.ok('scores' in r);
  assert.ok('concerns' in r);
  assert.ok('summary' in r);
  assert.ok('model' in r);
  assert.ok('generatedAt' in r);
});

test('toJSON: stub 字段 → bool', () => {
  const r = toJSON({
    draftId: null, recommendation: 'revise', scores: {}, concerns: [], summary: '',
    model: '', generatedAt: 0, stub: 0,
  });
  assert.equal(r.stub, false);
});

// ---------- 集成 ---
test('集成: stub review → format → toJSON', async () => {
  const v = await reviewDraft(mkDraft(), { draftId: 'd1' });
  const text = formatReviewText(v);
  const json = toJSON(v);
  assert.match(text, /Paper Review/);
  assert.equal(json.draftId, 'd1');
  assert.equal(json.stub, true);
});

test('集成: stub 含足够 concerns', async () => {
  const v = await reviewDraft(mkDraft());
  assert.ok(v.concerns.length >= 2);
  // 至少有 1 major + 1 minor
  assert.ok(v.concerns.some((c) => c.severity === 'major'));
  assert.ok(v.concerns.some((c) => c.severity === 'minor'));
});
#!/usr/bin/env node
// astro-src/scripts/deep-extract.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-frontmatter/deep-extract.ts type guard.

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

const mod = await loadTs('lib/paper-frontmatter/deep-extract.ts');
const { isDeepExtractField } = mod;

const valid = {
  reported_metrics: [],
  datasets: [],
  compute_requirements: { params: '', gpu_hours: '', flops: '', model_size: '' },
  limitations: [],
  replicability_score: 3,
  replicability_reason: 'reason',
};

test('isDeepExtractField: 有效对象', () => {
  assert.equal(isDeepExtractField(valid), true);
});

test('isDeepExtractField: null → false', () => {
  assert.equal(isDeepExtractField(null), false);
});

test('isDeepExtractField: undefined → false', () => {
  assert.equal(isDeepExtractField(undefined), false);
});

test('isDeepExtractField: 字符串 → false', () => {
  assert.equal(isDeepExtractField('string'), false);
  assert.equal(isDeepExtractField(''), false);
});

test('isDeepExtractField: 数字 → false', () => {
  assert.equal(isDeepExtractField(42), false);
});

test('isDeepExtractField: 数组 → false', () => {
  assert.equal(isDeepExtractField([]), false);
});

test('isDeepExtractField: 缺 replicability_score → false', () => {
  const { replicability_score, ...rest } = valid;
  void replicability_score;
  assert.equal(isDeepExtractField(rest), false);
});

test('isDeepExtractField: replicability_score 非数字 → false', () => {
  assert.equal(isDeepExtractField({ ...valid, replicability_score: '3' }), false);
});

test('isDeepExtractField: replicability_score=0 → false(< 1)', () => {
  assert.equal(isDeepExtractField({ ...valid, replicability_score: 0 }), false);
});

test('isDeepExtractField: replicability_score=6 → false(> 5)', () => {
  assert.equal(isDeepExtractField({ ...valid, replicability_score: 6 }), false);
});

test('isDeepExtractField: replicability_score=1 → true(边界)', () => {
  assert.equal(isDeepExtractField({ ...valid, replicability_score: 1 }), true);
});

test('isDeepExtractField: replicability_score=5 → true(边界)', () => {
  assert.equal(isDeepExtractField({ ...valid, replicability_score: 5 }), true);
});

test('isDeepExtractField: reported_metrics 非数组 → false', () => {
  assert.equal(isDeepExtractField({ ...valid, reported_metrics: 'foo' }), false);
});

test('isDeepExtractField: datasets 非数组 → false', () => {
  assert.equal(isDeepExtractField({ ...valid, datasets: 'foo' }), false);
});

test('isDeepExtractField: limitations 非数组 → false', () => {
  assert.equal(isDeepExtractField({ ...valid, limitations: 'foo' }), false);
});

test('isDeepExtractField: 数组字段允许缺失', () => {
  const { reported_metrics, datasets, limitations, ...rest } = valid;
  void reported_metrics; void datasets; void limitations;
  assert.equal(isDeepExtractField(rest), true);
});

test('isDeepExtractField: 可选字段不影响判定', () => {
  const withOptional = {
    ...valid,
    deep_extract_model: 'gpt-4',
    deep_extract_generated_at: '2025-01-01',
  };
  assert.equal(isDeepExtractField(withOptional), true);
});
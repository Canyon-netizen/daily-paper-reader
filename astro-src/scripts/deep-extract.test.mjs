#!/usr/bin/env node
// astro-src/scripts/deep-extract.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-frontmatter/deep-extract.ts.

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

test('isDeepExtractField: 合法对象 → true', () => {
  assert.equal(
    isDeepExtractField({
      reported_metrics: [],
      datasets: [],
      compute_requirements: {},
      limitations: [],
      replicability_score: 3,
      replicability_reason: 'ok',
    }),
    true,
  );
});

test('isDeepExtractField: 最小合法 { replicability_score: 1 }', () => {
  assert.equal(isDeepExtractField({ replicability_score: 1 }), true);
});

test('isDeepExtractField: replicability_score=5 → true', () => {
  assert.equal(isDeepExtractField({ replicability_score: 5 }), true);
});

test('isDeepExtractField: null → false', () => {
  assert.equal(isDeepExtractField(null), false);
});

test('isDeepExtractField: undefined → false', () => {
  assert.equal(isDeepExtractField(undefined), false);
});

test('isDeepExtractField: 数字 → false', () => {
  assert.equal(isDeepExtractField(3), false);
});

test('isDeepExtractField: 字符串 → false', () => {
  assert.equal(isDeepExtractField('3'), false);
});

test('isDeepExtractField: 空对象 → false (缺 replicability_score)', () => {
  assert.equal(isDeepExtractField({}), false);
});

test('isDeepExtractField: replicability_score 非 number → false', () => {
  assert.equal(isDeepExtractField({ replicability_score: '3' }), false);
  assert.equal(isDeepExtractField({ replicability_score: null }), false);
  assert.equal(isDeepExtractField({ replicability_score: undefined }), false);
});

test('isDeepExtractField: replicability_score < 1 → false', () => {
  assert.equal(isDeepExtractField({ replicability_score: 0 }), false);
  assert.equal(isDeepExtractField({ replicability_score: -1 }), false);
});

test('isDeepExtractField: replicability_score > 5 → false', () => {
  assert.equal(isDeepExtractField({ replicability_score: 6 }), false);
  assert.equal(isDeepExtractField({ replicability_score: 10 }), false);
});

test('isDeepExtractField: replicability_score 浮点合法值 (3.5)', () => {
  assert.equal(isDeepExtractField({ replicability_score: 3.5 }), true);
});

test('isDeepExtractField: reported_metrics 非数组 → false', () => {
  assert.equal(
    isDeepExtractField({ replicability_score: 3, reported_metrics: 'foo' }),
    false,
  );
});

test('isDeepExtractField: datasets 非数组 → false', () => {
  assert.equal(
    isDeepExtractField({ replicability_score: 3, datasets: { foo: 1 } }),
    false,
  );
});

test('isDeepExtractField: limitations 非数组 → false', () => {
  assert.equal(
    isDeepExtractField({ replicability_score: 3, limitations: 'foo' }),
    false,
  );
});

test('isDeepExtractField: arrays undefined 也合法', () => {
  assert.equal(isDeepExtractField({ replicability_score: 3 }), true);
});

test('isDeepExtractField: 数组 fields 合法时通过', () => {
  assert.equal(
    isDeepExtractField({
      replicability_score: 4,
      reported_metrics: [{ name: 'acc', value: '0.9' }],
      datasets: [{ name: 'MNIST', role: 'training' }],
      limitations: ['foo'],
    }),
    true,
  );
});

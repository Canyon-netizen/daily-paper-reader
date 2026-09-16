#!/usr/bin/env node
// astro-src/scripts/resource-tier.test.mjs
//
// Tests for R7 polish: astro-src/lib/types/resource-tier.ts resource tier + data scale inference.

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

const mod = await loadTs('lib/types/resource-tier.ts');
const {
  parseCount,
  parseParamsCount,
  parseFlopsCount,
  inferResourceTier,
  inferDataScale,
  TIER_ORDER,
  TIER_LABELS,
} = mod;

test('parseCount: "7B" → 7e9', () => {
  assert.equal(parseCount('7B'), 7e9);
});

test('parseCount: "340M" → 340e6', () => {
  assert.equal(parseCount('340M'), 340e6);
});

test('parseCount: "1.5k" → 1500', () => {
  assert.equal(parseCount('1.5k'), 1500);
});

test('parseCount: "200" → 200 (无单位)', () => {
  assert.equal(parseCount('200'), 200);
});

test('parseCount: 大写 K/M/B', () => {
  assert.equal(parseCount('5K'), 5000);
  assert.equal(parseCount('3M'), 3e6);
  assert.equal(parseCount('2B'), 2e9);
});

test('parseCount: null / undefined / 空 → null', () => {
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount(''), null);
});

test('parseCount: 数字串 → null', () => {
  assert.equal(parseCount('not a number'), null);
});

test('parseParamsCount: "7B" → 7e9', () => {
  assert.equal(parseParamsCount('7B'), 7e9);
});

test('parseParamsCount: "340M parameters" → 340e6', () => {
  assert.equal(parseParamsCount('340M parameters'), 340e6);
});

test('parseParamsCount: "1.5e9" → 1.5e9 (E 指数)', () => {
  assert.equal(parseParamsCount('1.5e9'), 1.5e9);
});

test('parseParamsCount: "1.5e+9" → 1.5e9', () => {
  assert.equal(parseParamsCount('1.5e+9'), 1.5e9);
});

test('parseParamsCount: 无单位默认 M', () => {
  assert.equal(parseParamsCount('7'), 7e6);
});

test('parseFlopsCount: "1.5e23" → 1.5e23', () => {
  assert.ok(Math.abs(parseFlopsCount('1.5e23') - 1.5e23) < 1e10);
});

test('parseFlopsCount: "5e22 FLOPs" → 5e22', () => {
  assert.equal(parseFlopsCount('5e22 FLOPs'), 5e22);
});

test('inferResourceTier: TPU pod via text', () => {
  assert.equal(inferResourceTier(null, 'trained on TPU v4 pod'), 'tpu_pod');
});

test('inferResourceTier: TPU pod via flops>=1e24', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { flops: '1e24' } }),
    'tpu_pod',
  );
});

test('inferResourceTier: cluster via gpu_hours>=10000', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { gpu_hours: '15000' } }),
    'cluster',
  );
});

test('inferResourceTier: cluster via flops>=1e23', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { flops: '5e23' } }),
    'cluster',
  );
});

test('inferResourceTier: multi_gpu via 1000<=gpu_hours<10000', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { gpu_hours: '5000' } }),
    'multi_gpu',
  );
});

test('inferResourceTier: multi_gpu via params>=30B', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { params: '70B' } }),
    'multi_gpu',
  );
});

test('inferResourceTier: single_gpu via 1<=gpu_hours<1000', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { gpu_hours: '500' } }),
    'single_gpu',
  );
});

test('inferResourceTier: single_gpu via params>=1B', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: { params: '7B' } }),
    'single_gpu',
  );
});

test('inferResourceTier: api_only via text signal', () => {
  assert.equal(inferResourceTier(null, 'uses GPT-4 via API for inference'), 'api_only');
});

test('inferResourceTier: api_only via replicability_score>=4', () => {
  assert.equal(
    inferResourceTier({ compute_requirements: {}, replicability_score: 5 }),
    'api_only',
  );
});

test('inferResourceTier: empty input → unknown', () => {
  assert.equal(inferResourceTier(null), 'unknown');
  assert.equal(inferResourceTier({}), 'unknown');
});

test('inferDataScale: web_scale via Common Crawl', () => {
  assert.equal(inferDataScale(null, 'trained on Common Crawl'), 'web_scale');
});

test('inferDataScale: web_scale via billion', () => {
  assert.equal(inferDataScale(null, '1 billion images'), 'web_scale');
});

test('inferDataScale: large via >1M', () => {
  assert.equal(inferDataScale(null, 'dataset >1M samples'), 'large');
});

test('inferDataScale: large via million', () => {
  assert.equal(inferDataScale(null, 'several million examples'), 'large');
});

test('inferDataScale: small < medium(<10k 先于 medium)', () => {
  assert.equal(inferDataScale(null, 'few thousand samples'), 'small');
});

test('inferDataScale: medium via 10k-1M', () => {
  assert.equal(inferDataScale(null, '100k examples'), 'medium');
});

test('inferDataScale: empty → unknown', () => {
  assert.equal(inferDataScale(null), 'unknown');
  assert.equal(inferDataScale(null, ''), 'unknown');
});

test('TIER_ORDER: unknown=99(最后)', () => {
  assert.equal(TIER_ORDER.unknown, 99);
});

test('TIER_LABELS: 中文', () => {
  assert.equal(TIER_LABELS.api_only, '仅 API');
  assert.equal(TIER_LABELS.cluster, '集群');
});
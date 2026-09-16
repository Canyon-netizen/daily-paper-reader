#!/usr/bin/env node
// astro-src/scripts/resource-tier.test.mjs
//
// Tests for R7 polish: astro-src/lib/types/resource-tier.ts.

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
    external: ['./types', '../types', '../../types', '../paper-frontmatter/deep-extract'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/types/resource-tier.ts');
const {
  TIER_ORDER,
  TIER_LABELS,
  TIER_BADGE_LABELS,
  DATA_SCALE_LABELS,
  parseCount,
  parseParamsCount,
  parseFlopsCount,
  inferResourceTier,
} = mod;

// ---------- TIER 常量 ----------
test('TIER_ORDER: 6 档都有,unknown 最大', () => {
  assert.equal(TIER_ORDER.api_only, 0);
  assert.equal(TIER_ORDER.single_gpu, 1);
  assert.equal(TIER_ORDER.multi_gpu, 2);
  assert.equal(TIER_ORDER.cluster, 3);
  assert.equal(TIER_ORDER.tpu_pod, 4);
  assert.equal(TIER_ORDER.unknown, 99);
});

test('TIER_LABELS: 6 档中文', () => {
  assert.equal(TIER_LABELS.api_only, '仅 API');
  assert.equal(TIER_LABELS.single_gpu, '单卡 GPU');
  assert.equal(TIER_LABELS.multi_gpu, '多卡 GPU');
  assert.equal(TIER_LABELS.cluster, '集群');
  assert.equal(TIER_LABELS.tpu_pod, 'TPU Pod');
  assert.equal(TIER_LABELS.unknown, '未知');
});

test('TIER_BADGE_LABELS: 6 档短标签', () => {
  assert.equal(TIER_BADGE_LABELS.api_only, 'API');
  assert.equal(TIER_BADGE_LABELS.tpu_pod, 'TPU');
  assert.equal(TIER_BADGE_LABELS.unknown, '?');
});

test('DATA_SCALE_LABELS: 5 档', () => {
  assert.equal(DATA_SCALE_LABELS.small, '<10k');
  assert.equal(DATA_SCALE_LABELS.medium, '10k-1M');
  assert.equal(DATA_SCALE_LABELS.large, '>1M');
  assert.equal(DATA_SCALE_LABELS.web_scale, 'Web 级');
  assert.equal(DATA_SCALE_LABELS.unknown, '未知');
});

// ---------- parseCount ----------
test('parseCount: 空 → null', () => {
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount(''), null);
});

test('parseCount: "200" → 200', () => {
  assert.equal(parseCount('200'), 200);
});

test('parseCount: "7k" → 7000', () => {
  assert.equal(parseCount('7k'), 7000);
  assert.equal(parseCount('7K'), 7000);
});

test('parseCount: "340M" → 340e6', () => {
  assert.equal(parseCount('340M'), 340e6);
});

test('parseCount: "7B" → 7e9', () => {
  assert.equal(parseCount('7B'), 7e9);
  assert.equal(parseCount('1.5b'), 1.5e9);
});

test('parseCount: 非 string → null', () => {
  assert.equal(parseCount(123), null);
});

// ---------- parseParamsCount ----------
test('parseParamsCount: "7B" → 7e9', () => {
  assert.equal(parseParamsCount('7B'), 7e9);
});

test('parseParamsCount: "340M parameters" → 340e6', () => {
  assert.equal(parseParamsCount('340M parameters'), 340e6);
});

test('parseParamsCount: 无单位默认 M', () => {
  // "500" 无单位 → * 1e6
  assert.equal(parseParamsCount('500'), 500e6);
});

test('parseParamsCount: "1.5e9" → 1.5e9', () => {
  assert.equal(parseParamsCount('1.5e9'), 1.5e9);
});

test('parseParamsCount: "1.5E+9" → 1.5e9', () => {
  assert.equal(parseParamsCount('1.5E+9'), 1.5e9);
});

test('parseParamsCount: 空 → null', () => {
  assert.equal(parseParamsCount(null), null);
  assert.equal(parseParamsCount(''), null);
});

// ---------- parseFlopsCount ----------
test('parseFlopsCount: "1.5e23" → 1.5e23', () => {
  const r = parseFlopsCount('1.5e23');
  assert.ok(Math.abs(r - 1.5e23) < 1e10);
});

test('parseFlopsCount: "5E22 FLOPs" → 5e22', () => {
  const r = parseFlopsCount('5E22 FLOPs');
  assert.ok(Math.abs(r - 5e22) < 1e10);
});

test('parseFlopsCount: "1.5e+23" → 1.5e23', () => {
  const r = parseFlopsCount('1.5e+23');
  assert.ok(Math.abs(r - 1.5e23) < 1e10);
});

test('parseFlopsCount: 空 → null', () => {
  assert.equal(parseFlopsCount(null), null);
});

// ---------- inferResourceTier ----------
test('inferResourceTier: deep=null, 无 textSignals → unknown', () => {
  assert.equal(inferResourceTier(null), 'unknown');
  assert.equal(inferResourceTier(undefined), 'unknown');
});

test('inferResourceTier: TPU pod 文本 → tpu_pod', () => {
  assert.equal(inferResourceTier(null, 'trained on TPU v4 pod'), 'tpu_pod');
});

test('inferResourceTier: flops >= 1e24 → tpu_pod', () => {
  const deep = { compute_requirements: { flops: '1.5e24' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'tpu_pod');
});

test('inferResourceTier: gpu_hours >= 10000 → cluster', () => {
  const deep = { compute_requirements: { gpu_hours: '12000' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'cluster');
});

test('inferResourceTier: flops >= 1e23 → cluster', () => {
  const deep = { compute_requirements: { flops: '5e23' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'cluster');
});

test('inferResourceTier: gpu_hours 1000-9999 → multi_gpu', () => {
  const deep = { compute_requirements: { gpu_hours: '5000' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'multi_gpu');
});

test('inferResourceTier: params >= 30B → multi_gpu', () => {
  const deep = { compute_requirements: { params: '70B' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'multi_gpu');
});

test('inferResourceTier: gpu_hours 1-999 → single_gpu', () => {
  const deep = { compute_requirements: { gpu_hours: '200' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'single_gpu');
});

test('inferResourceTier: params 1B-29B → single_gpu', () => {
  const deep = { compute_requirements: { params: '7B' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'single_gpu');
});

test('inferResourceTier: text 含 "api" → api_only', () => {
  // params=0 (无单位默认 *1e6=0)、无 gpu_hours,text 含 'api'
  const deep = { compute_requirements: { params: '0' }, limitations: [] };
  // textSignals = 'api'
  assert.equal(inferResourceTier(deep, 'uses api'), 'api_only');
});

test('inferResourceTier: replicability_score >= 4 + 无 gpu_hours → api_only', () => {
  const deep = {
    compute_requirements: {},
    limitations: [],
    replicability_score: 5,
  };
  assert.equal(inferResourceTier(deep), 'api_only');
});

test('inferResourceTier: 全空 + replicability=3 → unknown', () => {
  const deep = {
    compute_requirements: {},
    limitations: [],
    replicability_score: 3,
  };
  assert.equal(inferResourceTier(deep), 'unknown');
});

test('inferResourceTier: 优先级 — TPU 文本胜过 gpu_hours', () => {
  // gpu_hours=200 → 单卡,但 text 含 'TPU pod' → tpu_pod
  const deep = { compute_requirements: { gpu_hours: '200' }, limitations: [] };
  assert.equal(inferResourceTier(deep, 'on TPU pod'), 'tpu_pod');
});

test('inferResourceTier: 优先级 — flops=1e23 (cluster) 胜过 gpu_hours=200 (single_gpu)', () => {
  // flops=5e23 ≥ 1e23 → cluster;但 gpu_hours=200 ≥ 1 → single_gpu
  // 决策树先查 cluster 再 single_gpu,所以 → cluster
  const deep = { compute_requirements: { gpu_hours: '200', flops: '5e23' }, limitations: [] };
  assert.equal(inferResourceTier(deep), 'cluster');
});

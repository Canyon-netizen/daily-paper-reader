#!/usr/bin/env node
// astro-src/scripts/libraries-audience-thresholds.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/audience-thresholds.ts.
// getThresholdsForAudience + getAllAudienceProfiles + getAudienceLabel。

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

const mod = await loadTs('lib/libraries/audience-thresholds.ts');
const {
  getThresholdsForAudience,
  getAllAudienceProfiles,
  getAudienceLabel,
} = mod;

// ---------- getThresholdsForAudience ----------
test('getThresholdsForAudience: novice → 低阈值', () => {
  const r = getThresholdsForAudience('novice');
  assert.equal(r.minRelevance, 0.50);
  assert.equal(r.minQuality, 0.45);
  assert.equal(r.maxResults, 50);
});

test('getThresholdsForAudience: expert → 高阈值', () => {
  const r = getThresholdsForAudience('expert');
  assert.equal(r.minRelevance, 0.75);
  assert.equal(r.minQuality, 0.70);
  assert.equal(r.maxResults, 20);
});

test('getThresholdsForAudience: reviewer → 最高', () => {
  const r = getThresholdsForAudience('reviewer');
  assert.equal(r.minRelevance, 0.80);
  assert.equal(r.minQuality, 0.75);
  assert.equal(r.maxResults, 15);
});

test('getThresholdsForAudience: practitioner → 中等', () => {
  const r = getThresholdsForAudience('practitioner');
  assert.equal(r.minRelevance, 0.60);
  assert.equal(r.minQuality, 0.55);
  assert.equal(r.maxResults, 30);
});

test('getThresholdsForAudience: 4 个 profile 都返回', () => {
  for (const a of ['novice', 'expert', 'reviewer', 'practitioner']) {
    const r = getThresholdsForAudience(a);
    assert.ok(r && typeof r.minRelevance === 'number');
    assert.ok(typeof r.minQuality === 'number');
    assert.ok(typeof r.maxResults === 'number');
  }
});

test('getThresholdsForAudience: novice < expert thresholds', () => {
  const n = getThresholdsForAudience('novice');
  const e = getThresholdsForAudience('expert');
  assert.ok(n.minRelevance < e.minRelevance);
  assert.ok(n.minQuality < e.minQuality);
});

test('getThresholdsForAudience: novice maxResults > expert', () => {
  const n = getThresholdsForAudience('novice');
  const e = getThresholdsForAudience('expert');
  assert.ok(n.maxResults > e.maxResults);
});

test('getThresholdsForAudience: 未知 → undefined', () => {
  assert.equal(getThresholdsForAudience('unknown'), undefined);
});

// ---------- getAllAudienceProfiles ----------
test('getAllAudienceProfiles: 返回 4 个', () => {
  const r = getAllAudienceProfiles();
  assert.equal(r.length, 4);
});

test('getAllAudienceProfiles: 含 4 个预期 profile', () => {
  const r = getAllAudienceProfiles();
  assert.ok(r.includes('novice'));
  assert.ok(r.includes('expert'));
  assert.ok(r.includes('reviewer'));
  assert.ok(r.includes('practitioner'));
});

test('getAllAudienceProfiles: 返回数组', () => {
  assert.ok(Array.isArray(getAllAudienceProfiles()));
});

test('getAllAudienceProfiles: 每次调用返回新数组', () => {
  const a = getAllAudienceProfiles();
  const b = getAllAudienceProfiles();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

// ---------- getAudienceLabel ----------
test('getAudienceLabel: novice', () => {
  const r = getAudienceLabel('novice');
  assert.match(r, /入门小白/);
});

test('getAudienceLabel: expert', () => {
  const r = getAudienceLabel('expert');
  assert.match(r, /深耕专家/);
});

test('getAudienceLabel: reviewer', () => {
  const r = getAudienceLabel('reviewer');
  assert.match(r, /专业审稿人/);
});

test('getAudienceLabel: practitioner', () => {
  const r = getAudienceLabel('practitioner');
  assert.match(r, /工业实践者/);
});

test('getAudienceLabel: 4 个 profile 都有 label', () => {
  for (const a of ['novice', 'expert', 'reviewer', 'practitioner']) {
    const r = getAudienceLabel(a);
    assert.ok(typeof r === 'string' && r.length > 0);
  }
});

test('getAudienceLabel: 未知 → undefined', () => {
  assert.equal(getAudienceLabel('unknown'), undefined);
});

// ---------- 阈值排序 ---
test('阈值: novice 最宽松, reviewer 最严格', () => {
  const novice = getThresholdsForAudience('novice');
  const expert = getThresholdsForAudience('expert');
  const reviewer = getThresholdsForAudience('reviewer');
  assert.ok(novice.minRelevance < expert.minRelevance);
  assert.ok(expert.minRelevance < reviewer.minRelevance);
});

test('阈值: maxResults 反向 (novice 多, reviewer 少)', () => {
  const novice = getThresholdsForAudience('novice');
  const reviewer = getThresholdsForAudience('reviewer');
  assert.ok(novice.maxResults > reviewer.maxResults);
});

// ---------- 返回新对象 ---
test('getThresholdsForAudience: 每次返回新对象', () => {
  const a = getThresholdsForAudience('novice');
  const b = getThresholdsForAudience('novice');
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});
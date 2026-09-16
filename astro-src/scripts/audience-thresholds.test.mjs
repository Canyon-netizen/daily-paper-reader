#!/usr/bin/env node
// astro-src/scripts/audience-thresholds.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/audience-thresholds.ts.

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

test('getThresholdsForAudience: novice 低阈值', () => {
  const t = getThresholdsForAudience('novice');
  assert.equal(t.minRelevance, 0.5);
  assert.equal(t.minQuality, 0.45);
  assert.equal(t.maxResults, 50);
});

test('getThresholdsForAudience: expert 高阈值', () => {
  const t = getThresholdsForAudience('expert');
  assert.equal(t.minRelevance, 0.75);
  assert.equal(t.minQuality, 0.7);
  assert.equal(t.maxResults, 20);
});

test('getThresholdsForAudience: reviewer 极高阈值', () => {
  const t = getThresholdsForAudience('reviewer');
  assert.equal(t.minRelevance, 0.8);
  assert.equal(t.minQuality, 0.75);
  assert.equal(t.maxResults, 15);
});

test('getThresholdsForAudience: practitioner 中阈值', () => {
  const t = getThresholdsForAudience('practitioner');
  assert.equal(t.minRelevance, 0.6);
  assert.equal(t.minQuality, 0.55);
  assert.equal(t.maxResults, 30);
});

test('getThresholdsForAudience: 返回值有 3 个字段', () => {
  const t = getThresholdsForAudience('novice');
  assert.equal(Object.keys(t).length, 3);
});

test('getAllAudienceProfiles: 4 个 profile', () => {
  const ps = getAllAudienceProfiles();
  assert.equal(ps.length, 4);
  assert.ok(ps.includes('novice'));
  assert.ok(ps.includes('expert'));
  assert.ok(ps.includes('reviewer'));
  assert.ok(ps.includes('practitioner'));
});

test('getAudienceLabel: 中英混合标签', () => {
  assert.ok(getAudienceLabel('novice').includes('Novice'));
  assert.ok(getAudienceLabel('novice').includes('入门小白'));
  assert.ok(getAudienceLabel('expert').includes('Expert'));
  assert.ok(getAudienceLabel('reviewer').includes('Reviewer'));
  assert.ok(getAudienceLabel('practitioner').includes('Practitioner'));
});

test('getAudienceLabel: 4 个 profile 都返回非空', () => {
  for (const p of getAllAudienceProfiles()) {
    assert.ok(getAudienceLabel(p).length > 0);
  }
});
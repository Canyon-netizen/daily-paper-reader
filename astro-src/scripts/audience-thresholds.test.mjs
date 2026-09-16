#!/usr/bin/env node
// astro-src/scripts/audience-thresholds.test.mjs
//
// Tests for R7 LP.1 audience thresholds.

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
    platform: 'node',
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
  AudienceProfile,
} = mod;

test('getThresholdsForAudience: novice has low thresholds', () => {
  const t = getThresholdsForAudience('novice');
  assert.equal(t.minRelevance, 0.50);
  assert.equal(t.minQuality, 0.45);
  assert.equal(t.maxResults, 50);
});

test('getThresholdsForAudience: expert has high thresholds', () => {
  const t = getThresholdsForAudience('expert');
  assert.equal(t.minRelevance, 0.75);
  assert.equal(t.minQuality, 0.70);
  assert.equal(t.maxResults, 20);
});

test('getThresholdsForAudience: reviewer has very high thresholds', () => {
  const t = getThresholdsForAudience('reviewer');
  assert.equal(t.minRelevance, 0.80);
  assert.equal(t.minQuality, 0.75);
  assert.equal(t.maxResults, 15);
});

test('getThresholdsForAudience: practitioner has mid thresholds', () => {
  const t = getThresholdsForAudience('practitioner');
  assert.equal(t.minRelevance, 0.60);
  assert.equal(t.minQuality, 0.55);
  assert.equal(t.maxResults, 30);
});

test('getThresholdsForAudience: reviewer threshold > expert > practitioner > novice', () => {
  const r = getThresholdsForAudience('reviewer');
  const e = getThresholdsForAudience('expert');
  const p = getThresholdsForAudience('practitioner');
  const n = getThresholdsForAudience('novice');

  assert.ok(r.minRelevance > e.minRelevance);
  assert.ok(e.minRelevance > p.minRelevance);
  assert.ok(p.minRelevance > n.minRelevance);
});

test('getAllAudienceProfiles: returns all 4 profiles', () => {
  const profiles = getAllAudienceProfiles();
  assert.equal(profiles.length, 4);
  assert.ok(profiles.includes('novice'));
  assert.ok(profiles.includes('expert'));
  assert.ok(profiles.includes('reviewer'));
  assert.ok(profiles.includes('practitioner'));
});

test('getAudienceLabel: returns label for each profile', () => {
  assert.ok(getAudienceLabel('novice').includes('Novice'));
  assert.ok(getAudienceLabel('expert').includes('Expert'));
  assert.ok(getAudienceLabel('reviewer').includes('Reviewer'));
  assert.ok(getAudienceLabel('practitioner').includes('Practitioner'));
});

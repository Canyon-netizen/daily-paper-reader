#!/usr/bin/env node
// astro-src/scripts/anchor-quality.test.mjs
//
// Tests for R7 D.2.2 anchor paper quality scoring.

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

const mod = await loadTs('lib/libraries/anchor-quality.ts');
const { scoreAnchorPaper, rankAnchorPapers } = mod;

const knownPapers = new Map([
  ['2501.00001', { arxivId: '2501.00001', citations: 150, date: '2026-08-01', milestone: true }],
  ['2501.00002', { arxivId: '2501.00002', citations: 30, date: '2026-06-01' }],
  ['2501.00003', { arxivId: '2501.00003', citations: 5, date: '2024-01-01', milestone: false }],
  ['2501.00004', { arxivId: '2501.00004', citations: 0, date: '2025-01-01' }],
  ['2501.00005', { arxivId: '2501.00005' }], // No data
]);

test('scoreAnchorPaper: high quality paper (citations + recent + milestone)', () => {
  const result = scoreAnchorPaper('2501.00001', knownPapers);
  assert.ok(result.score >= 0.9, `Expected high score, got ${result.score}`);
  assert.ok(result.reasons.length >= 3);
});

test('scoreAnchorPaper: moderate quality (citations + recent, no milestone)', () => {
  const result = scoreAnchorPaper('2501.00002', knownPapers);
  assert.ok(result.score >= 0.3 && result.score <= 0.7, `Expected moderate score, got ${result.score}`);
});

test('scoreAnchorPaper: low quality (low citations + old)', () => {
  const result = scoreAnchorPaper('2501.00003', knownPapers);
  assert.ok(result.score < 0.3, `Expected low score, got ${result.score}`);
});

test('scoreAnchorPaper: unknown paper returns zero score', () => {
  const result = scoreAnchorPaper('2501.99999', knownPapers);
  assert.equal(result.score, 0);
  assert.ok(result.reasons.length > 0);
});

test('scoreAnchorPaper: missing fields handled gracefully', () => {
  const result = scoreAnchorPaper('2501.00005', knownPapers);
  assert.ok(result.score >= 0 && result.score <= 1);
});

test('scoreAnchorPaper: score clamped to 0-1', () => {
  const papersMax = new Map([['max', { arxivId: 'max', citations: 1000, date: '2026-09-01', milestone: true }]]);
  const result = scoreAnchorPaper('max', papersMax);
  assert.ok(result.score <= 1);
});

test('rankAnchorPapers: returns sorted array', () => {
  const ids = ['2501.00001', '2501.00002', '2501.00003', '2501.00004'];
  const ranked = rankAnchorPapers(ids, knownPapers);
  assert.equal(ranked.length, 4);
  // Should be sorted descending
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i-1].score >= ranked[i].score);
  }
});

test('rankAnchorPapers: includes all input IDs', () => {
  const ids = ['2501.00001', '2501.00004'];
  const ranked = rankAnchorPapers(ids, knownPapers);
  const rankedIds = ranked.map(r => r.id);
  assert.ok(rankedIds.includes('2501.00001'));
  assert.ok(rankedIds.includes('2501.00004'));
});

#!/usr/bin/env node
// astro-src/scripts/feedback-fixtures.test.mjs
//
// Tests for R7 F.2.5 feedback 5-dimension fixtures.

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

const mod = await loadTs('lib/agents/feedback.fixtures.ts');
const { FEEDBACK_FIXTURES, fixturesByDimension, fixturesForProposal } = mod;

test('FEEDBACK_FIXTURES: 5 条 fixture', () => {
  assert.equal(FEEDBACK_FIXTURES.length, 5);
});

test('每条 fixture 5 维度都齐', () => {
  for (const f of FEEDBACK_FIXTURES) {
    assert.ok(typeof f.scores.citation_validity === 'number');
    assert.ok(typeof f.scores.methodology === 'number');
    assert.ok(typeof f.scores.reproducibility === 'number');
    assert.ok(typeof f.scores.novelty === 'number');
    assert.ok(typeof f.scores.overall === 'number');
  }
});

test('所有评分都在 0..1', () => {
  for (const f of FEEDBACK_FIXTURES) {
    for (const v of Object.values(f.scores)) {
      assert.ok(v >= 0 && v <= 1, `${f.id}: score ${v} out of range`);
    }
  }
});

test('citation_validity 维度:citationLow 最低', () => {
  const sorted = fixturesByDimension('citation_validity');
  // citationLow 的 citation_validity = 0.2,应排在最后
  assert.ok(sorted[sorted.length - 1].id.includes('citation-low'));
});

test('methodology 维度:methodologyHigh 最高', () => {
  const sorted = fixturesByDimension('methodology');
  assert.equal(sorted[0].id, 'fix-fb-method-high');
});

test('reproducibility 维度:reproducibilityLow 最低', () => {
  const sorted = fixturesByDimension('reproducibility');
  assert.equal(sorted[sorted.length - 1].id, 'fix-fb-repro-low');
});

test('novelty 维度:noveltyHigh 最高', () => {
  const sorted = fixturesByDimension('novelty');
  assert.equal(sorted[0].id, 'fix-fb-novelty-high');
});

test('fixturesForProposal: 找指定 proposalId', () => {
  const r = fixturesForProposal('p_weak');
  assert.ok(r.length >= 1);
  assert.equal(r[0].proposalId, 'p_weak');
});

test('fixturesForProposal: 未知 id → 空', () => {
  assert.deepEqual(fixturesForProposal('unknown'), []);
});

test('id 唯一', () => {
  const ids = FEEDBACK_FIXTURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});
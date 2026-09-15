#!/usr/bin/env node
// astro-src/scripts/few-shot.test.mjs
//
// Tests for R7 F.1.2 few-shot selection.

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

const mod = await loadTs('lib/agents/few-shot.ts');
const { selectFewShotExamples, renderFewShotBlock } = mod;

function makeP(id, type, projectId, createdAt = 1000) {
  return {
    id,
    round: 1,
    type,
    title: `title-${id}`,
    rationale: `rationale-${id}`,
    evidence: { paperIds: [] },
    target: { projectId },
    estimated_effort: 'low',
    risk: '',
    created_at: createdAt,
  };
}

test('selectFewShotExamples: empty history returns []', () => {
  assert.deepEqual(selectFewShotExamples([]), []);
  assert.deepEqual(selectFewShotExamples([], { k: 3 }), []);
});

test('selectFewShotExamples: returns at most k', () => {
  const hist = [makeP('a', 'add_paper', 'p1'), makeP('b', 'add_paper', 'p1'), makeP('c', 'add_paper', 'p1')];
  const out = selectFewShotExamples(hist, { k: 2 });
  assert.equal(out.length, 2);
});

test('selectFewShotExamples: same-project boosts rank', () => {
  const hist = [
    makeP('other', 'add_paper', 'p2', 2000),     // 不同 project
    makeP('same', 'add_paper', 'p1', 1000),       // 同 project(我查的)
  ];
  const out = selectFewShotExamples(hist, { projectId: 'p1', k: 1 });
  assert.equal(out[0].sourceId, 'same');
});

test('selectFewShotExamples: same-type boosts rank when projectId same', () => {
  const hist = [
    makeP('a', 'add_paper', 'p1'),
    makeP('b', 'rebuttal', 'p1'),     // 同 project 不同 type
  ];
  const out = selectFewShotExamples(hist, { projectId: 'p1', type: 'rebuttal', k: 1 });
  // 'b' 同时匹配 project + type → 应该被挑出
  assert.equal(out[0].sourceId, 'b');
});

test('selectFewShotExamples: feedbackScore 高 → 排前', () => {
  const hist = [
    makeP('low', 'add_paper', 'p1'),  // default 0.5
    makeP('hi', 'add_paper', 'p1'),
  ];
  const out = selectFewShotExamples(hist, {
    projectId: 'p1',
    feedbackScoreByProposalId: { low: 0.1, hi: 0.9 },
    k: 1,
  });
  assert.equal(out[0].sourceId, 'hi');
});

test('selectFewShotExamples: minScore 过滤', () => {
  const hist = [
    makeP('a', 'add_paper', 'p1'),
    makeP('b', 'add_paper', 'p1'),
  ];
  const out = selectFewShotExamples(hist, {
    feedbackScoreByProposalId: { a: 0.1, b: 0.9 },
    minScore: 0.5,
    k: 5,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceId, 'b');
});

test('selectFewShotExamples: tie-breaker by created_at desc', () => {
  const hist = [
    makeP('old', 'add_paper', 'p1', 1000),
    makeP('new', 'add_paper', 'p1', 2000),
  ];
  // 都不给 feedback,默认 0.5,projectId 同 → 同分,新优先
  const out = selectFewShotExamples(hist, { projectId: 'p1', k: 2 });
  assert.equal(out[0].sourceId, 'new');
});

test('renderFewShotBlock: empty list returns empty string', () => {
  assert.equal(renderFewShotBlock([]), '');
});

test('renderFewShotBlock: produces numbered JSON blocks', () => {
  const block = renderFewShotBlock([
    { type: 'add_paper', title: 'X', rationale: 'Y', estimated_effort: 'low', risk: '', score: 0.5, sourceId: 's1' },
  ]);
  assert.match(block, /## Example 1/);
  assert.match(block, /```json/);
  assert.match(block, /"type": "add_paper"/);
  assert.match(block, /"title": "X"/);
});
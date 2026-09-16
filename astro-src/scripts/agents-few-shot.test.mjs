#!/usr/bin/env node
// astro-src/scripts/agents-few-shot.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/few-shot.ts.

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
    external: ['./types', '../types', '../../types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/few-shot.ts');
const { selectFewShotExamples, renderFewShotBlock } = mod;

function mkProposal(id, overrides = {}) {
  return {
    id,
    type: 'add_paper',
    title: `title-${id}`,
    rationale: `rationale-${id}`,
    risk: `risk-${id}`,
    estimated_effort: 'medium',
    evidence: { paperIds: [], quotes: [] },
    target: {},
    created_at: 1000,
    feedbackScore: 0.5,
    ...overrides,
  };
}

test('selectFewShotExamples: 空 history → []', () => {
  assert.deepEqual(selectFewShotExamples([]), []);
});

test('selectFewShotExamples: k=0 → []', () => {
  const r = selectFewShotExamples([mkProposal('p1')], { k: 0 });
  assert.deepEqual(r, []);
});

test('selectFewShotExamples: 默认 k=3', () => {
  const history = [
    mkProposal('p1'),
    mkProposal('p2'),
    mkProposal('p3'),
    mkProposal('p4'),
    mkProposal('p5'),
  ];
  const r = selectFewShotExamples(history);
  assert.equal(r.length, 3);
});

test('selectFewShotExamples: feedback score 决定顺序', () => {
  const history = [mkProposal('p1'), mkProposal('p2'), mkProposal('p3')];
  const r = selectFewShotExamples(history, {
    feedbackScoreByProposalId: { p1: 0.5, p2: 0.9, p3: 0.7 },
  });
  assert.equal(r[0].sourceId, 'p2');
  assert.equal(r[1].sourceId, 'p3');
  assert.equal(r[2].sourceId, 'p1');
});

test('selectFewShotExamples: 同 projectId 加分 +3', () => {
  const history = [
    mkProposal('p1', { target: { projectId: 'X' } }),
    mkProposal('p2', { target: {} }),
  ];
  const r = selectFewShotExamples(history, {
    projectId: 'X',
    feedbackScoreByProposalId: { p1: 0.5, p2: 0.5 },
  });
  // p1 同 projectId +3, fbScore 都是 0.5 → tie-break created_at
  assert.equal(r[0].sourceId, 'p1');
});

test('selectFewShotExamples: 同 type 加分 +2', () => {
  const history = [
    mkProposal('p1', { type: 'add_paper' }),
    mkProposal('p2', { type: 'cite_paper' }),
  ];
  const r = selectFewShotExamples(history, {
    type: 'add_paper',
    feedbackScoreByProposalId: { p1: 0.5, p2: 0.5 },
  });
  assert.equal(r[0].sourceId, 'p1');
});

test('selectFewShotExamples: minScore 过滤低分', () => {
  const history = [mkProposal('p1'), mkProposal('p2')];
  const r = selectFewShotExamples(history, {
    minScore: 0.5,
    feedbackScoreByProposalId: { p1: 0.3, p2: 0.7 },
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].sourceId, 'p2');
});

test('selectFewShotExamples: feedbackScoreByProposalId 覆盖', () => {
  const history = [
    mkProposal('p1', { feedbackScore: 0.3 }),
    mkProposal('p2', { feedbackScore: 0.3 }),
  ];
  const r = selectFewShotExamples(history, {
    feedbackScoreByProposalId: { p1: 0.9, p2: 0.4 },
  });
  assert.equal(r[0].sourceId, 'p1');
});

test('selectFewShotExamples: 输出顺序稳定(同输入同输出)', () => {
  const history = [
    mkProposal('p1', { feedbackScore: 0.5 }),
    mkProposal('p2', { feedbackScore: 0.5 }),
    mkProposal('p3', { feedbackScore: 0.5 }),
  ];
  const a = selectFewShotExamples(history).map((e) => e.sourceId);
  const b = selectFewShotExamples(history).map((e) => e.sourceId);
  assert.deepEqual(a, b);
});

test('selectFewShotExamples: FewShotExample 含 sourceId', () => {
  const history = [mkProposal('p1')];
  const r = selectFewShotExamples(history);
  assert.equal(r[0].sourceId, 'p1');
  assert.equal(r[0].title, 'title-p1');
});

test('renderFewShotBlock: 空数组 → ""', () => {
  assert.equal(renderFewShotBlock([]), '');
});

test('renderFewShotBlock: 含 Example 标题', () => {
  const r = renderFewShotBlock([
    { type: 'add_paper', title: 't', rationale: 'r', estimated_effort: 'low', risk: 'k', score: 0.5, sourceId: 'p1' },
  ]);
  assert.ok(r.includes('# 示例'));
  assert.ok(r.includes('Example 1'));
  assert.ok(r.includes('"type"'));
  assert.ok(r.includes('"title"'));
});

test('renderFewShotBlock: 多个 Example 编号', () => {
  const examples = [
    { type: 'add_paper', title: 't1', rationale: 'r1', estimated_effort: 'low', risk: 'k1', score: 0.5, sourceId: 'p1' },
    { type: 'add_paper', title: 't2', rationale: 'r2', estimated_effort: 'low', risk: 'k2', score: 0.5, sourceId: 'p2' },
  ];
  const r = renderFewShotBlock(examples);
  assert.ok(r.includes('Example 1'));
  assert.ok(r.includes('Example 2'));
});

test('renderFewShotBlock: 含 JSON code block', () => {
  const r = renderFewShotBlock([
    { type: 'add_paper', title: 't', rationale: 'r', estimated_effort: 'low', risk: 'k', score: 0.5, sourceId: 'p1' },
  ]);
  assert.ok(r.includes('```json'));
  assert.ok(r.includes('```'));
});
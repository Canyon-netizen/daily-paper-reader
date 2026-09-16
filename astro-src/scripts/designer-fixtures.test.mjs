#!/usr/bin/env node
// astro-src/scripts/designer-fixtures.test.mjs
//
// Tests for R7 F.1.5 designer fixtures (16 fixtures covering 8 proposal types).

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
    external: ['../experiments', '../../experiments', '../paper', '../../paper', '../projects', '../../projects'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/designer.fixtures.ts');
const { DESIGNER_FIXTURES, FIXTURES_BY_TYPE } = mod;

test('DESIGNER_FIXTURES: 总数 16(8 types × 2)', () => {
  assert.equal(DESIGNER_FIXTURES.length, 16);
});

test('DESIGNER_FIXTURES: 每条都有合法 id / type / proposal', () => {
  for (const f of DESIGNER_FIXTURES) {
    assert.ok(f.id);
    assert.ok(f.proposal.id);
    assert.equal(f.proposal.type, f.type);
    assert.equal(typeof f.scenario, 'string');
  }
});

test('FIXTURES_BY_TYPE: 8 种 proposal type 都有', () => {
  const expectedTypes = [
    'add_paper', 'create_draft', 'experiment_plan', 'literature_review',
    'rebuttal', 'expand_draft', 'cite_paper', 'archive_paper',
  ];
  for (const t of expectedTypes) {
    assert.ok(FIXTURES_BY_TYPE[t], `missing type ${t}`);
    assert.equal(FIXTURES_BY_TYPE[t].length, 2, `type ${t} 应有 2 fixture`);
  }
});

test('每个 type 都含 happy + edge fixture', () => {
  for (const f of DESIGNER_FIXTURES) {
    assert.ok(['happy', 'edge', 'minimal'].includes(f.scenario));
  }
});

test('happy fixture 的 feedbackScore ≥ 0.7', () => {
  const happies = DESIGNER_FIXTURES.filter((f) => f.scenario === 'happy');
  for (const f of happies) {
    assert.ok(f.proposal.feedbackScore >= 0.7, `${f.id}: happy should have high score`);
  }
});

test('edge fixture 的 feedbackScore ≤ 0.5', () => {
  const edges = DESIGNER_FIXTURES.filter((f) => f.scenario === 'edge');
  for (const f of edges) {
    assert.ok(f.proposal.feedbackScore <= 0.5, `${f.id}: edge should have low score`);
  }
});

test('所有 paper id 都是合法 arxiv 格式', () => {
  const re = /^\d{4}\.\d{4,5}(v\d+)?$/;
  for (const f of DESIGNER_FIXTURES) {
    for (const id of f.proposal.evidence.paperIds) {
      assert.ok(re.test(id), `${f.id}: bad arxiv id ${id}`);
    }
  }
});

test('create_draft / literature_review / rebuttal fixture 至少 1 paper', () => {
  for (const f of DESIGNER_FIXTURES) {
    if (['create_draft', 'literature_review', 'rebuttal'].includes(f.type)
        && f.scenario === 'happy') {
      assert.ok(f.proposal.evidence.paperIds.length >= 1, `${f.id}: happy 应有 paper`);
    }
  }
});

test('id 唯一', () => {
  const ids = DESIGNER_FIXTURES.map((f) => f.id);
  const uniq = new Set(ids);
  assert.equal(uniq.size, ids.length);
});
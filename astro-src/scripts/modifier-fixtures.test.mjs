#!/usr/bin/env node
// astro-src/scripts/modifier-fixtures.test.mjs
//
// Tests for R7 F.3.5 modifier fixtures (4 deliverable types).

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

// Load both fixtures + modifier (for checkCrossReference)
const fixMod = await loadTs('lib/agents/modifier.fixtures.ts');
const { MODIFIER_FIXTURES, MODIFIER_FIXTURES_BY_TYPE, dryRunModifierFixture, expectedActionKinds } = fixMod;

const mod = await loadTs('lib/agents/modifier.ts');
const { checkCrossReference } = mod;

test('MODIFIER_FIXTURES: 5 条 fixture', () => {
  assert.equal(MODIFIER_FIXTURES.length, 5);
});

test('MODIFIER_FIXTURES_BY_TYPE: 4 种 deliverable type', () => {
  for (const t of ['create_draft', 'literature_review', 'rebuttal', 'expand_draft']) {
    assert.ok(MODIFIER_FIXTURES_BY_TYPE[t]);
    assert.ok(MODIFIER_FIXTURES_BY_TYPE[t].length >= 1);
  }
});

test('create_draft happy fixture dry-run ok', () => {
  const fixture = MODIFIER_FIXTURES.find((f) => f.id === 'fix-mod-cd-happy');
  const r = dryRunModifierFixture(fixture, checkCrossReference);
  assert.equal(r.ok, true);
  assert.equal(r.crossRefOk, true);
});

test('create_draft insufficient fixture 触发 skip', () => {
  const fixture = MODIFIER_FIXTURES.find((f) => f.id === 'fix-mod-cd-insufficient');
  const r = dryRunModifierFixture(fixture, checkCrossReference);
  assert.equal(r.crossRefOk, false);
  assert.ok(r.reason.includes('不达标'));
});

test('literature_review / rebuttal / expand_draft happy 都通过 cross-ref', () => {
  for (const id of ['fix-mod-lr-happy', 'fix-mod-rb-happy', 'fix-mod-ed-happy']) {
    const fixture = MODIFIER_FIXTURES.find((f) => f.id === id);
    const r = dryRunModifierFixture(fixture, checkCrossReference);
    assert.equal(r.crossRefOk, true, `${id} should pass cross-ref`);
  }
});

test('expectedActionKinds: 各 type 对应 action kind', () => {
  assert.deepEqual(expectedActionKinds('create_draft'), ['create_draft_outline']);
  assert.deepEqual(expectedActionKinds('literature_review'), ['create_draft_outline']);
  assert.deepEqual(expectedActionKinds('rebuttal'), ['create_draft_outline']);
  assert.deepEqual(expectedActionKinds('expand_draft'), ['expand_draft_section']);
});

test('fixture id 唯一', () => {
  const ids = MODIFIER_FIXTURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('每条 fixture 的 proposalId 唯一', () => {
  const ids = MODIFIER_FIXTURES.map((f) => f.proposal.id);
  assert.equal(new Set(ids).size, ids.length);
});
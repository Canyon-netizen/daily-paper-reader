#!/usr/bin/env node
// astro-src/scripts/proposal-serialize.test.mjs
//
// Tests for R7 AP.7 proposal serialization helpers.

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

const mod = await loadTs('lib/agents/serialize.ts');
const { serializeProposal, deserializeProposal, proposalsEqual } = mod;

test('serializeProposal: produces stable JSON', () => {
  const proposal = { id: 'p1', title: 'Test', score: 0.8 };
  const json1 = serializeProposal(proposal);
  const json2 = serializeProposal(proposal);
  assert.equal(json1, json2);
});

test('serializeProposal: keys are sorted', () => {
  const proposal = { z: 1, a: 2, m: 3 };
  const json = serializeProposal(proposal);
  assert.ok(json.indexOf('"a"') < json.indexOf('"m"'));
  assert.ok(json.indexOf('"m"') < json.indexOf('"z"'));
});

test('deserializeProposal: parses JSON correctly', () => {
  const original = { id: 'p1', title: 'Test', score: 0.8 };
  const json = serializeProposal(original);
  const parsed = deserializeProposal(json);
  assert.deepEqual(parsed, original);
});

test('deserializeProposal: round-trip preserves data', () => {
  const original = { id: 'p1', extra: { nested: true }, arr: [1, 2, 3] };
  const json = serializeProposal(original);
  const roundTripped = deserializeProposal(json);
  assert.deepEqual(roundTripped, original);
});

test('proposalsEqual: detects equal proposals', () => {
  const a = { id: 'p1', title: 'Test', score: 0.8 };
  const b = { score: 0.8, title: 'Test', id: 'p1' };
  assert.equal(proposalsEqual(a, b), true);
});

test('proposalsEqual: detects unequal proposals', () => {
  const a = { id: 'p1', title: 'Test' };
  const b = { id: 'p2', title: 'Test' };
  assert.equal(proposalsEqual(a, b), false);
});

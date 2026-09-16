#!/usr/bin/env node
// astro-src/scripts/proposal-dedup.test.mjs
//
// Tests for R7 AP.2 proposal deduplication helper.

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

const mod = await loadTs('lib/agents/proposal-dedup.ts');
const { dedupeProposals } = mod;

test('dedupeProposals: empty array returns empty', () => {
  assert.deepEqual(dedupeProposals([]), []);
});

test('dedupeProposals: single proposal returns unchanged', () => {
  const proposals = [{ id: 'p1', title: 'Unique title' }];
  assert.equal(dedupeProposals(proposals).length, 1);
});

test('dedupeProposals: removes exact duplicate titles', () => {
  const proposals = [
    { id: 'p1', title: 'Same Title' },
    { id: 'p2', title: 'Same Title' },
  ];
  const result = dedupeProposals(proposals);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'p1');
});

test('dedupeProposals: keeps dissimilar titles', () => {
  const proposals = [
    { id: 'p1', title: 'Machine learning for classification' },
    { id: 'p2', title: 'Quantum computing principles' },
  ];
  const result = dedupeProposals(proposals, 0.5);
  assert.equal(result.length, 2);
});

test('dedupeProposals: removes similar titles below threshold', () => {
  const proposals = [
    { id: 'p1', title: 'Machine learning for classification' },
    { id: 'p2', title: 'Machine learning for classification task' },
  ];
  const result = dedupeProposals(proposals, 0.8);
  assert.equal(result.length, 1);
});

test('dedupeProposals: case insensitive', () => {
  const proposals = [
    { id: 'p1', title: 'MACHINE LEARNING' },
    { id: 'p2', title: 'machine learning' },
  ];
  const result = dedupeProposals(proposals);
  assert.equal(result.length, 1);
});

test('dedupeProposals: handles special characters differently', () => {
  const proposals = [
    { id: 'p1', title: 'A/B Testing Framework' },
    { id: 'p2', title: 'A B Testing Framework' },
  ];
  const result = dedupeProposals(proposals);
  // These are different enough to keep
  assert.equal(result.length, 2);
});

test('dedupeProposals: preserves original objects', () => {
  const proposals = [
    { id: 'p1', title: 'First', extra: 'data1' },
    { id: 'p2', title: 'Different', extra: 'data2' },
  ];
  const result = dedupeProposals(proposals);
  assert.equal(result[0].extra, 'data1');
  assert.equal(result[1].extra, 'data2');
});

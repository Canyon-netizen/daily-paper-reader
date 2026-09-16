#!/usr/bin/env node
// astro-src/scripts/experiment-cross-link.test.mjs
//
// Tests for R7 LP.3 experiment-idea cross-linking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock localStorage for Node.js environment - use global to persist across modules
if (!globalThis.__mockStorage) {
  globalThis.__mockStorage = new Map();
}
globalThis.localStorage = {
  getItem: (key) => globalThis.__mockStorage.get(key) ?? null,
  setItem: (key, value) => globalThis.__mockStorage.set(key, value),
  removeItem: (key) => globalThis.__mockStorage.delete(key),
  clear: () => globalThis.__mockStorage.clear(),
};

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

const mod = await loadTs('lib/experiments/cross-link.ts');
const {
  linkExperimentToIdea,
  unlinkExperiment,
  getLinkedIdea,
  getLinkedExperiments,
  getAllLinkedIdeas,
  clearAllLinks,
} = mod;

// Clear before tests
clearAllLinks();

test('linkExperimentToIdea: creates bidirectional link', () => {
  const result = linkExperimentToIdea('exp-001', 'idea-alpha');
  assert.equal(result, true);
  assert.equal(getLinkedIdea('exp-001'), 'idea-alpha');
  assert.ok(getLinkedExperiments('idea-alpha').includes('exp-001'));
});

test('linkExperimentToIdea: can relink to different idea', () => {
  linkExperimentToIdea('exp-002', 'idea-beta');
  linkExperimentToIdea('exp-002', 'idea-gamma');

  assert.equal(getLinkedIdea('exp-002'), 'idea-gamma');
  assert.ok(!getLinkedExperiments('idea-beta').includes('exp-002'));
  assert.ok(getLinkedExperiments('idea-gamma').includes('exp-002'));
});

test('unlinkExperiment: removes the link', () => {
  linkExperimentToIdea('exp-003', 'idea-x');
  const result = unlinkExperiment('exp-003', 'idea-x');

  assert.equal(result, true);
  assert.equal(getLinkedIdea('exp-003'), null);
  assert.ok(!getLinkedExperiments('idea-x').includes('exp-003'));
});

test('unlinkExperiment: returns false for non-existent link', () => {
  const result = unlinkExperiment('non-existent', 'idea-y');
  assert.equal(result, false);
});

test('getLinkedExperiments: returns all experiments for an idea', () => {
  clearAllLinks();
  linkExperimentToIdea('exp-a', 'idea-shared');
  linkExperimentToIdea('exp-b', 'idea-shared');
  linkExperimentToIdea('exp-c', 'idea-shared');

  const experiments = getLinkedExperiments('idea-shared');
  assert.equal(experiments.length, 3);
  assert.ok(experiments.includes('exp-a'));
  assert.ok(experiments.includes('exp-b'));
  assert.ok(experiments.includes('exp-c'));
});

test('getAllLinkedIdeas: returns all ideas with links', () => {
  clearAllLinks();
  linkExperimentToIdea('exp-1', 'idea-1');
  linkExperimentToIdea('exp-2', 'idea-2');
  linkExperimentToIdea('exp-3', 'idea-3');

  const ideas = getAllLinkedIdeas();
  assert.equal(ideas.length, 3);
});

test('clearAllLinks: removes all links', () => {
  linkExperimentToIdea('exp-x', 'idea-y');
  linkExperimentToIdea('exp-y', 'idea-z');

  clearAllLinks();

  assert.equal(getLinkedIdea('exp-x'), null);
  assert.equal(getLinkedIdea('exp-y'), null);
  assert.equal(getAllLinkedIdeas().length, 0);
});

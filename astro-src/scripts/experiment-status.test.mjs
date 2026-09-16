#!/usr/bin/env node
// astro-src/scripts/experiment-status.test.mjs
//
// Tests for R7 E.2.4 experiment status transitions.

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

const mod = await loadTs('lib/experiments/status.ts');
const { canTransition, applyTransition, getValidTransitions, getStatusDescription } = mod;

const mockExperiment = {
  id: 'test-exp',
  title: 'Test Experiment',
  titleZh: '测试实验',
  hypothesis: 'Test hypothesis',
  hypothesisZh: '测试假设',
  method: 'Test method',
  methodZh: '测试方法',
  variables: [],
  expectedResults: '',
  expectedResultsZh: '',
  status: 'planning' as const,
  relatedPapers: [],
  tags: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  owner: 'test',
};

test('canTransition: planning to running is valid', () => {
  const result = canTransition('planning', 'running');
  assert.equal(result.valid, true);
});

test('canTransition: planning to completed is invalid', () => {
  const result = canTransition('planning', 'completed');
  assert.equal(result.valid, false);
  assert.ok(result.reason);
});

test('canTransition: self-transition is invalid', () => {
  const result = canTransition('running', 'running');
  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes('Self-transition'));
});

test('canTransition: running to failed is valid', () => {
  const result = canTransition('running', 'failed');
  assert.equal(result.valid, true);
});

test('canTransition: completed to archived is valid', () => {
  const result = canTransition('completed', 'archived');
  assert.equal(result.valid, true);
});

test('canTransition: failed to completed is invalid', () => {
  const result = canTransition('failed', 'completed');
  assert.equal(result.valid, false);
});

test('applyTransition: successful transition returns updated experiment', () => {
  const result = applyTransition(mockExperiment, 'running');
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.experiment.status, 'running');
    assert.ok(result.experiment.updatedAt);
  }
});

test('applyTransition: failed transition returns error', () => {
  const result = applyTransition(mockExperiment, 'completed');
  assert.equal(result.success, false);
  assert.ok(result.error);
});

test('applyTransition: preserves other experiment fields', () => {
  const result = applyTransition(mockExperiment, 'running');
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.experiment.id, 'test-exp');
    assert.equal(result.experiment.title, 'Test Experiment');
  }
});

test('getValidTransitions: returns array of valid statuses', () => {
  const transitions = getValidTransitions('planning');
  assert.ok(Array.isArray(transitions));
  assert.ok(transitions.includes('running'));
  assert.ok(transitions.includes('paused'));
});

test('getValidTransitions: completed can go to running (rerun)', () => {
  const transitions = getValidTransitions('completed');
  assert.ok(transitions.includes('running'));
});

test('getStatusDescription: returns human-readable description', () => {
  assert.equal(getStatusDescription('planning'), 'Experiment is being designed');
  assert.equal(getStatusDescription('running'), 'Experiment is currently running');
  assert.equal(getStatusDescription('completed'), 'Experiment completed successfully');
});

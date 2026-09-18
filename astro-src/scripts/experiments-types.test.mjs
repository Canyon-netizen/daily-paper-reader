#!/usr/bin/env node
// astro-src/scripts/experiments-types.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/types.ts.
// EXPERIMENT_STATUS_TRANSITIONS + canTransitionExperimentStatus (pure parts).

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

const mod = await loadTs('lib/experiments/types.ts');
const {
  EXPERIMENT_STATUS_TRANSITIONS,
  canTransitionExperimentStatus,
} = mod;

// ---------- EXPERIMENT_STATUS_TRANSITIONS ----------
test('EXPERIMENT_STATUS_TRANSITIONS: 6 statuses', () => {
  assert.equal(Object.keys(EXPERIMENT_STATUS_TRANSITIONS).length, 6);
});

test('EXPERIMENT_STATUS_TRANSITIONS: planning → running/paused/archived', () => {
  const t = EXPERIMENT_STATUS_TRANSITIONS.planning;
  assert.ok(t.includes('running'));
  assert.ok(t.includes('paused'));
  assert.ok(t.includes('archived'));
  assert.equal(t.length, 3);
});

test('EXPERIMENT_STATUS_TRANSITIONS: running → 4 targets', () => {
  assert.equal(EXPERIMENT_STATUS_TRANSITIONS.running.length, 4);
});

test('EXPERIMENT_STATUS_TRANSITIONS: completed → running/archived', () => {
  const t = EXPERIMENT_STATUS_TRANSITIONS.completed;
  assert.ok(t.includes('running'));
  assert.ok(t.includes('archived'));
  assert.equal(t.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: failed → running/archived', () => {
  const t = EXPERIMENT_STATUS_TRANSITIONS.failed;
  assert.ok(t.includes('running'));
  assert.ok(t.includes('archived'));
  assert.equal(t.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: paused → running/archived', () => {
  const t = EXPERIMENT_STATUS_TRANSITIONS.paused;
  assert.ok(t.includes('running'));
  assert.ok(t.includes('archived'));
  assert.equal(t.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: archived → planning/running', () => {
  const t = EXPERIMENT_STATUS_TRANSITIONS.archived;
  assert.ok(t.includes('planning'));
  assert.ok(t.includes('running'));
  assert.equal(t.length, 2);
});

test('EXPERIMENT_STATUS_TRANSITIONS: planning 不含 completed', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.planning.includes('completed'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: planning 不含 failed', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.planning.includes('failed'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: completed 不含 failed/paused', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.completed.includes('failed'));
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.completed.includes('paused'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: running 不含 planning', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.running.includes('planning'));
});

// ---------- canTransitionExperimentStatus ----------
test('canTransition: planning → running → true', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'running'), true);
});

test('canTransition: planning → paused → true', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'paused'), true);
});

test('canTransition: planning → archived → true', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'archived'), true);
});

test('canTransition: running → completed → true', () => {
  assert.equal(canTransitionExperimentStatus('running', 'completed'), true);
});

test('canTransition: running → failed → true', () => {
  assert.equal(canTransitionExperimentStatus('running', 'failed'), true);
});

test('canTransition: running → paused → true', () => {
  assert.equal(canTransitionExperimentStatus('running', 'paused'), true);
});

test('canTransition: running → archived → true', () => {
  assert.equal(canTransitionExperimentStatus('running', 'archived'), true);
});

test('canTransition: completed → running → true (复跑)', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'running'), true);
});

test('canTransition: completed → archived → true', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'archived'), true);
});

test('canTransition: failed → running → true (重做)', () => {
  assert.equal(canTransitionExperimentStatus('failed', 'running'), true);
});

test('canTransition: failed → archived → true', () => {
  assert.equal(canTransitionExperimentStatus('failed', 'archived'), true);
});

test('canTransition: paused → running → true', () => {
  assert.equal(canTransitionExperimentStatus('paused', 'running'), true);
});

test('canTransition: paused → archived → true', () => {
  assert.equal(canTransitionExperimentStatus('paused', 'archived'), true);
});

test('canTransition: archived → planning → true (复活)', () => {
  assert.equal(canTransitionExperimentStatus('archived', 'planning'), true);
});

test('canTransition: archived → running → true', () => {
  assert.equal(canTransitionExperimentStatus('archived', 'running'), true);
});

test('canTransition: self-transition → false', () => {
  const statuses = ['planning', 'running', 'completed', 'failed', 'paused', 'archived'];
  for (const s of statuses) {
    assert.equal(canTransitionExperimentStatus(s, s), false, `${s} → ${s} should be false`);
  }
});

test('canTransition: planning → completed → false', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'completed'), false);
});

test('canTransition: planning → failed → false', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'failed'), false);
});

test('canTransition: completed → failed → false', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'failed'), false);
});

test('canTransition: completed → paused → false', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'paused'), false);
});

test('canTransition: running → planning → false', () => {
  assert.equal(canTransitionExperimentStatus('running', 'planning'), false);
});

test('canTransition: failed → paused → false', () => {
  assert.equal(canTransitionExperimentStatus('failed', 'paused'), false);
});

test('canTransition: archived → failed → false', () => {
  assert.equal(canTransitionExperimentStatus('archived', 'failed'), false);
});

test('canTransition: archived → paused → false', () => {
  assert.equal(canTransitionExperimentStatus('archived', 'paused'), false);
});

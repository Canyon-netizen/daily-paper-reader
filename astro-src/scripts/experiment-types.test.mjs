#!/usr/bin/env node
// astro-src/scripts/experiment-types.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/types.ts.
// 测试 canTransitionExperimentStatus + EXPERIMENT_STATUS_TRANSITIONS 状态机。

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
const { EXPERIMENT_STATUS_TRANSITIONS, canTransitionExperimentStatus } = mod;

test('EXPERIMENT_STATUS_TRANSITIONS: 6 个状态全覆盖', () => {
  const expected = ['planning', 'running', 'completed', 'failed', 'paused', 'archived'];
  for (const s of expected) {
    assert.ok(EXPERIMENT_STATUS_TRANSITIONS[s]);
  }
});

test('canTransitionExperimentStatus: planning → running 合法', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'running'), true);
});

test('canTransitionExperimentStatus: planning → paused 合法', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'paused'), true);
});

test('canTransitionExperimentStatus: planning → archived 合法', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'archived'), true);
});

test('canTransitionExperimentStatus: planning → completed 非法', () => {
  // 还没跑就完成,不允许
  assert.equal(canTransitionExperimentStatus('planning', 'completed'), false);
});

test('canTransitionExperimentStatus: planning → failed 非法', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'failed'), false);
});

test('canTransitionExperimentStatus: running → completed 合法', () => {
  assert.equal(canTransitionExperimentStatus('running', 'completed'), true);
});

test('canTransitionExperimentStatus: running → failed 合法', () => {
  assert.equal(canTransitionExperimentStatus('running', 'failed'), true);
});

test('canTransitionExperimentStatus: running → planning 非法(已开始不能再 planning)', () => {
  assert.equal(canTransitionExperimentStatus('running', 'planning'), false);
});

test('canTransitionExperimentStatus: completed → archived 合法', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'archived'), true);
});

test('canTransitionExperimentStatus: completed → running 合法(可复跑)', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'running'), true);
});

test('canTransitionExperimentStatus: completed → failed 非法', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'failed'), false);
});

test('canTransitionExperimentStatus: completed → paused 非法', () => {
  assert.equal(canTransitionExperimentStatus('completed', 'paused'), false);
});

test('canTransitionExperimentStatus: failed → running 合法(重做)', () => {
  assert.equal(canTransitionExperimentStatus('failed', 'running'), true);
});

test('canTransitionExperimentStatus: failed → archived 合法', () => {
  assert.equal(canTransitionExperimentStatus('failed', 'archived'), true);
});

test('canTransitionExperimentStatus: paused → running 合法', () => {
  assert.equal(canTransitionExperimentStatus('paused', 'running'), true);
});

test('canTransitionExperimentStatus: paused → archived 合法', () => {
  assert.equal(canTransitionExperimentStatus('paused', 'archived'), true);
});

test('canTransitionExperimentStatus: paused → completed 非法(没跑过不能完成)', () => {
  assert.equal(canTransitionExperimentStatus('paused', 'completed'), false);
});

test('canTransitionExperimentStatus: archived → planning 合法(复活)', () => {
  assert.equal(canTransitionExperimentStatus('archived', 'planning'), true);
});

test('canTransitionExperimentStatus: archived → running 合法', () => {
  assert.equal(canTransitionExperimentStatus('archived', 'running'), true);
});

test('canTransitionExperimentStatus: 自我循环 → false', () => {
  for (const s of ['planning', 'running', 'completed', 'failed', 'paused', 'archived']) {
    assert.equal(canTransitionExperimentStatus(s, s), false);
  }
});
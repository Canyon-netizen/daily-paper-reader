#!/usr/bin/env node
// astro-src/scripts/pipeline-override.test.mjs
//
// Tests for R7 F.4.3 pipeline user override.

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

const {
  recordOverride,
  getOverrides,
  clearOverrides,
  applyOverride,
  getStageOverride,
  createOverride,
} = await loadTs('lib/agents/pipeline-override.ts');

// Mock localStorage
const mockStore = {};
globalThis.localStorage = {
  getItem(k) { return mockStore[k] ?? null; },
  setItem(k, v) { mockStore[k] = v; },
  removeItem(k) { delete mockStore[k]; },
};

test('recordOverride and getOverrides: roundtrip', () => {
  const override = createOverride('stage1', 'skip', 'user requested skip');
  recordOverride('p1', override);
  const overrides = getOverrides('p1');
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].stageId, 'stage1');
  assert.equal(overrides[0].action, 'skip');
  clearOverrides('p1');
});

test('getOverrides: returns empty array for unknown pipeline', () => {
  clearOverrides('unknown-pipeline');
  const overrides = getOverrides('unknown-pipeline');
  assert.deepEqual(overrides, []);
});

test('clearOverrides: removes all overrides', () => {
  recordOverride('to-clear', createOverride('s1', 'skip', 'test'));
  recordOverride('to-clear', createOverride('s2', 'retry', 'test'));
  clearOverrides('to-clear');
  assert.deepEqual(getOverrides('to-clear'), []);
});

test('applyOverride: skip returns null', () => {
  const stage = { id: 'stage1', type: 'default' };
  const override = createOverride('stage1', 'skip', 'user skip');
  const result = applyOverride(stage, override);
  assert.equal(result, null);
});

test('applyOverride: retry adds retry flags', () => {
  const stage = { id: 'stage1', type: 'default', config: { foo: 'bar' } };
  const override = createOverride('stage1', 'retry', 'user retry');
  const result = applyOverride(stage, override);
  assert.ok(result);
  assert.equal(result.config._retry, true);
  assert.ok(result.config._retryTimestamp);
  assert.equal(result.config.foo, 'bar');
});

test('applyOverride: modify merges payload', () => {
  const stage = { id: 'stage1', type: 'default', config: { original: true } };
  const override = createOverride('stage1', 'modify', 'user modified', { type: 'custom', config: { new: 'value' } });
  const result = applyOverride(stage, override);
  assert.ok(result);
  assert.equal(result.type, 'custom');
  assert.equal(result.config.new, 'value');
  assert.equal(result.config.original, undefined);
});

test('applyOverride: non-matching stageId returns unchanged', () => {
  const stage = { id: 'stage1' };
  const override = createOverride('other-stage', 'skip', 'test');
  const result = applyOverride(stage, override);
  assert.equal(result.id, 'stage1');
});

test('getStageOverride: returns latest override for stage', () => {
  clearOverrides('p2');
  recordOverride('p2', createOverride('s1', 'skip', 'first'));
  // Wait a bit to ensure different timestamp
  const later = createOverride('s1', 'retry', 'second');
  later.ts = Date.now() + 1000;
  recordOverride('p2', later);

  const override = getStageOverride('p2', 's1');
  assert.ok(override);
  assert.equal(override.action, 'retry');
  clearOverrides('p2');
});

test('getStageOverride: returns null for no override', () => {
  clearOverrides('p3');
  const override = getStageOverride('p3', 'nonexistent');
  assert.equal(override, null);
});

test('createOverride: builds correct structure', () => {
  const override = createOverride('my-stage', 'modify', 'custom reason', { foo: 'bar' });
  assert.equal(override.stageId, 'my-stage');
  assert.equal(override.action, 'modify');
  assert.equal(override.reason, 'custom reason');
  assert.deepEqual(override.payload, { foo: 'bar' });
  assert.ok(override.ts > 0);
});

#!/usr/bin/env node
// astro-src/scripts/pipeline-recovery.test.mjs
//
// Tests for R7 F.4.1 pipeline recovery.

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
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  recoverFromSnapshot,
  createSnapshot,
} = await loadTs('lib/agents/pipeline-recovery.ts');

// Mock localStorage for Node
const mockStore = {};
const mockStorage = {
  getItem(k) { return mockStore[k] ?? null; },
  setItem(k, v) { mockStore[k] = v; },
  removeItem(k) { delete mockStore[k]; },
};
globalThis.localStorage = mockStorage;

// Helper to create test snapshot
function makeSnapshot(overrides = {}) {
  return {
    ts: Date.now(),
    completedStages: ['stage1', 'stage2'],
    currentStage: 'stage3',
    pipelineId: 'test-pipeline',
    ...overrides,
  };
}

test('saveSnapshot and loadSnapshot: roundtrip', () => {
  const snap = makeSnapshot();
  saveSnapshot('test-pipeline', snap);
  const loaded = loadSnapshot('test-pipeline');
  assert.deepEqual(loaded, snap);
});

test('loadSnapshot: returns null for missing pipeline', () => {
  clearSnapshot('nonexistent-pipeline');
  const loaded = loadSnapshot('nonexistent-pipeline');
  assert.equal(loaded, null);
});

test('clearSnapshot: removes snapshot', () => {
  const snap = makeSnapshot();
  saveSnapshot('to-clear', snap);
  clearSnapshot('to-clear');
  const loaded = loadSnapshot('to-clear');
  assert.equal(loaded, null);
});

test('createSnapshot: builds correct structure', () => {
  const snap = createSnapshot('p1', ['a', 'b'], 'c', { failedStage: 'd', error: 'err', metadata: { foo: 'bar' } });
  assert.equal(snap.pipelineId, 'p1');
  assert.deepEqual(snap.completedStages, ['a', 'b']);
  assert.equal(snap.currentStage, 'c');
  assert.equal(snap.failedStage, 'd');
  assert.equal(snap.error, 'err');
  assert.deepEqual(snap.metadata, { foo: 'bar' });
  assert.ok(snap.ts > 0);
});

test('recoverFromSnapshot: runs stages after completed', async () => {
  const snap = makeSnapshot({ completedStages: ['s1'], currentStage: 's2' });
  const runLog: string[] = [];
  const runStage = async (id) => {
    runLog.push(id);
    return { id, ok: true };
  };
  const result = await recoverFromSnapshot(snap, runStage);
  assert.deepEqual(runLog, ['s2']); // only runs current stage
  assert.ok(result.results['s2']);
  assert.deepEqual(Object.keys(result.errors), []);
  assert.equal(result.resumedFrom, 's2');
});

test('recoverFromSnapshot: stops on error and records it', async () => {
  const snap = makeSnapshot({ completedStages: [], currentStage: 'stageA' });
  const runStage = async (id) => {
    if (id === 'stageA') throw new Error('stageA failed');
    return { id };
  };
  const result = await recoverFromSnapshot(snap, runStage);
  assert.ok(result.errors['stageA']);
  assert.equal(result.errors['stageA'].message, 'stageA failed');
});

test('recoverFromSnapshot: multiple stages', async () => {
  const snap = makeSnapshot({ completedStages: ['s1'], currentStage: 's2', failedStage: 's3' });
  const results: Record<string, string> = {};
  const runStage = async (id) => {
    results[id] = `ran-${id}`;
    return results[id];
  };
  const result = await recoverFromSnapshot(snap, runStage);
  assert.deepEqual(result.results, { s2: 'ran-s2', s3: 'ran-s3' });
});

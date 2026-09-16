#!/usr/bin/env node
// astro-src/scripts/agent-history.test.mjs
//
// Tests for R7 AP.4 agent run history tracking.

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

// Mock localStorage
const storage = {};
const mockLocalStorage = {
  getItem: (key) => storage[key] ?? null,
  setItem: (key, value) => { storage[key] = value; },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};
globalThis.localStorage = mockLocalStorage;

const mod = await loadTs('lib/agents/history.ts');
const { recordAgentRun, getRecentRuns, summarizeRuns, clearAgentHistory } = mod;

// Clear storage before tests
mockLocalStorage.clear();

test('recordAgentRun: stores run with timestamp', () => {
  recordAgentRun('test-agent', { success: true, duration: 100 });
  const runs = getRecentRuns('test-agent');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].metadata.success, true);
  assert.equal(runs[0].metadata.duration, 100);
});

test('getRecentRuns: returns runs in descending order', () => {
  mockLocalStorage.clear();
  recordAgentRun('agent1', { timestamp: 1000 });
  recordAgentRun('agent1', { timestamp: 2000 });
  recordAgentRun('agent1', { timestamp: 1500 });
  const runs = getRecentRuns('agent1');
  assert.equal(runs[0].timestamp, 2000);
  assert.equal(runs[1].timestamp, 1500);
  assert.equal(runs[2].timestamp, 1000);
});

test('getRecentRuns: limits results', () => {
  mockLocalStorage.clear();
  for (let i = 0; i < 30; i++) {
    recordAgentRun('limit-agent', { timestamp: i * 1000 });
  }
  const runs = getRecentRuns('limit-agent', 10);
  assert.equal(runs.length, 10);
});

test('summarizeRuns: calculates correct stats', () => {
  mockLocalStorage.clear();
  recordAgentRun('stats-agent', { success: true, duration: 100 });
  recordAgentRun('stats-agent', { success: true, duration: 200 });
  recordAgentRun('stats-agent', { success: false, duration: 50 });
  const summary = summarizeRuns('stats-agent');
  assert.equal(summary.totalRuns, 3);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 1);
  assert.ok(Math.abs((summary.avgDuration || 0) - 116.67) < 0.1);
});

test('summarizeRuns: empty agent returns zeros', () => {
  mockLocalStorage.clear();
  const summary = summarizeRuns('empty-agent');
  assert.equal(summary.totalRuns, 0);
  assert.equal(summary.successCount, 0);
  assert.equal(summary.failureCount, 0);
});

test('clearAgentHistory: removes agent runs', () => {
  mockLocalStorage.clear();
  recordAgentRun('to-clear', { success: true });
  clearAgentHistory('to-clear');
  const runs = getRecentRuns('to-clear');
  assert.equal(runs.length, 0);
});

test('getRecentRuns: filters by agent name', () => {
  mockLocalStorage.clear();
  recordAgentRun('agent-a', { timestamp: 1000 });
  recordAgentRun('agent-b', { timestamp: 2000 });
  const runsA = getRecentRuns('agent-a');
  const runsB = getRecentRuns('agent-b');
  assert.equal(runsA.length, 1);
  assert.equal(runsB.length, 1);
});

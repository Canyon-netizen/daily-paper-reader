#!/usr/bin/env node
// astro-src/scripts/agent-health.test.mjs
//
// Tests for R7 AP.1 agent health check utility.

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

const mod = await loadTs('lib/agents/health.ts');
const { checkAgentHealth, updateAgentHealth } = mod;

// Clear storage before tests
mockLocalStorage.clear();

test('checkAgentHealth: unknown agent returns default healthy', () => {
  const health = checkAgentHealth('unknown-agent');
  assert.equal(health.available, true);
  assert.equal(health.lastRun, 0);
  assert.equal(health.errorRate, 0);
});

test('checkAgentHealth: reflects stored health data', () => {
  mockLocalStorage.clear();
  updateAgentHealth('test-agent', { lastRun: 1000, errorRate: 0.2 });
  const health = checkAgentHealth('test-agent');
  assert.equal(health.lastRun, 1000);
  assert.equal(health.errorRate, 0.2);
});

test('checkAgentHealth: marks unavailable when errorRate exceeds threshold', () => {
  mockLocalStorage.clear();
  updateAgentHealth('failing-agent', { lastRun: Date.now(), errorRate: 0.8 });
  const health = checkAgentHealth('failing-agent', { maxErrorRate: 0.5 });
  assert.equal(health.available, false);
});

test('checkAgentHealth: marks unavailable when stale', () => {
  mockLocalStorage.clear();
  const staleTime = Date.now() - (48 * 60 * 60 * 1000); // 48 hours ago
  updateAgentHealth('stale-agent', { lastRun: staleTime, errorRate: 0 });
  const health = checkAgentHealth('stale-agent', { staleMs: 24 * 60 * 60 * 1000 });
  assert.equal(health.available, false);
});

test('checkAgentHealth: available when healthy', () => {
  mockLocalStorage.clear();
  updateAgentHealth('healthy-agent', { lastRun: Date.now(), errorRate: 0.1 });
  const health = checkAgentHealth('healthy-agent');
  assert.equal(health.available, true);
});

test('updateAgentHealth: stores health data correctly', () => {
  mockLocalStorage.clear();
  updateAgentHealth('new-agent', { lastRun: 5000, errorRate: 0.3, available: false });
  const raw = mockLocalStorage.getItem('dpr_agent_health_v1');
  const data = JSON.parse(raw);
  assert.equal(data['new-agent'].lastRun, 5000);
  assert.equal(data['new-agent'].errorRate, 0.3);
  assert.equal(data['new-agent'].available, false);
});

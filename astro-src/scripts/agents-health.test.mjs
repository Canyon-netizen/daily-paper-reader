#!/usr/bin/env node
// astro-src/scripts/agents-health.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/health.ts (uses localStorage;
// runs in Node so localStorage is undefined → defaults apply).

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

const mod = await loadTs('lib/agents/health.ts');
const { checkAgentHealth, updateAgentHealth } = mod;

test('checkAgentHealth: localStorage 不存在时 → available=true, errorRate=0', () => {
  // Node 环境 localStorage undefined → 默认 agentHealth
  const r = checkAgentHealth('foo');
  assert.equal(r.available, true);
  assert.equal(r.errorRate, 0);
  assert.equal(r.lastRun, 0);
});

test('checkAgentHealth: 不同 agent 独立查询', () => {
  const a = checkAgentHealth('agent-a');
  const b = checkAgentHealth('agent-b');
  assert.equal(a.available, true);
  assert.equal(b.available, true);
});

test('checkAgentHealth: 自定义 maxErrorRate/staleMs (无 localStorage 时不影响)', () => {
  const r = checkAgentHealth('foo', { maxErrorRate: 0.1, staleMs: 1000 });
  assert.equal(r.available, true);
});

test('updateAgentHealth: 无 localStorage → no-op, 不抛错', () => {
  // 应静默 no-op
  assert.doesNotThrow(() => {
    updateAgentHealth('foo', { available: false });
  });
});

test('updateAgentHealth: 不存在的 agent 不报错', () => {
  assert.doesNotThrow(() => {
    updateAgentHealth('new-agent', { lastRun: 12345 });
  });
});

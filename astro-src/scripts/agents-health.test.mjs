#!/usr/bin/env node
// astro-src/scripts/agents-health.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/health.ts checkAgentHealth + updateAgentHealth.
// 在 import 前注入 globalThis.localStorage mock。

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

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

// ---------- checkAgentHealth ----------
test('checkAgentHealth: 无 health 数据 → 默认 available=true', () => {
  store.clear();
  const r = checkAgentHealth('unknown-agent');
  assert.equal(r.available, true);
  assert.equal(r.lastRun, 0);
  assert.equal(r.errorRate, 0);
});

test('checkAgentHealth: 已知 agent + low errorRate → available', () => {
  store.clear();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.1 });
  const r = checkAgentHealth('a1');
  assert.equal(r.available, true);
  assert.equal(r.errorRate, 0.1);
});

test('checkAgentHealth: 高 errorRate → unavailable', () => {
  store.clear();
  updateAgentHealth('a2', { available: true, lastRun: Date.now(), errorRate: 0.9 });
  const r = checkAgentHealth('a2');
  assert.equal(r.available, false);
});

test('checkAgentHealth: 自定义 maxErrorRate', () => {
  store.clear();
  updateAgentHealth('a3', { lastRun: Date.now(), errorRate: 0.4 });
  // maxErrorRate = 0.3 → 0.4 > 0.3 → unavailable
  const r = checkAgentHealth('a3', { maxErrorRate: 0.3 });
  assert.equal(r.available, false);
});

test('checkAgentHealth: 边界 maxErrorRate = 0.4 → 0.4 不严格大于 → available', () => {
  store.clear();
  updateAgentHealth('a3b', { lastRun: Date.now(), errorRate: 0.4 });
  const r = checkAgentHealth('a3b', { maxErrorRate: 0.4 });
  assert.equal(r.available, true);
});

test('checkAgentHealth: stale (lastRun 很久以前) → unavailable', () => {
  store.clear();
  updateAgentHealth('a4', { available: true, lastRun: 1, errorRate: 0 });
  const r = checkAgentHealth('a4');
  assert.equal(r.available, false);
});

test('checkAgentHealth: 自定义 staleMs', () => {
  store.clear();
  updateAgentHealth('a5', { available: true, lastRun: Date.now() - 100, errorRate: 0 });
  // staleMs = 50 → 100ms 之前算 stale
  const r = checkAgentHealth('a5', { staleMs: 50 });
  assert.equal(r.available, false);
});

test('checkAgentHealth: lastRun=0 → 不会 stale', () => {
  store.clear();
  updateAgentHealth('a6', { available: true, lastRun: 0, errorRate: 0 });
  const r = checkAgentHealth('a6');
  assert.equal(r.available, true);
});

test('checkAgentHealth: available=false 透传', () => {
  store.clear();
  updateAgentHealth('a7', { available: false, lastRun: Date.now(), errorRate: 0 });
  const r = checkAgentHealth('a7');
  assert.equal(r.available, false);
});

test('checkAgentHealth: lastRun 字段返回', () => {
  store.clear();
  updateAgentHealth('a8', { lastRun: 12345, errorRate: 0 });
  const r = checkAgentHealth('a8');
  assert.equal(r.lastRun, 12345);
});

test('checkAgentHealth: 损坏 JSON → 走默认', () => {
  store.set('dpr_agent_health_v1', '{not json');
  const r = checkAgentHealth('any');
  // JSON.parse 抛错被 catch → 用默认 { available: true, lastRun: 0 }
  assert.equal(r.available, true);
});

// ---------- updateAgentHealth ----------
test('updateAgentHealth: 写入 + checkAgentHealth 读出', () => {
  store.clear();
  updateAgentHealth('b1', { available: false });
  const r = checkAgentHealth('b1');
  assert.equal(r.available, false);
});

test('updateAgentHealth: 合并已存在数据', () => {
  store.clear();
  updateAgentHealth('b2', { lastRun: 100, errorRate: 0.2 });
  updateAgentHealth('b2', { available: false });
  const r = checkAgentHealth('b2');
  // 第二次只覆盖 available;lastRun/errorRate 保留
  assert.equal(r.lastRun, 100);
  assert.equal(r.errorRate, 0.2);
  assert.equal(r.available, false);
});

test('updateAgentHealth: 新 agent → 默认 lastRun=0/errorRate=0', () => {
  store.clear();
  updateAgentHealth('b3', { available: false });
  const r = checkAgentHealth('b3');
  assert.equal(r.lastRun, 0);
  assert.equal(r.errorRate, 0);
});

test('updateAgentHealth: 不同 agent → 独立存储', () => {
  store.clear();
  updateAgentHealth('b4', { errorRate: 0.1 });
  updateAgentHealth('b5', { errorRate: 0.9 });
  assert.equal(checkAgentHealth('b4').errorRate, 0.1);
  assert.equal(checkAgentHealth('b5').errorRate, 0.9);
});
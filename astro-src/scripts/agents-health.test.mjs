#!/usr/bin/env node
// astro-src/scripts/agents-health.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/health.ts.
// checkAgentHealth (maxErrorRate + staleMs 检查) +
// updateAgentHealth (localStorage 写入/合并)。

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

// localStorage mock
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const mod = await loadTs('lib/agents/health.ts');
const { checkAgentHealth, updateAgentHealth } = mod;

const resetStorage = () => store.clear();

// ---------- checkAgentHealth: 默认 ---
test('check: 无 localStorage 数据 → 默认 available', () => {
  resetStorage();
  const r = checkAgentHealth('agent1');
  assert.equal(r.available, true);
  assert.equal(r.lastRun, 0);
  assert.equal(r.errorRate, 0);
});

test('check: 读取写入的数据', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.1 });
  const r = checkAgentHealth('a1');
  assert.equal(r.available, true);
  assert.equal(r.errorRate, 0.1);
});

// ---------- 错误率检查 ---
test('check: errorRate > maxErrorRate → unavailable', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.6 });
  const r = checkAgentHealth('a1', { maxErrorRate: 0.5 });
  assert.equal(r.available, false);
});

test('check: errorRate = maxErrorRate → available', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.5 });
  const r = checkAgentHealth('a1', { maxErrorRate: 0.5 });
  assert.equal(r.available, true);
});

test('check: errorRate < maxErrorRate → available', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.3 });
  const r = checkAgentHealth('a1', { maxErrorRate: 0.5 });
  assert.equal(r.available, true);
});

// ---------- stale 检查 ---
test('check: lastRun 太久 → unavailable', () => {
  resetStorage();
  const oldTime = Date.now() - 48 * 60 * 60 * 1000; // 2 天前
  updateAgentHealth('a1', { available: true, lastRun: oldTime, errorRate: 0 });
  const r = checkAgentHealth('a1', { staleMs: 24 * 60 * 60 * 1000 });
  assert.equal(r.available, false);
});

test('check: lastRun 在 stale 范围内 → available', () => {
  resetStorage();
  const recentTime = Date.now() - 1 * 60 * 60 * 1000; // 1 小时前
  updateAgentHealth('a1', { available: true, lastRun: recentTime, errorRate: 0 });
  const r = checkAgentHealth('a1', { staleMs: 24 * 60 * 60 * 1000 });
  assert.equal(r.available, true);
});

test('check: lastRun=0 (default) → 不算 stale', () => {
  resetStorage();
  // 默认 lastRun=0,即使过去很久也不算
  const r = checkAgentHealth('a1');
  assert.equal(r.available, true);
});

// ---------- available 字段 ---
test('check: stored available=false → unavailable (即使 errorRate OK)', () => {
  resetStorage();
  updateAgentHealth('a1', { available: false, lastRun: Date.now(), errorRate: 0 });
  const r = checkAgentHealth('a1');
  assert.equal(r.available, false);
});

// ---------- 多个 agents ---
test('check: 不同 agent 独立', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.1 });
  updateAgentHealth('a2', { available: false, lastRun: Date.now(), errorRate: 0 });
  assert.equal(checkAgentHealth('a1').available, true);
  assert.equal(checkAgentHealth('a2').available, false);
});

// ---------- updateAgentHealth: 合并 ---
test('update: 部分字段合并', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.1 });
  updateAgentHealth('a1', { lastRun: Date.now() + 100 }); // 只更新 lastRun
  const r = checkAgentHealth('a1');
  assert.equal(r.available, true); // 保留旧值
  assert.equal(r.errorRate, 0.1); // 保留旧值
});

test('update: 缺字段使用 default', () => {
  resetStorage();
  updateAgentHealth('a1', { lastRun: Date.now() }); // 缺 available + errorRate
  const r = checkAgentHealth('a1');
  assert.equal(r.available, true); // default
  assert.equal(r.errorRate, 0); // default
});

test('update: 全字段覆盖', () => {
  resetStorage();
  updateAgentHealth('a1', { available: true, lastRun: Date.now(), errorRate: 0.1 });
  updateAgentHealth('a1', { available: false, lastRun: Date.now() + 1, errorRate: 0.9 });
  const r = checkAgentHealth('a1');
  assert.equal(r.available, false);
  assert.equal(r.errorRate, 0.9);
});

// ---------- 错误处理 ---
test('check: 损坏 JSON → 默认值', () => {
  resetStorage();
  store.set('dpr_agent_health_v1', 'not-json{');
  const r = checkAgentHealth('a1');
  assert.equal(r.available, true);
  assert.equal(r.lastRun, 0);
});

test('check: 无 opts 用默认', () => {
  resetStorage();
  const r = checkAgentHealth('a1');
  assert.equal(r.lastRun, 0);
});

test('storage key = "dpr_agent_health_v1"', () => {
  resetStorage();
  updateAgentHealth('a1', { lastRun: 100 });
  assert.ok(store.has('dpr_agent_health_v1'));
});

// ---------- 集成 ---
test('集成: write → read 流程', () => {
  resetStorage();
  updateAgentHealth('designer', {
    available: true,
    lastRun: Date.now(),
    errorRate: 0.05,
  });
  const h = checkAgentHealth('designer');
  assert.equal(h.available, true);
  assert.equal(h.errorRate, 0.05);
});

test('集成: 高错误率 → unavailable', () => {
  resetStorage();
  for (let i = 0; i < 5; i++) {
    updateAgentHealth('flaky', { errorRate: 0.1 });
  }
  updateAgentHealth('flaky', { errorRate: 0.8 });
  const h = checkAgentHealth('flaky');
  assert.equal(h.available, false);
});
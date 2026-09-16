#!/usr/bin/env node
// astro-src/scripts/agents-history.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/history.ts.
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

const mod = await loadTs('lib/agents/history.ts');
const {
  recordAgentRun,
  getRecentRuns,
  summarizeRuns,
  clearAgentHistory,
} = mod;

// ---------- recordAgentRun + getRecentRuns ----------
test('recordAgentRun: 写入 + getRecentRuns 读出', () => {
  store.clear();
  recordAgentRun('a1', { success: true });
  const r = getRecentRuns('a1');
  assert.equal(r.length, 1);
  assert.equal(r[0].agentName, 'a1');
});

test('recordAgentRun: metadata.timestamp 默认 Date.now', () => {
  store.clear();
  const before = Date.now();
  recordAgentRun('a2');
  const after = Date.now();
  const r = getRecentRuns('a2');
  assert.ok(r[0].timestamp >= before && r[0].timestamp <= after);
});

test('recordAgentRun: 自定义 timestamp 透传', () => {
  store.clear();
  recordAgentRun('a3', { timestamp: 12345 });
  const r = getRecentRuns('a3');
  assert.equal(r[0].timestamp, 12345);
});

test('recordAgentRun: 默认 metadata = {}', () => {
  store.clear();
  recordAgentRun('a4');
  const r = getRecentRuns('a4');
  assert.deepEqual(r[0].metadata, {});
});

test('getRecentRuns: 排序按 timestamp desc', () => {
  store.clear();
  recordAgentRun('a5', { timestamp: 100 });
  recordAgentRun('a5', { timestamp: 200 });
  recordAgentRun('a5', { timestamp: 150 });
  const r = getRecentRuns('a5');
  assert.deepEqual(r.map((x) => x.timestamp), [200, 150, 100]);
});

test('getRecentRuns: limit 默认 20', () => {
  store.clear();
  for (let i = 0; i < 30; i++) {
    recordAgentRun('a6', { timestamp: i });
  }
  const r = getRecentRuns('a6');
  assert.equal(r.length, 20);
  // 最新 20 个: 10..29
  assert.equal(r[0].timestamp, 29);
});

test('getRecentRuns: 自定义 limit', () => {
  store.clear();
  for (let i = 0; i < 30; i++) {
    recordAgentRun('a7', { timestamp: i });
  }
  const r = getRecentRuns('a7', 5);
  assert.equal(r.length, 5);
});

test('getRecentRuns: 不存在的 agent → []', () => {
  store.clear();
  assert.deepEqual(getRecentRuns('nonexistent'), []);
});

test('getRecentRuns: 过滤其他 agent', () => {
  store.clear();
  recordAgentRun('a8', { timestamp: 1 });
  recordAgentRun('a9', { timestamp: 2 });
  assert.equal(getRecentRuns('a8').length, 1);
  assert.equal(getRecentRuns('a9').length, 1);
});

test('recordAgentRun: 上限 1000 per agent (slice 末尾)', () => {
  store.clear();
  for (let i = 0; i < 1005; i++) {
    recordAgentRun('a10', { timestamp: i });
  }
  const r = getRecentRuns('a10', 2000);
  assert.equal(r.length, 1000);
  // 应保留最新 1000 个 → timestamp >= 5
  assert.ok(r.every((x) => x.timestamp >= 5));
});

test('recordAgentRun: 上限 1000 不影响其他 agent', () => {
  store.clear();
  for (let i = 0; i < 1500; i++) {
    recordAgentRun('a11', { timestamp: i });
  }
  recordAgentRun('a12', { timestamp: 9999 });
  // a12 应保留
  const r = getRecentRuns('a12');
  assert.equal(r.length, 1);
});

// ---------- summarizeRuns ----------
test('summarizeRuns: 空 → 全 0', () => {
  store.clear();
  const r = summarizeRuns('nonexistent');
  assert.equal(r.totalRuns, 0);
  assert.equal(r.successCount, 0);
  assert.equal(r.failureCount, 0);
  assert.equal(r.lastRun, 0);
  assert.equal(r.avgDuration, undefined);
});

test('summarizeRuns: success=true count', () => {
  store.clear();
  recordAgentRun('b1', { success: true });
  recordAgentRun('b1', { success: true });
  recordAgentRun('b1', { success: false });
  const r = summarizeRuns('b1');
  assert.equal(r.totalRuns, 3);
  assert.equal(r.successCount, 2);
  assert.equal(r.failureCount, 1);
});

test('summarizeRuns: success=undefined 视为成功', () => {
  store.clear();
  recordAgentRun('b2', {}); // success undefined
  const r = summarizeRuns('b2');
  assert.equal(r.successCount, 1);
  assert.equal(r.failureCount, 0);
});

test('summarizeRuns: avgDuration', () => {
  store.clear();
  recordAgentRun('b3', { duration: 100 });
  recordAgentRun('b3', { duration: 200 });
  recordAgentRun('b3', { duration: 300 });
  const r = summarizeRuns('b3');
  assert.equal(r.avgDuration, 200);
});

test('summarizeRuns: avgDuration 跳过 undefined', () => {
  store.clear();
  recordAgentRun('b4', { duration: 100 });
  recordAgentRun('b4', { duration: undefined });
  recordAgentRun('b4', { duration: null });
  recordAgentRun('b4', { duration: 200 });
  const r = summarizeRuns('b4');
  // 仅 100 + 200 / 2 = 150
  assert.equal(r.avgDuration, 150);
});

test('summarizeRuns: lastRun 是最新 timestamp', () => {
  store.clear();
  recordAgentRun('b5', { timestamp: 100 });
  recordAgentRun('b5', { timestamp: 500 });
  recordAgentRun('b5', { timestamp: 300 });
  const r = summarizeRuns('b5');
  assert.equal(r.lastRun, 500);
});

// ---------- clearAgentHistory ----------
test('clearAgentHistory: 删除指定 agent', () => {
  store.clear();
  recordAgentRun('c1', { timestamp: 1 });
  recordAgentRun('c2', { timestamp: 2 });
  clearAgentHistory('c1');
  assert.equal(getRecentRuns('c1').length, 0);
  assert.equal(getRecentRuns('c2').length, 1);
});

test('clearAgentHistory: 清理后 summarizeRuns → 0', () => {
  store.clear();
  recordAgentRun('c3', { timestamp: 1 });
  clearAgentHistory('c3');
  const r = summarizeRuns('c3');
  assert.equal(r.totalRuns, 0);
});
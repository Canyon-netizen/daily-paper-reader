#!/usr/bin/env node
// astro-src/scripts/experiments-results.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/results.ts.
// genResultId + computeDelta (delta / percentOff 4-decimal) +
// recordResult/getResults/clearResults/getResultSummary (用 localStorage mock + window stub)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

// ---------- localStorage + window mocks BEFORE module load ----------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};
globalThis.window = globalThis;

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

const mod = await loadTs('lib/experiments/results.ts');
const {
  genResultId,
  computeDelta,
  recordResult,
  getResults,
  clearResults,
  getResultSummary,
} = mod;

const reset = () => {
  store.clear();
  // source 重置所有 results
  globalThis.localStorage.clear();
};

// ---------- genResultId ----------
test('genResultId: 含 r_ 前缀', () => {
  assert.match(genResultId(), /^r_/);
});

test('genResultId: 多次调用不同', () => {
  const a = genResultId();
  const b = genResultId();
  assert.notEqual(a, b);
});

test('genResultId: 是 string', () => {
  assert.equal(typeof genResultId(), 'string');
});

// ---------- computeDelta ----------
test('computeDelta: 空数组 → 空', () => {
  const r = computeDelta([]);
  assert.deepEqual(r.metric, {});
});

test('computeDelta: delta = actual - expected', () => {
  const r = computeDelta([
    { id: '1', experimentId: 'e', metric: 'acc', expected: 0.8, actual: 0.85, ts: 0 },
  ]);
  // 浮点:0.85 - 0.8 = 0.0499999... 用近似比较
  assert.ok(Math.abs(r.metric.acc.delta - 0.05) < 1e-9);
});

test('computeDelta: percentOff = |delta / expected|', () => {
  const r = computeDelta([
    { id: '1', experimentId: 'e', metric: 'acc', expected: 0.8, actual: 0.85, ts: 0 },
  ]);
  // 0.05 / 0.8 = 0.0625
  assert.equal(r.metric.acc.percentOff, 0.0625);
});

test('computeDelta: expected=0 → percentOff=0 (避免除零)', () => {
  const r = computeDelta([
    { id: '1', experimentId: 'e', metric: 'm', expected: 0, actual: 5, ts: 0 },
  ]);
  assert.equal(r.metric.m.percentOff, 0);
});

test('computeDelta: percentOff 4 位小数', () => {
  const r = computeDelta([
    { id: '1', experimentId: 'e', metric: 'm', expected: 3, actual: 1, ts: 0 },
  ]);
  // 1 - 3 = -2, |(-2)/3| = 0.6666666... → rounded to 0.6667
  assert.equal(r.metric.m.percentOff, 0.6667);
});

test('computeDelta: 多 metric 分开', () => {
  const r = computeDelta([
    { id: '1', experimentId: 'e', metric: 'a', expected: 1, actual: 2, ts: 0 },
    { id: '2', experimentId: 'e', metric: 'b', expected: 1, actual: 0.5, ts: 0 },
  ]);
  assert.equal(r.metric.a.delta, 1);
  assert.equal(r.metric.b.delta, -0.5);
});

test('computeDelta: 重复 metric 后写覆盖前', () => {
  const r = computeDelta([
    { id: '1', experimentId: 'e', metric: 'a', expected: 1, actual: 2, ts: 0 },
    { id: '2', experimentId: 'e', metric: 'a', expected: 5, actual: 6, ts: 0 },
  ]);
  // 后写覆盖:expected=5, actual=6
  assert.equal(r.metric.a.expected, 5);
  assert.equal(r.metric.a.delta, 1);
});

// ---------- recordResult ----------
test('recordResult: 返回 ExperimentResult', () => {
  reset();
  const r = recordResult('e1', { metric: 'acc', expected: 0.8, actual: 0.9 });
  assert.equal(r.experimentId, 'e1');
  assert.equal(r.metric, 'acc');
  assert.equal(typeof r.id, 'string');
  assert.equal(typeof r.ts, 'number');
});

test('recordResult: 写入 localStorage', () => {
  reset();
  recordResult('e1', { metric: 'acc', expected: 0.8, actual: 0.9 });
  const raw = store.get('dpr_experiment_results_v1');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 1);
});

test('recordResult: 多次记录累加', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 2 });
  recordResult('e1', { metric: 'b', expected: 2, actual: 3 });
  const r = getResults('e1');
  assert.equal(r.length, 2);
});

// ---------- getResults ----------
test('getResults: 缺 store → []', () => {
  reset();
  assert.deepEqual(getResults('none'), []);
});

test('getResults: 按 experimentId 过滤', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 2 });
  recordResult('e2', { metric: 'b', expected: 1, actual: 2 });
  assert.equal(getResults('e1').length, 1);
  assert.equal(getResults('e2').length, 1);
});

// ---------- clearResults ----------
test('clearResults: 仅清当前 experimentId', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 2 });
  recordResult('e2', { metric: 'b', expected: 1, actual: 2 });
  clearResults('e1');
  assert.equal(getResults('e1').length, 0);
  assert.equal(getResults('e2').length, 1);
});

test('clearResults: 重复调无副作用', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 2 });
  clearResults('e1');
  clearResults('e1');
  assert.equal(getResults('e1').length, 0);
});

// ---------- getResultSummary ----------
test('getResultSummary: 含 count/avgPercentOff/metrics', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 1.1 });
  const s = getResultSummary('e1');
  assert.equal(s.count, 1);
  assert.ok(Array.isArray(s.metrics));
  assert.equal(typeof s.avgPercentOff, 'number');
});

test('getResultSummary: 空 → count=0', () => {
  reset();
  const s = getResultSummary('none');
  assert.equal(s.count, 0);
  assert.equal(s.avgPercentOff, 0);
  assert.deepEqual(s.metrics, []);
});

test('getResultSummary: avgPercentOff 是 4 位小数', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 2 });
  const s = getResultSummary('e1');
  // 1.0 (|1/1|)
  assert.equal(s.avgPercentOff, 1.0);
});

test('getResultSummary: metrics 含所有 metric 名', () => {
  reset();
  recordResult('e1', { metric: 'a', expected: 1, actual: 2 });
  recordResult('e1', { metric: 'b', expected: 1, actual: 2 });
  const s = getResultSummary('e1');
  assert.deepEqual(s.metrics.sort(), ['a', 'b']);
});

// ---------- 损坏 JSON ---
test('experiments-results: 损坏 JSON → 空', () => {
  store.set('dpr_experiment_results_v1', '{bad');
  assert.deepEqual(getResults('e1'), []);
});
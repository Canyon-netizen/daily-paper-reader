#!/usr/bin/env node
// astro-src/scripts/agents-gate-policy.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/gate-policy.ts evaluateGatePolicy.

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

const mod = await loadTs('lib/agents/gate-policy.ts');
const { evaluateGatePolicy } = mod;

test('evaluateGatePolicy: 空 policy → passed=true', () => {
  const r = evaluateGatePolicy([], { x: 1 });
  assert.equal(r.passed, true);
  assert.deepEqual(r.reasons, []);
});

test('evaluateGatePolicy: 空 scores + 空 policy → passed=true', () => {
  const r = evaluateGatePolicy([], {});
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: > 比较 — pass', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '>' }], { x: 10 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: > 比较 — fail (等于)', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '>' }], { x: 5 });
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /failed/);
});

test('evaluateGatePolicy: >= 比较 — pass (等于)', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '>=' }], { x: 5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: < 比较 — pass', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '<' }], { x: 3 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: <= 比较 — pass (等于)', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '<=' }], { x: 5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: == 比较 — pass', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '==' }], { x: 5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: == 比较 — fail (浮点)', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '==' }], { x: 5.001 });
  assert.equal(r.passed, false);
});

test('evaluateGatePolicy: != 比较 — pass (不等)', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '!=' }], { x: 3 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: != 比较 — fail (等于)', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '!=' }], { x: 5 });
  assert.equal(r.passed, false);
});

test('evaluateGatePolicy: 未知 comparator → 视为失败', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '??' }], { x: 10 });
  assert.equal(r.passed, false);
});

test('evaluateGatePolicy: 缺失 metric → 添加 reason', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '>' }], {});
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /Missing metric: x/);
});

test('evaluateGatePolicy: 缺失 metric + 其他 rule fail → 2 reasons', () => {
  const r = evaluateGatePolicy(
    [
      { metric: 'x', threshold: 5, comparator: '>' },
      { metric: 'y', threshold: 10, comparator: '>=' },
    ],
    { y: 5 },
  );
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 2);
});

test('evaluateGatePolicy: 多 rule 全 pass', () => {
  const r = evaluateGatePolicy(
    [
      { metric: 'x', threshold: 5, comparator: '>' },
      { metric: 'y', threshold: 10, comparator: '>=' },
    ],
    { x: 10, y: 10 },
  );
  assert.equal(r.passed, true);
  assert.deepEqual(r.reasons, []);
});

test('evaluateGatePolicy: reason 字符串包含 metric/values/comparator', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '>' }], { x: 3 });
  assert.equal(r.reasons[0], 'x: 3 > 5 (failed)');
});

test('evaluateGatePolicy: negative numbers', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: -5, comparator: '>' }], { x: 0 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: 字符串 metric key → 未命中默认 0/分数查找', () => {
  // key 是字符串 → 查找正常
  const r = evaluateGatePolicy([{ metric: 'foo.bar', threshold: 1, comparator: '>' }], { 'foo.bar': 5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: undefined scores value → 视为缺失', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 5, comparator: '>' }], { x: undefined });
  assert.equal(r.passed, false);
  assert.match(r.reasons[0], /Missing metric: x/);
});
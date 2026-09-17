#!/usr/bin/env node
// astro-src/scripts/agents-gate-policy.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/gate-policy.ts.
// evaluateGatePolicy (规则列表:metric + comparator + threshold → pass/fail)。

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

// ---------- 比较运算符 ---
test('compare: > 通过', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '>' }],
    { score: 0.7 },
  );
  assert.equal(r.passed, true);
});

test('compare: > 等于 threshold → 失败', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '>' }],
    { score: 0.5 },
  );
  assert.equal(r.passed, false);
});

test('compare: >= 等于 threshold → 通过', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '>=' }],
    { score: 0.5 },
  );
  assert.equal(r.passed, true);
});

test('compare: < 通过', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '<' }],
    { score: 0.3 },
  );
  assert.equal(r.passed, true);
});

test('compare: <= 等于 → 通过', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '<=' }],
    { score: 0.5 },
  );
  assert.equal(r.passed, true);
});

test('compare: == 相等', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '==' }],
    { score: 0.5 },
  );
  assert.equal(r.passed, true);
});

test('compare: != 不等', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '!=' }],
    { score: 0.7 },
  );
  assert.equal(r.passed, true);
});

test('compare: != 相等 → 失败', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '!=' }],
    { score: 0.5 },
  );
  assert.equal(r.passed, false);
});

// ---------- 多规则 ---
test('multi: 全部通过', () => {
  const r = evaluateGatePolicy(
    [
      { metric: 'score', threshold: 0.5, comparator: '>=' },
      { metric: 'novelty', threshold: 0.3, comparator: '>=' },
    ],
    { score: 0.8, novelty: 0.5 },
  );
  assert.equal(r.passed, true);
  assert.equal(r.reasons.length, 0);
});

test('multi: 任一失败 → 不通过', () => {
  const r = evaluateGatePolicy(
    [
      { metric: 'score', threshold: 0.5, comparator: '>=' },
      { metric: 'novelty', threshold: 0.3, comparator: '>=' },
    ],
    { score: 0.8, novelty: 0.2 },
  );
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 1);
});

// ---------- 缺失 metric ---
test('missing metric: 记 reason + 不通过', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '>=' }],
    {},
  );
  assert.equal(r.passed, false);
  assert.match(r.reasons[0], /Missing metric/);
});

test('missing metric 不影响其他规则', () => {
  const r = evaluateGatePolicy(
    [
      { metric: 'a', threshold: 1, comparator: '>=' },
      { metric: 'b', threshold: 1, comparator: '>=' },
    ],
    { a: 2 },
  );
  // b 缺失,a 通过 → b 不通过
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /Missing metric: b/);
});

// ---------- 边界 ---
test('empty policy → 通过 (无规则)', () => {
  const r = evaluateGatePolicy([], {});
  assert.equal(r.passed, true);
  assert.deepEqual(r.reasons, []);
});

test('empty policy 但有 scores → 通过', () => {
  const r = evaluateGatePolicy([], { score: 0.5 });
  assert.equal(r.passed, true);
});

test('unknown comparator → 失败', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '???' }],
    { score: 0.7 },
  );
  assert.equal(r.passed, false);
});

test('reason 含 metric + value + comparator + threshold + "(failed)"', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'score', threshold: 0.5, comparator: '>=' }],
    { score: 0.3 },
  );
  assert.match(r.reasons[0], /score/);
  assert.match(r.reasons[0], /0.3/);
  assert.match(r.reasons[0], />=/);
  assert.match(r.reasons[0], /0.5/);
  assert.match(r.reasons[0], /\(failed\)/);
});

// ---------- 返回结构 ---
test('result: passed 是 bool', () => {
  const r = evaluateGatePolicy([], {});
  assert.equal(typeof r.passed, 'boolean');
});

test('result: reasons 是 array', () => {
  const r = evaluateGatePolicy([], {});
  assert.ok(Array.isArray(r.reasons));
});

test('多失败 reasons 都记录', () => {
  const r = evaluateGatePolicy(
    [
      { metric: 'a', threshold: 1, comparator: '>=' },
      { metric: 'b', threshold: 1, comparator: '>=' },
      { metric: 'c', threshold: 1, comparator: '>=' },
    ],
    { a: 0, b: 0, c: 0 },
  );
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 3);
});
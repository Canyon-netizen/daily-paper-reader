#!/usr/bin/env node
// astro-src/scripts/agents-gate-policy.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/gate-policy.ts.

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

test('evaluateGatePolicy: 空 policy → 通过', () => {
  const r = evaluateGatePolicy([], { x: 5 });
  assert.equal(r.passed, true);
  assert.deepEqual(r.reasons, []);
});

test('evaluateGatePolicy: 空 scores + 有 policy → 全部 Missing', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '>=' }], {});
  assert.equal(r.passed, false);
  assert.ok(r.reasons[0].includes('Missing metric'));
});

test('evaluateGatePolicy: comparator ">" 通过', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '>' }], { x: 0.6 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: comparator ">" 边界值等于 threshold → 不通过', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '>' }], { x: 0.5 });
  assert.equal(r.passed, false);
});

test('evaluateGatePolicy: comparator ">=" 边界值通过', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '>=' }], { x: 0.5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: comparator "<" 数值', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '<' }], { x: 0.4 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: comparator "<=" 边界值通过', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '<=' }], { x: 0.5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: comparator "==" 相等通过', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '==' }], { x: 0.5 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: comparator "!=" 不等通过', () => {
  const r = evaluateGatePolicy([{ metric: 'x', threshold: 0.5, comparator: '!=' }], { x: 0.6 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: 多规则全通过', () => {
  const r = evaluateGatePolicy([
    { metric: 'a', threshold: 0.5, comparator: '>=' },
    { metric: 'b', threshold: 0.7, comparator: '>' },
    { metric: 'c', threshold: 0.0, comparator: '<=' },
  ], { a: 1, b: 0.8, c: 0 });
  assert.equal(r.passed, true);
});

test('evaluateGatePolicy: 任一规则失败 → reasons 含具体信息', () => {
  const r = evaluateGatePolicy([
    { metric: 'a', threshold: 0.5, comparator: '>=' },
    { metric: 'b', threshold: 0.7, comparator: '>' },
  ], { a: 1, b: 0.5 });
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 1);
  assert.ok(r.reasons[0].includes('b'));
  assert.ok(r.reasons[0].includes('failed'));
});

test('evaluateGatePolicy: 失败 reason 格式 "<metric>: <value> <comp> <threshold> (failed)"', () => {
  const r = evaluateGatePolicy([
    { metric: 'novelty', threshold: 0.6, comparator: '>' },
  ], { novelty: 0.4 });
  assert.equal(r.reasons[0], 'novelty: 0.4 > 0.6 (failed)');
});

test('evaluateGatePolicy: 未知 comparator → false', () => {
  const r = evaluateGatePolicy(
    [{ metric: 'x', threshold: 0.5, comparator: 'unknown' }],
    { x: 1 }
  );
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 1);
});

test('evaluateGatePolicy: passed=false 但 reasons 包含全部失败 + Missing', () => {
  const r = evaluateGatePolicy([
    { metric: 'x', threshold: 0.5, comparator: '>=' },
    { metric: 'y', threshold: 0.5, comparator: '>=' },
  ], { x: 0.3 }); // y missing, x 失败
  assert.equal(r.passed, false);
  assert.equal(r.reasons.length, 2);
});
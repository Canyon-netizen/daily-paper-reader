#!/usr/bin/env node
// astro-src/scripts/gate-policy.test.mjs
//
// Tests for R7 AP.5 gate policy evaluation helper.

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

const mod = await loadTs('lib/agents/gate-policy.ts');
const { evaluateGatePolicy } = mod;

test('evaluateGatePolicy: passes when all rules pass', () => {
  const policy = [
    { metric: 'quality', threshold: 0.5, comparator: '>=' },
    { metric: 'confidence', threshold: 0.3, comparator: '>=' },
  ];
  const scores = { quality: 0.8, confidence: 0.5 };
  const result = evaluateGatePolicy(policy, scores);
  assert.equal(result.passed, true);
  assert.deepEqual(result.reasons, []);
});

test('evaluateGatePolicy: fails when rule fails', () => {
  const policy = [
    { metric: 'quality', threshold: 0.7, comparator: '>=' },
  ];
  const scores = { quality: 0.5 };
  const result = evaluateGatePolicy(policy, scores);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.length > 0);
});

test('evaluateGatePolicy: missing metric causes failure', () => {
  const policy = [
    { metric: 'missing', threshold: 0.5, comparator: '>=' },
  ];
  const scores = {};
  const result = evaluateGatePolicy(policy, scores);
  assert.equal(result.passed, false);
  assert.ok(result.reasons[0].includes('Missing metric'));
});

test('evaluateGatePolicy: all comparators work', () => {
  const scores = { value: 5 };
  assert.equal(evaluateGatePolicy([{ metric: 'value', threshold: 4, comparator: '>' }], scores).passed, true);
  assert.equal(evaluateGatePolicy([{ metric: 'value', threshold: 5, comparator: '>=' }], scores).passed, true);
  assert.equal(evaluateGatePolicy([{ metric: 'value', threshold: 6, comparator: '<' }], scores).passed, true);
  assert.equal(evaluateGatePolicy([{ metric: 'value', threshold: 5, comparator: '<=' }], scores).passed, true);
  assert.equal(evaluateGatePolicy([{ metric: 'value', threshold: 5, comparator: '==' }], scores).passed, true);
  assert.equal(evaluateGatePolicy([{ metric: 'value', threshold: 4, comparator: '!=' }], scores).passed, true);
});

test('evaluateGatePolicy: empty policy passes', () => {
  const result = evaluateGatePolicy([], { quality: 0.5 });
  assert.equal(result.passed, true);
  assert.deepEqual(result.reasons, []);
});

test('evaluateGatePolicy: returns reasons for each failed rule', () => {
  const policy = [
    { metric: 'quality', threshold: 0.9, comparator: '>=' },
    { metric: 'confidence', threshold: 0.8, comparator: '>=' },
  ];
  const scores = { quality: 0.5, confidence: 0.3 };
  const result = evaluateGatePolicy(policy, scores);
  assert.equal(result.passed, false);
  assert.equal(result.reasons.length, 2);
});

#!/usr/bin/env node
// astro-src/scripts/experiment-results.test.mjs
//
// Tests for R7 E.2.3 (result metrics) + E.2.4 (status transitions).

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

const types = await loadTs('lib/experiments/types.ts');
const res = await loadTs('lib/experiments/results.ts');

const { EXPERIMENT_STATUS_TRANSITIONS, canTransitionExperimentStatus } = types;
const {
  genResultMetricId,
  normalizeResultMetric,
  isMetricComplete,
  computeMetricDeviation,
  nextStatusesForExperiment,
  transitionExperimentStatus,
} = res;

// ----- E.2.4: status transitions -----

test('EXPERIMENT_STATUS_TRANSITIONS: covers all 6 statuses', () => {
  for (const s of ['planning', 'running', 'completed', 'failed', 'paused', 'archived']) {
    assert.ok(Array.isArray(EXPERIMENT_STATUS_TRANSITIONS[s]), `missing ${s}`);
  }
});

test('EXPERIMENT_STATUS_TRANSITIONS: planning cannot jump to completed', () => {
  assert.ok(!EXPERIMENT_STATUS_TRANSITIONS.planning.includes('completed'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: completed can revert to running (re-run)', () => {
  assert.ok(EXPERIMENT_STATUS_TRANSITIONS.completed.includes('running'));
});

test('EXPERIMENT_STATUS_TRANSITIONS: archived can revive to planning/running', () => {
  assert.ok(EXPERIMENT_STATUS_TRANSITIONS.archived.includes('planning'));
  assert.ok(EXPERIMENT_STATUS_TRANSITIONS.archived.includes('running'));
});

test('canTransitionExperimentStatus: same-state rejected', () => {
  for (const s of ['planning', 'running', 'completed', 'failed', 'paused', 'archived']) {
    assert.equal(canTransitionExperimentStatus(s, s), false);
  }
});

test('canTransitionExperimentStatus: legal & illegal pairs', () => {
  assert.equal(canTransitionExperimentStatus('planning', 'running'), true);
  assert.equal(canTransitionExperimentStatus('running', 'completed'), true);
  assert.equal(canTransitionExperimentStatus('completed', 'failed'), false); // cannot revert
  assert.equal(canTransitionExperimentStatus('running', 'planning'), false);
});

test('nextStatusesForExperiment: returns transition map values', () => {
  const nexts = nextStatusesForExperiment('running');
  assert.ok(nexts.includes('completed'));
  assert.ok(nexts.includes('paused'));
});

test('transitionExperimentStatus: legal returns new experiment', () => {
  const exp = {
    id: 'e1', title: '', titleZh: '',
    hypothesis: '', hypothesisZh: '',
    method: '', methodZh: '',
    variables: [],
    expectedResults: '', expectedResultsZh: '',
    status: 'planning',
    relatedPapers: [], tags: [],
    createdAt: '2026-09-16', updatedAt: '2026-09-16',
    owner: 'me', relatedIdeas: [],
  };
  const next = transitionExperimentStatus(exp, 'running');
  assert.ok(next);
  assert.equal(next.status, 'running');
  // updatedAt 应该更新到今天
  assert.equal(next.updatedAt, new Date().toISOString().split('T')[0]);
  // 原 exp 不变
  assert.equal(exp.status, 'planning');
});

test('transitionExperimentStatus: illegal returns null (no mutation)', () => {
  const exp = { status: 'planning' };
  const next = transitionExperimentStatus(exp, 'completed');
  assert.equal(next, null);
  assert.equal(exp.status, 'planning');
});

// ----- E.2.3: result metrics -----

test('genResultMetricId: returns non-empty string with prefix', () => {
  const id = genResultMetricId();
  assert.equal(typeof id, 'string');
  assert.ok(id.startsWith('m_'));
  assert.ok(id.length > 5);
});

test('normalizeResultMetric: minimal input fills defaults', () => {
  const m = normalizeResultMetric({ metricName: 'acc' });
  assert.ok(m);
  assert.ok(m.id.startsWith('m_'));
  assert.equal(m.metricName, 'acc');
  assert.equal(typeof m.timestamp, 'number');
  assert.equal(m.expectedValue, undefined);
  assert.equal(m.actualValue, undefined);
});

test('normalizeResultMetric: missing metricName returns null', () => {
  assert.equal(normalizeResultMetric(null), null);
  assert.equal(normalizeResultMetric({}), null);
  assert.equal(normalizeResultMetric({ metricName: '' }), null);
});

test('normalizeResultMetric: trims whitespace, drops undefined fields', () => {
  const m = normalizeResultMetric({ metricName: '  BLEU-4  ', unit: '' });
  assert.ok(m);
  assert.equal(m.metricName, 'BLEU-4');
  assert.equal(m.unit, undefined);
});

test('normalizeResultMetric: invalid numbers become undefined', () => {
  const m = normalizeResultMetric({ metricName: 'x', expectedValue: NaN, actualValue: Infinity });
  assert.ok(m);
  assert.equal(m.expectedValue, undefined);
  assert.equal(m.actualValue, undefined);
});

test('isMetricComplete: requires both expected + actual as finite numbers', () => {
  assert.equal(isMetricComplete(null), false);
  assert.equal(isMetricComplete({ metricName: 'a', expectedValue: 1 }), false);
  assert.equal(isMetricComplete({ metricName: 'a', expectedValue: 1, actualValue: 0.9 }), true);
});

test('computeMetricDeviation: empty / undefined input', () => {
  assert.deepEqual(computeMetricDeviation([]), { totalCount: 0, completeCount: 0 });
  assert.deepEqual(computeMetricDeviation(undefined), { totalCount: 0, completeCount: 0 });
});

test('computeMetricDeviation: counts + computes meanAbsDiff', () => {
  const stats = computeMetricDeviation([
    { id: '1', timestamp: 0, metricName: 'acc', expectedValue: 1.0, actualValue: 0.9 }, // diff 0.1
    { id: '2', timestamp: 0, metricName: 'f1', expectedValue: 0.8, actualValue: 0.85 }, // diff 0.05
    { id: '3', timestamp: 0, metricName: 'no-actual' }, // incomplete
  ]);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.completeCount, 2);
  assert.equal(Math.round(stats.meanAbsDiff * 100000) / 100000, 0.075); // (0.1 + 0.05) / 2
  // meanRelDiff = ((0.9-1.0)/1.0 + (0.85-0.8)/0.8) / 2 = (-0.1 + 0.0625) / 2 = -0.01875
  assert.equal(Math.round(stats.meanRelDiff * 100000) / 100000, -0.01875);
});

test('computeMetricDeviation: tolerance counts expected within 5%', () => {
  const stats = computeMetricDeviation([
    { id: '1', timestamp: 0, metricName: 'acc', expectedValue: 1.0, actualValue: 1.02 }, // 2% off → within
    { id: '2', timestamp: 0, metricName: 'f1', expectedValue: 1.0, actualValue: 0.5 }, // 50% off → not within
    { id: '3', timestamp: 0, metricName: 'latency', expectedValue: 100, actualValue: 105 }, // 5% off → within
  ]);
  assert.equal(stats.completeCount, 3);
  assert.equal(stats.withinToleranceCount, 2);
});
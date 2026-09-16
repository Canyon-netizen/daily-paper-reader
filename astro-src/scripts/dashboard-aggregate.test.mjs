#!/usr/bin/env node
// astro-src/scripts/dashboard-aggregate.test.mjs
//
// Tests for R7 LP.7 dashboard data aggregation.

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

const mod = await loadTs('lib/dashboard/aggregate.ts');
const { aggregateDashboard, formatDashboardSummary } = mod;

const mockActivityFeed = [
  { kind: 'paper_added' },
  { kind: 'paper_added' },
  { kind: 'idea_created' },
  { kind: 'experiment_logged' },
];

const mockPhaseStats = {
  planning: 5,
  running: 3,
  completed: 10,
  archived: 2,
};

const mockTimeToPaper = [3, 5, 7, 2, 10]; // days

test('aggregateDashboard: aggregates activity by kind', () => {
  const result = aggregateDashboard(mockActivityFeed, mockPhaseStats, mockTimeToPaper);

  assert.ok(result.activity.length >= 3);
  const paperAdded = result.activity.find(a => a.kind === 'paper_added');
  assert.ok(paperAdded);
  assert.equal(paperAdded.count, 2);
});

test('aggregateDashboard: includes phase distribution', () => {
  const result = aggregateDashboard(mockActivityFeed, mockPhaseStats, mockTimeToPaper);

  assert.equal(result.phaseDistribution.planning, 5);
  assert.equal(result.phaseDistribution.running, 3);
  assert.equal(result.phaseDistribution.completed, 10);
});

test('aggregateDashboard: calculates average days to publish', () => {
  const result = aggregateDashboard(mockActivityFeed, mockPhaseStats, mockTimeToPaper);

  // (3+5+7+2+10)/5 = 5.4
  assert.ok(Math.abs(result.avgDaysToPublish - 5.4) < 0.01);
});

test('aggregateDashboard: handles empty time to paper', () => {
  const result = aggregateDashboard(mockActivityFeed, mockPhaseStats, []);

  assert.equal(result.avgDaysToPublish, 0);
});

test('aggregateDashboard: handles empty activity feed', () => {
  const result = aggregateDashboard([], mockPhaseStats, mockTimeToPaper);

  assert.ok(Array.isArray(result.activity));
  assert.equal(result.activity.length, 0);
});

test('formatDashboardSummary: returns summary string', () => {
  const agg = aggregateDashboard(mockActivityFeed, mockPhaseStats, mockTimeToPaper);
  const summary = formatDashboardSummary(agg);

  assert.ok(summary.includes('activities'));
});

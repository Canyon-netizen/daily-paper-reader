#!/usr/bin/env node
// astro-src/scripts/time-to-paper.test.mjs
//
// Tests for R7 E.4.3 dashboard time-to-paper metrics.

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

const mod = await loadTs('lib/dashboard/time-to-paper.ts');
const { computeTimeToPaper, aggregateTimeToPaper, addStatusTransition, markPublished } = mod;

// Helper to create timestamp N days ago
const daysAgo = (n) => Date.now() - n * 24 * 60 * 60 * 1000;

test('computeTimeToPaper: calculates days from first seen', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(30),
    statusTransitions: [
      { phase: 'literature', ts: daysAgo(25) },
      { phase: 'idea', ts: daysAgo(20) },
    ],
    publishedAt: daysAgo(0),
  };

  const result = computeTimeToPaper(timeline);
  assert.ok(result.daysFromFirstSeen >= 29 && result.daysFromFirstSeen <= 31);
});

test('computeTimeToPaper: calculates days per phase', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(10),
    statusTransitions: [
      { phase: 'literature', ts: daysAgo(8) },
      { phase: 'idea', ts: daysAgo(5) },
      { phase: 'experiment', ts: daysAgo(2) },
    ],
    publishedAt: daysAgo(0),
  };

  const result = computeTimeToPaper(timeline);
  assert.ok(result.daysPerPhase['literature'] >= 2);
  assert.ok(result.daysPerPhase['idea'] >= 2);
  assert.ok(result.daysPerPhase['experiment'] >= 1);
});

test('computeTimeToPaper: identifies bottlenecks', () => {
  // Each phase's duration = (next transition ts) - (this transition ts).
  // Sorted transitions: literature at day 28, idea at day 10, experiment at day 5.
  //   literature lasts 18d (until idea starts), idea lasts 5d, experiment lasts 5d
  //   (until publishedAt = day 0).
  // Bottleneck: literature (longest).
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(30),
    statusTransitions: [
      { phase: 'literature', ts: daysAgo(28) },
      { phase: 'idea', ts: daysAgo(10) },
      { phase: 'experiment', ts: daysAgo(5) },
    ],
    publishedAt: daysAgo(0),
  };

  const result = computeTimeToPaper(timeline);
  assert.ok(result.bottlenecks.includes('literature'));
});

test('computeTimeToPaper: uses now if not published', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(5),
    statusTransitions: [],
    // No publishedAt - uses current time
  };

  const result = computeTimeToPaper(timeline);
  assert.ok(result.daysFromFirstSeen >= 4 && result.daysFromFirstSeen <= 6);
});

test('aggregateTimeToPaper: empty input returns zeros', () => {
  const result = aggregateTimeToPaper([]);
  assert.equal(result.totalPapers, 0);
  assert.equal(result.completedPapers, 0);
  assert.equal(result.avgDaysFromFirstSeen, 0);
});

test('aggregateTimeToPaper: calculates averages', () => {
  const timelines = [
    {
      arxivId: '2501.00001',
      firstSeenAt: daysAgo(30),
      statusTransitions: [{ phase: 'literature', ts: daysAgo(15) }],
      publishedAt: daysAgo(0),
    },
    {
      arxivId: '2501.00002',
      firstSeenAt: daysAgo(20),
      statusTransitions: [{ phase: 'literature', ts: daysAgo(10) }],
      publishedAt: daysAgo(0),
    },
  ];

  const result = aggregateTimeToPaper(timelines);
  assert.equal(result.totalPapers, 2);
  assert.equal(result.completedPapers, 2);
  assert.ok(result.avgDaysFromFirstSeen > 0);
});

test('addStatusTransition: adds new transition', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(10),
    statusTransitions: [],
  };

  const updated = addStatusTransition(timeline, 'idea');
  assert.equal(updated.statusTransitions.length, 1);
  assert.equal(updated.statusTransitions[0].phase, 'idea');
});

test('addStatusTransition: preserves existing transitions', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(10),
    statusTransitions: [{ phase: 'literature', ts: daysAgo(8) }],
  };

  const updated = addStatusTransition(timeline, 'idea');
  assert.equal(updated.statusTransitions.length, 2);
  assert.equal(updated.statusTransitions[0].phase, 'literature');
});

test('markPublished: sets publishedAt', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(10),
    statusTransitions: [],
  };

  const published = markPublished(timeline);
  assert.ok(published.publishedAt);
});

test('markPublished: uses custom timestamp', () => {
  const timeline = {
    arxivId: '2501.00001',
    firstSeenAt: daysAgo(10),
    statusTransitions: [],
  };

  const customTime = daysAgo(5);
  const published = markPublished(timeline, customTime);
  assert.equal(published.publishedAt, customTime);
});

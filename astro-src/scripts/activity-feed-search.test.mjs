#!/usr/bin/env node
// astro-src/scripts/activity-feed-search.test.mjs
//
// Tests for R7 LP.5: activity feed search and filter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock localStorage for Node.js environment
if (!globalThis.__mockStorage) {
  globalThis.__mockStorage = new Map();
}
globalThis.localStorage = {
  getItem: (key) => globalThis.__mockStorage.get(key) ?? null,
  setItem: (key, value) => globalThis.__mockStorage.set(key, value),
  removeItem: (key) => globalThis.__mockStorage.delete(key),
  clear: () => globalThis.__mockStorage.clear(),
};

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

const mod = await loadTs('lib/dashboard/activity-feed.ts');
const {
  recordEvent,
  searchEvents,
  filterByDateRange,
  clearActivityFeed,
} = mod;

// Setup: create some events
clearActivityFeed();

// Helper: add days to a date string
const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

// Pre-populate events
recordEvent({ kind: 'paper_added', summary: 'Added paper: Attention is All You Need' });
recordEvent({ kind: 'idea_created', summary: 'Created idea: Efficient Transformers' });
recordEvent({ kind: 'paper_added', summary: 'Added paper: BERT Pre-training' });
recordEvent({ kind: 'experiment_logged', summary: 'Logged experiment: Ablation study' });

test('searchEvents: finds events by keyword (case-insensitive)', () => {
  const results = searchEvents('transformer');
  assert.ok(results.length >= 1);
  assert.ok(results.some(e => e.summary.toLowerCase().includes('transformer')));
});

test('searchEvents: returns all events for empty query', () => {
  const results = searchEvents('');
  assert.ok(results.length >= 4);
});

test('searchEvents: returns empty array for no match', () => {
  const results = searchEvents('xyz-nonexistent-123');
  assert.equal(results.length, 0);
});

test('filterByDateRange: filters events within range', () => {
  // Use current timestamp - should include all recent events
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const results = filterByDateRange(weekAgo, now);
  assert.ok(results.length >= 4);
});

test('filterByDateRange: returns empty for future range', () => {
  const now = Date.now();
  const future = now + 30 * 24 * 60 * 60 * 1000;

  const results = filterByDateRange(now, future);
  assert.equal(results.length, 0);
});

test('filterByDateRange: handles ISO string dates', () => {
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const results = filterByDateRange(weekAgo, now);
  assert.ok(results.length >= 4);
});

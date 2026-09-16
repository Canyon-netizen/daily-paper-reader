#!/usr/bin/env node
// astro-src/scripts/phase-stats.test.mjs
//
// Tests for R7 E.4.2 dashboard phase statistics.

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

const mod = await loadTs('lib/dashboard/phase-stats.ts');
const { computePhaseStats, getTotalPhaseItems, getDominantPhase } = mod;

test('computePhaseStats: counts papers correctly', () => {
  const input = {
    papers: [
      { id: 'p1', date: '2026-08-01' },
      { id: 'p2', date: '2026-07-01' },
    ],
  };
  const stats = computePhaseStats(input);
  const lit = stats.find(s => s.phase === 'literature');
  assert.equal(lit?.count, 2);
});

test('computePhaseStats: counts ideas correctly', () => {
  const input = {
    ideas: [
      { id: 'i1', status: 'active', updatedAt: 1000 },
      { id: 'i2', status: 'draft', updatedAt: 2000 },
    ],
  };
  const stats = computePhaseStats(input);
  const idea = stats.find(s => s.phase === 'idea');
  assert.equal(idea?.count, 2);
});

test('computePhaseStats: promoted idea maps to experiment', () => {
  const input = {
    ideas: [
      { id: 'i1', status: 'promoted', updatedAt: 1000 },
    ],
  };
  const stats = computePhaseStats(input);
  const exp = stats.find(s => s.phase === 'experiment');
  assert.equal(exp?.count, 1);
});

test('computePhaseStats: experiments map to correct phases', () => {
  const input = {
    experiments: [
      { id: 'e1', status: 'running', updatedAt: 1000 },
      { id: 'e2', status: 'completed', updatedAt: 2000 },
    ],
  };
  const stats = computePhaseStats(input);
  const running = stats.find(s => s.phase === 'experiment');
  const writing = stats.find(s => s.phase === 'writing');
  assert.equal(running?.count, 1);
  assert.equal(writing?.count, 1);
});

test('computePhaseStats: writings map to correct phases', () => {
  const input = {
    writings: [
      { id: 'w1', status: 'draft', updatedAt: 1000 },
      { id: 'w2', status: 'submitted', updatedAt: 2000 },
      { id: 'w3', status: 'published', updatedAt: 3000 },
    ],
  };
  const stats = computePhaseStats(input);
  const writing = stats.find(s => s.phase === 'writing');
  const submitted = stats.find(s => s.phase === 'submitted');
  const published = stats.find(s => s.phase === 'published');
  assert.equal(writing?.count, 1);
  assert.equal(submitted?.count, 1);
  assert.equal(published?.count, 1);
});

test('computePhaseStats: empty input returns all phases', () => {
  const stats = computePhaseStats({});
  assert.equal(stats.length, 7);
  for (const s of stats) {
    assert.equal(s.count, 0);
  }
});

test('computePhaseStats: sorts by count descending', () => {
  const input = {
    papers: [{ id: 'p1' }],
    ideas: [{ id: 'i1' }, { id: 'i2' }],
    experiments: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
  };
  const stats = computePhaseStats(input);
  assert.ok(stats[0].count >= stats[1].count);
  assert.ok(stats[1].count >= stats[2].count);
});

test('getTotalPhaseItems: sums all counts', () => {
  const stats = [
    { phase: 'literature', count: 10, latestAt: null },
    { phase: 'idea', count: 5, latestAt: null },
    { phase: 'experiment', count: 3, latestAt: null },
  ];
  assert.equal(getTotalPhaseItems(stats), 18);
});

test('getDominantPhase: returns phase with most items', () => {
  const stats = [
    { phase: 'literature', count: 10, latestAt: null },
    { phase: 'idea', count: 5, latestAt: null },
  ];
  assert.equal(getDominantPhase(stats), 'literature');
});

test('getDominantPhase: returns null when all zero', () => {
  const stats = [
    { phase: 'literature', count: 0, latestAt: null },
  ];
  assert.equal(getDominantPhase(stats), null);
});

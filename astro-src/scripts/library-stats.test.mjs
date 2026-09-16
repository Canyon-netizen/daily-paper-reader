#!/usr/bin/env node
// astro-src/scripts/library-stats.test.mjs
//
// Tests for R7 D.2.3 library statistics.

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

const mod = await loadTs('lib/libraries/stats.ts');
const { computeLibraryStats, getLibraryPapers } = mod;

const mockLibrary = {
  id: 'test-lib',
  title: 'Test Library',
  titleZh: '测试库',
  description: 'Test',
  descriptionZh: '测试',
  tags: ['task:rl', 'method:rlhf'],
  dimension: 'task',
  curator: 'test',
  hue: 'blue',
};

const mockPapers = [
  { arxivId: '2501.00001', date: '2026-08-01', authors: ['Alice', 'Bob'], categories: { task: ['rl'], method: ['rlhf'] }, tags: [] },
  { arxivId: '2501.00002', date: '2025-06-15', authors: ['Bob', 'Carol'], categories: { task: ['rl'] }, tags: [] },
  { arxivId: '2501.00003', date: '2024-03-20', authors: ['Carol', 'Dave'], categories: { method: ['rlhf'] }, tags: [] },
  { arxivId: '2501.00004', date: '2023-01-10', authors: ['Eve'], categories: { venue: ['nips'] }, tags: [] },
  { arxivId: '2501.00005', authors: [] }, // No date, no categories
];

test('computeLibraryStats: paperCount', () => {
  const result = computeLibraryStats(mockLibrary, mockPapers);
  assert.equal(result.paperCount, 5);
});

test('computeLibraryStats: uniqueAuthors', () => {
  const result = computeLibraryStats(mockLibrary, mockPapers);
  assert.ok(result.uniqueAuthors.length >= 3);
});

test('computeLibraryStats: yearRange', () => {
  const result = computeLibraryStats(mockLibrary, mockPapers);
  assert.deepEqual(result.yearRange, [2023, 2026]);
});

test('computeLibraryStats: topCategories', () => {
  const result = computeLibraryStats(mockLibrary, mockPapers);
  assert.ok(result.topCategories.length > 0);
  // task:rl should be top
  const rlCat = result.topCategories.find(c => c.cat === 'task:rl');
  assert.ok(rlCat);
});

test('computeLibraryStats: empty papers', () => {
  const result = computeLibraryStats(mockLibrary, []);
  assert.equal(result.paperCount, 0);
  assert.deepEqual(result.yearRange, [null, null]);
});

test('getLibraryPapers: filters correctly', () => {
  const result = getLibraryPapers(mockPapers, mockLibrary);
  assert.equal(result.length, 3); // 3 papers match task:rl or method:rlhf
});

test('getLibraryPapers: no matches', () => {
  const noMatchLib = { ...mockLibrary, tags: ['task:nonexistent'] };
  const result = getLibraryPapers(mockPapers, noMatchLib);
  assert.equal(result.length, 0);
});

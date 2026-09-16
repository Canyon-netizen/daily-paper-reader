#!/usr/bin/env node
// astro-src/scripts/projects-highlights.test.mjs
//
// Tests for R7 polish: astro-src/lib/projects/highlights.ts project highlights aggregator.

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

const mod = await loadTs('lib/projects/highlights.ts');
const { filterHighlights, computeHighlightsStats } = mod;

function highlight(over) {
  return {
    id: 'h-1',
    canonicalId: '2501.00001',
    text: 'sample text',
    note: '',
    createdAt: 1000,
    ...over,
  };
}

test('filterHighlights: 空 query → 返回拷贝', () => {
  const list = [highlight({ id: '1' })];
  const out = filterHighlights(list, '');
  assert.notEqual(out, list);
  assert.equal(out.length, 1);
});

test('filterHighlights: 命中 text', () => {
  const list = [highlight({ text: 'Deep learning is great' })];
  assert.equal(filterHighlights(list, 'deep').length, 1);
});

test('filterHighlights: 命中 note', () => {
  const list = [highlight({ text: 'x', note: 'has reasoning' })];
  assert.equal(filterHighlights(list, 'reasoning').length, 1);
});

test('filterHighlights: 大小写不敏感', () => {
  const list = [highlight({ text: 'DEEP' })];
  assert.equal(filterHighlights(list, 'deep').length, 1);
});

test('filterHighlights: trim query', () => {
  const list = [highlight({ text: 'foo bar' })];
  assert.equal(filterHighlights(list, '  bar  ').length, 1);
});

test('filterHighlights: 都不命中 → []', () => {
  const list = [highlight({ text: 'foo' })];
  assert.equal(filterHighlights(list, 'zzz').length, 0);
});

test('filterHighlights: 多条部分命中', () => {
  const list = [
    highlight({ id: '1', text: 'foo' }),
    highlight({ id: '2', text: 'bar' }),
    highlight({ id: '3', text: 'baz' }),
  ];
  const out = filterHighlights(list, 'bar');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '2');
});

test('computeHighlightsStats: 空列表 → 0', () => {
  const stats = computeHighlightsStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.byPaper, 0);
  assert.equal(stats.withNotes, 0);
});

test('computeHighlightsStats: 同 paper 多高亮 byPaper=1', () => {
  const list = [
    highlight({ id: '1', canonicalId: 'A', createdAt: 1 }),
    highlight({ id: '2', canonicalId: 'A', createdAt: 2 }),
  ];
  const stats = computeHighlightsStats(list);
  assert.equal(stats.total, 2);
  assert.equal(stats.byPaper, 1);
});

test('computeHighlightsStats: 不同 paper byPaper=N', () => {
  const list = [
    highlight({ id: '1', canonicalId: 'A' }),
    highlight({ id: '2', canonicalId: 'B' }),
    highlight({ id: '3', canonicalId: 'C' }),
  ];
  const stats = computeHighlightsStats(list);
  assert.equal(stats.byPaper, 3);
});

test('computeHighlightsStats: 计数带 note 的条目', () => {
  const list = [
    highlight({ id: '1', note: 'first note' }),
    highlight({ id: '2', note: '' }),
    highlight({ id: '3', note: '   ' }), // 空白 trim 后算空
    highlight({ id: '4', note: 'second' }),
  ];
  const stats = computeHighlightsStats(list);
  assert.equal(stats.total, 4);
  assert.equal(stats.withNotes, 2);
});

test('computeHighlightsStats: note=null 时不计入 withNotes', () => {
  const list = [highlight({ note: null })];
  const stats = computeHighlightsStats(list);
  assert.equal(stats.withNotes, 0);
});
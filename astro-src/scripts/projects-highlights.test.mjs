#!/usr/bin/env node
// astro-src/scripts/projects-highlights.test.mjs
//
// Tests for R7 polish: astro-src/lib/projects/highlights.ts.
// filterHighlights + computeHighlightsStats (纯函数)。
// aggregateProjectHighlights 用 IDB,跳过。

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

const mkHL = (overrides) => ({
  id: 'h',
  canonicalId: 'paper1',
  text: 'sample text',
  createdAt: 1000,
  ...overrides,
});

// ---------- filterHighlights ----------
test('filterHighlights: 空 query → 返回浅拷贝', () => {
  const list = [mkHL()];
  const r = filterHighlights(list, '');
  assert.deepEqual(r, list);
  assert.notEqual(r, list); // 浅拷贝(新数组)
});

test('filterHighlights: query 空白 → 全部返回', () => {
  const list = [mkHL(), mkHL({ id: 'h2' })];
  const r = filterHighlights(list, '   ');
  assert.equal(r.length, 2);
});

test('filterHighlights: 大小写不敏感', () => {
  const list = [mkHL({ text: 'Hello World' })];
  assert.equal(filterHighlights(list, 'hello').length, 1);
  assert.equal(filterHighlights(list, 'WORLD').length, 1);
});

test('filterHighlights: 匹配 text', () => {
  const list = [
    mkHL({ id: '1', text: 'apple' }),
    mkHL({ id: '2', text: 'banana' }),
  ];
  const r = filterHighlights(list, 'apple');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '1');
});

test('filterHighlights: 匹配 note', () => {
  const list = [
    mkHL({ id: '1', text: 'foo', note: 'bar' }),
    mkHL({ id: '2', text: 'baz' }),
  ];
  const r = filterHighlights(list, 'bar');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '1');
});

test('filterHighlights: 任一字段匹配即返回', () => {
  const list = [
    mkHL({ id: '1', text: 'alpha' }),
    mkHL({ id: '2', text: 'beta', note: 'alpha' }),
    mkHL({ id: '3', text: 'gamma' }),
  ];
  const r = filterHighlights(list, 'alpha');
  assert.equal(r.length, 2);
});

test('filterHighlights: 空 list → 空', () => {
  assert.deepEqual(filterHighlights([], 'query'), []);
});

test('filterHighlights: 不修改原数组', () => {
  const list = [mkHL({ text: 'a' })];
  filterHighlights(list, 'b');
  assert.equal(list.length, 1);
});

test('filterHighlights: 不匹配 → []', () => {
  const r = filterHighlights([mkHL({ text: 'foo' })], 'xyz');
  assert.deepEqual(r, []);
});

// ---------- computeHighlightsStats ----------
test('computeHighlightsStats: 空 → 0', () => {
  const r = computeHighlightsStats([]);
  assert.equal(r.total, 0);
  assert.equal(r.byPaper, 0);
  assert.equal(r.withNotes, 0);
});

test('computeHighlightsStats: total = list.length', () => {
  const r = computeHighlightsStats([
    mkHL(), mkHL({ id: '2' }), mkHL({ id: '3' }),
  ]);
  assert.equal(r.total, 3);
});

test('computeHighlightsStats: byPaper 去重', () => {
  const r = computeHighlightsStats([
    mkHL({ canonicalId: 'p1' }),
    mkHL({ canonicalId: 'p1' }),
    mkHL({ canonicalId: 'p2' }),
  ]);
  assert.equal(r.byPaper, 2);
});

test('computeHighlightsStats: withNotes 计非空', () => {
  const r = computeHighlightsStats([
    mkHL({ note: 'a' }),
    mkHL({ note: '' }),
    mkHL({ note: '   ' }), // 空白 → 不计
    mkHL(), // 缺 note
    mkHL({ note: 'b' }),
  ]);
  assert.equal(r.withNotes, 2);
});

test('computeHighlightsStats: 仅空白 note 不计', () => {
  const r = computeHighlightsStats([
    mkHL({ note: '   ' }),
  ]);
  assert.equal(r.withNotes, 0);
});

test('computeHighlightsStats: 含 paperIdx 不影响', () => {
  const r = computeHighlightsStats([
    mkHL({ paperIdx: 0 }),
    mkHL({ paperIdx: 1 }),
  ]);
  assert.equal(r.total, 2);
  assert.equal(r.byPaper, 1);
});

// ---------- 集成 ---
test('集成: filter + stats', () => {
  const list = [
    mkHL({ id: '1', text: 'apple', note: 'fruit', canonicalId: 'p1' }),
    mkHL({ id: '2', text: 'banana', canonicalId: 'p1' }),
    mkHL({ id: '3', text: 'apple pie', canonicalId: 'p2' }),
  ];
  const filtered = filterHighlights(list, 'apple');
  const stats = computeHighlightsStats(filtered);
  assert.equal(stats.total, 2);
  assert.equal(stats.byPaper, 2);
  assert.equal(stats.withNotes, 1);
});
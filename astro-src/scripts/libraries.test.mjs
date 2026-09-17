#!/usr/bin/env node
// astro-src/scripts/libraries.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries.ts.
// getLibrary (id → Library) +
// buildLibraryDigests (items + LIBRARIES → LibraryDigest[]) +
// selectLibraryPapers (items + Library → 命中论文)。

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
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/libraries.ts');
const {
  LIBRARIES,
  getLibrary,
  buildLibraryDigests,
  selectLibraryPapers,
} = mod;

const mkLib = (overrides = {}) => ({
  id: 'test-lib',
  title: 'Test Lib',
  titleZh: '测试库',
  description: 'desc',
  descriptionZh: '描述',
  tags: ['task:rl'],
  dimension: 'task',
  curator: 'core',
  hue: 'blue',
  ...overrides,
});

const mkPaper = (overrides = {}) => ({
  id: 'papers/x.md',
  title: 'Test',
  date: '2026-09-01',
  arxivId: '2310.12345',
  canonicalArxivId: '2310.12345',
  slug: 'x',
  yearMonth: '2026-09',
  day: '01',
  categories: { venue: [], task: ['rl'], method: [], type: [] },
  tags: [],
  concepts: [],
  ...overrides,
});

// ---------- getLibrary ---
test('getLib: 已知 id → 返回库', () => {
  const first = LIBRARIES[0];
  const r = getLibrary(first.id);
  assert.equal(r.id, first.id);
});

test('getLib: 未知 id → null', () => {
  assert.equal(getLibrary('unknown-lib'), null);
});

test('getLib: 空字符串 → null', () => {
  assert.equal(getLibrary(''), null);
});

test('LIBRARIES: 非空', () => {
  assert.ok(LIBRARIES.length > 0);
});

// ---------- buildLibraryDigests ---
test('digests: 空 items → []', () => {
  // 没有任何 items → 所有 lib 的 matched.length === 0 → 全部跳过
  const r = buildLibraryDigests([]);
  assert.deepEqual(r, []);
});

test('digests: 命中 library → 1 条', () => {
  const rlLib = LIBRARIES.find((l) => l.tags.includes('task:rl'));
  if (!rlLib) {
    // 如果没有 rl lib,跳过
    return;
  }
  const r = buildLibraryDigests([
    mkPaper({ categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  assert.ok(r.length >= 1);
});

test('digests: paperCount 命中数', () => {
  const r = buildLibraryDigests([
    mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p3', categories: { venue: [], task: [], method: ['transformer'], type: [] } }),
  ]);
  const rlDigest = r.find((d) => d.library.tags.includes('task:rl'));
  assert.ok(rlDigest);
  assert.equal(rlDigest.paperCount, 2);
});

test('digests: latestDate 取最近 date', () => {
  const r = buildLibraryDigests([
    mkPaper({ id: 'p1', date: '2026-08-01', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', date: '2026-09-10', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p3', date: '2026-09-15', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  const rlDigest = r.find((d) => d.library.tags.includes('task:rl'));
  assert.equal(rlDigest.latestDate, '2026-09-15');
});

test('digests: recentIds 前 3 个按 date desc', () => {
  const r = buildLibraryDigests([
    mkPaper({ id: 'p1', date: '2026-08-01', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', date: '2026-09-10', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p3', date: '2026-09-15', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p4', date: '2026-09-12', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ]);
  const rlDigest = r.find((d) => d.library.tags.includes('task:rl'));
  assert.equal(rlDigest.recentIds[0], 'p3'); // 2026-09-15
  assert.equal(rlDigest.recentIds[1], 'p4'); // 2026-09-12
  assert.equal(rlDigest.recentIds[2], 'p2'); // 2026-09-10
});

test('digests: 0 命中 lib 跳过', () => {
  const r = buildLibraryDigests([
    mkPaper({ categories: { venue: [], task: [], method: [], type: [] } }),
  ]);
  // 没有 paper 命中任何 lib
  assert.equal(r.length, 0);
});

test('digests: conceptCount 去重计数', () => {
  const r = buildLibraryDigests([
    mkPaper({
      id: 'p1',
      categories: { venue: [], task: ['rl'], method: [], type: [] },
      concepts: [{ slug: 'c1' }, { slug: 'c2' }],
    }),
    mkPaper({
      id: 'p2',
      categories: { venue: [], task: ['rl'], method: [], type: [] },
      concepts: [{ slug: 'c1' }, { slug: 'c3' }],
    }),
  ]);
  const rlDigest = r.find((d) => d.library.tags.includes('task:rl'));
  // c1, c2, c3 → 3 个 unique
  assert.equal(rlDigest.conceptCount, 3);
});

test('digests: concepts 缺/非数组 → 跳过', () => {
  const r = buildLibraryDigests([
    mkPaper({
      id: 'p1',
      categories: { venue: [], task: ['rl'], method: [], type: [] },
      // concepts 缺
    }),
    mkPaper({
      id: 'p2',
      categories: { venue: [], task: ['rl'], method: [], type: [] },
      concepts: null,
    }),
  ]);
  const rlDigest = r.find((d) => d.library.tags.includes('task:rl'));
  assert.equal(rlDigest.conceptCount, 0);
});

test('digests: legacy query: tags 映射到 task:', () => {
  const r = buildLibraryDigests([
    mkPaper({
      id: 'p1',
      categories: { venue: [], task: [], method: [], type: [] },
      tags: ['query:rl'],
    }),
  ]);
  // 应命中 task:rl lib
  const rlDigest = r.find((d) => d.library.tags.includes('task:rl'));
  assert.ok(rlDigest);
  assert.equal(rlDigest.paperCount, 1);
});

test('digests: tags 非 query 前缀 → 不映射', () => {
  const r = buildLibraryDigests([
    mkPaper({
      id: 'p1',
      categories: { venue: [], task: [], method: [], type: [] },
      tags: ['method:transformer'], // 不是 query: 前缀
    }),
  ]);
  // categories 全空 + tags 无 query → flattenTags 出 [] → 不命中任何 lib
  assert.equal(r.length, 0);
});

test('digests: lib 多 tag OR', () => {
  const customLib = mkLib({ id: 'multi', tags: ['task:rl', 'task:reasoning'] });
  // 用自定义 lib 路径需要替换 LIBRARIES — 这里测 OR 行为用 buildLibDigests 内部
  // 直接 selectLibraryPapers 测
  const matched = selectLibraryPapers(
    [mkPaper({ categories: { venue: [], task: ['reasoning'], method: [], type: [] } })],
    customLib,
  );
  assert.equal(matched.length, 1);
});

// ---------- selectLibraryPapers ---
test('select: 空 items → []', () => {
  const r = selectLibraryPapers([], mkLib());
  assert.deepEqual(r, []);
});

test('select: 命中 → 返回', () => {
  const r = selectLibraryPapers(
    [mkPaper({ categories: { venue: [], task: ['rl'], method: [], type: [] } })],
    mkLib(),
  );
  assert.equal(r.length, 1);
});

test('select: 不命中 → []', () => {
  const r = selectLibraryPapers(
    [mkPaper({ categories: { venue: [], task: [], method: [], type: [] } })],
    mkLib({ tags: ['task:rl'] }),
  );
  assert.equal(r.length, 0);
});

test('select: lib 多 tag OR', () => {
  const lib = mkLib({ tags: ['task:rl', 'task:reasoning'] });
  const r = selectLibraryPapers(
    [
      mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
      mkPaper({ id: 'p2', categories: { venue: [], task: ['reasoning'], method: [], type: [] } }),
      mkPaper({ id: 'p3', categories: { venue: [], task: ['other'], method: [], type: [] } }),
    ],
    lib,
  );
  assert.equal(r.length, 2);
});

test('select: legacy query: tags', () => {
  const r = selectLibraryPapers(
    [mkPaper({ categories: { venue: [], task: [], method: [], type: [] }, tags: ['query:rl'] })],
    mkLib(),
  );
  assert.equal(r.length, 1);
});

test('select: categories 缺 → []', () => {
  const r = selectLibraryPapers(
    [mkPaper({ categories: undefined })],
    mkLib(),
  );
  assert.equal(r.length, 0);
});

test('select: tags 缺 → []', () => {
  const r = selectLibraryPapers(
    [mkPaper({ categories: { venue: [], task: [], method: [], type: [] } })],
    mkLib({ tags: ['task:rl'] }),
  );
  // categories.task=[] → flattenTags 不出 task:rl → 不命中
  assert.equal(r.length, 0);
});

// ---------- 集成 ---
test('集成: buildLibraryDigests 与 selectLibraryPapers 一致', () => {
  const items = [
    mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
    mkPaper({ id: 'p2', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
  ];
  const digests = buildLibraryDigests(items);
  const rlDigest = digests.find((d) => d.library.tags.includes('task:rl'));
  assert.ok(rlDigest);
  const selected = selectLibraryPapers(items, rlDigest.library);
  assert.equal(selected.length, rlDigest.paperCount);
});
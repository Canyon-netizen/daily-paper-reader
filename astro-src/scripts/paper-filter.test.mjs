#!/usr/bin/env node
// astro-src/scripts/paper-filter.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-filter.ts paper filtering/sorting pipeline.

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
    external: ['node:*', './paper-disk.mjs', '../paper-disk.mjs', './taxonomies-disk.mjs', '../taxonomies-disk.mjs'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/paper-filter.ts');
const {
  filterByTag,
  filterBySearch,
  filterBySinceDays,
  sortAndLimit,
  applyRankedOrder,
  filterByAuthor,
  filterByVenue,
  filterByYearRange,
  filterByStarred,
  filterByReadingStatus,
  filterByHasNote,
  filterByUserTag,
  applyLibraryFilters,
  applyPaperFilters,
} = mod;

function paper(over) {
  return {
    id: 'papers/x.md',
    slug: 'x',
    title: 'Sample paper',
    title_zh: '示例论文',
    tldr: 'A summary',
    date: '2025-01-01',
    yearMonth: '2025-01',
    day: '01',
    authors: 'Alice, Bob',
    score: 5,
    categories: { task: ['rl'], method: ['rl'], type: ['paper'], venue: ['ICML 2025'] },
    canonicalArxivId: '2501.00001',
    arxivId: '2501.00001v1',
    wikiContent: null,
    ...over,
  };
}

test('filterByTag: 空 tag → 原样', () => {
  const items = [paper()];
  assert.equal(filterByTag(items, '').length, 1);
});

test('filterByTag: "task:rl" 命中', () => {
  const items = [paper({ categories: { task: ['rl'], method: [], type: [], venue: [] } })];
  assert.equal(filterByTag(items, 'task:rl').length, 1);
});

test('filterByTag: "rl" 也命中(兼容短写法)', () => {
  const items = [paper({ categories: { task: ['rl'], method: [], type: [], venue: [] } })];
  assert.equal(filterByTag(items, 'rl').length, 1);
});

test('filterByTag: 不匹配的 tag 排除', () => {
  const items = [paper({ categories: { task: ['cv'], method: [], type: [], venue: [] } })];
  assert.equal(filterByTag(items, 'rl').length, 0);
});

test('filterBySearch: 命中 title', () => {
  const items = [paper({ title: 'Deep Learning is great' })];
  assert.equal(filterBySearch(items, 'deep').length, 1);
});

test('filterBySearch: 命中 title_zh', () => {
  const items = [paper({ title_zh: '深度学习综述' })];
  assert.equal(filterBySearch(items, '深度').length, 1);
});

test('filterBySearch: 命中 tldr', () => {
  const items = [paper({ tldr: 'this is about reasoning' })];
  assert.equal(filterBySearch(items, 'reasoning').length, 1);
});

test('filterBySearch: 大小写不敏感', () => {
  const items = [paper({ title: 'Deep Learning' })];
  assert.equal(filterBySearch(items, 'DEEP').length, 1);
});

test('filterBySearch: 空 search → 不过滤', () => {
  const items = [paper()];
  assert.equal(filterBySearch(items, '').length, 1);
});

test('filterBySinceDays: 0 或负 → 不过滤', () => {
  const items = [paper()];
  assert.equal(filterBySinceDays(items, 0).length, 1);
  assert.equal(filterBySinceDays(items, -1).length, 1);
});

test('filterBySinceDays: 1 天内 → 命中', () => {
  const today = new Date().toISOString().slice(0, 10);
  const items = [paper({ date: today })];
  assert.equal(filterBySinceDays(items, 7).length, 1);
});

test('filterBySinceDays: 老论文 → 排除', () => {
  const items = [paper({ date: '2020-01-01' })];
  assert.equal(filterBySinceDays(items, 7).length, 0);
});

test('filterBySinceDays: 无 date → 排除', () => {
  const items = [paper({ date: '' })];
  assert.equal(filterBySinceDays(items, 7).length, 0);
});

test('sortAndLimit: date desc 默认', () => {
  const items = [
    paper({ id: 'a.md', date: '2025-01-01' }),
    paper({ id: 'b.md', date: '2025-03-01' }),
    paper({ id: 'c.md', date: '2025-02-01' }),
  ];
  const sorted = sortAndLimit(items, 'date');
  assert.equal(sorted[0].id, 'b.md');
  assert.equal(sorted[1].id, 'c.md');
  assert.equal(sorted[2].id, 'a.md');
});

test('sortAndLimit: date asc', () => {
  const items = [
    paper({ id: 'a.md', date: '2025-01-01' }),
    paper({ id: 'b.md', date: '2025-03-01' }),
  ];
  const sorted = sortAndLimit(items, 'date', 'asc');
  assert.equal(sorted[0].id, 'a.md');
});

test('sortAndLimit: score desc', () => {
  const items = [
    paper({ id: 'a.md', score: 5 }),
    paper({ id: 'b.md', score: 10 }),
  ];
  const sorted = sortAndLimit(items, 'score');
  assert.equal(sorted[0].id, 'b.md');
});

test('sortAndLimit: limit 截断', () => {
  const items = [paper({ id: 'a.md' }), paper({ id: 'b.md' }), paper({ id: 'c.md' })];
  const sorted = sortAndLimit(items, 'date', 'desc', 2);
  assert.equal(sorted.length, 2);
});

test('sortAndLimit: limit<=0 不截断', () => {
  const items = [paper({ id: 'a.md' }), paper({ id: 'b.md' })];
  assert.equal(sortAndLimit(items, 'date', 'desc', 0).length, 2);
});

test('applyRankedOrder: 命中项按 rankedIds 顺序', () => {
  const items = [
    paper({ id: 'a.md', canonicalArxivId: 'A' }),
    paper({ id: 'b.md', canonicalArxivId: 'B' }),
    paper({ id: 'c.md', canonicalArxivId: 'C' }),
  ];
  const ordered = applyRankedOrder(items, ['C', 'A', 'B']);
  assert.equal(ordered[0].id, 'c.md');
  assert.equal(ordered[1].id, 'a.md');
  assert.equal(ordered[2].id, 'b.md');
});

test('applyRankedOrder: 未命中项追加末尾', () => {
  const items = [
    paper({ id: 'a.md', canonicalArxivId: 'A' }),
    paper({ id: 'b.md', canonicalArxivId: 'B' }),
  ];
  const ordered = applyRankedOrder(items, ['B']);
  assert.equal(ordered[0].id, 'b.md');
  assert.equal(ordered[1].id, 'a.md'); // fallback
});

test('applyRankedOrder: 空 rankedIds → 原序', () => {
  const items = [paper({ id: 'a.md' }), paper({ id: 'b.md' })];
  const ordered = applyRankedOrder(items, []);
  assert.equal(ordered[0].id, 'a.md');
  assert.equal(ordered[1].id, 'b.md');
});

test('filterByAuthor: 子串命中', () => {
  const items = [paper({ authors: 'Alice Wonderland' })];
  assert.equal(filterByAuthor(items, 'alice').length, 1);
});

test('filterByAuthor: 空 name → 不过滤', () => {
  const items = [paper()];
  assert.equal(filterByAuthor(items, '').length, 1);
});

test('filterByVenue: 精确匹配', () => {
  const items = [paper({ categories: { task: [], method: [], type: [], venue: ['ICML 2025'] } })];
  assert.equal(filterByVenue(items, 'ICML 2025').length, 1);
});

test('filterByVenue: 不匹配 → 排除', () => {
  const items = [paper({ categories: { task: [], method: [], type: [], venue: ['NeurIPS'] } })];
  assert.equal(filterByVenue(items, 'ICML 2025').length, 0);
});

test('filterByYearRange: [2024, 2026] 命中', () => {
  const items = [paper({ date: '2025-06-01' })];
  assert.equal(filterByYearRange(items, { from: 2024, to: 2026 }).length, 1);
});

test('filterByYearRange: 无 date → 排除', () => {
  const items = [paper({ date: '' })];
  assert.equal(filterByYearRange(items, { from: 2020 }).length, 0);
});

test('filterByStarred: snapshot.starred 命中', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(['2501.00001']),
    status: new Map(),
    notes: new Map(),
    userTags: new Map(),
  };
  const items = [paper()];
  assert.equal(filterByStarred(items, snapshot).length, 1);
});

test('filterByStarred: 空 starred 不过滤', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(),
    status: new Map(),
    notes: new Map(),
    userTags: new Map(),
  };
  const items = [paper()];
  assert.equal(filterByStarred(items, snapshot).length, 1);
});

test('filterByReadingStatus: "read" 命中', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(),
    status: new Map([['2501.00001', 'read']]),
    notes: new Map(),
    userTags: new Map(),
  };
  const items = [paper()];
  const out = filterByReadingStatus(items, 'read', snapshot);
  assert.equal(out.length, 1);
});

test('filterByReadingStatus: 默认 unread + 空 snapshot 不过滤', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(),
    status: new Map(),
    notes: new Map(),
    userTags: new Map(),
  };
  const items = [paper()];
  const out = filterByReadingStatus(items, 'unread', snapshot);
  assert.equal(out.length, 1);
});

test('filterByHasNote: snapshot.notes 命中', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(),
    status: new Map(),
    notes: new Map([['2501.00001', 'note text']]),
    userTags: new Map(),
  };
  const items = [paper()];
  assert.equal(filterByHasNote(items, snapshot).length, 1);
});

test('filterByUserTag: kind+label 命中', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(),
    status: new Map(),
    notes: new Map(),
    userTags: new Map([['2501.00001', [{ kind: 'topic', label: 'rl' }]]]),
  };
  const items = [paper()];
  const out = filterByUserTag(items, 'topic', 'rl', snapshot);
  assert.equal(out.length, 1);
});

test('applyPaperFilters: search + limit 组合', () => {
  const items = [
    paper({ id: 'a.md', title: 'Deep RL' }),
    paper({ id: 'b.md', title: 'Other' }),
  ];
  const out = applyPaperFilters(items, { search: 'deep', limit: 10 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a.md');
});

test('applyLibraryFilters: 多维组合', () => {
  const snapshot = {
    hidden: new Set(),
    starred: new Set(['2501.00001']),
    status: new Map(),
    notes: new Map(),
    userTags: new Map(),
  };
  const items = [
    paper({ id: 'a.md', canonicalArxivId: '2501.00001' }),
    paper({ id: 'b.md', canonicalArxivId: '2501.00002', authors: 'No match' }),
  ];
  const out = applyLibraryFilters(items, snapshot, { author: 'alice', starred: true });
  // starred 命中 a.md → a.md 通过 starred,然后 author 'alice' 命中 a.md
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a.md');
});

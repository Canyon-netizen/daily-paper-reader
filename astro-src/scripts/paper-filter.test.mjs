#!/usr/bin/env node
// astro-src/scripts/paper-filter.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-filter.ts.
// filterByTag / filterBySearch / filterBySinceDays / sortAndLimit +
// applyPaperFilters (tag + search + sinceDays + dedup + sortBy + limit + rankedIds) +
// applyRankedOrder + applyLibraryFilters (author/venue/yearRange/starred/readingStatus/hasNote/userTag)。

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

const mod = await loadTs('lib/paper-filter.ts');
const {
  filterByTag,
  filterBySearch,
  filterBySinceDays,
  sortAndLimit,
  applyPaperFilters,
  applyRankedOrder,
  filterByAuthor,
  filterByVenue,
  filterByYearRange,
  filterByStarred,
  filterByReadingStatus,
  filterByHasNote,
  filterByUserTag,
  applyLibraryFilters,
} = mod;

const mkPaper = (overrides = {}) => ({
  id: 'papers/x.md',
  title: 'Some Title',
  title_zh: '一些标题',
  tldr: 'short summary',
  date: '2026-09-01',
  score: 0.5,
  authors: 'Alice, Bob',
  arxivId: '2310.12345v1',
  canonicalArxivId: '2310.12345',
  slug: 'x',
  yearMonth: '2026-09',
  day: '01',
  categories: { venue: [], task: ['rl'], method: [], type: [] },
  tags: [],
  ...overrides,
});

// ---------- filterByTag ---
test('tag: 空 tag → 返回原数组', () => {
  const items = [mkPaper()];
  const r = filterByTag(items, '');
  assert.equal(r, items);
});

test('tag: "task:rl" 完整匹配', () => {
  const r = filterByTag([mkPaper()], 'task:rl');
  assert.equal(r.length, 1);
});

test('tag: "rl" 后缀匹配(去 dim 前缀)', () => {
  const r = filterByTag([mkPaper()], 'rl');
  assert.equal(r.length, 1);
});

test('tag: 不命中 → []', () => {
  const r = filterByTag(
    [mkPaper({ categories: { venue: [], task: [], method: [], type: [] } })],
    'rl',
  );
  assert.equal(r.length, 0);
});

test('tag: 不修改原数组', () => {
  const items = [mkPaper()];
  const r = filterByTag(items, 'rl');
  assert.notEqual(r, items);
});

// ---------- filterBySearch ---
test('search: 空 → 返回原数组', () => {
  const items = [mkPaper()];
  const r = filterBySearch(items, '');
  assert.equal(r, items);
});

test('search: 命中 title', () => {
  const r = filterBySearch([mkPaper({ title: 'Attention Is All You Need' })], 'attention');
  assert.equal(r.length, 1);
});

test('search: 命中 title_zh', () => {
  const r = filterBySearch([mkPaper({ title_zh: '注意力机制' })], '注意力');
  assert.equal(r.length, 1);
});

test('search: 命中 tldr', () => {
  const r = filterBySearch([mkPaper({ tldr: 'some summary here' })], 'summary');
  assert.equal(r.length, 1);
});

test('search: 大小写不敏感', () => {
  const r = filterBySearch([mkPaper({ title: 'ATTENTION' })], 'attention');
  assert.equal(r.length, 1);
});

test('search: 不命中 → []', () => {
  const r = filterBySearch([mkPaper()], 'nonexistent');
  assert.equal(r.length, 0);
});

// ---------- filterBySinceDays ---
test('since: sinceDays <= 0 → 返回原数组', () => {
  const items = [mkPaper()];
  assert.equal(filterBySinceDays(items, 0), items);
  assert.equal(filterBySinceDays(items, -1), items);
});

test('since: sinceDays 非 number → 返回原数组', () => {
  const items = [mkPaper()];
  assert.equal(filterBySinceDays(items, '30'), items);
});

test('since: 30 天内 → 命中', () => {
  // today
  const d = new Date().toISOString().slice(0, 10);
  const r = filterBySinceDays([mkPaper({ date: d })], 30);
  assert.equal(r.length, 1);
});

test('since: date 缺 → 淘汰', () => {
  const r = filterBySinceDays([mkPaper({ date: '' })], 30);
  assert.equal(r.length, 0);
});

test('since: date 非法 → 淘汰', () => {
  const r = filterBySinceDays([mkPaper({ date: 'invalid' })], 30);
  assert.equal(r.length, 0);
});

// ---------- sortAndLimit ---
test('sort: date desc 默认', () => {
  const r = sortAndLimit([
    mkPaper({ id: 'p1', date: '2026-08-01' }),
    mkPaper({ id: 'p2', date: '2026-09-15' }),
    mkPaper({ id: 'p3', date: '2026-09-01' }),
  ], 'date');
  assert.equal(r[0].id, 'p2');
  assert.equal(r[2].id, 'p1');
});

test('sort: date asc', () => {
  const r = sortAndLimit([
    mkPaper({ id: 'p1', date: '2026-08-01' }),
    mkPaper({ id: 'p2', date: '2026-09-15' }),
  ], 'date', 'asc');
  assert.equal(r[0].id, 'p1');
});

test('sort: score desc', () => {
  const r = sortAndLimit([
    mkPaper({ id: 'p1', score: 0.3 }),
    mkPaper({ id: 'p2', score: 0.9 }),
    mkPaper({ id: 'p3', score: 0.6 }),
  ], 'score');
  assert.equal(r[0].id, 'p2');
});

test('sort: limit 截断', () => {
  const r = sortAndLimit(
    [mkPaper({ id: 'p1' }), mkPaper({ id: 'p2' }), mkPaper({ id: 'p3' })],
    'date', 'desc', 2,
  );
  assert.equal(r.length, 2);
});

test('sort: limit=0 → 不截断', () => {
  const r = sortAndLimit(
    [mkPaper({ id: 'p1' }), mkPaper({ id: 'p2' })],
    'date', 'desc', 0,
  );
  assert.equal(r.length, 2);
});

test('sort: date 缺 → 0 兜底', () => {
  const r = sortAndLimit([
    mkPaper({ id: 'p1', date: '' }),
    mkPaper({ id: 'p2', date: '2026-09-01' }),
  ], 'date', 'desc');
  assert.equal(r[0].id, 'p2'); // 0 < 实际日期
});

// ---------- applyPaperFilters ---
test('pipeline: tag + dedup + sortBy date', () => {
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', date: '2026-08-01', arxivId: '2310.11111v1', canonicalArxivId: '2310.11111' }),
      mkPaper({ id: 'p2', date: '2026-09-15', arxivId: '2310.11111v2', canonicalArxivId: '2310.11111' }),
    ],
    { tag: 'rl' },
  );
  // 同 canonical 留 v2(日期新)
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'p2');
});

test('pipeline: dedup=false 不去重', () => {
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', arxivId: '2310.11111v1', canonicalArxivId: '2310.11111' }),
      mkPaper({ id: 'p2', arxivId: '2310.11111v2', canonicalArxivId: '2310.11111' }),
    ],
    { dedup: false },
  );
  assert.equal(r.length, 2);
});

test('pipeline: tag 过滤优先', () => {
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', categories: { venue: [], task: ['rl'], method: [], type: [] } }),
      mkPaper({ id: 'p2', categories: { venue: [], task: ['reasoning'], method: [], type: [] } }),
    ],
    { tag: 'rl' },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'p1');
});

test('pipeline: search 过滤', () => {
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', title: 'attention' }),
      mkPaper({ id: 'p2', title: 'other' }),
    ],
    { search: 'attention' },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'p1');
});

test('pipeline: rankedIds 优先 sortBy', () => {
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', arxivId: '2310.11111', canonicalArxivId: 'a', date: '2026-09-01' }),
      mkPaper({ id: 'p2', arxivId: '2310.22222', canonicalArxivId: 'b', date: '2026-08-01' }),
    ],
    { rankedIds: ['b', 'a'] },
  );
  // b 排名在前
  assert.equal(r[0].canonicalArxivId, 'b');
});

test('pipeline: rankedIds 未命中 → 末尾 + date desc 兜底', () => {
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', arxivId: '2310.11111', canonicalArxivId: 'x', date: '2026-08-01' }),
      mkPaper({ id: 'p2', arxivId: '2310.22222', canonicalArxivId: 'a', date: '2026-09-01' }),
      mkPaper({ id: 'p3', arxivId: '2310.33333', canonicalArxivId: 'b', date: '2026-09-15' }),
    ],
    { rankedIds: ['b', 'a'] },
  );
  // b, a 命中(按 rank), x 兜底到末尾(date desc)
  assert.equal(r[0].id, 'p3');
  assert.equal(r[1].id, 'p2');
  assert.equal(r[2].id, 'p1');
});

test('pipeline: sinceDays 严过滤不足 → 兜底补齐', () => {
  const d_old = '2026-01-01';
  const d_new = '2026-09-15';
  const r = applyPaperFilters(
    [
      mkPaper({ id: 'p1', arxivId: '2310.11111', canonicalArxivId: 'a', date: d_old }),
      mkPaper({ id: 'p2', arxivId: '2310.22222', canonicalArxivId: 'b', date: d_new }),
    ],
    { sinceDays: 30, limit: 3 }, // 30 天内只有 p2 命中
  );
  // 兜底:不强制 sinceDays → 用原池排序
  assert.equal(r.length, 2);
});

// ---------- applyRankedOrder ---
test('rank: 空 rankedIds → 返回原数组', () => {
  const items = [mkPaper()];
  const r = applyRankedOrder(items, []);
  assert.equal(r, items);
});

test('rank: 命中 rankedIds 排前', () => {
  const r = applyRankedOrder(
    [
      mkPaper({ id: 'p1', canonicalArxivId: 'a' }),
      mkPaper({ id: 'p2', canonicalArxivId: 'b' }),
    ],
    ['b', 'a'],
  );
  assert.equal(r[0].id, 'p2');
});

test('rank: 未命中 fallback', () => {
  const r = applyRankedOrder(
    [
      mkPaper({ id: 'p1', canonicalArxivId: 'x', date: '2026-08-01' }),
      mkPaper({ id: 'p2', canonicalArxivId: 'a', date: '2026-09-01' }),
    ],
    ['a'],
  );
  // a 命中在前,x 兜底(默认 date desc)
  assert.equal(r[0].id, 'p2');
  assert.equal(r[1].id, 'p1');
});

test('rank: 自定义 fallback', () => {
  const r = applyRankedOrder(
    [
      mkPaper({ id: 'p1', canonicalArxivId: 'x' }),
      mkPaper({ id: 'p2', canonicalArxivId: 'a' }),
    ],
    ['a'],
    () => 0, // 保留原序
  );
  assert.equal(r[0].id, 'p2'); // a 命中在前
  assert.equal(r[1].id, 'p1');
});

// ---------- filterByAuthor ---
test('author: 空 name → 返回原数组', () => {
  const items = [mkPaper()];
  assert.equal(filterByAuthor(items, ''), items);
});

test('author: 子串匹配大小写不敏感', () => {
  const r = filterByAuthor([mkPaper({ authors: 'Alice Smith' })], 'alice');
  assert.equal(r.length, 1);
});

test('author: 不命中 → []', () => {
  const r = filterByAuthor([mkPaper({ authors: 'Alice' })], 'bob');
  assert.equal(r.length, 0);
});

test('author: 缺 authors 字段 → 不抛', () => {
  const r = filterByAuthor([mkPaper({ authors: undefined })], 'alice');
  assert.equal(r.length, 0);
});

// ---------- filterByVenue ---
test('venue: 空 venue → 返回原数组', () => {
  const items = [mkPaper()];
  assert.equal(filterByVenue(items, ''), items);
});

test('venue: 精确匹配', () => {
  const r = filterByVenue(
    [mkPaper({ categories: { venue: ['ICML 2025'], task: [], method: [], type: [] } })],
    'ICML 2025',
  );
  assert.equal(r.length, 1);
});

test('venue: "ICML" 不命中 "ICML 2025"', () => {
  const r = filterByVenue(
    [mkPaper({ categories: { venue: ['ICML 2025'], task: [], method: [], type: [] } })],
    'ICML',
  );
  assert.equal(r.length, 0);
});

test('venue: 不命中 → []', () => {
  const r = filterByVenue(
    [mkPaper({ categories: { venue: ['NeurIPS'], task: [], method: [], type: [] } })],
    'ICML',
  );
  assert.equal(r.length, 0);
});

// ---------- filterByYearRange ---
test('year: 无 range → 返回原数组', () => {
  const items = [mkPaper()];
  const r = filterByYearRange(items, {});
  assert.equal(r, items);
});

test('year: from + to 区间内', () => {
  const r = filterByYearRange(
    [mkPaper({ date: '2026-01-01' })],
    { from: 2025, to: 2027 },
  );
  assert.equal(r.length, 1);
});

test('year: 早于 from → 淘汰', () => {
  const r = filterByYearRange(
    [mkPaper({ date: '2024-01-01' })],
    { from: 2025 },
  );
  assert.equal(r.length, 0);
});

test('year: 晚于 to → 淘汰', () => {
  const r = filterByYearRange(
    [mkPaper({ date: '2028-01-01' })],
    { to: 2027 },
  );
  assert.equal(r.length, 0);
});

test('year: date 缺 → 淘汰', () => {
  const r = filterByYearRange(
    [mkPaper({ date: '' })],
    { from: 2025 },
  );
  assert.equal(r.length, 0);
});

test('year: date 非法 → 淘汰', () => {
  const r = filterByYearRange(
    [mkPaper({ date: 'invalid' })],
    { from: 2025 },
  );
  assert.equal(r.length, 0);
});

test('year: from 缺 → to 单边', () => {
  const r = filterByYearRange(
    [mkPaper({ date: '2026-01-01' })],
    { to: 2030 },
  );
  assert.equal(r.length, 1);
});

test('year: to 缺 → from 单边', () => {
  const r = filterByYearRange(
    [mkPaper({ date: '2020-01-01' })],
    { from: 2019 },
  );
  assert.equal(r.length, 1);
});

// ---------- applyLibraryFilters (snapshot) ---
const mkSnap = (overrides = {}) => ({
  hidden: new Set(),
  starred: new Set(),
  status: new Map(),
  notes: new Map(),
  userTags: new Map(),
  ...overrides,
});

test('libF: 空 opts → 返回原数组', () => {
  const items = [mkPaper()];
  const r = applyLibraryFilters(items, mkSnap(), {});
  assert.equal(r, items);
});

test('libF: author + venue 组合', () => {
  const r = applyLibraryFilters(
    [
      mkPaper({ authors: 'Alice', categories: { venue: ['ICML'], task: [], method: [], type: [] } }),
      mkPaper({ authors: 'Bob', categories: { venue: ['NeurIPS'], task: [], method: [], type: [] } }),
    ],
    mkSnap(),
    { author: 'Alice', venue: 'ICML' },
  );
  assert.equal(r.length, 1);
});

test('libF: starred 命中', () => {
  const snap = mkSnap({ starred: new Set(['2310.12345']) });
  const r = applyLibraryFilters(
    [mkPaper(), mkPaper({ canonicalArxivId: 'other' })],
    snap,
    { starred: true },
  );
  assert.equal(r.length, 1);
});

test('libF: starred 空 → 不过滤', () => {
  const r = applyLibraryFilters(
    [mkPaper(), mkPaper({ id: 'p2' })],
    mkSnap({ starred: new Set() }),
    { starred: true },
  );
  // starred.size === 0 → 不过滤
  assert.equal(r.length, 2);
});

test('libF: readingStatus unread + 空 snapshot → 不过滤', () => {
  const r = applyLibraryFilters([mkPaper()], mkSnap(), { readingStatus: 'unread' });
  assert.equal(r.length, 1);
});

test('libF: readingStatus read', () => {
  const snap = mkSnap({ status: new Map([['2310.12345', 'read']]) });
  const r = applyLibraryFilters([mkPaper()], snap, { readingStatus: 'read' });
  assert.equal(r.length, 1);
});

test('libF: hasNote 命中', () => {
  const snap = mkSnap({ notes: new Map([['2310.12345', 'note text']]) });
  const r = applyLibraryFilters([mkPaper()], snap, { hasNote: true });
  assert.equal(r.length, 1);
});

test('libF: hasNote 空 → 不过滤', () => {
  const r = applyLibraryFilters([mkPaper()], mkSnap(), { hasNote: true });
  assert.equal(r.length, 1);
});

test('libF: userTag 命中', () => {
  const snap = mkSnap({
    userTags: new Map([['2310.12345', [{ kind: 'task', label: 'reasoning' }]]]),
  });
  const r = applyLibraryFilters(
    [mkPaper()],
    snap,
    { userTag: { kind: 'task', label: 'reasoning' } },
  );
  assert.equal(r.length, 1);
});

test('libF: userTag 不匹配 kind', () => {
  const snap = mkSnap({
    userTags: new Map([['2310.12345', [{ kind: 'task', label: 'reasoning' }]]]),
  });
  const r = applyLibraryFilters(
    [mkPaper()],
    snap,
    { userTag: { kind: 'method', label: 'reasoning' } },
  );
  assert.equal(r.length, 0);
});

test('libF: userTag 空 kind/label → 不过滤', () => {
  const r = applyLibraryFilters(
    [mkPaper()],
    mkSnap(),
    { userTag: { kind: '', label: '' } },
  );
  assert.equal(r.length, 1);
});
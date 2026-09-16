#!/usr/bin/env node
// astro-src/scripts/search-cache.test.mjs
//
// Tests for R7 H.1.3 search result cache + pagination.

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

const mod = await loadTs('lib/search/cache.ts');
const {
  getCachedSearchResult,
  setCachedSearchResult,
  clearSearchCache,
  searchCacheSize,
  purgeExpiredSearchCache,
  paginateHits,
} = mod;

// helper
function makeResult(n) {
  return {
    hits: Array.from({ length: n }, (_, i) => ({
      id: `papers/2026/09/${String(i).padStart(5, '0')}`,
      canonicalId: `2506.${String(i).padStart(5, '0')}`,
      score: 1 - i * 0.01,
      corpusScore: 0.5,
      noteScore: 0,
      matchedFields: ['title'],
      noteOnly: false,
    })),
    mode: 'bm25',
    stats: { tookMs: 1, totalHits: n, noteHits: 0, indexedDocs: n, notesSearched: 0 },
  };
}

// ----- getCachedSearchResult / setCachedSearchResult -----

test('cache: 写完能读到', () => {
  clearSearchCache();
  setCachedSearchResult('transformer', makeResult(3));
  const r = getCachedSearchResult('transformer');
  assert.ok(r);
  assert.equal(r.hits.length, 3);
});

test('cache: 大小写 + 空格不敏感', () => {
  clearSearchCache();
  setCachedSearchResult('Transformer', makeResult(1));
  assert.ok(getCachedSearchResult('transformer'));
  assert.ok(getCachedSearchResult('TRANSFORMER'));
  assert.ok(getCachedSearchResult('  transformer  '));
});

test('cache: TTL 过期返回 null', () => {
  clearSearchCache();
  setCachedSearchResult('q', makeResult(1), 1000);
  assert.equal(getCachedSearchResult('q', 1000 + 60_001, 60_000), null);
});

test('cache: 未过期可读', () => {
  clearSearchCache();
  setCachedSearchResult('q', makeResult(1), 1000);
  assert.ok(getCachedSearchResult('q', 1000 + 30_000, 60_000));
});

test('cache: 超过 maxEntries 淘汰最老', () => {
  clearSearchCache();
  setCachedSearchResult('a', makeResult(1), 1000, 3);
  setCachedSearchResult('b', makeResult(1), 2000, 3);
  setCachedSearchResult('c', makeResult(1), 3000, 3);
  setCachedSearchResult('d', makeResult(1), 4000, 3);  // a 应该被淘汰
  assert.equal(searchCacheSize(), 3);
  assert.equal(getCachedSearchResult('a', 5000, 60_000), null);
  assert.ok(getCachedSearchResult('b', 5000, 60_000));
  assert.ok(getCachedSearchResult('d', 5000, 60_000));
});

test('cache: LRU bump — 读后写入最新位置', () => {
  clearSearchCache();
  setCachedSearchResult('a', makeResult(1), 1000, 3);
  setCachedSearchResult('b', makeResult(1), 2000, 3);
  setCachedSearchResult('c', makeResult(1), 3000, 3);
  // 读 a → a 应该变成最近使用
  assert.ok(getCachedSearchResult('a', 3500, 60_000));
  // 再加 d → 应该淘汰 b(现在最老)
  setCachedSearchResult('d', makeResult(1), 4000, 3);
  assert.equal(searchCacheSize(), 3);
  assert.equal(getCachedSearchResult('b', 5000, 60_000), null);
  assert.ok(getCachedSearchResult('a', 5000, 60_000));
});

// ----- purgeExpiredSearchCache -----

test('purgeExpiredSearchCache: 清掉过期的', () => {
  clearSearchCache();
  setCachedSearchResult('old', makeResult(1), 1000);
  setCachedSearchResult('new', makeResult(1), 50_000);
  const removed = purgeExpiredSearchCache(110_000, 60_000);
  assert.equal(removed, 1);
  assert.equal(searchCacheSize(), 1);
  // 110_000 - 50_000 = 60_000 → 还没过期 (> 才过期)
  assert.ok(getCachedSearchResult('new', 109_999, 60_000));
});

// ----- paginateHits -----

test('paginateHits: 第一页', () => {
  const r = makeResult(120);
  const p = paginateHits(r, 1, 50);
  assert.equal(p.items.length, 50);
  assert.equal(p.hasMore, true);
  assert.equal(p.total, 120);
});

test('paginateHits: 最后一页少于 pageSize', () => {
  const r = makeResult(120);
  const p = paginateHits(r, 3, 50);
  assert.equal(p.items.length, 20);
  assert.equal(p.hasMore, false);
});

test('paginateHits: 超出范围 → hasMore=false, items=[]', () => {
  const r = makeResult(10);
  const p = paginateHits(r, 5, 5);
  assert.equal(p.items.length, 0);
  assert.equal(p.hasMore, false);
});

test('paginateHits: page < 1 视作 1', () => {
  const r = makeResult(10);
  const p = paginateHits(r, 0, 5);
  assert.equal(p.items.length, 5);
});

test('paginateHits: 整除时刚好一页完', () => {
  const r = makeResult(50);
  const p = paginateHits(r, 1, 50);
  assert.equal(p.items.length, 50);
  assert.equal(p.hasMore, false);
});
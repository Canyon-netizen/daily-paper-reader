// astro-src/scripts/paper.test.mjs
// Tests for pure functions in lib/paper.ts
//
// Loader pattern: esbuild-bundle the TS source and import as ESM data URL.

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

// Load the module
const paper = await loadTs('lib/paper.ts');

const {
  flattenCategories,
  figureUrlToAbsolute,
  paperBasename,
  paperHref,
  resolveTaskKey,
  LEGACY_TAG_PREFIX,
  // Re-exported from arxiv
  dedupByCanonicalArxivId,
  canonicalArxivId,
} = paper;

// ============================================================
// flattenCategories tests
// ============================================================

test('flattenCategories returns empty array for undefined', () => {
  assert.deepStrictEqual(flattenCategories(undefined), []);
});

test('flattenCategories returns empty array for null', () => {
  assert.deepStrictEqual(flattenCategories(null), []);
});

test('flattenCategories handles empty categories object', () => {
  assert.deepStrictEqual(flattenCategories({ venue: [], task: [], method: [], type: [] }), []);
});

test('flattenCategories flattens venue dimension', () => {
  const result = flattenCategories({ venue: ['ICML 2025'], task: [], method: [], type: [] });
  assert.deepStrictEqual(result, ['venue:ICML 2025']);
});

test('flattenCategories flattens task dimension', () => {
  const result = flattenCategories({ venue: [], task: ['rl'], method: [], type: [] });
  assert.deepStrictEqual(result, ['task:rl']);
});

test('flattenCategories flattens method dimension', () => {
  const result = flattenCategories({ venue: [], task: [], method: ['transformer'], type: [] });
  assert.deepStrictEqual(result, ['method:transformer']);
});

test('flattenCategories flattens type dimension', () => {
  const result = flattenCategories({ venue: [], task: [], method: [], type: ['survey'] });
  assert.deepStrictEqual(result, ['type:survey']);
});

test('flattenCategories preserves order: venue, task, method, type', () => {
  const result = flattenCategories({
    venue: ['NeurIPS'],
    task: ['rl'],
    method: ['transformer'],
    type: ['paper'],
  });
  assert.deepStrictEqual(result, [
    'venue:NeurIPS',
    'task:rl',
    'method:transformer',
    'type:paper',
  ]);
});

test('flattenCategories deduplicates identical dim:label pairs', () => {
  const result = flattenCategories({
    venue: ['ICML', 'ICML'],
    task: ['rl', 'rl'],
    method: [],
    type: [],
  });
  assert.deepStrictEqual(result, ['venue:ICML', 'task:rl']);
});

test('flattenCategories handles all dimensions with multiple values', () => {
  const result = flattenCategories({
    venue: ['ICML 2025', 'NeurIPS 2024'],
    task: ['rl', 'reasoning'],
    method: ['transformer', 'cnn'],
    type: ['paper', 'survey'],
  });
  assert.deepStrictEqual(result, [
    'venue:ICML 2025',
    'venue:NeurIPS 2024',
    'task:rl',
    'task:reasoning',
    'method:transformer',
    'method:cnn',
    'type:paper',
    'type:survey',
  ]);
});

test('flattenCategories handles partial dimensions', () => {
  const result = flattenCategories({
    venue: [],
    task: ['llm'],
    method: [],
    type: [],
  });
  assert.deepStrictEqual(result, ['task:llm']);
});

// ============================================================
// figureUrlToAbsolute tests
// ============================================================

test('figureUrlToAbsolute returns empty string for empty url', () => {
  assert.strictEqual(figureUrlToAbsolute(''), '');
});

test('figureUrlToAbsolute returns empty string for undefined url', () => {
  assert.strictEqual(figureUrlToAbsolute(undefined), '');
});

test('figureUrlToAbsolute returns https URL as-is', () => {
  assert.strictEqual(figureUrlToAbsolute('https://example.com/img.png'), 'https://example.com/img.png');
});

test('figureUrlToAbsolute returns http URL as-is', () => {
  assert.strictEqual(figureUrlToAbsolute('http://example.com/img.png'), 'http://example.com/img.png');
});

test('figureUrlToAbsolute returns absolute path starting with / as-is', () => {
  assert.strictEqual(figureUrlToAbsolute('/images/fig1.png'), '/images/fig1.png');
});

test('figureUrlToAbsolute converts relative path with default base /', () => {
  assert.strictEqual(figureUrlToAbsolute('figures/fig1.png'), '/figures/fig1.png');
});

test('figureUrlToAbsolute converts relative path with custom base', () => {
  assert.strictEqual(figureUrlToAbsolute('figures/fig1.png', '/docs'), '/docs/figures/fig1.png');
});

test('figureUrlToAbsolute handles ./ prefix', () => {
  assert.strictEqual(figureUrlToAbsolute('./figures/fig1.png', '/base'), '/base/figures/fig1.png');
});

test('figureUrlToAbsolute strips trailing slash from base', () => {
  assert.strictEqual(figureUrlToAbsolute('fig.png', '/base/'), '/base/fig.png');
});

test('figureUrlToAbsolute handles base without leading slash', () => {
  // base is used as-is, not forced to start with /
  assert.strictEqual(figureUrlToAbsolute('fig.png', 'base'), 'base/fig.png');
});

test('figureUrlToAbsolute handles base with multiple slashes', () => {
  // base is used as-is, multiple slashes preserved
  assert.strictEqual(figureUrlToAbsolute('fig.png', '///base///'), '///base///fig.png');
});

// ============================================================
// paperBasename tests
// ============================================================

test('paperBasename extracts basename from full path', () => {
  assert.strictEqual(paperBasename('papers/2026/07/17/2607.14171v1'), '2607.14171v1');
});

test('paperBasename returns input as-is if no slashes', () => {
  assert.strictEqual(paperBasename('2607.14171v1'), '2607.14171v1');
});

test('paperBasename handles path with multiple slashes', () => {
  assert.strictEqual(paperBasename('a/b/c/d/e.md'), 'e.md');
});

test('paperBasename handles empty string', () => {
  assert.strictEqual(paperBasename(''), '');
});

// ============================================================
// paperHref tests
// ============================================================

test('paperHref builds basic href', () => {
  const result = paperHref('2607.14171v1', '/');
  assert.strictEqual(result, '/papers/2607.14171v1/');
});

test('paperHref builds href with base path', () => {
  const result = paperHref('2607.14171v1', '/docs');
  assert.strictEqual(result, '/docs/papers/2607.14171v1/');
});

test('paperHref builds href with hash', () => {
  const result = paperHref('2607.14171v1', '/', 'abstract');
  assert.strictEqual(result, '/papers/2607.14171v1/abstract');
});

test('paperHref builds href with base and hash', () => {
  const result = paperHref('papers/2026/07/2607.14171v1', '/docs', 'figures');
  assert.strictEqual(result, '/docs/papers/2607.14171v1/figures');
});

test('paperHref strips trailing slash from base', () => {
  const result = paperHref('2607.14171v1', '/base/');
  assert.strictEqual(result, '/base/papers/2607.14171v1/');
});

test('paperHref handles full path paper id', () => {
  const result = paperHref('papers/2026/07/17/2607.14171v1-branch-xyz', '/base');
  assert.strictEqual(result, '/base/papers/2607.14171v1-branch-xyz/');
});

// ============================================================
// resolveTaskKey tests
// ============================================================

test('resolveTaskKey returns task from categories.task', () => {
  const item = { categories: { task: ['rl'], venue: [], method: [], type: [] }, tags: undefined };
  assert.strictEqual(resolveTaskKey(item), 'rl');
});

test('resolveTaskKey falls back to tags with query: prefix', () => {
  const item = { categories: { task: [], venue: [], method: [], type: [] }, tags: ['query:rl'] };
  assert.strictEqual(resolveTaskKey(item), 'rl');
});

test('resolveTaskKey falls back to tags without prefix (should still have prefix check)', () => {
  const item = { categories: { task: [], venue: [], method: [], type: [] }, tags: ['rl'] };
  assert.strictEqual(resolveTaskKey(item), '其他');
});

test('resolveTaskKey returns 其他 when no task or tags', () => {
  const item = { categories: { task: [], venue: [], method: [], type: [] }, tags: [] };
  assert.strictEqual(resolveTaskKey(item), '其他');
});

test('resolveTaskKey returns 其他 when categories undefined', () => {
  const item = { tags: undefined };
  assert.strictEqual(resolveTaskKey(item), '其他');
});

test('resolveTaskKey prefers categories.task over tags', () => {
  const item = { categories: { task: ['reasoning'], venue: [], method: [], type: [] }, tags: ['query:rl'] };
  assert.strictEqual(resolveTaskKey(item), 'reasoning');
});

test('resolveTaskKey handles empty categories object', () => {
  const item = { categories: {}, tags: ['query:vision'] };
  assert.strictEqual(resolveTaskKey(item), 'vision');
});

test('LEGACY_TAG_PREFIX is query:', () => {
  assert.strictEqual(LEGACY_TAG_PREFIX, 'query:');
});

// ============================================================
// Re-exported from arxiv: canonicalArxivId
// ============================================================

test('canonicalArxivId extracts canonical ID from versioned ID', () => {
  assert.strictEqual(canonicalArxivId('2607.00483v2'), '2607.00483');
});

test('canonicalArxivId returns ID unchanged if no version', () => {
  assert.strictEqual(canonicalArxivId('2607.00483'), '2607.00483');
});

test('canonicalArxivId handles uppercase V', () => {
  assert.strictEqual(canonicalArxivId('2607.00483V2'), '2607.00483');
});

test('canonicalArxivId handles empty string', () => {
  assert.strictEqual(canonicalArxivId(''), '');
});

test('canonicalArxivId trims whitespace', () => {
  assert.strictEqual(canonicalArxivId('  2607.00483v2  '), '2607.00483');
});

test('canonicalArxivId handles non-arxiv strings', () => {
  assert.strictEqual(canonicalArxivId('some-id'), 'some-id');
});

// ============================================================
// Re-exported from arxiv: dedupByCanonicalArxivId
// ============================================================

test('dedupByCanonicalArxivId keeps higher version', () => {
  const items = [
    { id: 'a', arxivId: '2607.00483v1', title: 'v1' },
    { id: 'b', arxivId: '2607.00483v2', title: 'v2' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].title, 'v2');
});

test('dedupByCanonicalArxivId keeps single item if no versions', () => {
  const items = [
    { id: 'a', arxivId: '2607.00483', title: 'only' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.strictEqual(result.length, 1);
});

test('dedupByCanonicalArxivId preserves items with different IDs', () => {
  const items = [
    { id: 'a', arxivId: '2607.00483v1', title: 'v1' },
    { id: 'b', arxivId: '2608.12345v1', title: 'other' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.strictEqual(result.length, 2);
});

test('dedupByCanonicalArxivId handles empty array', () => {
  const result = dedupByCanonicalArxivId([]);
  assert.deepStrictEqual(result, []);
});

test('dedupByCanonicalArxivId handles non-arxiv IDs', () => {
  const items = [
    { id: 'paper-1', arxivId: '', title: 'no arxiv' },
    { id: 'paper-2', arxivId: '', title: 'also no arxiv' },
  ];
  // Non-arxiv items use id: prefix, so different ids keep both
  const result = dedupByCanonicalArxivId(items);
  assert.strictEqual(result.length, 2);
});

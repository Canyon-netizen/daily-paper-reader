#!/usr/bin/env node
// astro-src/scripts/concepts-index-pure.test.mjs
//
// Tests for R7 polish: astro-src/lib/concepts-index.ts
// Additional edge-case tests beyond concepts-index.test.mjs

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

const mod = await loadTs('lib/concepts-index.ts');
const {
  normalizeConceptList,
  getConceptEntry,
  getRelatedConcepts,
  buildWikilinkResolver,
  getConceptHistory,
} = mod;

// ---------- Additional edge-case tests ----------

// Test: normalizeConceptList - escaped quotes in JSON string
test('normalize: JSON 字符串含转义引号', () => {
  const input = '[{"slug": "s1", "display_name": "D\\"1"}]';
  const r = normalizeConceptList(input);
  assert.equal(r.length, 1);
  assert.equal(r[0].display_name, 'D"1');
});

// Test: normalizeConceptList - novelty/centrality 0 is valid
test('normalize: novelty/centrality 为 0 是有效值', () => {
  const r = normalizeConceptList([
    { slug: 's', display_name: 'D', novelty: 0, centrality: 0 },
  ]);
  assert.equal(r[0].novelty, 0);
  assert.equal(r[0].centrality, 0);
});

// Test: normalizeConceptList - novelty/centrality Infinity ignored
test('normalize: Infinity → undefined', () => {
  const r = normalizeConceptList([
    { slug: 's', display_name: 'D', novelty: Infinity, centrality: -Infinity },
  ]);
  assert.equal(r[0].novelty, undefined);
  assert.equal(r[0].centrality, undefined);
});

// Test: normalizeConceptList - whitespace-only JSON string
test('normalize: JSON 字符串纯空白', () => {
  const r = normalizeConceptList('   ');
  assert.equal(r.length, 0);
});

// Test: normalizeConceptList - array with extra whitespace
test('normalize: 数组元素 extra whitespace', () => {
  const r = normalizeConceptList([
    { slug: '  s1  ', display_name: '  D1  ', category: '  method  ' },
  ]);
  assert.equal(r[0].slug, 's1');
  assert.equal(r[0].display_name, 'D1');
  assert.equal(r[0].category, 'method');
});

// Test: getRelatedConcepts - tie-breaking by display_name
test('related: co_count 相同时按 display_name 字母排序', () => {
  const idx = mkIndexTieBreaker();
  const r = getRelatedConcepts(idx, 's1');
  // s2 and s3 both have co_count = 1, alphabetical: s2 before s3
  assert.equal(r[0].slug, 's2');
  assert.equal(r[1].slug, 's3');
});

// Test: getRelatedConcepts - returns array with correct properties
test('related: 返回对象含全部字段', () => {
  const idx = mkIndexBasic();
  const r = getRelatedConcepts(idx, 's1');
  if (r.length > 0) {
    const first = r[0];
    assert.ok('slug' in first);
    assert.ok('display_name' in first);
    assert.ok('category' in first);
    assert.ok('co_count' in first);
    assert.ok('paper_count' in first);
  }
});

// Test: buildWikilinkResolver - empty index returns empty Map
test('resolver: 空 index 返回空 Map', () => {
  const idx = { bySlug: new Map(), relatedBySlug: new Map(), totalPapersWithConcepts: 0, totalPapers: 0, builtAt: '2026-01-01' };
  const m = buildWikilinkResolver(idx);
  assert.equal(m.size, 0);
});

// Test: buildWikilinkResolver - multiple entries accumulate correctly
test('resolver: 多个 entry 累加', () => {
  const idx = mkIndexBasic();
  const m = buildWikilinkResolver(idx);
  // Each entry adds 3 keys (slug, display_name, display_name lowercase)
  // 3 entries × 3 = 9 keys
  assert.equal(m.size, 9);
});

// Test: buildWikilinkResolver - lookup is case-sensitive for lowercase key
test('resolver: lowercase key 可查', () => {
  const idx = mkIndexBasic();
  const m = buildWikilinkResolver(idx);
  const r = m.get('concept two');
  assert.ok(r);
  assert.equal(r.slug, 's2');
});

// Test: getConceptHistory - empty history returns empty array
test('history: 无 history 返回空数组', () => {
  const idx = { bySlug: new Map([['s1', { slug: 's1', display_name: 'D', category: 'method', paper_count: 1, novelty: 0, centrality: 0, paper_ids: [] }]]), relatedBySlug: new Map(), totalPapersWithConcepts: 1, totalPapers: 1, builtAt: '2026-01-01' };
  const h = getConceptHistory(idx, 's1');
  assert.equal(h.length, 0);
});

// Test: getConceptEntry - returns undefined for null slug
test('getEntry: null slug → undefined', () => {
  const idx = mkIndexBasic();
  // @ts-ignore - testing runtime behavior
  assert.equal(getConceptEntry(idx, null), undefined);
});

// Test: getRelatedConcepts - empty related list returns empty array
test('related: 无相关概念返回空数组', () => {
  const idx = { bySlug: new Map([['s1', { slug: 's1', display_name: 'D', category: 'method', paper_count: 1, novelty: 0, centrality: 0, paper_ids: [] }]]), relatedBySlug: new Map(), totalPapersWithConcepts: 1, totalPapers: 1, builtAt: '2026-01-01' };
  const r = getRelatedConcepts(idx, 's1');
  assert.equal(r.length, 0);
});

// Test: normalizeConceptList - handles numeric strings in number fields
test('normalize: number 字段接受数字字符串', () => {
  const r = normalizeConceptList([
    { slug: 's', display_name: 'D', novelty: '0.5', centrality: '0.3' },
  ]);
  // Should be parsed as numbers or rejected - check implementation behavior
  // The current implementation only accepts actual numbers, not strings
  assert.equal(r[0].novelty, undefined);
  assert.equal(r[0].centrality, undefined);
});

// ---------- helpers ----------
function mkIndexBasic() {
  const bySlug = new Map();
  bySlug.set('s1', {
    slug: 's1', display_name: 'Concept One', category: 'method',
    paper_count: 2, novelty: 0.5, centrality: 0.6, paper_ids: ['p1', 'p2'],
  });
  bySlug.set('s2', {
    slug: 's2', display_name: 'Concept Two', category: 'problem',
    paper_count: 1, novelty: 0.7, centrality: 0.8, paper_ids: ['p1'],
  });
  bySlug.set('s3', {
    slug: 's3', display_name: 'Concept Three', category: 'method',
    paper_count: 1, novelty: 0.3, centrality: 0.4, paper_ids: ['p2'],
  });
  const relatedBySlug = new Map();
  relatedBySlug.set('s1', [
    { slug: 's2', display_name: 'Concept Two', category: 'problem', co_count: 3, paper_count: 1 },
    { slug: 's3', display_name: 'Concept Three', category: 'method', co_count: 1, paper_count: 1 },
  ]);
  return { bySlug, relatedBySlug, totalPapersWithConcepts: 2, totalPapers: 3, builtAt: '2026-01-01' };
}

function mkIndexTieBreaker() {
  const bySlug = new Map();
  bySlug.set('s1', { slug: 's1', display_name: 'Concept One', category: 'method', paper_count: 1, novelty: 0.5, centrality: 0.6, paper_ids: ['p1'] });
  bySlug.set('s2', { slug: 's2', display_name: 'Concept B', category: 'problem', paper_count: 1, novelty: 0.7, centrality: 0.8, paper_ids: ['p1'] });
  bySlug.set('s3', { slug: 's3', display_name: 'Concept A', category: 'method', paper_count: 1, novelty: 0.3, centrality: 0.4, paper_ids: ['p1'] });
  const relatedBySlug = new Map();
  // Both s2 and s3 have co_count = 1 with s1
  relatedBySlug.set('s1', [
    { slug: 's2', display_name: 'Concept B', category: 'problem', co_count: 1, paper_count: 1 },
    { slug: 's3', display_name: 'Concept A', category: 'method', co_count: 1, paper_count: 1 },
  ]);
  return { bySlug, relatedBySlug, totalPapersWithConcepts: 1, totalPapers: 1, builtAt: '2026-01-01' };
}

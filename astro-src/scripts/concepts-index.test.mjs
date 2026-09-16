#!/usr/bin/env node
// astro-src/scripts/concepts-index.test.mjs
//
// Tests for R7 polish: astro-src/lib/concepts-index.ts concept index builder helpers.

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
    external: [
      'node:*',
      './concept-disk.mjs',
      '../concept-disk.mjs',
      './concepts/version',
      '../concepts/version',
    ],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/concepts-index.ts');
const {
  normalizeConceptList,
  buildWikilinkResolver,
  getConceptEntry,
  getRelatedConcepts,
} = mod;

test('normalizeConceptList: undefined → []', () => {
  assert.deepEqual(normalizeConceptList(undefined), []);
});

test('normalizeConceptList: 空数组', () => {
  assert.deepEqual(normalizeConceptList([]), []);
});

test('normalizeConceptList: 对象数组 → ConceptRef[]', () => {
  const out = normalizeConceptList([
    { slug: 'foo', display_name: 'Foo' },
    { slug: 'bar', display_name: 'Bar', category: 'method', novelty: 0.8, centrality: 0.5 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].slug, 'foo');
  assert.equal(out[0].category, 'other'); // 默认值
  assert.equal(out[1].category, 'method');
  assert.equal(out[1].novelty, 0.8);
});

test('normalizeConceptList: JSON-encoded 字符串', () => {
  const out = normalizeConceptList('[{"slug":"x","display_name":"X"}]');
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'x');
});

test('normalizeConceptList: 空字符串 → []', () => {
  assert.deepEqual(normalizeConceptList(''), []);
  assert.deepEqual(normalizeConceptList('   '), []);
});

test('normalizeConceptList: 非法 JSON → []', () => {
  assert.deepEqual(normalizeConceptList('not json'), []);
});

test('normalizeConceptList: 缺 slug / display_name 跳过', () => {
  const out = normalizeConceptList([
    { slug: 'good', display_name: 'G' },
    { slug: '', display_name: 'No slug' },
    { slug: 'no-name' }, // 无 display_name
    null,
    'string item',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'good');
});

test('normalizeConceptList: 同 paper 内去重', () => {
  const out = normalizeConceptList([
    { slug: 'dup', display_name: 'Dup' },
    { slug: 'dup', display_name: 'Dup again' },
  ]);
  assert.equal(out.length, 1);
});

test('normalizeConceptList: novelty/centrality 非 number 时 undefined', () => {
  const out = normalizeConceptList([
    { slug: 'x', display_name: 'X', novelty: 'NaN', centrality: null },
  ]);
  assert.equal(out[0].novelty, undefined);
  assert.equal(out[0].centrality, undefined);
});

test('normalizeConceptList: trim slug/display_name/category', () => {
  const out = normalizeConceptList([
    { slug: '  trimmed  ', display_name: '  Name  ', category: '  method  ' },
  ]);
  assert.equal(out[0].slug, 'trimmed');
  assert.equal(out[0].display_name, 'Name');
  assert.equal(out[0].category, 'method');
});

test('buildWikilinkResolver: 3 keys per entry (slug / display / lower)', () => {
  const index = {
    bySlug: new Map([
      ['foo', { slug: 'foo', display_name: 'Foo Display', category: 'x', paper_count: 1, novelty: 0, centrality: 0, paper_ids: [] }],
    ]),
    relatedBySlug: new Map(),
    totalPapers: 1,
    totalPapersWithConcepts: 1,
    builtAt: '2025-01-01',
  };
  const resolver = buildWikilinkResolver(index);
  // slug 'foo' + display 'Foo Display' + lower 'foo display' = 3 distinct keys
  assert.equal(resolver.size, 3);
  assert.ok(resolver.has('foo'));
  assert.ok(resolver.has('Foo Display'));
  assert.ok(resolver.has('foo display'));
});

test('getConceptEntry: 找到', () => {
  const index = {
    bySlug: new Map([['x', { slug: 'x', display_name: 'X', category: 'c', paper_count: 1, novelty: 0, centrality: 0, paper_ids: [] }]]),
    relatedBySlug: new Map(),
    totalPapers: 1,
    totalPapersWithConcepts: 1,
    builtAt: '',
  };
  const entry = getConceptEntry(index, 'x');
  assert.ok(entry);
  assert.equal(entry.slug, 'x');
});

test('getConceptEntry: 找不到 → undefined', () => {
  const index = { bySlug: new Map(), relatedBySlug: new Map(), totalPapers: 0, totalPapersWithConcepts: 0, builtAt: '' };
  assert.equal(getConceptEntry(index, 'missing'), undefined);
});

test('getRelatedConcepts: 找到', () => {
  const related = [{ slug: 'a', display_name: 'A', category: 'x', co_count: 3, paper_count: 2 }];
  const index = {
    bySlug: new Map(),
    relatedBySlug: new Map([['x', related]]),
    totalPapers: 1,
    totalPapersWithConcepts: 1,
    builtAt: '',
  };
  const out = getRelatedConcepts(index, 'x');
  assert.deepEqual(out, related);
});

test('getRelatedConcepts: 找不到 → []', () => {
  const index = { bySlug: new Map(), relatedBySlug: new Map(), totalPapers: 0, totalPapersWithConcepts: 0, builtAt: '' };
  assert.deepEqual(getRelatedConcepts(index, 'unknown'), []);
});

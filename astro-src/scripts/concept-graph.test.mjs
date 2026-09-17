#!/usr/bin/env node
// astro-src/scripts/concept-graph.test.mjs
//
// Tests for R7 polish: astro-src/lib/concept_graph.ts.
// loadConceptIndex + searchConcepts + sortConceptsByHeat。

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
    external: ['node:*'],
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/concept_graph.ts');
const {
  loadConceptIndex,
  searchConcepts,
  sortConceptsByHeat,
} = mod;

const mkConcept = (overrides) => ({
  slug: 'foo',
  display_name: 'Foo',
  category: 'ml',
  paper_count: 5,
  ...overrides,
});

// mock fetch
function mkFetch(impl) {
  return async (url) => impl(url);
}

// ---------- loadConceptIndex ----------
test('loadConceptIndex: ok → 返回数组', async () => {
  const data = [mkConcept({ slug: 'a' }), mkConcept({ slug: 'b' })];
  const r = await loadConceptIndex('/', mkFetch(async () => ({
    ok: true,
    json: async () => data,
  })));
  assert.equal(r.length, 2);
  assert.equal(r[0].slug, 'a');
});

test('loadConceptIndex: 非 ok → []', async () => {
  const r = await loadConceptIndex('/', mkFetch(async () => ({ ok: false, json: async () => [] })));
  assert.deepEqual(r, []);
});

test('loadConceptIndex: 404 → []', async () => {
  const r = await loadConceptIndex('/', mkFetch(async () => ({ ok: false, status: 404, json: async () => null })));
  assert.deepEqual(r, []);
});

test('loadConceptIndex: 抛出 → []', async () => {
  const r = await loadConceptIndex('/', mkFetch(async () => { throw new Error('network'); }));
  assert.deepEqual(r, []);
});

test('loadConceptIndex: JSON 非数组 → []', async () => {
  const r = await loadConceptIndex('/', mkFetch(async () => ({
    ok: true,
    json: async () => ({ foo: 'bar' }),
  })));
  assert.deepEqual(r, []);
});

test('loadConceptIndex: {concepts: [...]} → 返回内层', async () => {
  const r = await loadConceptIndex('/', mkFetch(async () => ({
    ok: true,
    json: async () => ({ concepts: [mkConcept({ slug: 'a' })] }),
  })));
  assert.equal(r.length, 1);
});

test('loadConceptIndex: null JSON → []', async () => {
  const r = await loadConceptIndex('/', mkFetch(async () => ({
    ok: true,
    json: async () => null,
  })));
  assert.deepEqual(r, []);
});

test('loadConceptIndex: baseUrl 末尾 / 被去掉', async () => {
  let capturedUrl = '';
  await loadConceptIndex('/base/', mkFetch(async (u) => {
    capturedUrl = u;
    return { ok: false, json: async () => [] };
  }));
  // 去掉末尾 /
  assert.equal(capturedUrl, '/base/wiki/concepts/_index.json');
});

test('loadConceptIndex: baseUrl 无末尾 / → 保留', async () => {
  let capturedUrl = '';
  await loadConceptIndex('/base', mkFetch(async (u) => {
    capturedUrl = u;
    return { ok: false, json: async () => [] };
  }));
  assert.equal(capturedUrl, '/base/wiki/concepts/_index.json');
});

// ---------- searchConcepts ----------
test('searchConcepts: 空查询 → 全部', () => {
  const all = [mkConcept({ slug: 'a' }), mkConcept({ slug: 'b' })];
  assert.equal(searchConcepts('', all).length, 2);
});

test('searchConcepts: undefined 查询 → 全部', () => {
  const all = [mkConcept()];
  assert.equal(searchConcepts(undefined, all).length, 1);
});

test('searchConcepts: trim 查询', () => {
  const all = [mkConcept({ display_name: 'Transformer' })];
  const r = searchConcepts('  Transformer  ', all);
  assert.equal(r.length, 1);
});

test('searchConcepts: display_name 匹配', () => {
  const all = [
    mkConcept({ slug: 'a', display_name: 'Transformer' }),
    mkConcept({ slug: 'b', display_name: 'RNN' }),
  ];
  const r = searchConcepts('transformer', all);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'a');
});

test('searchConcepts: slug 匹配', () => {
  const all = [mkConcept({ slug: 'transformer' })];
  const r = searchConcepts('trans', all);
  assert.equal(r.length, 1);
});

test('searchConcepts: category 匹配', () => {
  const all = [mkConcept({ category: 'attention' })];
  const r = searchConcepts('att', all);
  assert.equal(r.length, 1);
});

test('searchConcepts: 大小写不敏感', () => {
  const all = [mkConcept({ display_name: 'Transformer' })];
  const r = searchConcepts('TRANS', all);
  assert.equal(r.length, 1);
});

test('searchConcepts: 不匹配 → []', () => {
  const all = [mkConcept({ display_name: 'Foo' })];
  assert.deepEqual(searchConcepts('bar', all), []);
});

test('searchConcepts: 多匹配', () => {
  const all = [
    mkConcept({ slug: 'a', display_name: 'Transformer-X' }),
    mkConcept({ slug: 'b', display_name: 'Transformer-Y' }),
    mkConcept({ slug: 'c', display_name: 'RNN' }),
  ];
  const r = searchConcepts('transformer', all);
  assert.equal(r.length, 2);
});

test('searchConcepts: 缺字段视为空串', () => {
  // 没有 display_name/slug/category → (''.toLowerCase()).includes('foo') = false
  const all = [mkConcept({ display_name: undefined, slug: undefined, category: undefined })];
  assert.equal(searchConcepts('foo', all).length, 0);
});

// ---------- sortConceptsByHeat ----------
test('sortConceptsByHeat: 按 paper_count 降序', () => {
  const r = sortConceptsByHeat([
    mkConcept({ slug: 'a', paper_count: 1 }),
    mkConcept({ slug: 'b', paper_count: 10 }),
    mkConcept({ slug: 'c', paper_count: 5 }),
  ]);
  assert.deepEqual(r.map((c) => c.slug), ['b', 'c', 'a']);
});

test('sortConceptsByHeat: 同 paper_count → 按 display_name localeCompare', () => {
  const r = sortConceptsByHeat([
    mkConcept({ slug: 'z', display_name: 'Zeta', paper_count: 5 }),
    mkConcept({ slug: 'a', display_name: 'Alpha', paper_count: 5 }),
  ]);
  assert.deepEqual(r.map((c) => c.slug), ['a', 'z']);
});

test('sortConceptsByHeat: 缺 paper_count 当 0', () => {
  const r = sortConceptsByHeat([
    mkConcept({ slug: 'a', paper_count: undefined, display_name: 'A' }),
    mkConcept({ slug: 'b', paper_count: 1 }),
  ]);
  assert.equal(r[0].slug, 'b');
});

test('sortConceptsByHeat: 缺 display_name 用空串排序', () => {
  const r = sortConceptsByHeat([
    mkConcept({ slug: 'a', paper_count: 5, display_name: undefined }),
    mkConcept({ slug: 'b', paper_count: 5, display_name: '' }),
  ]);
  // 两个 display_name 都空 → 相等 → 顺序保留
  assert.equal(r.length, 2);
});

test('sortConceptsByHeat: 不修改输入', () => {
  const all = [mkConcept({ slug: 'a', paper_count: 1 }), mkConcept({ slug: 'b', paper_count: 10 })];
  const before = JSON.parse(JSON.stringify(all));
  sortConceptsByHeat(all);
  assert.deepEqual(all, before);
});

test('sortConceptsByHeat: 空数组', () => {
  assert.deepEqual(sortConceptsByHeat([]), []);
});
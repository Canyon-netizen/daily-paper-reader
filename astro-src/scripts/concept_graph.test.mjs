#!/usr/bin/env node
// astro-src/scripts/concept_graph.test.mjs
//
// Tests for R7 polish: astro-src/lib/concept_graph.ts.
// loadConceptIndex (fetch /wiki/concepts/_index.json → ConceptMeta[]) +
// searchConcepts (fuzzy 匹配 display_name/slug/category) +
// sortConceptsByHeat (paper_count desc, display_name asc 兜底)。

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

const mod = await loadTs('lib/concept_graph.ts');
const { loadConceptIndex, searchConcepts, sortConceptsByHeat } = mod;

const mkMeta = (overrides = {}) => ({
  slug: 's1',
  display_name: 'S1',
  category: 'method',
  paper_count: 1,
  ...overrides,
});

// ---------- loadConceptIndex ---
test('load: 数组形式', async () => {
  const data = [mkMeta({ slug: 's1' }), mkMeta({ slug: 's2' })];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => data,
  });
  const r = await loadConceptIndex('/', fetchImpl);
  assert.equal(r.length, 2);
});

test('load: {concepts:[]} 形式', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ concepts: [mkMeta()] }),
  });
  const r = await loadConceptIndex('/', fetchImpl);
  assert.equal(r.length, 1);
});

test('load: 404 → []', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => null });
  const r = await loadConceptIndex('/', fetchImpl);
  assert.deepEqual(r, []);
});

test('load: fetch throw → []', async () => {
  const fetchImpl = async () => { throw new Error('network'); };
  const r = await loadConceptIndex('/', fetchImpl);
  assert.deepEqual(r, []);
});

test('load: 非数组非 {concepts:[]} → []', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => 'random string',
  });
  const r = await loadConceptIndex('/', fetchImpl);
  assert.deepEqual(r, []);
});

test('load: null → []', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => null,
  });
  const r = await loadConceptIndex('/', fetchImpl);
  assert.deepEqual(r, []);
});

test('load: baseUrl 末尾 / 去除', async () => {
  let calledUrl = null;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: false, json: async () => null };
  };
  await loadConceptIndex('/base/', fetchImpl);
  // baseUrl.replace(/\/$/, "") → /base
  assert.equal(calledUrl, '/base/wiki/concepts/_index.json');
});

test('load: baseUrl 无 /', async () => {
  let calledUrl = null;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: false, json: async () => null };
  };
  await loadConceptIndex('/base', fetchImpl);
  assert.equal(calledUrl, '/base/wiki/concepts/_index.json');
});

// ---------- searchConcepts ---
test('search: 空 query → 返回 all', () => {
  const all = [mkMeta({ slug: 's1' }), mkMeta({ slug: 's2' })];
  assert.equal(searchConcepts('', all).length, 2);
});

test('search: 纯空白 query → 返回 all', () => {
  const all = [mkMeta()];
  assert.equal(searchConcepts('   ', all).length, 1);
});

test('search: undefined query → 返回 all', () => {
  const all = [mkMeta()];
  assert.equal(searchConcepts(undefined, all).length, 1);
});

test('search: 匹配 display_name', () => {
  const all = [
    mkMeta({ slug: 'transformer', display_name: 'Transformer' }),
    mkMeta({ slug: 'cnn', display_name: 'CNN' }),
  ];
  const r = searchConcepts('trans', all);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'transformer');
});

test('search: 匹配 slug', () => {
  const all = [
    mkMeta({ slug: 'transformer', display_name: 'X' }),
    mkMeta({ slug: 'cnn', display_name: 'Y' }),
  ];
  const r = searchConcepts('trans', all);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'transformer');
});

test('search: 匹配 category', () => {
  const all = [
    mkMeta({ slug: 'a', display_name: 'A', category: 'method' }),
    mkMeta({ slug: 'b', display_name: 'B', category: 'problem' }),
  ];
  const r = searchConcepts('meth', all);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 'a');
});

test('search: 大小写不敏感', () => {
  const all = [mkMeta({ display_name: 'TRANSFORMER' })];
  assert.equal(searchConcepts('trans', all).length, 1);
});

test('search: 不匹配 → []', () => {
  const all = [mkMeta({ display_name: 'X', slug: 'y', category: 'z' })];
  assert.equal(searchConcepts('nothing', all).length, 0);
});

test('search: 部分匹配', () => {
  const all = [mkMeta({ display_name: 'Reinforcement Learning' })];
  assert.equal(searchConcepts('force', all).length, 1);
});

test('search: query trim', () => {
  const all = [mkMeta({ display_name: 'X' })];
  assert.equal(searchConcepts('  X  ', all).length, 1);
});

test('search: 空 all → []', () => {
  assert.equal(searchConcepts('foo', []).length, 0);
});

test('search: display_name 缺 → 不抛', () => {
  const all = [{ slug: 's1', category: 'method', paper_count: 1 }];
  assert.equal(searchConcepts('method', all).length, 1);
});

// ---------- sortConceptsByHeat ---
test('sort: 按 paper_count desc', () => {
  const r = sortConceptsByHeat([
    mkMeta({ slug: 'a', paper_count: 1 }),
    mkMeta({ slug: 'b', paper_count: 5 }),
    mkMeta({ slug: 'c', paper_count: 3 }),
  ]);
  assert.equal(r[0].slug, 'b');
  assert.equal(r[1].slug, 'c');
  assert.equal(r[2].slug, 'a');
});

test('sort: paper_count 同 → display_name asc 兜底', () => {
  const r = sortConceptsByHeat([
    mkMeta({ slug: 'z', display_name: 'Z', paper_count: 1 }),
    mkMeta({ slug: 'a', display_name: 'A', paper_count: 1 }),
  ]);
  assert.equal(r[0].slug, 'a');
  assert.equal(r[1].slug, 'z');
});

test('sort: 不修改原数组', () => {
  const orig = [
    mkMeta({ slug: 'a', paper_count: 1 }),
    mkMeta({ slug: 'b', paper_count: 5 }),
  ];
  sortConceptsByHeat(orig);
  assert.equal(orig[0].slug, 'a'); // 原顺序
});

test('sort: 空数组 → []', () => {
  assert.deepEqual(sortConceptsByHeat([]), []);
});

test('sort: paper_count 缺 → 0', () => {
  const r = sortConceptsByHeat([
    mkMeta({ slug: 'a', paper_count: 3 }),
    mkMeta({ slug: 'b' }), // 缺 → 0
  ]);
  assert.equal(r[0].slug, 'a');
});

test('sort: display_name 缺 → "" 兜底', () => {
  const r = sortConceptsByHeat([
    mkMeta({ slug: 'b', display_name: 'B', paper_count: 1 }),
    { slug: 'a', display_name: undefined, paper_count: 1 }, // display_name undefined
  ]);
  // "" < "B" → a 在前
  assert.equal(r[0].slug, 'a');
});

// ---------- 集成 ---
test('集成: load → search → sort', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      mkMeta({ slug: 'transformer', display_name: 'Transformer', paper_count: 10 }),
      mkMeta({ slug: 'cnn', display_name: 'CNN', paper_count: 5 }),
      mkMeta({ slug: 'rnn', display_name: 'RNN', paper_count: 3 }),
    ],
  });
  const all = await loadConceptIndex('/', fetchImpl);
  const searched = searchConcepts('trans', all);
  const sorted = sortConceptsByHeat(searched);
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].slug, 'transformer');
});

test('集成: search 不匹配 → 0 结果', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [mkMeta({ display_name: 'X' })],
  });
  const all = await loadConceptIndex('/', fetchImpl);
  const r = searchConcepts('nothing', all);
  assert.equal(r.length, 0);
});
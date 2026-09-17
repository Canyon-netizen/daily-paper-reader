#!/usr/bin/env node
// astro-src/scripts/agents-candidates.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/candidates.ts.
// buildCandidatesFromLibrary (从 paperIds 构造 candidate 列表,maxPapers 截断,skipMissing 跳过)。

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

const mod = await loadTs('lib/agents/candidates.ts');
const { buildCandidatesFromLibrary } = mod;

const mkLib = (paperIds) => ({ paperIds });

const mkLookup = (map) => (id) => Promise.resolve(map[id] || null);

// ---------- 基本流程 ---
test('buildCandidatesFromLibrary: 单 paper', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({ '1': { title: 'Paper One' } }),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, '1');
  assert.equal(r[0].title, 'Paper One');
});

test('buildCandidatesFromLibrary: 多 papers', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1', '2', '3']),
    mkLookup({
      '1': { title: 'A' },
      '2': { title: 'B' },
      '3': { title: 'C' },
    }),
  );
  assert.equal(r.length, 3);
});

test('buildCandidatesFromLibrary: 保留 library 顺序', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['c', 'a', 'b']),
    mkLookup({ a: { title: 'A' }, b: { title: 'B' }, c: { title: 'C' } }),
  );
  assert.equal(r[0].arxivId, 'c');
  assert.equal(r[1].arxivId, 'a');
  assert.equal(r[2].arxivId, 'b');
});

// ---------- 标题优先级 ---
test('buildCandidatesFromLibrary: 优先 title_zh', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({ '1': { title: 'English', title_zh: '中文' } }),
  );
  assert.equal(r[0].title, '中文');
});

test('buildCandidatesFromLibrary: 缺 title_zh → fallback title', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({ '1': { title: 'English' } }),
  );
  assert.equal(r[0].title, 'English');
});

test('buildCandidatesFromLibrary: 缺 title → 用 id', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['abc']),
    mkLookup({ abc: {} }),
  );
  assert.equal(r[0].title, 'abc');
});

// ---------- tldr ---
test('buildCandidatesFromLibrary: tldr 透传', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({ '1': { title: 'A', tldr: 'summary' } }),
  );
  assert.equal(r[0].tldr, 'summary');
});

test('buildCandidatesFromLibrary: 优先 tldr_zh', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({ '1': { title: 'A', tldr: 'en', tldr_zh: 'zh' } }),
  );
  assert.equal(r[0].tldr, 'zh');
});

test('buildCandidatesFromLibrary: 缺 tldr → 字段不存在', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({ '1': { title: 'A' } }),
  );
  assert.equal(r[0].tldr, undefined);
});

// ---------- 缺失 paper ---
test('buildCandidatesFromLibrary: 缺失 → 占位 "(missing) id"', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    mkLookup({}),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '(missing) 1');
});

test('buildCandidatesFromLibrary: skipMissing → 完全跳过', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1', '2']),
    mkLookup({ '1': { title: 'A' } }),
    { skipMissing: true },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, '1');
});

test('buildCandidatesFromLibrary: lookup 抛错 → 走缺失路径', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    () => { throw new Error('boom'); },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '(missing) 1');
});

test('buildCandidatesFromLibrary: lookup 返回 null → 走缺失路径', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    () => null,
  );
  assert.equal(r[0].title, '(missing) 1');
});

test('buildCandidatesFromLibrary: lookup 返回 Promise<null>', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1']),
    async () => null,
  );
  assert.equal(r[0].title, '(missing) 1');
});

// ---------- maxPapers 截断 ---
test('buildCandidatesFromLibrary: maxPapers 截断', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['1', '2', '3', '4', '5']),
    mkLookup({ '1': { title: 'A' }, '2': { title: 'B' } }),
    { maxPapers: 2 },
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].arxivId, '1');
  assert.equal(r[1].arxivId, '2');
});

test('buildCandidatesFromLibrary: 默认 max=30', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `id${i}`);
  const r = await buildCandidatesFromLibrary(
    mkLib(ids),
    mkLookup({}),
  );
  assert.equal(r.length, 30);
});

test('buildCandidatesFromLibrary: maxPapers=Infinity 全部返回', async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
  const r = await buildCandidatesFromLibrary(
    mkLib(ids),
    mkLookup({}),
    { maxPapers: 1000 },
  );
  assert.equal(r.length, 100);
});

// ---------- 边界 ---
test('buildCandidatesFromLibrary: 空 paperIds → 空', async () => {
  const r = await buildCandidatesFromLibrary(mkLib([]), mkLookup({}));
  assert.deepEqual(r, []);
});

test('buildCandidatesFromLibrary: 缺 paperIds → 空', async () => {
  const r = await buildCandidatesFromLibrary({}, mkLookup({}));
  assert.deepEqual(r, []);
});

test('buildCandidatesFromLibrary: library null → 空', async () => {
  const r = await buildCandidatesFromLibrary(null, mkLookup({}));
  assert.deepEqual(r, []);
});

// ---------- 异步 lookup ---
test('buildCandidatesFromLibrary: lookup 可 async', async () => {
  const lookup = async (id) => {
    await new Promise((r) => setTimeout(r, 0));
    return { title: `T-${id}` };
  };
  const r = await buildCandidatesFromLibrary(mkLib(['a', 'b']), lookup);
  assert.equal(r[0].title, 'T-a');
  assert.equal(r[1].title, 'T-b');
});

test('buildCandidatesFromLibrary: lookup 可 sync', async () => {
  const lookup = (id) => ({ title: `T-${id}` });
  const r = await buildCandidatesFromLibrary(mkLib(['a']), lookup);
  assert.equal(r[0].title, 'T-a');
});

// ---------- 综合 ---
test('集成: 混合 (含/缺 tldr/缺失)', async () => {
  const r = await buildCandidatesFromLibrary(
    mkLib(['a', 'b', 'c', 'd']),
    mkLookup({
      a: { title: 'A', tldr: 'sum A' },
      b: { title: 'B' },
      c: { title: 'C', title_zh: 'C-zh', tldr_zh: 't-zh' },
    }),
  );
  assert.equal(r.length, 4);
  assert.equal(r[0].tldr, 'sum A');
  assert.equal(r[1].tldr, undefined);
  assert.equal(r[2].title, 'C-zh');
  assert.equal(r[2].tldr, 't-zh');
  assert.equal(r[3].title, '(missing) d');
});
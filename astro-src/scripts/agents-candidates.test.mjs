#!/usr/bin/env node
// astro-src/scripts/agents-candidates.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/candidates.ts buildCandidatesFromLibrary.

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
    external: ['../user-libraries/types', '../../user-libraries/types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/candidates.ts');
const { buildCandidatesFromLibrary } = mod;

const fakeLookup = (meta) => (id) => meta[id] || null;

test('buildCandidatesFromLibrary: 空 library → []', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: [] },
    fakeLookup({}),
  );
  assert.deepEqual(r, []);
});

test('buildCandidatesFromLibrary: undefined library → []', async () => {
  const r = await buildCandidatesFromLibrary(undefined, fakeLookup({}));
  assert.deepEqual(r, []);
});

test('buildCandidatesFromLibrary: 单论文', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1'] },
    fakeLookup({ p1: { title: 'Title 1' } }),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, 'p1');
  assert.equal(r[0].title, 'Title 1');
});

test('buildCandidatesFromLibrary: title_zh 优先于 title', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1'] },
    fakeLookup({ p1: { title: 'En', title_zh: '中文' } }),
  );
  assert.equal(r[0].title, '中文');
});

test('buildCandidatesFromLibrary: tldr_zh 优先于 tldr', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1'] },
    fakeLookup({ p1: { title: 'X', tldr: 'en', tldr_zh: '中' } }),
  );
  assert.equal(r[0].tldr, '中');
});

test('buildCandidatesFromLibrary: tldr 缺 → 不写入', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1'] },
    fakeLookup({ p1: { title: 'X' } }),
  );
  assert.equal(r[0].tldr, undefined);
});

test('buildCandidatesFromLibrary: 顺序 = paperIds 原序', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['c', 'a', 'b'] },
    fakeLookup({
      a: { title: 'A' }, b: { title: 'B' }, c: { title: 'C' },
    }),
  );
  assert.deepEqual(r.map((c) => c.arxivId), ['c', 'a', 'b']);
});

test('buildCandidatesFromLibrary: 默认 maxPapers=30', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => 'p' + i);
  const lookup = fakeLookup(Object.fromEntries(ids.map((id) => [id, { title: id }])));
  const r = await buildCandidatesFromLibrary({ paperIds: ids }, lookup);
  assert.equal(r.length, 30);
});

test('buildCandidatesFromLibrary: 自定义 maxPapers', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => 'p' + i);
  const lookup = fakeLookup(Object.fromEntries(ids.map((id) => [id, { title: id }])));
  const r = await buildCandidatesFromLibrary({ paperIds: ids }, lookup, { maxPapers: 3 });
  assert.equal(r.length, 3);
});

test('buildCandidatesFromLibrary: skipMissing=true 跳过缺失', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1', 'p-missing', 'p2'] },
    fakeLookup({ p1: { title: 'A' }, p2: { title: 'B' } }),
    { skipMissing: true },
  );
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((c) => c.arxivId), ['p1', 'p2']);
});

test('buildCandidatesFromLibrary: skipMissing=false (默认) → "(missing) <id>"', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p-missing'] },
    fakeLookup({}),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '(missing) p-missing');
});

test('buildCandidatesFromLibrary: lookup throw → skipMissing=true 跳过', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1', 'p2'] },
    async (id) => {
      if (id === 'p2') throw new Error('boom');
      return { title: 'A' };
    },
    { skipMissing: true },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].arxivId, 'p1');
});

test('buildCandidatesFromLibrary: lookup throw + skipMissing=false → 兜底', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p-bad'] },
    async () => { throw new Error('boom'); },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '(missing) p-bad');
});

test('buildCandidatesFromLibrary: 论文无 title/title_zh → 用 id 当 title', async () => {
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1'] },
    fakeLookup({ p1: {} }),
  );
  assert.equal(r[0].title, 'p1');
});

test('buildCandidatesFromLibrary: 同步 lookup (非 Promise) 也支持', async () => {
  // PaperLookup 接受 sync 或 async
  const r = await buildCandidatesFromLibrary(
    { paperIds: ['p1'] },
    (id) => ({ title: 'sync-' + id }),
  );
  assert.equal(r[0].title, 'sync-p1');
});

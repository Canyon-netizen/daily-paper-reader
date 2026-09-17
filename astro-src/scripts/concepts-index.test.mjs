#!/usr/bin/env node
// astro-src/scripts/concepts-index.test.mjs
//
// Tests for R7 polish: astro-src/lib/concepts-index.ts.
// normalizeConceptList (宽容 JSON 解析 + 去重) +
// getConceptEntry / getRelatedConcepts / buildWikilinkResolver /
// getConceptHistory (从 index 派生)。

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

// ---------- normalizeConceptList ---
test('normalize: 直接数组', () => {
  const r = normalizeConceptList([
    { slug: 's1', display_name: 'D1', category: 'method' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, 's1');
  assert.equal(r[0].display_name, 'D1');
});

test('normalize: JSON 字符串', () => {
  const r = normalizeConceptList('[{"slug":"s","display_name":"D"}]');
  assert.equal(r.length, 1);
});

test('normalize: 缺 slug → 跳过', () => {
  const r = normalizeConceptList([
    { display_name: 'D', category: 'method' },
    { slug: 's', display_name: 'D2' },
  ]);
  assert.equal(r.length, 1);
});

test('normalize: 缺 display_name → 跳过', () => {
  const r = normalizeConceptList([{ slug: 's', category: 'method' }]);
  assert.equal(r.length, 0);
});

test('normalize: 非 object 项 → 跳过', () => {
  const r = normalizeConceptList([null, 'string', { slug: 's', display_name: 'D' }]);
  assert.equal(r.length, 1);
});

test('normalize: 重复 slug 同 paper 内去重', () => {
  const r = normalizeConceptList([
    { slug: 's', display_name: 'D1' },
    { slug: 's', display_name: 'D2' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].display_name, 'D1');
});

test('normalize: category 缺 → "other"', () => {
  const r = normalizeConceptList([{ slug: 's', display_name: 'D' }]);
  assert.equal(r[0].category, 'other');
});

test('normalize: novelty/centrality 是 number 透传', () => {
  const r = normalizeConceptList([
    { slug: 's', display_name: 'D', novelty: 0.8, centrality: 0.5 },
  ]);
  assert.equal(r[0].novelty, 0.8);
  assert.equal(r[0].centrality, 0.5);
});

test('normalize: novelty/centrality 缺 → undefined', () => {
  const r = normalizeConceptList([{ slug: 's', display_name: 'D' }]);
  assert.equal(r[0].novelty, undefined);
  assert.equal(r[0].centrality, undefined);
});

test('normalize: novelty NaN → undefined', () => {
  const r = normalizeConceptList([
    { slug: 's', display_name: 'D', novelty: NaN },
  ]);
  assert.equal(r[0].novelty, undefined);
});

test('normalize: 字符串坏 JSON → []', () => {
  const r = normalizeConceptList('not json{');
  assert.equal(r.length, 0);
});

test('normalize: 空字符串 → []', () => {
  assert.equal(normalizeConceptList('').length, 0);
  assert.equal(normalizeConceptList('  ').length, 0);
});

test('normalize: 空数组 → []', () => {
  assert.equal(normalizeConceptList([]).length, 0);
});

test('normalize: trim slug + display_name', () => {
  const r = normalizeConceptList([{ slug: '  s  ', display_name: '  D  ' }]);
  assert.equal(r[0].slug, 's');
  assert.equal(r[0].display_name, 'D');
});

test('normalize: 非 string 数据 → []', () => {
  assert.equal(normalizeConceptList(null).length, 0);
  assert.equal(normalizeConceptList(undefined).length, 0);
  assert.equal(normalizeConceptList(42).length, 0);
});

// ---------- getConceptEntry ---
test('getEntry: 找到', () => {
  const idx = mkIndex();
  const e = getConceptEntry(idx, 's1');
  assert.equal(e.slug, 's1');
});

test('getEntry: 缺 → undefined', () => {
  assert.equal(getConceptEntry(mkIndex(), 'missing'), undefined);
});

// ---------- getRelatedConcepts ---
test('related: 找到', () => {
  const idx = mkIndex();
  const r = getRelatedConcepts(idx, 's1');
  assert.equal(r.length, 2);
});

test('related: 缺 → []', () => {
  assert.equal(getRelatedConcepts(mkIndex(), 'missing').length, 0);
});

test('related: 按 co_count desc 排', () => {
  const idx = mkIndex();
  const r = getRelatedConcepts(idx, 's1');
  assert.equal(r[0].co_count, 3);
  assert.equal(r[1].co_count, 1);
});

// ---------- buildWikilinkResolver ---
test('resolver: slug key', () => {
  const idx = mkIndex();
  const m = buildWikilinkResolver(idx);
  assert.ok(m.has('s1'));
});

test('resolver: display_name key (原样)', () => {
  const idx = mkIndex();
  const m = buildWikilinkResolver(idx);
  assert.ok(m.has('Concept One'));
});

test('resolver: display_name lowercase key', () => {
  const idx = mkIndex();
  const m = buildWikilinkResolver(idx);
  assert.ok(m.has('concept one'));
});

test('resolver: 返回 { slug, display_name }', () => {
  const idx = mkIndex();
  const m = buildWikilinkResolver(idx);
  const r = m.get('s1');
  assert.equal(r.slug, 's1');
  assert.equal(r.display_name, 'Concept One');
});

// ---------- getConceptHistory ---
test('history: 找到', () => {
  const idx = mkIndexWithHistory();
  const h = getConceptHistory(idx, 's1');
  assert.equal(h.length, 1);
});

test('history: 缺 → []', () => {
  const idx = mkIndexWithHistory();
  assert.equal(getConceptHistory(idx, 'missing').length, 0);
});

// ---------- 集成 ---
test('集成: normalize → getEntry', () => {
  const norm = normalizeConceptList([{ slug: 'x', display_name: 'X', category: 'method' }]);
  const idx = mkIndex();
  // 把 normalize 出的 concept 放到 index bySlug
  idx.bySlug.set(norm[0].slug, {
    slug: norm[0].slug,
    display_name: norm[0].display_name,
    category: norm[0].category,
    paper_count: 1,
    novelty: 0,
    centrality: 0,
    paper_ids: [],
  });
  const e = getConceptEntry(idx, 'x');
  assert.equal(e.display_name, 'X');
});

// ---------- helpers ---
function mkIndex() {
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
  return {
    bySlug, relatedBySlug,
    totalPapersWithConcepts: 2, totalPapers: 3,
    builtAt: '2026-01-01',
  };
}

function mkIndexWithHistory() {
  const idx = mkIndex();
  idx.bySlug.get('s1').history = [{ date: '2026-01-01', paper_count: 2 }];
  return idx;
}
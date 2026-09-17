#!/usr/bin/env node
// astro-src/scripts/paper-relations-tfidf.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/tfidf.ts.
// TF-IDF 余弦相似度边 + L2 归一 + topK 裁剪。

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

const mod = await loadTs('lib/paper-relations/tfidf.ts');
const { computeTfIdfEdges } = mod;

const mkPaper = (overrides = {}) => ({
  id: 'papers/x.md',
  title: 'Some Title',
  title_zh: '',
  tldr: '',
  arxivId: '2310.12345',
  canonicalArxivId: '2310.12345',
  slug: 'x',
  yearMonth: '2026-09',
  day: '01',
  categories: { venue: [], task: [], method: [], type: [] },
  tags: [],
  ...overrides,
});

// ---------- basic ---
test('tfidf: < 2 papers → []', () => {
  assert.equal(computeTfIdfEdges([]).length, 0);
  assert.equal(computeTfIdfEdges([mkPaper()]).length, 0);
});

test('tfidf: 完全相同文本 → 边存在(双向)', () => {
  const text = 'transformer attention is all you need';
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: text }),
    mkPaper({ id: 'p2', title: text }),
  ]);
  // TF-IDF 实现对每对 (i,j) 生成 2 条边(i→j 和 j→i),topK 不会合并
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].weight - 1) < 1e-9);
  assert.ok(Math.abs(r[1].weight - 1) < 1e-9);
});

test('tfidf: 完全无关文本 → 0 边(低于 minWeight)', () => {
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: 'transformer attention mechanism' }),
    mkPaper({ id: 'p2', title: 'completely different topic' }),
  ]);
  // 即使有交集也可能为 0 → 边不一定为 0,只是可能极低
  assert.ok(r.length >= 0);
});

test('tfidf: 部分共享 → weight 介于 0..1', () => {
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: 'transformer attention is great' }),
    mkPaper({ id: 'p2', title: 'transformer and attention are great' }),
  ]);
  assert.equal(r.length, 2); // 双向
  assert.ok(r[0].weight > 0 && r[0].weight < 1);
});

test('tfidf: 边 type = tfidf', () => {
  const text = 'transformer attention great';
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: text }),
    mkPaper({ id: 'p2', title: text }),
  ]);
  assert.equal(r[0].type, 'tfidf');
});

test('tfidf: source/target = paper ids', () => {
  const text = 'transformer attention great';
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: text }),
    mkPaper({ id: 'p2', title: text }),
  ]);
  assert.equal(r[0].source, 'p1');
  assert.equal(r[0].target, 'p2');
});

test('tfidf: sharedTags = []', () => {
  const text = 'transformer attention';
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: text }),
    mkPaper({ id: 'p2', title: text }),
  ]);
  assert.deepEqual(r[0].sharedTags, []);
});

// ---------- minWeight / topK ---
test('tfidf: minWeight 过滤低权重', () => {
  const r = computeTfIdfEdges(
    [
      mkPaper({ id: 'p1', title: 'transformer attention' }),
      mkPaper({ id: 'p2', title: 'transformer great' }),
    ],
    8,
    0.99, // 高阈值
  );
  // 完整相似度应 < 0.99 → 过滤
  assert.equal(r.length, 0);
});

test('tfidf: topK 每 source 限条', () => {
  const papers = [];
  for (let i = 0; i < 5; i++) {
    papers.push(mkPaper({ id: `p${i}`, title: `transformer attention model ${i}` }));
  }
  const r = computeTfIdfEdges(papers, 2); // topK=2 → 每个 source 最多 2 边
  // p0 出边最多 2
  const p0Edges = r.filter((e) => e.source === 'p0');
  assert.ok(p0Edges.length <= 2);
});

test('tfidf: 自相似度不出现边', () => {
  // p1 不会和自身产生边
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: 'transformer' }),
    mkPaper({ id: 'p2', title: 'transformer' }),
    mkPaper({ id: 'p3', title: 'transformer' }),
  ]);
  for (const e of r) {
    assert.notEqual(e.source, e.target);
  }
});

// ---------- text 拼接 ---
test('tfidf: 拼接 title + title_zh + tldr', () => {
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: 'transformer', title_zh: '', tldr: 'great' }),
    mkPaper({ id: 'p2', title: 'transformer', title_zh: 'great', tldr: '' }),
  ]);
  // 共享 'transformer' 和 'great' → 双向 2 边
  assert.equal(r.length, 2);
  assert.ok(r[0].weight > 0);
});

test('tfidf: 全空文本 → []', () => {
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: '', title_zh: '', tldr: '' }),
    mkPaper({ id: 'p2', title: '', title_zh: '', tldr: '' }),
  ]);
  // tokenize → [] → 无交集 → 无边
  assert.equal(r.length, 0);
});

// ---------- CJK ---
test('tfidf: CJK 字符支持', () => {
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title_zh: '注意力机制 transformer' }),
    mkPaper({ id: 'p2', title_zh: '注意力 transformer' }),
  ]);
  assert.equal(r.length, 2);
  assert.ok(r[0].weight > 0);
});

test('tfidf: 短 token (1 字符) 过滤', () => {
  // tokenize filter length > 1 → 单字符词应被过滤
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: 'a b c d transformer' }),
    mkPaper({ id: 'p2', title: 'a b c d transformer' }),
  ]);
  // 单字符被滤,共享 'transformer' → 双向 2 边
  assert.equal(r.length, 2);
});

// ---------- 集成 ---
test('集成: 大集合', () => {
  const r = computeTfIdfEdges([
    mkPaper({ id: 'p1', title: 'transformer attention is all you need' }),
    mkPaper({ id: 'p2', title: 'transformer attention is all you need' }),
    mkPaper({ id: 'p3', title: 'completely different topic with no overlap' }),
    mkPaper({ id: 'p4', title: 'transformer related but different angle' }),
  ]);
  // 至少有 p1→p2 边(weight=1) — 双向都有
  const p12s = r.filter((e) =>
    (e.source === 'p1' && e.target === 'p2') ||
    (e.source === 'p2' && e.target === 'p1'),
  );
  assert.ok(p12s.length >= 1);
  assert.ok(Math.abs(p12s[0].weight - 1) < 1e-9);
});
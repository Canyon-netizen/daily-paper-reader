#!/usr/bin/env node
// astro-src/scripts/edges-util.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/edges-util.ts shared edge utilities.

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
    external: ['node:*', './paper-disk.mjs', '../paper-disk.mjs'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/paper-relations/edges-util.ts');
const { buildNodes, topKEdges, tagSet } = mod;

function paper(id, over) {
  return {
    id,
    slug: id,
    title: 'Sample',
    title_zh: '示例',
    date: '2025-01-01',
    yearMonth: '2025-01',
    day: '01',
    arxivId: id,
    canonicalArxivId: id,
    wikiContent: null,
    ...over,
  };
}

test('buildNodes: 映射 id/arxivId/title/tags', () => {
  const nodes = buildNodes([
    paper('a', { categories: { task: ['rl'], method: [], type: [], venue: [] } }),
  ]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, 'a');
  assert.equal(nodes[0].arxivId, 'a');
  assert.equal(nodes[0].title, 'Sample');
  assert.ok(nodes[0].tags.includes('task:rl'));
});

test('buildNodes: title 缺失时回退到 title_zh', () => {
  const nodes = buildNodes([paper('a', { title: '', title_zh: '中文' })]);
  assert.equal(nodes[0].title, '中文');
});

test('buildNodes: 全部缺失时回退到 id', () => {
  const nodes = buildNodes([paper('xyz', { title: '', title_zh: '' })]);
  assert.equal(nodes[0].title, 'xyz');
});

test('buildNodes: 空数组 → []', () => {
  assert.deepEqual(buildNodes([]), []);
});

test('buildNodes: categories 为 null', () => {
  const nodes = buildNodes([paper('a', { categories: null })]);
  assert.deepEqual(nodes[0].tags, []);
});

test('topKEdges: k<=0 不过滤', () => {
  const edges = [
    { source: 'a', target: 'b', weight: 0.5, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'c', weight: 0.3, type: 'jaccard', sharedTags: [] },
  ];
  assert.equal(topKEdges(edges, 0).length, 2);
  assert.equal(topKEdges(edges, -1).length, 2);
});

test('topKEdges: 按 source 分组取 top K weight 降序', () => {
  const edges = [
    { source: 'a', target: 'b', weight: 0.5, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'c', weight: 0.9, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'd', weight: 0.1, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'e', weight: 0.7, type: 'jaccard', sharedTags: [] },
  ];
  const out = topKEdges(edges, 2);
  assert.equal(out.length, 2);
  // top 2 weight:0.9, 0.7
  const targets = out.map((e) => e.target);
  assert.ok(targets.includes('c'));
  assert.ok(targets.includes('e'));
});

test('topKEdges: 多 source 独立裁剪', () => {
  const edges = [
    { source: 'a', target: 'b', weight: 0.5, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'c', weight: 0.4, type: 'jaccard', sharedTags: [] },
    { source: 'd', target: 'e', weight: 0.3, type: 'jaccard', sharedTags: [] },
  ];
  const out = topKEdges(edges, 1);
  assert.equal(out.length, 2);
});

test('topKEdges: 保留每组前 k 条', () => {
  const edges = [
    { source: 'a', target: 'b', weight: 0.1, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'c', weight: 0.2, type: 'jaccard', sharedTags: [] },
    { source: 'a', target: 'd', weight: 0.3, type: 'jaccard', sharedTags: [] },
  ];
  const out = topKEdges(edges, 3);
  assert.equal(out.length, 3);
});

test('topKEdges: 空数组 → []', () => {
  assert.deepEqual(topKEdges([], 5), []);
});

test('tagSet: 拍平 categories 为带 dim 前缀的 Set', () => {
  const p = paper('a', { categories: { task: ['rl', 'cv'], method: [], type: [], venue: ['ICML 2025'] } });
  const set = tagSet(p);
  assert.ok(set.has('task:rl'));
  assert.ok(set.has('task:cv'));
  assert.ok(set.has('venue:ICML 2025'));
});

test('tagSet: null categories → 空 Set', () => {
  const set = tagSet(paper('a', { categories: null }));
  assert.equal(set.size, 0);
});

test('tagSet: categories 缺失某维度不影响', () => {
  const set = tagSet(paper('a', { categories: { task: ['rl'], method: null, type: [], venue: [] } }));
  assert.ok(set.has('task:rl'));
});

test('tagSet: 去重(flattenCategories 已去重)', () => {
  // 即使 task 数组有重复也只算一次
  const set = tagSet(paper('a', { categories: { task: ['rl', 'rl'], method: [], type: [], venue: [] } }));
  assert.equal(set.size, 1);
});
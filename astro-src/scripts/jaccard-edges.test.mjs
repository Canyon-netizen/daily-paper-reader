#!/usr/bin/env node
// astro-src/scripts/jaccard-edges.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-relations/jaccard.ts Jaccard similarity edges.

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
    external: ['node:*', './edges-util.mjs', '../edges-util.mjs', './paper-disk.mjs', '../paper-disk.mjs'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/paper-relations/jaccard.ts');
const { computeJaccardEdges } = mod;

function paper(id, categories) {
  return {
    id,
    slug: id,
    title: 't',
    date: '2025-01-01',
    yearMonth: '2025-01',
    day: '01',
    categories,
    canonicalArxivId: id,
    arxivId: id,
    wikiContent: null,
  };
}

test('computeJaccardEdges: 完全相同 tags → weight=1', () => {
  const papers = [
    paper('a', { task: ['rl'], method: [], type: [], venue: [] }),
    paper('b', { task: ['rl'], method: [], type: [], venue: [] }),
  ];
  const edges = computeJaccardEdges(papers);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].weight, 1);
  assert.equal(edges[0].type, 'jaccard');
  assert.ok(edges[0].sharedTags.includes('task:rl'));
});

test('computeJaccardEdges: 完全不共享 → 无边', () => {
  const papers = [
    paper('a', { task: ['rl'], method: [], type: [], venue: [] }),
    paper('b', { task: ['cv'], method: [], type: [], venue: [] }),
  ];
  const edges = computeJaccardEdges(papers);
  assert.equal(edges.length, 0);
});

test('computeJaccardEdges: 部分共享 → 正确权重', () => {
  // A: {rl, agent}; B: {rl, code} → 交集 {rl}=1, 并集=3 → 1/3
  const papers = [
    paper('a', { task: ['rl', 'agent'], method: [], type: [], venue: [] }),
    paper('b', { task: ['rl', 'code'], method: [], type: [], venue: [] }),
  ];
  const edges = computeJaccardEdges(papers);
  assert.equal(edges.length, 1);
  assert.ok(Math.abs(edges[0].weight - 1 / 3) < 0.001);
});

test('computeJaccardEdges: 无 categories 跳过', () => {
  const papers = [paper('a', null), paper('b', null)];
  assert.equal(computeJaccardEdges(papers).length, 0);
});

test('computeJaccardEdges: minWeight 过滤', () => {
  const papers = [
    paper('a', { task: ['rl', 'agent'], method: [], type: [], venue: [] }),
    paper('b', { task: ['rl', 'code'], method: [], type: [], venue: [] }),
  ];
  // 1/3 < 0.5 → 排除
  assert.equal(computeJaccardEdges(papers, 0.5).length, 0);
  // minWeight=0.1 → 命中
  assert.equal(computeJaccardEdges(papers, 0.1).length, 1);
});

test('computeJaccardEdges: 多对论文', () => {
  const papers = [
    paper('a', { task: ['rl'], method: [], type: [], venue: [] }),
    paper('b', { task: ['rl'], method: [], type: [], venue: [] }),
    paper('c', { task: ['rl'], method: [], type: [], venue: [] }),
  ];
  // 3 个 paper,共 3 对
  const edges = computeJaccardEdges(papers);
  assert.equal(edges.length, 3);
});

test('computeJaccardEdges: 保留数组顺序(source=papers[i])', () => {
  const papers = [
    paper('z', { task: ['rl'], method: [], type: [], venue: [] }),
    paper('a', { task: ['rl'], method: [], type: [], venue: [] }),
  ];
  const edges = computeJaccardEdges(papers);
  // jaccard 不做规范化,直接用 array index:source=papers[0]='z'
  assert.equal(edges[0].source, 'z');
  assert.equal(edges[0].target, 'a');
});

test('computeJaccardEdges: 单论文无 self-edge', () => {
  const papers = [paper('a', { task: ['rl'], method: [], type: [], venue: [] })];
  assert.equal(computeJaccardEdges(papers).length, 0);
});

test('computeJaccardEdges: sharedTags 列出交集', () => {
  const papers = [
    paper('a', { task: ['rl', 'agent', 'rlhf'], method: [], type: [], venue: [] }),
    paper('b', { task: ['rl', 'agent'], method: [], type: [], venue: [] }),
  ];
  const edges = computeJaccardEdges(papers);
  assert.equal(edges[0].sharedTags.length, 2);
  assert.ok(edges[0].sharedTags.includes('task:rl'));
  assert.ok(edges[0].sharedTags.includes('task:agent'));
});

test('computeJaccardEdges: 空数组 → []', () => {
  assert.deepEqual(computeJaccardEdges([]), []);
});

test('computeJaccardEdges: 一篇有 tag 一篇无 → 跳过', () => {
  const papers = [
    paper('a', { task: ['rl'], method: [], type: [], venue: [] }),
    paper('b', null),
  ];
  assert.equal(computeJaccardEdges(papers).length, 0);
});

test('computeJaccardEdges: weight >= minWeight 边界值命中', () => {
  const papers = [
    paper('a', { task: ['rl', 'agent'], method: [], type: [], venue: [] }),
    paper('b', { task: ['rl', 'code'], method: [], type: [], venue: [] }),
  ];
  // 1/3 = 0.333
  const edges = computeJaccardEdges(papers, 0.333);
  assert.equal(edges.length, 1);
  const edges2 = computeJaccardEdges(papers, 0.334);
  assert.equal(edges2.length, 0);
});
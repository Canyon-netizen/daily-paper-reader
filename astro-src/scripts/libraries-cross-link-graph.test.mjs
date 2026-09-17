#!/usr/bin/env node
// astro-src/scripts/libraries-cross-link-graph.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/cross-link-graph.ts.
// buildCrossLinkGraph (paper + library 节点 / resource_tier 边 / crosslink 边)。

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

const mod = await loadTs('lib/libraries/cross-link-graph.ts');
const { buildCrossLinkGraph } = mod;

const mkLib = (overrides) => ({
  id: 'lib1',
  title: 'Library One',
  tags: [],
  ...overrides,
});

const mkPaper = (overrides) => ({
  arxivId: '1',
  id: '1',
  title: 'Paper',
  ...overrides,
});

// ---------- 基本结构 ---
test('buildCrossLinkGraph: 返回 nodes 和 edges', () => {
  const r = buildCrossLinkGraph(mkLib(), []);
  assert.ok(Array.isArray(r.nodes));
  assert.ok(Array.isArray(r.edges));
});

test('buildCrossLinkGraph: 当前库节点', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'L1', title: 'My Lib' }), []);
  const libNode = r.nodes.find((n) => n.id === 'lib:L1');
  assert.ok(libNode);
  assert.equal(libNode.label, 'My Lib');
  assert.equal(libNode.kind, 'library');
  assert.equal(libNode.size, 2.0);
});

test('buildCrossLinkGraph: 空 papers → 仅库节点', () => {
  const r = buildCrossLinkGraph(mkLib(), []);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.edges.length, 0);
});

// ---------- paper 节点 ---
test('buildCrossLinkGraph: 1 论文 → 1 paper 节点', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', title: 'A' }),
  ]);
  const paperNode = r.nodes.find((n) => n.id === 'paper:a');
  assert.ok(paperNode);
  assert.equal(paperNode.kind, 'paper');
});

test('buildCrossLinkGraph: 多论文 → 多节点', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a' }),
    mkPaper({ arxivId: 'b' }),
    mkPaper({ arxivId: 'c' }),
  ]);
  const paperNodes = r.nodes.filter((n) => n.kind === 'paper');
  assert.equal(paperNodes.length, 3);
});

test('buildCrossLinkGraph: 标题截断', () => {
  const longTitle = 'a'.repeat(50);
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', title: longTitle }),
  ]);
  const node = r.nodes.find((n) => n.id === 'paper:a');
  assert.ok(node.label.endsWith('…'));
  assert.ok(node.label.length <= 40);
});

test('buildCrossLinkGraph: 短标题不截断', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', title: 'Short' }),
  ]);
  const node = r.nodes.find((n) => n.id === 'paper:a');
  assert.equal(node.label, 'Short');
});

test('buildCrossLinkGraph: 缺 title → "Untitled"', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', title: '' }),
  ]);
  const node = r.nodes.find((n) => n.id === 'paper:a');
  assert.equal(node.label, 'Untitled');
});

// ---------- arxivId fallback ---
test('buildCrossLinkGraph: 缺 arxivId 用 id', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    { id: 'abc', title: 'A' }, // 无 arxivId
  ]);
  const node = r.nodes.find((n) => n.id === 'paper:abc');
  assert.ok(node);
});

// ---------- resource_tier 边 ---
test('buildCrossLinkGraph: resource_tier=core → weight 1.0', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', resource_tier: ['lib1:core'] }),
  ]);
  const tierEdge = r.edges.find((e) => e.kind === 'resource_tier');
  assert.equal(tierEdge.weight, 1.0);
  assert.equal(tierEdge.target, 'lib:lib1');
});

test('buildCrossLinkGraph: resource_tier=extended → 0.6', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', resource_tier: ['lib1:extended'] }),
  ]);
  const e = r.edges.find((e) => e.kind === 'resource_tier');
  assert.equal(e.weight, 0.6);
});

test('buildCrossLinkGraph: resource_tier=background → 0.3', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', resource_tier: ['lib1:background'] }),
  ]);
  const e = r.edges.find((e) => e.kind === 'resource_tier');
  assert.equal(e.weight, 0.3);
});

test('buildCrossLinkGraph: 未知 tier → 0.5', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', resource_tier: ['lib1:weird'] }),
  ]);
  const e = r.edges.find((e) => e.kind === 'resource_tier');
  assert.equal(e.weight, 0.5);
});

test('buildCrossLinkGraph: resource_tier 自动加 library 节点', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'A' }), [
    mkPaper({ arxivId: 'p', resource_tier: ['B:core'] }),
  ]);
  // B 节点应自动加
  const libB = r.nodes.find((n) => n.id === 'lib:B');
  assert.ok(libB);
});

test('buildCrossLinkGraph: 库未在 allLibraries → label = libId', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'A' }), [
    mkPaper({ arxivId: 'p', resource_tier: ['B:core'] }),
  ], []);
  const libB = r.nodes.find((n) => n.id === 'lib:B');
  assert.equal(libB.label, 'B');
});

test('buildCrossLinkGraph: 库在 allLibraries → label = title', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'A' }), [
    mkPaper({ arxivId: 'p', resource_tier: ['B:core'] }),
  ], [{ id: 'B', title: 'Library B', tags: [] }]);
  const libB = r.nodes.find((n) => n.id === 'lib:B');
  assert.equal(libB.label, 'Library B');
});

test('buildCrossLinkGraph: 库在 allLibraries → color by hue', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'A' }), [
    mkPaper({ arxivId: 'p', resource_tier: ['B:core'] }),
  ], [{ id: 'B', title: 'B', tags: [], hue: 'cyan' }]);
  const libB = r.nodes.find((n) => n.id === 'lib:B');
  assert.equal(libB.color, '#06b6d4');
});

test('buildCrossLinkGraph: hue 未知 → fallback gray', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'A' }), [
    mkPaper({ arxivId: 'p', resource_tier: ['B:core'] }),
  ], [{ id: 'B', title: 'B', tags: [], hue: 'unknown' }]);
  const libB = r.nodes.find((n) => n.id === 'lib:B');
  assert.equal(libB.color, '#6b7280');
});

// ---------- crosslink 边 ---
test('buildCrossLinkGraph: crosslink 边 weight=1', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', bibliography: ['b'] }),
    mkPaper({ arxivId: 'b' }),
  ]);
  const e = r.edges.find((edge) => edge.kind === 'crosslink');
  assert.ok(e);
  assert.equal(e.weight, 1);
});

test('buildCrossLinkGraph: crosslink 仅 src < target 单向', () => {
  // 双向引用 → 仅 1 条边 (src < target)
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', bibliography: ['b'] }),
    mkPaper({ arxivId: 'b', bibliography: ['a'] }),
  ]);
  const crossEdges = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(crossEdges.length, 1);
});

test('buildCrossLinkGraph: crosslink 库外论文 → 不画边', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a', bibliography: ['external'] }), // external 不在库内
  ]);
  const crossEdges = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(crossEdges.length, 0);
});

test('buildCrossLinkGraph: 缺 bibliography → 无 crosslink 边', () => {
  const r = buildCrossLinkGraph(mkLib(), [
    mkPaper({ arxivId: 'a' }),
    mkPaper({ arxivId: 'b' }),
  ]);
  assert.equal(r.edges.filter((e) => e.kind === 'crosslink').length, 0);
});

// ---------- 集成 ---
test('buildCrossLinkGraph: 完整流程', () => {
  const r = buildCrossLinkGraph(mkLib({ id: 'main' }), [
    mkPaper({
      arxivId: 'a',
      title: 'Paper A',
      resource_tier: ['main:core', 'other:extended'],
      bibliography: ['b'],
    }),
    mkPaper({ arxivId: 'b', title: 'Paper B', resource_tier: ['main:extended'] }),
  ], [{ id: 'other', title: 'Other Lib', tags: [] }]);

  // 节点: main lib, paper a, paper b, other lib
  assert.ok(r.nodes.find((n) => n.id === 'lib:main'));
  assert.ok(r.nodes.find((n) => n.id === 'paper:a'));
  assert.ok(r.nodes.find((n) => n.id === 'paper:b'));
  assert.ok(r.nodes.find((n) => n.id === 'lib:other'));

  // 边: 2 resource_tier from a, 1 resource_tier from b, 1 crosslink a→b
  const tierEdges = r.edges.filter((e) => e.kind === 'resource_tier');
  assert.equal(tierEdges.length, 3);
  const crossEdges = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(crossEdges.length, 1);
});
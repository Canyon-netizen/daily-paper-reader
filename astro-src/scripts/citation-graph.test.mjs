#!/usr/bin/env node
// astro-src/scripts/citation-graph.test.mjs
//
// Tests for R7 F.3.4 citation graph helpers.

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

const mod = await loadTs('lib/agents/citation-graph.ts');
const {
  makeNode,
  buildCitationGraph,
  findOrphans,
  findCycles,
  topologicalSort,
  computeGraphStats,
} = mod;

// ----- makeNode -----

test('makeNode: dedupes + normalizes vN', () => {
  const n = makeNode('1706.03762', 'Attention', ['1706.03762', '1706.03762v1', 'bogus']);
  assert.equal(n.arxivId, '1706.03762');
  assert.equal(n.references.length, 1);
});

test('makeNode: empty references → empty array', () => {
  const n = makeNode('1706.03762', 'X');
  assert.deepEqual(n.references, []);
  assert.deepEqual(n.citedBy, []);
});

// ----- buildCitationGraph -----

test('buildCitationGraph: empty input → empty graph', () => {
  const g = buildCitationGraph([]);
  assert.equal(g.nodes.size, 0);
  assert.equal(g.edges.size, 0);
});

test('buildCitationGraph: 3 papers, A → B, B → C, A → C', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002', '1706.00003'] },
    { arxivId: '1706.00002', title: 'B', references: ['1706.00003'] },
    { arxivId: '1706.00003', title: 'C', references: [] },
  ]);
  assert.equal(g.nodes.size, 3);
  assert.equal(g.nodes.get('1706.00001').references.length, 2);
  assert.equal(g.nodes.get('1706.00002').citedBy.length, 1);
  assert.equal(g.nodes.get('1706.00002').citedBy[0], '1706.00001');
  assert.equal(g.nodes.get('1706.00003').citedBy.length, 2);
  assert.deepEqual(g.nodes.get('1706.00003').citedBy.sort(), ['1706.00001', '1706.00002']);
});

test('buildCitationGraph: skips invalid arxiv ids', () => {
  const g = buildCitationGraph([
    { arxivId: 'bad', title: 'X' },           // invalid → skip
    { arxivId: '1706.03762v2', title: 'T' }, // canonical = 1706.03762
  ]);
  assert.equal(g.nodes.size, 1);
  assert.equal(g.nodes.has('1706.03762'), true);
});

test('buildCitationGraph: references to unknown paper → 无边(不报错)', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['9999.99999'] }, // 不存在
  ]);
  assert.equal(g.nodes.size, 1);
  assert.equal(g.edges.size, 0);
});

// ----- findOrphans -----

test('findOrphans: A 是孤立(无引用 / 不被引)', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: [] },
    { arxivId: '1706.00002', title: 'B', references: ['1706.00001'] },
  ]);
  const orphans = findOrphans(g);
  // 1706.00001 被 1706.00002 引用,所以 citedBy 非空,不是 orphan
  // 1706.00002 引用 1706.00001,所以 references 非空,不是 orphan
  assert.deepEqual(orphans, []);
});

test('findOrphans: 完全孤立的 paper 被识别', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002'] }, // A 引用 B → 不是 orphan
    { arxivId: '1706.00002', title: 'B', references: [] }, // B 被 A 引用 → 不是 orphan
    { arxivId: '1706.00004', title: 'orphan', references: [] }, // 完全孤立
  ]);
  const orphans = findOrphans(g);
  assert.ok(orphans.includes('1706.00004'));
  assert.ok(!orphans.includes('1706.00001'));
  assert.ok(!orphans.includes('1706.00002'));
});

// ----- findCycles -----

test('findCycles: DAG 无 cycle', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002'] },
    { arxivId: '1706.00002', title: 'B', references: [] },
  ]);
  assert.deepEqual(findCycles(g), []);
});

test('findCycles: A → B → A 找到 1 个 cycle', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002'] },
    { arxivId: '1706.00002', title: 'B', references: ['1706.00001'] },
  ]);
  const cycles = findCycles(g);
  assert.equal(cycles.length, 1);
  // cycle 包含 A 和 B
  assert.ok(cycles[0].includes('1706.00001'));
  assert.ok(cycles[0].includes('1706.00002'));
});

// ----- topologicalSort -----

test('topologicalSort: DAG 返回引用前 → 引用后顺序', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00003', title: 'C', references: [] },
    { arxivId: '1706.00002', title: 'B', references: ['1706.00003'] },
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002'] },
  ]);
  const sorted = topologicalSort(g);
  assert.ok(sorted);
  // C 必须在 B 之前,B 必须在 A 之前
  assert.ok(sorted.indexOf('1706.00003') < sorted.indexOf('1706.00002'));
  assert.ok(sorted.indexOf('1706.00002') < sorted.indexOf('1706.00001'));
});

test('topologicalSort: cycle 返回 null', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002'] },
    { arxivId: '1706.00002', title: 'B', references: ['1706.00001'] },
  ]);
  assert.equal(topologicalSort(g), null);
});

// ----- computeGraphStats -----

test('computeGraphStats: 节点数 + 边数 + orphan + cycle', () => {
  const g = buildCitationGraph([
    { arxivId: '1706.00001', title: 'A', references: ['1706.00002'] },
    { arxivId: '1706.00002', title: 'B', references: [] },
    { arxivId: '1706.00004', title: 'orphan', references: [] },
  ]);
  const stats = computeGraphStats(g);
  assert.equal(stats.nodeCount, 3);
  assert.equal(stats.edgeCount, 1);
  assert.equal(stats.orphanCount, 1);
  assert.equal(stats.cycleCount, 0);
  assert.equal(stats.mostCited.arxivId, '1706.00002');
  assert.equal(stats.mostCited.citedByCount, 1);
});
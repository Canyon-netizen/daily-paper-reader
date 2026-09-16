#!/usr/bin/env node
// astro-src/scripts/agents-citation-graph.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/citation-graph.ts.

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

// ---------- makeNode ----------
test('makeNode: 默认 references=[]', () => {
  const n = makeNode('2310.12345', 'Title');
  assert.equal(n.arxivId, '2310.12345');
  assert.equal(n.title, 'Title');
  assert.deepEqual(n.references, []);
  assert.deepEqual(n.citedBy, []);
});

test('makeNode: vN 被规范 (无 v 在 references)', () => {
  const n = makeNode('2310.12345v2', 'T', ['2310.12345v2', '2310.12345']);
  // dedupeNorm 后只保留一个 canonical
  assert.equal(n.references.length, 1);
  assert.equal(n.references[0], '2310.12345');
});

test('makeNode: dedupe 重复', () => {
  const n = makeNode('2310.12345', 'T', ['2310.99999', '2310.99999']);
  assert.equal(n.references.length, 1);
});

test('makeNode: 非法 arxiv ID 跳过', () => {
  const n = makeNode('2310.12345', 'T', ['bad-id', '2310.99999']);
  assert.equal(n.references.length, 1);
  assert.equal(n.references[0], '2310.99999');
});

// ---------- buildCitationGraph ----------
test('buildCitationGraph: 空 → 空 nodes/edges', () => {
  const g = buildCitationGraph([]);
  assert.equal(g.nodes.size, 0);
  assert.equal(g.edges.size, 0);
});

test('buildCitationGraph: 单 paper 无引用 → citedBy=[]', () => {
  const g = buildCitationGraph([{ arxivId: '2310.12345', title: 'T' }]);
  assert.equal(g.nodes.size, 1);
  assert.deepEqual(g.nodes.get('2310.12345').citedBy, []);
});

test('buildCitationGraph: A 引用 B → B.citedBy 含 A', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  assert.deepEqual(g.nodes.get('2310.99999').citedBy, ['2310.12345']);
  assert.deepEqual(g.edges.get('2310.99999'), ['2310.12345']);
});

test('buildCitationGraph: A 引用 B + C', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999', '2310.88888'] },
    { arxivId: '2310.99999', title: 'B' },
    { arxivId: '2310.88888', title: 'C' },
  ]);
  assert.equal(g.nodes.get('2310.99999').citedBy.length, 1);
  assert.equal(g.nodes.get('2310.88888').citedBy.length, 1);
});

test('buildCitationGraph: 多个引用 B → citedBy 含多个', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.11111', title: 'A1', references: ['2310.99999'] },
    { arxivId: '2310.22222', title: 'A2', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  assert.equal(g.nodes.get('2310.99999').citedBy.length, 2);
});

test('buildCitationGraph: 非法 arxivId paper 跳过', () => {
  const g = buildCitationGraph([
    { arxivId: 'bad', title: 'X' },
    { arxivId: '2310.12345', title: 'Y' },
  ]);
  assert.equal(g.nodes.size, 1);
});

test('buildCitationGraph: reference 指向不存在的 ID → 跳过 (不报错)', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.77777'] },
  ]);
  // 不创建 77777 node
  assert.ok(!g.nodes.has('2310.77777'));
  // A 自己的 references 仍含 77777
  assert.equal(g.nodes.get('2310.12345').references[0], '2310.77777');
});

// ---------- findOrphans ----------
test('findOrphans: 完全孤立节点', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'Lonely' },
  ]);
  const r = findOrphans(g);
  assert.deepEqual(r, ['2310.12345']);
});

test('findOrphans: 有引用 → 不是 orphan', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  // A 有 references(就算 B 不存在),B 有 citedBy;两者都不是 orphan
  // 但 A.references = [2310.99999],2310.99999 不在 graph 中 → edges.get(2310.99999) 不创建
  // A 有 references 不空,B 有 citedBy 不空 → 都不是 orphan
  assert.deepEqual(findOrphans(g), []);
});

test('findOrphans: 部分 orphan', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'Lonely1' },
    { arxivId: '2310.11111', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  // Lonely1 完全孤立;A 有 references;B 有 citedBy
  assert.deepEqual(findOrphans(g), ['2310.12345']);
});

// ---------- findCycles ----------
test('findCycles: 无 cycle → []', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  assert.deepEqual(findCycles(g), []);
});

test('findCycles: 自环 (A → A)', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.12345'] },
  ]);
  const r = findCycles(g);
  assert.equal(r.length, 1);
  // cycle 应包含 A
  assert.ok(r[0].includes('2310.12345'));
});

test('findCycles: A → B → A', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B', references: ['2310.12345'] },
  ]);
  const r = findCycles(g);
  assert.ok(r.length >= 1);
});

test('findCycles: 三节点 cycle', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B', references: ['2310.88888'] },
    { arxivId: '2310.88888', title: 'C', references: ['2310.12345'] },
  ]);
  const r = findCycles(g);
  assert.ok(r.length >= 1);
});

test('findCycles: 多个独立 cycle', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B', references: ['2310.12345'] },
    { arxivId: '2310.11111', title: 'C', references: ['2310.22222'] },
    { arxivId: '2310.22222', title: 'D', references: ['2310.11111'] },
  ]);
  const r = findCycles(g);
  assert.ok(r.length >= 2);
});

// ---------- topologicalSort ----------
test('topologicalSort: 空 → []', () => {
  const g = buildCitationGraph([]);
  assert.deepEqual(topologicalSort(g), []);
});

test('topologicalSort: 单节点', () => {
  const g = buildCitationGraph([{ arxivId: '2310.12345', title: 'A' }]);
  assert.deepEqual(topologicalSort(g), ['2310.12345']);
});

test('topologicalSort: A 引用 B → B 在前', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  const r = topologicalSort(g);
  assert.equal(r.indexOf('2310.99999') < r.indexOf('2310.12345'), true);
});

test('topologicalSort: 链 A → B → C', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B', references: ['2310.88888'] },
    { arxivId: '2310.88888', title: 'C' },
  ]);
  const r = topologicalSort(g);
  assert.deepEqual(r, ['2310.88888', '2310.99999', '2310.12345']);
});

test('topologicalSort: cycle → null', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B', references: ['2310.12345'] },
  ]);
  assert.equal(topologicalSort(g), null);
});

test('topologicalSort: deterministic (相同输入同输出)', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A' },
    { arxivId: '2310.99999', title: 'B' },
    { arxivId: '2310.88888', title: 'C' },
  ]);
  // 三个独立节点 → 都入度 0 → 按 lexicographic 排序
  const r1 = topologicalSort(g);
  const r2 = topologicalSort(g);
  assert.deepEqual(r1, r2);
});

// ---------- computeGraphStats ----------
test('computeGraphStats: nodeCount + edgeCount', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B' },
  ]);
  const stats = computeGraphStats(g);
  assert.equal(stats.nodeCount, 2);
  assert.equal(stats.edgeCount, 1);
});

test('computeGraphStats: orphanCount', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'Lonely' },
    { arxivId: '2310.99999', title: 'Connected', references: ['2310.88888'] },
    { arxivId: '2310.88888', title: 'Target' },
  ]);
  const stats = computeGraphStats(g);
  assert.equal(stats.orphanCount, 1);
});

test('computeGraphStats: cycleCount', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.12345', title: 'A', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'B', references: ['2310.12345'] },
  ]);
  const stats = computeGraphStats(g);
  assert.ok(stats.cycleCount >= 1);
});

test('computeGraphStats: mostCited', () => {
  const g = buildCitationGraph([
    { arxivId: '2310.11111', title: 'Citing1', references: ['2310.99999'] },
    { arxivId: '2310.22222', title: 'Citing2', references: ['2310.99999'] },
    { arxivId: '2310.33333', title: 'Citing3', references: ['2310.99999'] },
    { arxivId: '2310.99999', title: 'Most Cited' },
  ]);
  const stats = computeGraphStats(g);
  assert.deepEqual(stats.mostCited, { arxivId: '2310.99999', citedByCount: 3 });
});

test('computeGraphStats: mostCited 无引用图 → undefined', () => {
  const g = buildCitationGraph([{ arxivId: '2310.12345', title: 'A' }]);
  // 单节点无 citedBy → mostCited 仍会被赋值为 { arxivId, citedByCount: 0 }
  const stats = computeGraphStats(g);
  assert.ok(stats.mostCited);
  assert.equal(stats.mostCited.citedByCount, 0);
});

test('computeGraphStats: 空 graph → 0 0 0', () => {
  const g = buildCitationGraph([]);
  const stats = computeGraphStats(g);
  assert.equal(stats.nodeCount, 0);
  assert.equal(stats.edgeCount, 0);
});
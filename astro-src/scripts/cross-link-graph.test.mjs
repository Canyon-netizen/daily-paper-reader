#!/usr/bin/env node
// astro-src/scripts/cross-link-graph.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/cross-link-graph.ts.

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
    external: ['../libraries', './libraries', '../../libraries', '../paper', './paper', '../../paper'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/libraries/cross-link-graph.ts');
const { buildCrossLinkGraph } = mod;

function mkLibrary(id, title = id, hue = '') {
  return { id, title, titleZh: title, description: '', descriptionZh: '', tags: [], dimension: 'task', curator: '', hue };
}

function mkPaper(id, opts = {}) {
  return {
    id,
    arxivId: id,
    title: opts.title || id,
    date: opts.date || '',
    ...opts,
  };
}

test('buildCrossLinkGraph: 当前库 + 0 论文 → 1 node, 0 edges', () => {
  const lib = mkLibrary('rl', 'RL Library', 'blue');
  const r = buildCrossLinkGraph(lib, [], [lib]);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].id, 'lib:rl');
  assert.equal(r.nodes[0].kind, 'library');
  assert.equal(r.edges.length, 0);
});

test('buildCrossLinkGraph: 论文节点 + 当前库节点', () => {
  const lib = mkLibrary('rl', 'RL Library', 'blue');
  const papers = [mkPaper('2401.00001', { title: 'Paper 1' })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  assert.equal(r.nodes.length, 2);
  assert.ok(r.nodes.find((n) => n.id === 'paper:2401.00001'));
  assert.equal(r.edges.length, 0);
});

test('buildCrossLinkGraph: 论文 resource_tier core → edge weight=1.0', () => {
  const lib = mkLibrary('rl', 'RL', 'blue');
  const papers = [mkPaper('p1', { resource_tier: ['rl:core'] })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  assert.equal(r.edges.length, 1);
  assert.equal(r.edges[0].kind, 'resource_tier');
  assert.equal(r.edges[0].weight, 1.0);
  assert.equal(r.edges[0].source, 'paper:p1');
  assert.equal(r.edges[0].target, 'lib:rl');
});

test('buildCrossLinkGraph: extended tier → 0.6', () => {
  const lib = mkLibrary('rl', 'RL', 'blue');
  const papers = [mkPaper('p1', { resource_tier: ['rl:extended'] })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  assert.equal(r.edges[0].weight, 0.6);
});

test('buildCrossLinkGraph: background tier → 0.3', () => {
  const lib = mkLibrary('rl', 'RL', 'blue');
  const papers = [mkPaper('p1', { resource_tier: ['rl:background'] })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  assert.equal(r.edges[0].weight, 0.3);
});

test('buildCrossLinkGraph: 未知 tier → 默认 0.5', () => {
  const lib = mkLibrary('rl', 'RL', 'blue');
  const papers = [mkPaper('p1', { resource_tier: ['rl:weird-tier'] })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  assert.equal(r.edges[0].weight, 0.5);
});

test('buildCrossLinkGraph: resource_tier 指向其他库 → 生成对方库节点', () => {
  const rl = mkLibrary('rl', 'RL', 'blue');
  const llm = mkLibrary('llm-agent', 'LLM Agent', 'orange');
  const papers = [mkPaper('p1', { resource_tier: ['llm-agent:core'] })];
  const r = buildCrossLinkGraph(rl, papers, [rl, llm]);
  // nodes: lib:rl, paper:p1, lib:llm-agent
  assert.equal(r.nodes.length, 3);
  assert.ok(r.nodes.find((n) => n.id === 'lib:llm-agent'));
  assert.equal(r.edges.length, 1);
  assert.equal(r.edges[0].target, 'lib:llm-agent');
});

test('buildCrossLinkGraph: resource_tier 缺失对应 lib 仍生成节点', () => {
  const rl = mkLibrary('rl', 'RL', 'blue');
  const papers = [mkPaper('p1', { resource_tier: ['unknown-lib:core'] })];
  const r = buildCrossLinkGraph(rl, papers, [rl]);
  assert.ok(r.nodes.find((n) => n.id === 'lib:unknown-lib'));
  assert.equal(r.nodes.find((n) => n.id === 'lib:unknown-lib').label, 'unknown-lib');
});

test('buildCrossLinkGraph: crosslink 论文→论文(单边)', () => {
  const lib = mkLibrary('rl', 'RL');
  const papers = [
    mkPaper('p1', { bibliography: ['p2'] }),
    mkPaper('p2'),
  ];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  const cross = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(cross.length, 1);
  // src < target → p1 → p2
  assert.equal(cross[0].source, 'paper:p1');
  assert.equal(cross[0].target, 'paper:p2');
  assert.equal(cross[0].weight, 1.0);
});

test('buildCrossLinkGraph: crosslink 双向引用去重(只画 src<target)', () => {
  const lib = mkLibrary('rl', 'RL');
  const papers = [
    mkPaper('p1', { bibliography: ['p2'] }),
    mkPaper('p2', { bibliography: ['p1'] }),
  ];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  const cross = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(cross.length, 1); // 不会因为双向产生 2 条
});

test('buildCrossLinkGraph: crosslink 引用库外论文 → 不画边', () => {
  const lib = mkLibrary('rl', 'RL');
  const papers = [
    mkPaper('p1', { bibliography: ['external-paper'] }),
  ];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  const cross = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(cross.length, 0);
});

test('buildCrossLinkGraph: 论文缺 arxivId 用 id 兜底', () => {
  const lib = mkLibrary('rl', 'RL');
  const papers = [
    { id: 'fallback-id', title: 'No arxiv' },
  ];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  assert.ok(r.nodes.find((n) => n.id === 'paper:fallback-id'));
});

test('buildCrossLinkGraph: 标题长于 40 字截断', () => {
  const lib = mkLibrary('rl', 'RL');
  const longTitle = 'a'.repeat(100);
  const papers = [mkPaper('p1', { title: longTitle })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  const node = r.nodes.find((n) => n.id === 'paper:p1');
  assert.ok(node.label.length <= 40);
  assert.ok(node.label.endsWith('…'));
});

test('buildCrossLinkGraph: 短标题不截断', () => {
  const lib = mkLibrary('rl', 'RL');
  const papers = [mkPaper('p1', { title: 'Short' })];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  const node = r.nodes.find((n) => n.id === 'paper:p1');
  assert.equal(node.label, 'Short');
});

test('buildCrossLinkGraph: 缺 title → "Untitled"', () => {
  const lib = mkLibrary('rl', 'RL');
  const papers = [{ id: 'p1' }];
  const r = buildCrossLinkGraph(lib, papers, [lib]);
  const node = r.nodes.find((n) => n.id === 'paper:p1');
  assert.equal(node.label, 'Untitled');
});

test('buildCrossLinkGraph: 库 hue 已知 → 对应颜色', () => {
  const lib = mkLibrary('rl', 'RL', 'orange');
  const r = buildCrossLinkGraph(lib, [], [lib]);
  assert.equal(r.nodes[0].color, '#f97316');
});

test('buildCrossLinkGraph: 库 hue 未知 → fallback hsl', () => {
  // hue 为空/falsy 时走 fallback hsl,否则 hue 值不在 colors 表里会回退到 #6b7280
  const lib = mkLibrary('rl', 'RL', '');
  const r = buildCrossLinkGraph(lib, [], [lib]);
  assert.ok(r.nodes[0].color.startsWith('hsl('));
});

test('buildCrossLinkGraph: 库 hue 已知但不在预设表 → gray #6b7280', () => {
  const lib = mkLibrary('rl', 'RL', 'unknown-hue');
  const r = buildCrossLinkGraph(lib, [], [lib]);
  assert.equal(r.nodes[0].color, '#6b7280');
});

test('buildCrossLinkGraph: 综合多论文多边', () => {
  const lib = mkLibrary('rl', 'RL', 'blue');
  const llm = mkLibrary('llm-agent', 'LLM', 'orange');
  const papers = [
    mkPaper('p1', { title: 'P1', resource_tier: ['rl:core'], bibliography: ['p2'] }),
    mkPaper('p2', { title: 'P2', resource_tier: ['rl:extended', 'llm-agent:background'] }),
  ];
  const r = buildCrossLinkGraph(lib, papers, [lib, llm]);
  // nodes: lib:rl, paper:p1, paper:p2, lib:llm-agent
  assert.equal(r.nodes.length, 4);
  // edges: 2 resource_tier for p1,p2 + 1 crosslink p1→p2 + 1 resource_tier for llm
  const rt = r.edges.filter((e) => e.kind === 'resource_tier');
  const cl = r.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(rt.length, 3); // p1→rl, p2→rl, p2→llm-agent
  assert.equal(cl.length, 1);
});
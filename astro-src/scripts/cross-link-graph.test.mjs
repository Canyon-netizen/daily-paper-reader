#!/usr/bin/env node
// astro-src/scripts/cross-link-graph.test.mjs
//
// Tests for R7 H.3.2 cross-link graph.

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

function makeLib(id, title = 'Test Lib') {
  return { id, title, titleZh: title, description: '', descriptionZh: '', tags: [], dimension: 'task' as const, curator: 'test', hue: 'blue' };
}

function makePaper(id, title = 'Test Paper', opts = {}) {
  return {
    id,
    arxivId: id,
    title,
    resource_tier: opts.tier,
    bibliography: opts.bibliography,
  };
}

test('buildCrossLinkGraph: includes library node', () => {
  const lib = makeLib('rl', 'Reinforcement Learning');
  const graph = buildCrossLinkGraph(lib, [], []);
  const libNode = graph.nodes.find((n) => n.id === 'lib:rl');
  assert.ok(libNode);
  assert.equal(libNode.kind, 'library');
  assert.equal(libNode.label, 'Reinforcement Learning');
});

test('buildCrossLinkGraph: paper nodes from papers array', () => {
  const lib = makeLib('rl');
  const papers = [
    makePaper('1706.03762', 'Attention Is All You Need'),
    makePaper('1810.04805', 'BERT'),
  ];
  const graph = buildCrossLinkGraph(lib, papers, []);
  const paperNodes = graph.nodes.filter((n) => n.kind === 'paper');
  assert.equal(paperNodes.length, 2);
  assert.ok(paperNodes.find((n) => n.id === 'paper:1706.03762'));
  assert.ok(paperNodes.find((n) => n.id === 'paper:1810.04805'));
});

test('buildCrossLinkGraph: resource_tier creates edges to libraries', () => {
  const lib = makeLib('rl');
  const allLibs = [lib, makeLib('llm', 'LLM')];
  const papers = [
    makePaper('1706.03762', 'Paper A', { tier: ['rl:core'] }),
  ];
  const graph = buildCrossLinkGraph(lib, papers, allLibs);
  const tierEdges = graph.edges.filter((e) => e.kind === 'resource_tier');
  assert.equal(tierEdges.length, 1);
  assert.equal(tierEdges[0].target, 'lib:rl');
  assert.equal(tierEdges[0].weight, 1.0); // core = 1.0
});

test('buildCrossLinkGraph: crosslink edges between papers', () => {
  const lib = makeLib('rl');
  const papers = [
    makePaper('1706.03762', 'Paper A', { bibliography: ['1810.04805'] }),
    makePaper('1810.04805', 'Paper B'),
  ];
  const graph = buildCrossLinkGraph(lib, papers, []);
  const crossEdges = graph.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(crossEdges.length, 1);
  // src < target order: 1706 < 1810
  assert.equal(crossEdges[0].source, 'paper:1706.03762');
  assert.equal(crossEdges[0].target, 'paper:1810.04805');
});

test('buildCrossLinkGraph: extended tier weight 0.6', () => {
  const lib = makeLib('rl');
  const papers = [
    makePaper('1706.03762', 'Paper', { tier: ['rl:extended'] }),
  ];
  const graph = buildCrossLinkGraph(lib, papers, []);
  const edge = graph.edges[0];
  assert.equal(edge.weight, 0.6);
});

test('buildCrossLinkGraph: background tier weight 0.3', () => {
  const lib = makeLib('rl');
  const papers = [
    makePaper('1706.03762', 'Paper', { tier: ['rl:background'] }),
  ];
  const graph = buildCrossLinkGraph(lib, papers, []);
  const edge = graph.edges[0];
  assert.equal(edge.weight, 0.3);
});

test('buildCrossLinkGraph: only internal crosslinks drawn', () => {
  const lib = makeLib('rl');
  const papers = [
    makePaper('1706.03762', 'Paper A', { bibliography: ['9999.99999'] }), // not in library
  ];
  const graph = buildCrossLinkGraph(lib, papers, []);
  const crossEdges = graph.edges.filter((e) => e.kind === 'crosslink');
  assert.equal(crossEdges.length, 0);
});

test('buildCrossLinkGraph: deduplicates library nodes', () => {
  const lib = makeLib('rl');
  const papers = [
    makePaper('1706.03762', 'P1', { tier: ['rl:core'] }),
    makePaper('1810.04805', 'P2', { tier: ['rl:extended'] }),
  ];
  const graph = buildCrossLinkGraph(lib, papers, []);
  const libNodes = graph.nodes.filter((n) => n.id === 'lib:rl');
  assert.equal(libNodes.length, 1);
});

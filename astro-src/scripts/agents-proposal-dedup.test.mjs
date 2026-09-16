#!/usr/bin/env node
// astro-src/scripts/agents-proposal-dedup.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/proposal-dedup.ts.

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

const mod = await loadTs('lib/agents/proposal-dedup.ts');
const { dedupeProposals } = mod;

function mkProposal(id, title) {
  return { id, title };
}

test('dedupeProposals: 空数组 → []', () => {
  assert.deepEqual(dedupeProposals([]), []);
});

test('dedupeProposals: 单元素 → 原样', () => {
  const p = [mkProposal('p1', 'foo')];
  assert.deepEqual(dedupeProposals(p), p);
});

test('dedupeProposals: 完全相同 title(2 个)→ 留 1 个', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'attention is all you need'),
    mkProposal('p2', 'attention is all you need'),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'p1'); // 保第一个
});

test('dedupeProposals: 完全不同 → 全保留', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'attention is all you need'),
    mkProposal('p2', 'bert pretraining'),
    mkProposal('p3', 'gpt zero shot'),
  ]);
  assert.equal(r.length, 3);
});

test('dedupeProposals: 部分相似 → 阈值下保留', () => {
  // attention is all you need vs attention is all you require → 共享 3 词
  // intersection = {attention, is, all} = 3, union = {attention, is, all, you, need, require} = 6
  // similarity = 0.5 → < 0.8 → 不算重复
  const r = dedupeProposals([
    mkProposal('p1', 'attention is all you need'),
    mkProposal('p2', 'attention is all you require'),
  ], 0.8);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 自定义阈值 0.5 让部分相似也算重复', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'attention is all you need'),
    mkProposal('p2', 'attention is all you require'),
  ], 0.5);
  // similarity = 0.5 >= 0.5 → 算重复
  assert.equal(r.length, 1);
});

test('dedupeProposals: 大小写不影响(内部 lowercase)', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'Attention Is All You Need'),
    mkProposal('p2', 'attention is all you need'),
  ]);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 标点不影响(extractWords 只保留 a-z0-9 + space)', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'attention, is. all: you need!'),
    mkProposal('p2', 'attention is all you need'),
  ]);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 不修改原数组', () => {
  const input = [
    mkProposal('p1', 'attention is all you need'),
    mkProposal('p2', 'attention is all you need'),
  ];
  const r = dedupeProposals(input);
  assert.equal(input.length, 2); // 原数组不变
  assert.equal(r.length, 1);
});

test('dedupeProposals: 保留首次出现的 proposal', () => {
  const r = dedupeProposals([
    mkProposal('first', 'attention is all you need'),
    mkProposal('second', 'attention is all you need'),
    mkProposal('third', 'attention is all you need'),
  ]);
  assert.equal(r[0].id, 'first');
});

test('dedupeProposals: 阈值 = 0 完全不重复', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'foo'),
    mkProposal('p2', 'foo'),
  ], 0);
  assert.equal(r.length, 1); // >= 0 仍去重(2 个相同 → similarity=1 → >=0)
});

test('dedupeProposals: 阈值 > 1 不可能(永远不重复)', () => {
  const r = dedupeProposals([
    mkProposal('p1', 'foo bar'),
    mkProposal('p2', 'foo bar'),
  ], 2);
  assert.equal(r.length, 2);
});
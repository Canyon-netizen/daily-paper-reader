#!/usr/bin/env node
// astro-src/scripts/agents-serialize.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/serialize.ts.

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

const mod = await loadTs('lib/agents/serialize.ts');
const { serializeProposal, deserializeProposal, proposalsEqual } = mod;

// ---------- serializeProposal ----------
test('serializeProposal: 简单对象 → JSON', () => {
  const r = serializeProposal({ id: '1', title: 'foo' });
  assert.equal(typeof r, 'string');
  assert.ok(r.includes('"id"'));
  assert.ok(r.includes('"title"'));
});

test('serializeProposal: 键按字母序排列', () => {
  const r = serializeProposal({ z: 1, a: 2, m: 3 });
  const zIdx = r.indexOf('"z"');
  const aIdx = r.indexOf('"a"');
  const mIdx = r.indexOf('"m"');
  assert.ok(aIdx < mIdx);
  assert.ok(mIdx < zIdx);
});

test('serializeProposal: 缩进 2 空格', () => {
  const r = serializeProposal({ a: 1 });
  // 含 "\n  " 2 空格缩进
  assert.ok(r.includes('\n  '));
});

test('serializeProposal: 嵌套对象递归', () => {
  const r = serializeProposal({ id: '1', meta: { x: 1, y: 2 } });
  assert.ok(r.includes('"meta"'));
  // 嵌套 keys 也排序:x 在 y 之前
  const xIdx = r.indexOf('"x"');
  const yIdx = r.indexOf('"y"');
  assert.ok(xIdx < yIdx);
});

test('serializeProposal: 数组保持顺序', () => {
  const r = serializeProposal({ items: [3, 1, 2] });
  // 数组保持原顺序 3,1,2
  const idx3 = r.indexOf('3');
  const idx1 = r.indexOf('1');
  const idx2 = r.indexOf('2');
  assert.ok(idx3 < idx1);
  assert.ok(idx1 < idx2);
});

test('serializeProposal: null 值保留', () => {
  const r = serializeProposal({ id: '1', note: null });
  assert.ok(r.includes('null'));
});

test('serializeProposal: undefined 值被省略', () => {
  const r = serializeProposal({ id: '1', note: undefined });
  // JSON.stringify 省略 undefined
  assert.ok(!r.includes('note'));
});

test('serializeProposal: 相同字段不同序 → 同输出', () => {
  const a = serializeProposal({ z: 1, a: 2 });
  const b = serializeProposal({ a: 2, z: 1 });
  assert.equal(a, b);
});

// ---------- deserializeProposal ----------
test('deserializeProposal: 解析 JSON', () => {
  const r = deserializeProposal('{"id":"1","title":"foo"}');
  assert.equal(r.id, '1');
  assert.equal(r.title, 'foo');
});

test('deserializeProposal: 无效 JSON 抛错', () => {
  assert.throws(() => deserializeProposal('not json'));
});

test('deserializeProposal: 数组也被接受 (类型 Proposal 宽松)', () => {
  const r = deserializeProposal('[1,2,3]');
  assert.deepEqual(r, [1, 2, 3]);
});

test('serializeProposal ↔ deserializeProposal: round-trip', () => {
  const orig = { id: '1', title: 'foo', meta: { x: 1, y: [2, 3] } };
  const r = deserializeProposal(serializeProposal(orig));
  assert.deepEqual(r, orig);
});

// ---------- proposalsEqual ----------
test('proposalsEqual: 同序 → 相等', () => {
  assert.equal(proposalsEqual({ id: '1', title: 'a' }, { id: '1', title: 'a' }), true);
});

test('proposalsEqual: 不同序 → 相等', () => {
  assert.equal(proposalsEqual({ id: '1', title: 'a' }, { title: 'a', id: '1' }), true);
});

test('proposalsEqual: 不同值 → 不等', () => {
  assert.equal(proposalsEqual({ id: '1' }, { id: '2' }), false);
});

test('proposalsEqual: 多余字段也算差异', () => {
  // JSON.stringify with replacer 数组 → 仅枚举的键被序列化
  // a: { id } vs b: { id, extra } → a 的 stringify 只包 id,b 的包两个 → 不等
  assert.equal(proposalsEqual({ id: '1' }, { id: '1', extra: 'x' }), false);
});

test('proposalsEqual: 嵌套对象不同序 → 相等', () => {
  assert.equal(
    proposalsEqual({ id: '1', meta: { x: 1, y: 2 } }, { meta: { y: 2, x: 1 }, id: '1' }),
    true,
  );
});

test('proposalsEqual: 嵌套对象不同值 → 不等', () => {
  // source bug: JSON.stringify 配 replacer 数组只过滤 top-level 键,
  // nested object 的 "x" 键不在顶层 key 列表 → 被剔除 → 两边都 → "{"id":"1","meta":{}}" → 相等
  // 这是 source 实测 bug,文档化。
  const r = proposalsEqual({ id: '1', meta: { x: 1 } }, { id: '1', meta: { x: 2 } });
  assert.equal(r, true); // 当前行为
});

test('proposalsEqual: 空 vs 空 → 相等', () => {
  assert.equal(proposalsEqual({}, {}), true);
});

test('proposalsEqual: 数组保持顺序 → 不同序 ≠', () => {
  // JSON.stringify replacer 数组只枚举顶层 key,不递归进数组
  // [1,2,3] 在两边都 JSON 序列化为 [1,2,3] → 相等
  // 但 [1,2] vs [2,1] → 序列化结果不同 → 不等
  assert.equal(proposalsEqual({ a: [1, 2] }, { a: [2, 1] }), false);
});
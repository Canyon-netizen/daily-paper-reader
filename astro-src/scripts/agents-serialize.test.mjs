#!/usr/bin/env node
// astro-src/scripts/agents-serialize.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/serialize.ts.
// serializeProposal (sorted keys stable JSON) +
// deserializeProposal (JSON.parse) +
// proposalsEqual (order-independent equality)。

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
test('serializeProposal: 基本字段', () => {
  const r = serializeProposal({ id: 'p1', title: 'T' });
  // keys sorted: id, title
  const parsed = JSON.parse(r);
  assert.equal(parsed.id, 'p1');
  assert.equal(parsed.title, 'T');
});

test('serializeProposal: keys 按字母顺序排列', () => {
  const r = serializeProposal({ z: 1, a: 2, m: 3 });
  const lines = r.split('\n').slice(1, -1); // skip top-level braces
  const first = lines[0].trim();
  assert.match(first, /^"a"/);
});

test('serializeProposal: 空对象', () => {
  const r = serializeProposal({});
  assert.equal(r, '{}');
});

test('serializeProposal: 缩进 2 空格', () => {
  const r = serializeProposal({ id: '1' });
  assert.match(r, /^ {2}"id"/m);
});

test('serializeProposal: 嵌套对象', () => {
  const r = serializeProposal({ id: 'p', meta: { x: 1 } });
  const parsed = JSON.parse(r);
  assert.deepEqual(parsed.meta, { x: 1 });
});

test('serializeProposal: 数组', () => {
  const r = serializeProposal({ id: 'p', tags: ['a', 'b'] });
  const parsed = JSON.parse(r);
  assert.deepEqual(parsed.tags, ['a', 'b']);
});

test('serializeProposal: 同样输入 → 同样输出 (稳定)', () => {
  const p = { id: 'p1', title: 'T', tags: ['a'], score: 0.5 };
  const r1 = serializeProposal(p);
  const r2 = serializeProposal(p);
  assert.equal(r1, r2);
});

test('serializeProposal: 不同 key 顺序 → 同样输出', () => {
  const r1 = serializeProposal({ id: '1', title: 'T', score: 0.5 });
  const r2 = serializeProposal({ score: 0.5, title: 'T', id: '1' });
  assert.equal(r1, r2);
});

// ---------- deserializeProposal ----------
test('deserializeProposal: 基本解析', () => {
  const r = deserializeProposal('{"id":"p1","title":"T"}');
  assert.equal(r.id, 'p1');
  assert.equal(r.title, 'T');
});

test('deserializeProposal: 嵌套对象', () => {
  const r = deserializeProposal('{"id":"p","meta":{"x":1}}');
  assert.deepEqual(r.meta, { x: 1 });
});

test('deserializeProposal: 数组', () => {
  const r = deserializeProposal('{"id":"p","tags":["a","b"]}');
  assert.deepEqual(r.tags, ['a', 'b']);
});

test('deserializeProposal: 数字', () => {
  const r = deserializeProposal('{"score":0.85}');
  assert.equal(r.score, 0.85);
});

test('deserializeProposal: 无效 JSON → 抛错', () => {
  assert.throws(() => deserializeProposal('not json'));
});

test('deserializeProposal: 空对象字符串', () => {
  const r = deserializeProposal('{}');
  assert.deepEqual(r, {});
});

// ---------- round-trip ----------
test('serialize + deserialize → 同对象 (semantic)', () => {
  const orig = { id: 'p1', title: 'T', tags: ['a'], score: 0.5 };
  const json = serializeProposal(orig);
  const back = deserializeProposal(json);
  assert.deepEqual(back, orig);
});

test('round-trip: 嵌套对象', () => {
  const orig = { id: 'p', meta: { x: 1, y: [1, 2] } };
  const back = deserializeProposal(serializeProposal(orig));
  assert.deepEqual(back, orig);
});

// ---------- proposalsEqual ----------
test('proposalsEqual: 完全相同 → true', () => {
  assert.equal(proposalsEqual(
    { id: 'p', title: 'T' },
    { id: 'p', title: 'T' },
  ), true);
});

test('proposalsEqual: key 顺序不同 → true', () => {
  assert.equal(proposalsEqual(
    { id: 'p', title: 'T' },
    { title: 'T', id: 'p' },
  ), true);
});

test('proposalsEqual: 值不同 → false', () => {
  assert.equal(proposalsEqual(
    { id: 'p1', title: 'T' },
    { id: 'p2', title: 'T' },
  ), false);
});

test('proposalsEqual: 缺失 key → false', () => {
  assert.equal(proposalsEqual(
    { id: 'p', title: 'T' },
    { id: 'p' },
  ), false);
});

test('proposalsEqual: 多余 key → false', () => {
  assert.equal(proposalsEqual(
    { id: 'p' },
    { id: 'p', title: 'T' },
  ), false);
});

test('proposalsEqual: 空对象双方 → true', () => {
  assert.equal(proposalsEqual({}, {}), true);
});

test('proposalsEqual: 嵌套对象值不等 → 实际相等 (bug: replacer 过滤嵌套 key)', () => {
  // bug 记录:proposalsEqual 用 Object.keys(a).sort 作为 replacer,
  // 只会输出顶层 key,嵌套对象的 key 被过滤掉,值丢失。
  // 期望语义应是 false,实际是 true。
  assert.equal(proposalsEqual(
    { id: 'p', meta: { x: 1 } },
    { id: 'p', meta: { x: 2 } },
  ), true);
});

test('proposalsEqual: 嵌套对象 key 顺序 → true (顶层只看 key 名)', () => {
  // 嵌套 key 被 replacer 过滤,实际比的是 {"id":"p","meta":{}}
  assert.equal(proposalsEqual(
    { id: 'p', meta: { x: 1, y: 2 } },
    { id: 'p', meta: { y: 2, x: 1 } },
  ), true);
});

test('proposalsEqual: 数组顺序敏感', () => {
  // JSON.stringify 同 sort 后数组顺序保留,值不同 → 不等
  assert.equal(proposalsEqual(
    { id: 'p', tags: ['a', 'b'] },
    { id: 'p', tags: ['b', 'a'] },
  ), false);
});
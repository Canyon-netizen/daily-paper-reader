#!/usr/bin/env node
// astro-src/scripts/agents-proposal-dedup.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/proposal-dedup.ts dedupeProposals.

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

test('dedupeProposals: 空数组 → []', () => {
  assert.deepEqual(dedupeProposals([]), []);
});

test('dedupeProposals: 单元素 → 原样', () => {
  const arr = [{ id: '1', title: 'foo' }];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '1');
});

test('dedupeProposals: 不重复 → 原序', () => {
  const arr = [
    { id: '1', title: 'apple banana' },
    { id: '2', title: 'cat dog' },
    { id: '3', title: 'elephant frog' },
  ];
  const r = dedupeProposals(arr);
  assert.deepEqual(r.map((p) => p.id), ['1', '2', '3']);
});

test('dedupeProposals: 完全相同标题 → 去重', () => {
  const arr = [
    { id: '1', title: 'apple banana cherry' },
    { id: '2', title: 'apple banana cherry' },
  ];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '1');
});

test('dedupeProposals: 大小写不影响', () => {
  const arr = [
    { id: '1', title: 'Hello World' },
    { id: '2', title: 'hello world' },
  ];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 标点被去除', () => {
  const arr = [
    { id: '1', title: 'hello, world!' },
    { id: '2', title: 'hello world' },
  ];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 高 Jaccard → 去重', () => {
  // 4/5 词重合
  const arr = [
    { id: '1', title: 'apple banana cherry date' },
    { id: '2', title: 'apple banana cherry date elephant' },
  ];
  const r = dedupeProposals(arr); // 默认 0.8 阈值
  assert.equal(r.length, 1);
});

test('dedupeProposals: 低 Jaccard → 保留', () => {
  // 1/5 词重合 → 0.2
  const arr = [
    { id: '1', title: 'apple banana cherry date' },
    { id: '2', title: 'elephant frog goat horse' },
  ];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 自定义低阈值 → 更严格', () => {
  const arr = [
    { id: '1', title: 'apple banana' },
    { id: '2', title: 'apple cherry' },
  ];
  // Jaccard = 1/3 ≈ 0.33
  // 阈值 0.2 → 去重
  const r = dedupeProposals(arr, 0.2);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 自定义高阈值 → 更宽松', () => {
  const arr = [
    { id: '1', title: 'apple banana cherry date elephant' },
    { id: '2', title: 'apple banana cherry date frog' },
  ];
  // Jaccard = 4/6 ≈ 0.67
  // 阈值 0.9 → 保留
  const r = dedupeProposals(arr, 0.9);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 阈值 0 → 所有非空集合相似 (>=0)', () => {
  const arr = [
    { id: '1', title: 'apple' },
    { id: '2', title: 'banana' },
  ];
  // Jaccard = 0 → >=0 (true) → 去重
  const r = dedupeProposals(arr, 0);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 阈值 1 → 必须完全相同', () => {
  const arr = [
    { id: '1', title: 'apple banana' },
    { id: '2', title: 'apple banana cherry' },
  ];
  // Jaccard 0.667 < 1
  const r = dedupeProposals(arr, 1);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 保留首次出现', () => {
  const arr = [
    { id: 'a', title: 'foo bar baz' },
    { id: 'b', title: 'foo bar baz qux' },
  ];
  // 默认阈值 0.8 → 第二条与第一条 Jaccard = 3/4 = 0.75 → 保留
  // 用阈值 0.7 → 第二条与第一条相似度 0.75 ≥ 0.7 → 去重,保留 a
  const r = dedupeProposals(arr, 0.7);
  assert.equal(r[0].id, 'a');
  assert.equal(r.length, 1);
});

test('dedupeProposals: 输入不被修改', () => {
  const arr = [
    { id: '1', title: 'a b' },
    { id: '2', title: 'a b' },
  ];
  const original = JSON.parse(JSON.stringify(arr));
  dedupeProposals(arr);
  assert.deepEqual(arr, original);
});

test('dedupeProposals: 返回新数组 (非引用)', () => {
  const arr = [{ id: '1', title: 'foo' }];
  const r = dedupeProposals(arr);
  assert.notEqual(r, arr);
});

test('dedupeProposals: 数字字符视作 word', () => {
  // 含数字字符的 token 算 word
  const arr = [
    { id: '1', title: 'foo 123 bar' },
    { id: '2', title: 'foo 456 bar' },
  ];
  // 共享 foo + bar → 2/4 = 0.5 → 默认阈值 0.8 不去重
  const r = dedupeProposals(arr);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 中文标题 → 全部当 stop-char 过滤', () => {
  // 中文非 a-z0-9,会被过滤掉 → 空集合
  const arr = [
    { id: '1', title: '你好' },
    { id: '2', title: '世界' },
  ];
  // 双方空集合,jaccard 返回 0 → 默认 0.8 阈值不去重
  const r = dedupeProposals(arr);
  assert.equal(r.length, 2);
});

test('dedupeProposals: 3+ 重复链式去重', () => {
  const arr = [
    { id: '1', title: 'apple banana cherry' },
    { id: '2', title: 'apple banana cherry date' },
    { id: '3', title: 'apple banana cherry date elephant' },
  ];
  const r = dedupeProposals(arr);
  // id 2 vs id 1: Jaccard = 3/4 = 0.75 < 0.8 → 保留
  // id 3 vs id 2: 4/5 = 0.8 ≥ 0.8 → 去重
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((p) => p.id), ['1', '2']);
});

test('dedupeProposals: 多个空格折叠', () => {
  // split(/\s+/) 处理连续空白
  const arr = [
    { id: '1', title: 'foo   bar' },
    { id: '2', title: 'foo bar' },
  ];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 1);
});

test('dedupeProposals: 前后空白 trim via split', () => {
  const arr = [
    { id: '1', title: '   foo bar   ' },
    { id: '2', title: 'foo bar' },
  ];
  const r = dedupeProposals(arr);
  assert.equal(r.length, 1);
});
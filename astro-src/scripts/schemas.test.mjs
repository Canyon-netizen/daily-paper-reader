#!/usr/bin/env node
// astro-src/scripts/schemas.test.mjs
//
// Tests for R7 polish: astro-src/lib/schemas.ts re-exports.
// Tests normalize functions from llm-clean/normalize.ts and buildCategories/categoriesToYamlInline from taxonomies.ts.

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
    external: ['node:*'],
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/schemas.ts');
const {
  normalizeAliasToken,
  normalizeAliases,
  normalizeQuery,
  clampText,
  clampStringArray,
  buildCategories,
  categoriesToYamlInline,
} = mod;

// ---------- normalizeAliasToken ----------
test('normalizeAliasToken: 空输入 → 空字符串', () => {
  assert.equal(normalizeAliasToken(null), '');
  assert.equal(normalizeAliasToken(undefined), '');
  assert.equal(normalizeAliasToken(123), '');
});

test('normalizeAliasToken: 去除中文字符和标点', () => {
  assert.equal(normalizeAliasToken('hello world!'), 'hello world');
  assert.equal(normalizeAliasToken('RL/Agent'), 'RL Agent');
});

test('normalizeAliasToken: 多个空格合并为一个', () => {
  assert.equal(normalizeAliasToken('hello    world'), 'hello world');
});

test('normalizeAliasToken: 保留英文数字连字符下划线', () => {
  assert.equal(normalizeAliasToken('self-distillation_v2'), 'self-distillation_v2');
});

// ---------- normalizeAliases ----------
test('normalizeAliases: 非数组输入 → 空数组', () => {
  assert.deepEqual(normalizeAliases(null, 'query'), []);
  assert.deepEqual(normalizeAliases(undefined, 'query'), []);
  assert.deepEqual(normalizeAliases('not array', 'query'), []);
});

test('normalizeAliases: 过滤掉 primaryQuery 自己', () => {
  const result = normalizeAliases(['query', 'other'], 'query');
  assert.equal(result.includes('query'), false);
});

test('normalizeAliases: 去重', () => {
  const result = normalizeAliases(['RL', 'rl', 'rl'], 'main');
  assert.deepEqual(result, ['RL']);
});

test('normalizeAliases: 过滤中文', () => {
  const result = normalizeAliases(['强化学习', 'RL'], 'main');
  assert.deepEqual(result, ['RL']);
});

// ---------- normalizeQuery ----------
test('normalizeQuery: 非字符串输入 → 空字符串', () => {
  assert.equal(normalizeQuery(null), '');
  assert.equal(normalizeQuery(undefined), '');
  assert.equal(normalizeQuery(123), '');
});

test('normalizeQuery: 去除中文字符', () => {
  assert.equal(normalizeQuery('强化学习 RL'), 'RL');
  assert.equal(normalizeQuery('测试 query'), 'query');
});

test('normalizeQuery: 截取前6个token', () => {
  const q = 'a b c d e f g h';
  assert.equal(normalizeQuery(q), 'a b c d e f');
});

test('normalizeQuery: 保留英文数字连字符下划线', () => {
  assert.equal(normalizeQuery('self-distillation_v2'), 'self-distillation_v2');
});

// ---------- clampText ----------
test('clampText: 空输入 → 空字符串', () => {
  assert.equal(clampText(null, 100), '');
  assert.equal(clampText(undefined, 100), '');
  assert.equal(clampText('', 100), '');
});

test('clampText: 短文本不过截断', () => {
  assert.equal(clampText('hello', 100), 'hello');
});

test('clampText: 超过max长度 → 截断+省略号', () => {
  const result = clampText('hello world foo bar baz', 15);
  assert.equal(result.length, 16); // 15 + 1省略号
  assert.match(result, /^hello world foo…$/);
});

test('clampText: 正好max长度 → 不过截断', () => {
  assert.equal(clampText('12345', 5), '12345');
});

// ---------- clampStringArray ----------
test('clampStringArray: 非数组输入 → 空数组', () => {
  assert.deepEqual(clampStringArray(null, 5, 10), []);
  assert.deepEqual(clampStringArray(undefined, 5, 10), []);
});

test('clampStringArray: 限制数组长度', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const result = clampStringArray(arr, 3, 10);
  assert.equal(result.length, 3);
});

test('clampStringArray: 每个元素也限制长度', () => {
  const arr = ['short', 'this is very long text here'];
  const result = clampStringArray(arr, 5, 10);
  assert.equal(result[0], 'short');
  assert.equal(result[1].length, 11); // 10 + 省略号
});

test('clampStringArray: 过滤空字符串', () => {
  const arr = ['a', '', 'b', '   ', 'c'];
  const result = clampStringArray(arr, 5, 10);
  assert.deepEqual(result, ['a', 'b', 'c']);
});

// ---------- buildCategories ----------
test('buildCategories: 空输入 → 全空数组', () => {
  const result = buildCategories();
  assert.deepEqual(result, { venue: [], task: [], method: [], type: [] });
});

test('buildCategories: venue 直接放行', () => {
  const result = buildCategories({ venue: ['ICML 2025', 'NeurIPS 2024'] });
  assert.deepEqual(result.venue, ['ICML 2025', 'NeurIPS 2024']);
});

test('buildCategories: task 白名单过滤', () => {
  const result = buildCategories({ task: ['rl', 'invalid-task', 'agent'] });
  assert.deepEqual(result.task, ['rl', 'agent']);
});

test('buildCategories: method 白名单过滤', () => {
  const result = buildCategories({ method: ['distillation', 'invalid'] });
  assert.deepEqual(result.method, ['distillation']);
});

test('buildCategories: type 白名单过滤', () => {
  const result = buildCategories({ type: ['benchmark', 'invalid-type'] });
  assert.deepEqual(result.type, ['benchmark']);
});

test('buildCategories: 大小写不敏感', () => {
  const result = buildCategories({ task: ['RL', 'AGENT', 'rl'] });
  assert.deepEqual(result.task, ['rl', 'agent']);
});

test('buildCategories: 去重保序', () => {
  const result = buildCategories({ task: ['rl', 'agent', 'rl'] });
  assert.deepEqual(result.task, ['rl', 'agent']);
});

test('buildCategories: 过滤空字符串', () => {
  const result = buildCategories({ task: ['rl', '', '  ', 'agent'] });
  assert.deepEqual(result.task, ['rl', 'agent']);
});

// ---------- categoriesToYamlInline ----------
test('categoriesToYamlInline: 空categories', () => {
  const result = categoriesToYamlInline({
    venue: [],
    task: [],
    method: [],
    type: [],
  });
  assert.equal(result, '{ venue: [], task: [], method: [], type: [] }');
});

test('categoriesToYamlInline: 带值', () => {
  const result = categoriesToYamlInline({
    venue: ['ICML 2025'],
    task: ['rl'],
    method: [],
    type: ['benchmark'],
  });
  assert.equal(result, '{ venue: ["ICML 2025"], task: ["rl"], method: [], type: ["benchmark"] }');
});

test('categoriesToYamlInline: 转义引号', () => {
  const result = categoriesToYamlInline({
    venue: ['test "quote"'],
    task: [],
    method: [],
    type: [],
  });
  assert.equal(result, '{ venue: ["test \\"quote\\""], task: [], method: [], type: [] }');
});

#!/usr/bin/env node
// astro-src/scripts/llm-clean-normalize.test.mjs
//
// Tests for R7 polish: astro-src/lib/llm-clean/normalize.ts.

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

const mod = await loadTs('lib/llm-clean/normalize.ts');
const {
  normalizeAliasToken,
  normalizeAliases,
  normalizeQuery,
  clampText,
  clampStringArray,
} = mod;

// ---------- normalizeAliasToken ----------
test('normalizeAliasToken: 空 → ""', () => {
  assert.equal(normalizeAliasToken(''), '');
  assert.equal(normalizeAliasToken('   '), '');
});

test('normalizeAliasToken: 非 string → ""', () => {
  assert.equal(normalizeAliasToken(null), '');
  assert.equal(normalizeAliasToken(123), '');
  assert.equal(normalizeAliasToken(undefined), '');
});

test('normalizeAliasToken: ASCII token 保留', () => {
  assert.equal(normalizeAliasToken('rl-agent'), 'rl-agent');
});

test('normalizeAliasToken: 中文替换为空格', () => {
  // 中文都被替换为单空格,然后折叠
  const r = normalizeAliasToken('中文 token');
  assert.equal(r, 'token');
  assert.ok(!r.includes('中'));
});

test('normalizeAliasToken: 标点替换为单空格', () => {
  const r = normalizeAliasToken('foo.bar,baz');
  // . , → 空格,折叠为单
  assert.equal(r, 'foo bar baz');
});

// ---------- normalizeAliases ----------
test('normalizeAliases: 空数组 → []', () => {
  assert.deepEqual(normalizeAliases([], 'rl'), []);
});

test('normalizeAliases: undefined → []', () => {
  assert.deepEqual(normalizeAliases(undefined, 'rl'), []);
});

test('normalizeAliases: 非数组 → []', () => {
  assert.deepEqual(normalizeAliases('foo', 'rl'), []);
});

test('normalizeAliases: 去空/去重/去主 query', () => {
  const r = normalizeAliases(['rl', 'reinforcement', 'rl', 'cv', 'RL'], 'rl');
  // 'rl' 是主 query, 'RL' lower == 'rl' → 去掉; 'reinforcement','cv' 保留
  assert.deepEqual(r, ['reinforcement', 'cv']);
});

test('normalizeAliases: 大小写合并', () => {
  const r = normalizeAliases(['RL', 'rl', 'Rl'], 'cv');
  assert.deepEqual(r, ['RL']);
});

// ---------- normalizeQuery ----------
test('normalizeQuery: 空 → ""', () => {
  assert.equal(normalizeQuery(''), '');
  assert.equal(normalizeQuery('   '), '');
  assert.equal(normalizeQuery(null), '');
});

test('normalizeQuery: 纯中文 → ""', () => {
  assert.equal(normalizeQuery('强化学习'), '');
});

test('normalizeQuery: ASCII 保留', () => {
  assert.equal(normalizeQuery('reinforcement learning'), 'reinforcement learning');
});

test('normalizeQuery: 中英混合 → 去掉中文', () => {
  assert.equal(normalizeQuery('强化 learning'), 'learning');
});

test('normalizeQuery: 标点替换', () => {
  assert.equal(normalizeQuery('foo,bar.baz'), 'foo bar baz');
});

test('normalizeQuery: 多空白折叠', () => {
  assert.equal(normalizeQuery('a   b    c'), 'a b c');
});

test('normalizeQuery: 截前 6 token', () => {
  assert.equal(normalizeQuery('a b c d e f g h'), 'a b c d e f');
});

test('normalizeQuery: 正好 6 token 不截', () => {
  assert.equal(normalizeQuery('a b c d e f'), 'a b c d e f');
});

// ---------- clampText ----------
test('clampText: 空 → ""', () => {
  assert.equal(clampText('', 10), '');
  assert.equal(clampText(null, 10), '');
  assert.equal(clampText(undefined, 10), '');
});

test('clampText: 短于 max 原样', () => {
  assert.equal(clampText('hello', 10), 'hello');
});

test('clampText: 等于 max 不截', () => {
  assert.equal(clampText('0123456789', 10), '0123456789');
});

test('clampText: 长于 max 截断 + …', () => {
  assert.equal(clampText('0123456789abc', 10), '0123456789…');
});

test('clampText: 两端空白裁剪', () => {
  assert.equal(clampText('  hello  ', 20), 'hello');
});

test('clampText: 非 string 强转', () => {
  assert.equal(clampText(12345, 3), '123…');
});

// ---------- clampStringArray ----------
test('clampStringArray: 非数组 → []', () => {
  assert.deepEqual(clampStringArray(null, 10, 100), []);
  assert.deepEqual(clampStringArray('foo', 10, 100), []);
});

test('clampStringArray: 过滤空字符串', () => {
  assert.deepEqual(clampStringArray(['a', '', 'b', '  '], 10, 100), ['a', 'b']);
});

test('clampStringArray: maxLen 限制总数', () => {
  const r = clampStringArray(['a', 'b', 'c', 'd', 'e'], 3, 100);
  assert.deepEqual(r, ['a', 'b', 'c']);
});

test('clampStringArray: eachMax 限制每条长度', () => {
  const r = clampStringArray(['hello world'], 10, 5);
  assert.deepEqual(r, ['hello…']);
});

test('clampStringArray: maxLen=0 → 第一项即满', () => {
  // 实际行为:push 'a' 后 length=1 >= 0 → break,返回 ['a']
  const r = clampStringArray(['a'], 0, 100);
  assert.deepEqual(r, ['a']);
});

#!/usr/bin/env node
// astro-src/scripts/highlight-locate.test.mjs
//
// Tests for R7 polish: astro-src/lib/user-library/highlights.ts::locateHighlight.

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

const mod = await loadTs('lib/user-library/highlights.ts');
const { locateHighlight } = mod;

function h(text) {
  return { id: '1', canonicalId: 'x', text, note: '', createdAt: 0 };
}

test('locateHighlight: 找到单一出现', () => {
  assert.deepEqual(locateHighlight('hello world', h('world')), [6]);
});

test('locateHighlight: 多个出现都列出', () => {
  assert.deepEqual(locateHighlight('ababab', h('ab')), [0, 2, 4]);
});

test('locateHighlight: 重叠匹配', () => {
  // 'aa' 在 'aaaa' 中找到两次 (0, 2),不重叠
  assert.deepEqual(locateHighlight('aaaa', h('aa')), [0, 2]);
});

test('locateHighlight: 不存在 → []', () => {
  assert.deepEqual(locateHighlight('hello', h('xyz')), []);
});

test('locateHighlight: 空高亮 text → []', () => {
  assert.deepEqual(locateHighlight('hello', h('')), []);
});

test('locateHighlight: 空高亮 + 空 text → []', () => {
  assert.deepEqual(locateHighlight('', h('')), []);
});

test('locateHighlight: text 比源还长 → []', () => {
  assert.deepEqual(locateHighlight('hi', h('hello')), []);
});

test('locateHighlight: 大小写敏感', () => {
  // 大写不匹配小写
  assert.deepEqual(locateHighlight('Hello', h('hello')), []);
});

test('locateHighlight: 命中 text 开头', () => {
  assert.deepEqual(locateHighlight('hello world', h('hello')), [0]);
});

test('locateHighlight: 命中 text 末尾', () => {
  assert.deepEqual(locateHighlight('hello world', h('world')), [6]);
});

test('locateHighlight: 中文命中', () => {
  const text = '深度学习是机器学习的一个分支';
  const hl = h('机器学习');
  assert.deepEqual(locateHighlight(text, hl), [5]);
});

test('locateHighlight: 多个高亮位置正确', () => {
  const text = 'foo bar foo baz foo';
  const hl = h('foo');
  assert.deepEqual(locateHighlight(text, hl), [0, 8, 16]);
});
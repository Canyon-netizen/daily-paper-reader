#!/usr/bin/env node
// astro-src/scripts/writing-wordcount.test.mjs
//
// Tests for R7 polish: astro-src/lib/writing/wordcount.ts.
// estimateWords + estimateChineseChars + estimateEnglishWords。

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

const mod = await loadTs('lib/writing/wordcount.ts');
const { estimateWords, estimateChineseChars, estimateEnglishWords } = mod;

// ---------- estimateWords: 基本 ----------
test('estimateWords: 空字符串', () => {
  assert.deepEqual(estimateWords(''), { chinese: 0, english: 0, total: 0 });
});

test('estimateWords: undefined', () => {
  assert.deepEqual(estimateWords(undefined), { chinese: 0, english: 0, total: 0 });
});

test('estimateWords: null', () => {
  assert.deepEqual(estimateWords(null), { chinese: 0, english: 0, total: 0 });
});

test('estimateWords: 非字符串', () => {
  assert.deepEqual(estimateWords(123), { chinese: 0, english: 0, total: 0 });
});

// ---------- 中文 ----------
test('estimateWords: 纯中文 4 字', () => {
  const r = estimateWords('机器学习');
  assert.equal(r.chinese, 4);
  assert.equal(r.english, 0);
  assert.equal(r.total, 4);
});

test('estimateWords: 中文含标点 (全角也算 CJK)', () => {
  const r = estimateWords('你好，世界。');
  // '你','好','，','世','界','。' 全角标点也在 CJK_RE 范围内
  assert.equal(r.chinese, 6);
});

test('estimateWords: 中文含 ASCII 标点', () => {
  const r = estimateWords('hello, world!');
  // ASCII 标点不在 CJK_RE
  assert.equal(r.chinese, 0);
  // 'hello, world!' split by whitespace → ['hello,', 'world!']
  // 长度 > 0 且含 a-z → 2 词
  assert.equal(r.english, 2);
});

test('estimateWords: 中文含日文', () => {
  // ひらがな / カタカナ 在 CJK_RE 内
  const r = estimateWords('こんにちは');
  assert.equal(r.chinese, 5);
});

// ---------- 英文 ----------
test('estimateWords: 英文 3 词', () => {
  const r = estimateWords('hello world foo');
  assert.equal(r.english, 3);
  assert.equal(r.chinese, 0);
});

test('estimateWords: 英文大小写', () => {
  const r = estimateWords('Hello WORLD Foo');
  assert.equal(r.english, 3);
});

test('estimateWords: 英文多空白', () => {
  const r = estimateWords('hello    world');
  assert.equal(r.english, 2);
});

test('estimateWords: 英文仅数字不算词', () => {
  const r = estimateWords('123 456 hello');
  // '123','456' 不含 a-zA-Z → 过滤
  assert.equal(r.english, 1);
});

test('estimateWords: 英文单字符过滤', () => {
  // 实现:filter(word => length > 0 && /[a-zA-Z]/.test(word))
  // 'a' length > 0 且含 a-z → 算 1 词
  const r = estimateWords('a b c');
  assert.equal(r.english, 3);
});

test('estimateWords: 仅标点', () => {
  assert.equal(estimateWords('!!! ???').english, 0);
});

// ---------- 混合 ----------
test('estimateWords: 中英混合', () => {
  const r = estimateWords('机器学习 machine learning');
  assert.equal(r.chinese, 4);
  assert.equal(r.english, 2);
  assert.equal(r.total, 6);
});

test('estimateWords: 中英混合分总 = chinese + english', () => {
  const r = estimateWords('今天 weather is good');
  assert.equal(r.total, r.chinese + r.english);
});

// ---------- estimateChineseChars ----------
test('estimateChineseChars: 空', () => {
  assert.equal(estimateChineseChars(''), 0);
});

test('estimateChineseChars: 4 字', () => {
  assert.equal(estimateChineseChars('机器学习'), 4);
});

test('estimateChineseChars: 含英文 0', () => {
  assert.equal(estimateChineseChars('hello'), 0);
});

test('estimateChineseChars: undefined → 0', () => {
  assert.equal(estimateChineseChars(undefined), 0);
});

test('estimateChineseChars: null → 0', () => {
  assert.equal(estimateChineseChars(null), 0);
});

test('estimateChineseChars: 非字符串 → 0', () => {
  assert.equal(estimateChineseChars(123), 0);
});

// ---------- estimateEnglishWords ----------
test('estimateEnglishWords: 空', () => {
  assert.equal(estimateEnglishWords(''), 0);
});

test('estimateEnglishWords: 3 词', () => {
  assert.equal(estimateEnglishWords('foo bar baz'), 3);
});

test('estimateEnglishWords: undefined → 0', () => {
  assert.equal(estimateEnglishWords(undefined), 0);
});

test('estimateEnglishWords: null → 0', () => {
  assert.equal(estimateEnglishWords(null), 0);
});

test('estimateEnglishWords: 仅数字 → 0', () => {
  assert.equal(estimateEnglishWords('123 456'), 0);
});

test('estimateEnglishWords: 含中文 0', () => {
  assert.equal(estimateEnglishWords('机器学习'), 0);
});

test('estimateEnglishWords: 中英混合只数英文', () => {
  assert.equal(estimateEnglishWords('hello 机器 world'), 2);
});

test('estimateEnglishWords: 多空白 → 1', () => {
  assert.equal(estimateEnglishWords('foo   bar'), 2);
});
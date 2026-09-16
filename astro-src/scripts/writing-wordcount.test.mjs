#!/usr/bin/env node
// astro-src/scripts/writing-wordcount.test.mjs
//
// Tests for R7 polish: astro-src/lib/writing/wordcount.ts.

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

const mod = await loadTs('lib/writing/wordcount.ts');
const { estimateWords, estimateChineseChars, estimateEnglishWords } = mod;

test('estimateWords: 空字符串 → 全 0', () => {
  assert.deepEqual(estimateWords(''), { chinese: 0, english: 0, total: 0 });
});

test('estimateWords: null → 全 0', () => {
  assert.deepEqual(estimateWords(null), { chinese: 0, english: 0, total: 0 });
});

test('estimateWords: undefined → 全 0', () => {
  assert.deepEqual(estimateWords(undefined), { chinese: 0, english: 0, total: 0 });
});

test('estimateWords: 纯中文', () => {
  const r = estimateWords('你好世界');
  assert.equal(r.chinese, 4);
  assert.equal(r.english, 0);
  assert.equal(r.total, 4);
});

test('estimateWords: 纯英文', () => {
  const r = estimateWords('hello world this is a test');
  assert.equal(r.chinese, 0);
  assert.equal(r.english, 6);
  assert.equal(r.total, 6);
});

test('estimateWords: 中英混合', () => {
  const r = estimateWords('今天 weather is 不错');
  // 中:今天,不错(4 chars) + 英:weather, is(2 words) = 6
  // 但 'is' 是英文词
  assert.equal(r.chinese, 4);
  assert.equal(r.english, 2);
  assert.equal(r.total, 6);
});

test('estimateWords: 数字不计入英文', () => {
  // 数字无 a-z 字符 → 不算英文词
  const r = estimateWords('123 456');
  assert.equal(r.english, 0);
});

test('estimateWords: 标点不计入', () => {
  const r = estimateWords('hello, world!');
  assert.equal(r.english, 2);
});

test('estimateChineseChars: 空 → 0', () => {
  assert.equal(estimateChineseChars(''), 0);
});

test('estimateChineseChars: 中文文本', () => {
  assert.equal(estimateChineseChars('今天天气真好'), 6);
});

test('estimateChineseChars: 含 CJK 标点也算', () => {
  // CJK 标点 ',' '。' 在 regex 范围内 → 6
  assert.equal(estimateChineseChars('你好，世界。'), 6);
});

test('estimateEnglishWords: 空 → 0', () => {
  assert.equal(estimateEnglishWords(''), 0);
});

test('estimateEnglishWords: 多词', () => {
  assert.equal(estimateEnglishWords('a b c d'), 4);
});

test('estimateEnglishWords: 含数字不算词', () => {
  assert.equal(estimateEnglishWords('a 1 b'), 2);
});

test('estimateEnglishWords: 多个空白折叠', () => {
  // 折叠后 'a b' → 2 words
  assert.equal(estimateEnglishWords('a    b'), 2);
});
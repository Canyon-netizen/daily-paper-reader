#!/usr/bin/env node
// astro-src/scripts/wordcount.test.mjs
//
// Tests for R7 WP.5: word count estimator.

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
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/writing/wordcount.ts');
const { estimateWords, estimateChineseChars, estimateEnglishWords } = mod;

test('estimateWords: 纯中文', () => {
  const result = estimateWords('这是一段中文文本');
  assert.equal(result.chinese, 8);
  assert.equal(result.english, 0);
  assert.equal(result.total, 8);
});

test('estimateWords: 纯英文', () => {
  const result = estimateWords('This is an English text');
  assert.equal(result.chinese, 0);
  assert.equal(result.english, 5);
  assert.equal(result.total, 5);
});

test('estimateWords: 中英混合', () => {
  const result = estimateWords('这是中文 English mixed 混合文本');
  assert.equal(result.chinese, 8);
  assert.equal(result.english, 3);
  assert.equal(result.total, 11);
});

test('estimateWords: 空字符串', () => {
  const result = estimateWords('');
  assert.equal(result.total, 0);
});

test('estimateWords: null/undefined', () => {
  const result = estimateWords(null);
  assert.equal(result.total, 0);
  const result2 = estimateWords(undefined);
  assert.equal(result2.total, 0);
});

test('estimateWords: 包含数字和符号', () => {
  const result = estimateWords('测试123 test! @#$%');
  assert.ok(result.total > 0);
});

test('estimateChineseChars: 纯中文', () => {
  const result = estimateChineseChars('中文测试');
  assert.equal(result, 4);
});

test('estimateEnglishWords: 纯英文', () => {
  const result = estimateEnglishWords('Hello world test');
  assert.equal(result, 3);
});

test('estimateWords: unicode/CJK mixing', () => {
  const result = estimateWords('日本語テスト English 日本語');
  assert.ok(result.chinese > 0);  // 日文字符也算 CJK
  assert.ok(result.english > 0);
});

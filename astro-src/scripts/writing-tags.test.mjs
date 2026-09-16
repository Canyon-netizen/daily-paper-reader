#!/usr/bin/env node
// astro-src/scripts/writing-tags.test.mjs
//
// Tests for R7 WP.6: extractKeywords.

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

const mod = await loadTs('lib/writing/tags.ts');
const { extractKeywords, extractCommonKeywords } = mod;

test('extractKeywords: 基本提取', () => {
  const text = 'deep learning neural network machine learning';
  const keywords = extractKeywords(text);
  assert.ok(keywords.length > 0);
  assert.ok(keywords.includes('learning'));
});

test('extractKeywords: 过滤停用词', () => {
  const text = 'the and or but in on at machine learning';
  const keywords = extractKeywords(text);
  assert.ok(!keywords.includes('the'));
  assert.ok(!keywords.includes('and'));
});

test('extractKeywords: topN 参数', () => {
  const text = 'apple banana cherry date elderberry fig grape hazelnut';
  const keywords = extractKeywords(text, { topN: 5 });
  assert.equal(keywords.length, 5);
});

test('extractKeywords: minLength 参数', () => {
  const text = 'a aa aaa b bb bbb';
  const keywords = extractKeywords(text, { minLength: 3 });
  assert.ok(!keywords.includes('a'));
  assert.ok(!keywords.includes('aa'));
  assert.ok(keywords.includes('aaa'));
});

test('extractKeywords: 空文本', () => {
  const keywords = extractKeywords('');
  assert.deepEqual(keywords, []);
});

test('extractCommonKeywords: 单文本', () => {
  const texts = ['deep learning neural network'];
  const keywords = extractCommonKeywords(texts);
  assert.ok(keywords.length > 0);
});

test('extractCommonKeywords: 多文本取交集', () => {
  const texts = [
    'deep learning neural network',
    'deep learning transformer',
    'neural network deep learning',
  ];
  const keywords = extractCommonKeywords(texts);
  // 应该有 'deep' 和 'learning' 在内
  assert.ok(keywords.includes('deep') || keywords.includes('learning'));
});

test('extractKeywords: 区分大小写', () => {
  const text = 'Deep Learning deep learning';
  const keywords = extractKeywords(text, { caseSensitive: true });
  assert.ok(keywords.includes('Deep'));
  assert.ok(keywords.includes('deep'));
});

test('extractKeywords: 中文支持', () => {
  const text = '深度学习 神经网络 机器学习';
  const keywords = extractKeywords(text);
  // 中文应该被提取
  assert.ok(keywords.length > 0);
});

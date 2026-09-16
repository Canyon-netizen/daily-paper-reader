#!/usr/bin/env node
// astro-src/scripts/dom-utils.test.mjs
//
// Tests for R7 polish: astro-src/lib/dom-utils.ts HTML escape + debounce.

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
    external: ['./arxiv.mjs', '../arxiv.mjs'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/dom-utils.ts');
const { escapeHtml, debounce } = mod;

test('escapeHtml: 普通文本不变', () => {
  assert.equal(escapeHtml('hello world'), 'hello world');
});

test('escapeHtml: 空字符串', () => {
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml: 非字符串 → null', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '');
  assert.equal(escapeHtml({}), '');
});

test('escapeHtml: < > 转义', () => {
  assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
});

test('escapeHtml: & 转义', () => {
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
});

test('escapeHtml: " 转义', () => {
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
});

test('escapeHtml: \' 转义', () => {
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escapeHtml: 综合 HTML', () => {
  const out = escapeHtml('<a href="x" class=\'y\'>foo & bar</a>');
  assert.equal(out, '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;foo &amp; bar&lt;/a&gt;');
});

test('escapeHtml: & 转义先于其他(避免重复转义)', () => {
  // & 必须先被替换,否则后续替换会再次把 & 转义
  const out = escapeHtml('&lt;');
  assert.equal(out, '&amp;lt;');
});

test('debounce: 立即连续调用,只执行最后一次', async () => {
  let count = 0;
  const fn = debounce(() => count++, 20);
  fn();
  fn();
  fn();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(count, 1);
});

test('debounce: ms 内重复调用会被取消', async () => {
  let count = 0;
  const fn = debounce(() => count++, 50);
  fn();
  await new Promise((r) => setTimeout(r, 10));
  fn();
  await new Promise((r) => setTimeout(r, 10));
  fn();
  // 总共耗时 ~30ms,小于 50ms,不应执行
  assert.equal(count, 0);
});

test('debounce: 传递参数', async () => {
  let lastArg = null;
  const fn = debounce((x) => {
    lastArg = x;
  }, 20);
  fn('hello');
  fn('world');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lastArg, 'world');
});

test('debounce: ms 后执行', async () => {
  let count = 0;
  const fn = debounce(() => count++, 20);
  fn();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(count, 1);
});

test('debounce: 多次独立调用各自执行', async () => {
  let count = 0;
  const fn = debounce(() => count++, 20);
  fn();
  await new Promise((r) => setTimeout(r, 50));
  fn();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(count, 2);
});

test('debounce: 返回类型是函数(签名保持)', () => {
  const fn = debounce(() => {}, 10);
  assert.equal(typeof fn, 'function');
});
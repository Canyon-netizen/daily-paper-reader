#!/usr/bin/env node
// astro-src/scripts/dom-utils.test.mjs
//
// Tests for R7 polish: astro-src/lib/dom-utils.ts.
// escapeHtml + debounce (timing) + canonicalArxivId (re-export)。

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

const mod = await loadTs('lib/dom-utils.ts');
const { escapeHtml, debounce, canonicalArxivId } = mod;

// ---------- escapeHtml ----------
test('escapeHtml: & → &amp;', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml: < → &lt;', () => {
  assert.equal(escapeHtml('<'), '&lt;');
});

test('escapeHtml: > → &gt;', () => {
  assert.equal(escapeHtml('>'), '&gt;');
});

test('escapeHtml: " → &quot;', () => {
  assert.equal(escapeHtml('"'), '&quot;');
});

test('escapeHtml: \' → &#39;', () => {
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml: 全部 5 字符', () => {
  assert.equal(escapeHtml(`<script>"foo" & 'bar'</script>`),
    '&lt;script&gt;&quot;foo&quot; &amp; &#39;bar&#39;&lt;/script&gt;');
});

test('escapeHtml: & 先转义 (避免 & 重复转义)', () => {
  // '<' → '&lt;', '&' → '&amp;' 顺序很重要
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('&'), '&amp;');
});

test('escapeHtml: undefined → 空', () => {
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: null → 空', () => {
  assert.equal(escapeHtml(null), '');
});

test('escapeHtml: number → 空', () => {
  assert.equal(escapeHtml(123), '');
});

test('escapeHtml: 数组 → 空', () => {
  assert.equal(escapeHtml([]), '');
});

test('escapeHtml: 空字符串', () => {
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml: 普通文本不变', () => {
  assert.equal(escapeHtml('hello world'), 'hello world');
});

test('escapeHtml: 中文不变', () => {
  assert.equal(escapeHtml('你好'), '你好');
});

// ---------- debounce ----------
test('debounce: 多次调用只触发最后一次', async () => {
  let count = 0;
  const fn = debounce(() => count++, 20);
  fn();
  fn();
  fn();
  // 等过 ms
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(count, 1);
});

test('debounce: 调用最后一次的参数', async () => {
  let lastArg = '';
  const fn = debounce((x) => { lastArg = x; }, 20);
  fn('a');
  fn('b');
  fn('c');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lastArg, 'c');
});

test('debounce: 调用间隔足够则多次触发', async () => {
  let count = 0;
  const fn = debounce(() => count++, 20);
  fn();
  await new Promise((r) => setTimeout(r, 30));
  fn();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(count, 2);
});

test('debounce: 返回函数', () => {
  const fn = debounce(() => {}, 100);
  assert.equal(typeof fn, 'function');
});

// ---------- canonicalArxivId re-export ----------
test('canonicalArxivId: 剥 v 后缀', () => {
  assert.equal(canonicalArxivId('2310.12345v2'), '2310.12345');
});

test('canonicalArxivId: 无 v 后缀', () => {
  assert.equal(canonicalArxivId('2310.12345'), '2310.12345');
});
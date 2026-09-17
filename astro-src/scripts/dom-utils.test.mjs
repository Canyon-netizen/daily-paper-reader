#!/usr/bin/env node
// astro-src/scripts/dom-utils.test.mjs
//
// Tests for R7 polish: astro-src/lib/dom-utils.ts.
// debounce + escapeHtml + canonicalArxivId (re-export) + $ (DOM)。

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

const mod = await loadTs('lib/dom-utils.ts');
const { debounce, escapeHtml, canonicalArxivId, $ } = mod;

// ---------- debounce ---
test('debounce: 立即多次调用 → 只执行最后一次', async () => {
  let called = 0;
  let lastArg = null;
  const fn = debounce((x) => { called++; lastArg = x; }, 30);
  fn(1);
  fn(2);
  fn(3);
  assert.equal(called, 0); // 还没触发
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(called, 1);
  assert.equal(lastArg, 3);
});

test('debounce: 间隔足够 → 多次触发', async () => {
  let called = 0;
  const fn = debounce(() => { called++; }, 30);
  fn();
  await new Promise((r) => setTimeout(r, 50));
  fn();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(called, 2);
});

test('debounce: 透传多个参数', async () => {
  let got = null;
  const fn = debounce((a, b, c) => { got = [a, b, c]; }, 20);
  fn(1, 'x', true);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(got, [1, 'x', true]);
});

test('debounce: ms=0 也行(异步)', async () => {
  let called = 0;
  const fn = debounce(() => { called++; }, 0);
  fn();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(called, 1);
});

test('debounce: 连续触发 取消前一次', async () => {
  let calls = [];
  const fn = debounce((x) => calls.push(x), 20);
  fn('a');
  await new Promise((r) => setTimeout(r, 5));
  fn('b'); // 重置定时器
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls, ['b']);
});

// ---------- escapeHtml ---
test('escape: 纯字符串不变', () => {
  assert.equal(escapeHtml('hello'), 'hello');
});

test('escape: & → &amp;', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escape: < → &lt;', () => {
  assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
});

test('escape: > → &gt;', () => {
  assert.equal(escapeHtml('a > b'), 'a &gt; b');
});

test('escape: " → &quot;', () => {
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
});

test("escape: ' → &#39;", () => {
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escape: 全部转义', () => {
  assert.equal(escapeHtml(`<a href="x">'&</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
});

test('escape: undefined → ""', () => {
  assert.equal(escapeHtml(undefined), '');
});

test('escape: null → ""', () => {
  assert.equal(escapeHtml(null), '');
});

test('escape: 数字 → ""(typeof !== "string")', () => {
  assert.equal(escapeHtml(42), '');
});

test('escape: 对象 → ""(typeof !== "string")', () => {
  assert.equal(escapeHtml({ x: 1 }), '');
});

test('escape: 顺序敏感 (& 必须先于其他)', () => {
  // & → &amp; 后面的 lt/gt/quot 不再被误转
  // 如果 & 在 < 之后,会变成 &amp;lt; 但 &amp; 又会被处理 → 死循环
  assert.equal(escapeHtml('&<>'), '&amp;&lt;&gt;');
});

// ---------- canonicalArxivId (re-export from arxiv.ts) ---
test('canonical: 带 vN → 去掉', () => {
  assert.equal(canonicalArxivId('2607.00483v2'), '2607.00483');
});

test('canonical: 不带版本 → 原样', () => {
  assert.equal(canonicalArxivId('2305.16291'), '2305.16291');
});

test('canonical: 大写 V 也行', () => {
  assert.equal(canonicalArxivId('2607.00483V2'), '2607.00483');
});

test('canonical: 空白 trim', () => {
  assert.equal(canonicalArxivId('  2607.00483v1  '), '2607.00483');
});

test('canonical: 空字符串 → ""', () => {
  assert.equal(canonicalArxivId(''), '');
});

test('canonical: undefined → ""', () => {
  assert.equal(canonicalArxivId(undefined), '');
});

test('canonical: 含多个 v → 只剥最后一个', () => {
  // "abcv2v3" → 不匹配 ARXIV 格式,但 .replace(/v\d+$/i, '') 仍剥一次
  assert.equal(canonicalArxivId('abcv2v3'), 'abcv2');
});

test('canonical: 中段 v 不剥', () => {
  // "abcv2xyz" → 末尾不是 vN → 不剥
  assert.equal(canonicalArxivId('abcv2xyz'), 'abcv2xyz');
});

// ---------- $ (DOM lookup) ---
// stub document
const stubElements = new Map();
globalThis.document = {
  getElementById: (id) => stubElements.get(id),
};

test('$: 找到 → 返回元素', () => {
  const el = { id: 'foo', tagName: 'DIV' };
  stubElements.set('foo', el);
  const r = $('foo');
  assert.equal(r, el);
});

test('$: 找不到 → throw', () => {
  stubElements.clear();
  assert.throws(() => $('missing'), /#missing not found/);
});

test('$: 类型参数', () => {
  const el = { id: 'btn', value: 'click' };
  stubElements.set('btn', el);
  // 用 JSDoc 类型提示
  const r = $('btn');
  assert.equal(r.value, 'click');
});

test('$: 空 id → throw', () => {
  stubElements.clear();
  assert.throws(() => $(''), /# not found/);
});
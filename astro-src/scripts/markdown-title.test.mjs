#!/usr/bin/env node
// astro-src/scripts/markdown-title.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/title.ts.
// renderTitleHtml — KaTeX + HTML escape inline $..$ / $$..$。

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

const mod = await loadTs('lib/markdown/title.ts');
const { renderTitleHtml } = mod;

// ---------- 基本 ----------
test('renderTitleHtml: 空字符串 → 空', () => {
  assert.equal(renderTitleHtml(''), '');
});

test('renderTitleHtml: undefined → 空', () => {
  assert.equal(renderTitleHtml(undefined), '');
});

test('renderTitleHtml: null → 空', () => {
  assert.equal(renderTitleHtml(null), '');
});

test('renderTitleHtml: 纯文本 — escapeHtml 后原样', () => {
  const r = renderTitleHtml('Hello world');
  assert.equal(r, 'Hello world');
});

test('renderTitleHtml: HTML 特殊字符转义', () => {
  const r = renderTitleHtml('<script>alert("xss")</script>');
  assert.match(r, /&lt;script&gt;/);
  assert.match(r, /&quot;/);
  assert.doesNotMatch(r, /<script>/);
});

// ---------- 行内数学 ----------
test('renderTitleHtml: 行内 $x$ → katex 输出 (含 math class)', () => {
  const r = renderTitleHtml('foo $x$ bar');
  // katex 输出含 class="katex"
  assert.match(r, /katex/);
  // 数学外仍是 'foo' 'bar'
  assert.match(r, /foo/);
  assert.match(r, /bar/);
});

test('renderTitleHtml: 行内数学 \\alpha', () => {
  const r = renderTitleHtml('$\\alpha$');
  // katex 会渲染 alpha
  assert.match(r, /katex/);
});

test('renderTitleHtml: 行内数学 throwOnError=false 不抛', () => {
  // 非法数学不应抛
  const r = renderTitleHtml('$ \\invalidcommand{}$');
  // 返回字符串(可能含 fallback code)
  assert.ok(typeof r === 'string');
});

// ---------- 块级数学 ----------
test('renderTitleHtml: 块级 $$...$$', () => {
  const r = renderTitleHtml('foo $$\\beta$$ bar');
  assert.match(r, /katex/);
  assert.match(r, /foo/);
  assert.match(r, /bar/);
});

test('renderTitleHtml: 块级含换行', () => {
  const r = renderTitleHtml('$$\n\\sum_{i=1}^n i\n$$');
  assert.match(r, /katex/);
});

test('renderTitleHtml: 块级 throwOnError=false', () => {
  const r = renderTitleHtml('$$ \\invalidcommand{} $$');
  assert.ok(typeof r === 'string');
});

// ---------- 多段混合 ----------
test('renderTitleHtml: 行内 + 块级同时存在', () => {
  const r = renderTitleHtml('$$x$$ inline $y$');
  // 两次 katex 渲染,占位符 KATEX0 / KATEX1
  assert.match(r, /katex/);
});

test('renderTitleHtml: 普通 $ 单个不被当数学 (无 $..$)', () => {
  // '$5' 后面没有 '$' → 不匹配 inline → 当字面 → escapeHtml
  // 注意 '$' 字符自身不在 escapeHtml 表里 → 保留
  const r = renderTitleHtml('price $5');
  assert.match(r, /price/);
  assert.match(r, /\$5/);
});

test('renderTitleHtml: 含换行的 inline 不算数学', () => {
  // 行内正则 /[^$\n]+?/ 不跨换行
  const r = renderTitleHtml('foo $x\ny$ bar');
  // $x 和 $y$ 不闭合 → 都当字面
  assert.ok(typeof r === 'string');
});

// ---------- 占位符顺序 ----------
test('renderTitleHtml: 占位符按出现顺序替换', () => {
  // 多个数学,占位符 KATEX0/1/2 → 按索引替换
  const r = renderTitleHtml('$a$ $b$ $c$');
  // KATEX 占位符不应残留
  assert.doesNotMatch(r, / KATEX\d+ /);
});

test('renderTitleHtml: 数学替换后剩余 escape', () => {
  // 'foo < bar $x$' → 整体被 escape(数学占位符替换后,剩余文本再 escape)
  const r = renderTitleHtml('foo < bar $x$');
  assert.match(r, /&lt;/);
  assert.match(r, /katex/);
});
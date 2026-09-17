#!/usr/bin/env node
// astro-src/scripts/title.test.mjs
//
// Tests for R7 polish: astro-src/lib/title.ts.
// stripTitleMarkup + paperPlainTitle — pure, no deps.

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

const mod = await loadTs('lib/title.ts');
const { stripTitleMarkup, paperPlainTitle } = mod;

// ---------- stripTitleMarkup: 基本 ----------
test('stripTitleMarkup: 普通文本原样', () => {
  assert.equal(stripTitleMarkup('Hello world'), 'Hello world');
});

test('stripTitleMarkup: undefined → 空', () => {
  assert.equal(stripTitleMarkup(undefined), '');
});

test('stripTitleMarkup: null → 空', () => {
  assert.equal(stripTitleMarkup(null), '');
});

test('stripTitleMarkup: 数字转字符串', () => {
  assert.equal(stripTitleMarkup(42), '42');
});

test('stripTitleMarkup: 头尾空白 trim', () => {
  assert.equal(stripTitleMarkup('  hello  '), 'hello');
});

test('stripTitleMarkup: 连续空白合并', () => {
  assert.equal(stripTitleMarkup('hello   world'), 'hello world');
});

test('stripTitleMarkup: \\r\\n → \\n (最终 \\s+ 合并)', () => {
  // 实现末尾 .replace(/\s+/g, ' ') → 折行变单空格
  assert.equal(stripTitleMarkup('a\r\nb'), 'a b');
});

// ---------- stripTitleMarkup: 数学分隔符 ----------
test('stripTitleMarkup: $...$ inline 数学', () => {
  // \\alpha → alpha
  const r = stripTitleMarkup('The $\\alpha$ value');
  assert.equal(r, 'The alpha value');
});

test('stripTitleMarkup: $$...$$ display 数学', () => {
  const r = stripTitleMarkup('Title with $$\\beta + \\gamma$$ inline');
  assert.match(r, /beta/);
  assert.match(r, /gamma/);
});

test('stripTitleMarkup: \\(...\\) paren 数学', () => {
  const r = stripTitleMarkup('Foo \\(\\mu\\) bar');
  assert.match(r, /mu/);
});

test('stripTitleMarkup: \\[...\\] bracket 数学', () => {
  const r = stripTitleMarkup('Title \\[\\sum\\] end');
  assert.match(r, /∑/);
});

test('stripTitleMarkup: 数学分隔符后多余空格清理', () => {
  const r = stripTitleMarkup('Foo $x$ bar');
  assert.equal(r, 'Foo x bar');
});

// ---------- stripTitleMarkup: LaTeX 符号表 ----------
test('stripTitleMarkup: \\neq → ≠', () => {
  assert.equal(stripTitleMarkup('A $\\neq$ B'), 'A ≠ B');
});

test('stripTitleMarkup: \\leq → ≤', () => {
  assert.equal(stripTitleMarkup('$x \\leq y$'), 'x ≤ y');
});

test('stripTitleMarkup: \\geq → ≥', () => {
  assert.equal(stripTitleMarkup('$x \\geq y$'), 'x ≥ y');
});

test('stripTitleMarkup: \\pm → ±', () => {
  assert.equal(stripTitleMarkup('$x \\pm 1$'), 'x ± 1');
});

test('stripTitleMarkup: \\times → ×', () => {
  assert.equal(stripTitleMarkup('$a \\times b$'), 'a × b');
});

test('stripTitleMarkup: \\cdot → ·', () => {
  assert.equal(stripTitleMarkup('$a \\cdot b$'), 'a · b');
});

test('stripTitleMarkup: \\rightarrow / \\to → →', () => {
  assert.match(stripTitleMarkup('$A \\rightarrow B$'), /→/);
  assert.match(stripTitleMarkup('$A \\to B$'), /→/);
});

test('stripTitleMarkup: \\infty → ∞', () => {
  assert.match(stripTitleMarkup('$\\infty$ loop'), /∞/);
});

test('stripTitleMarkup: \\partial → ∂', () => {
  assert.match(stripTitleMarkup('$\\partial f$'), /∂/);
});

test('stripTitleMarkup: \\sum → ∑', () => {
  assert.match(stripTitleMarkup('$\\sum_i$'), /∑/);
});

test('stripTitleMarkup: \\prod → ∏', () => {
  assert.match(stripTitleMarkup('$\\prod_i$'), /∏/);
});

test('stripTitleMarkup: \\max / \\min 保留字面', () => {
  assert.match(stripTitleMarkup('$\\max_k$'), /max/);
  assert.match(stripTitleMarkup('$\\min_k$'), /min/);
});

test('stripTitleMarkup: 未知 LaTeX 命令保留命令名', () => {
  assert.equal(stripTitleMarkup('$\\foobar$'), 'foobar');
});

test('stripTitleMarkup: \\ne / \\le / \\ge 别名', () => {
  assert.match(stripTitleMarkup('$\\ne$'), /≠/);
  assert.match(stripTitleMarkup('$\\le$'), /≤/);
  assert.match(stripTitleMarkup('$\\ge$'), /≥/);
});

// ---------- stripTitleMarkup: 清理 ----------
test('stripTitleMarkup: \\, \\; \\: \\! 转空格 (在数学内)', () => {
  // 注意:这些命令只在 stripLatexExpression 内处理 → 必须包在 $...$
  assert.equal(stripTitleMarkup('$A\\,B$'), 'A B');
  assert.equal(stripTitleMarkup('$A\\;B$'), 'A B');
  assert.equal(stripTitleMarkup('$A\\:B$'), 'A B');
  assert.equal(stripTitleMarkup('$A\\!B$'), 'A B');
});

test('stripTitleMarkup: \\~ 转空格 (在数学内)', () => {
  assert.equal(stripTitleMarkup('$A\\~B$'), 'A B');
});

test('stripTitleMarkup: \\> 转空格 (在数学内)', () => {
  assert.equal(stripTitleMarkup('$A\\>B$'), 'A B');
});

test('stripTitleMarkup: \\;\\: 连续转单空格 (在数学内)', () => {
  assert.equal(stripTitleMarkup('$A\\;\\:B$'), 'A B');
});

test('stripTitleMarkup: 数学外 \\, 不转换', () => {
  // 在数学外,这些命令没机会处理 → 保留为字面
  const r = stripTitleMarkup('A\\,B');
  // stripLatexExpression 不会被调用 → 保留 \, 但最终 \s+ 不影响
  assert.match(r, /\\,/);
});

test('stripTitleMarkup: 移除孤立 $', () => {
  // 没有匹配分隔符的 $ 也要清掉
  assert.equal(stripTitleMarkup('A$ B'), 'A B');
});

test('stripTitleMarkup: {}^_ 大括号 caret 下标清理', () => {
  // {}^^_ 等符号被删除
  const r = stripTitleMarkup('$x_{i}$');
  assert.equal(r, 'xi');
});

// ---------- stripTitleMarkup: 转义反斜杠非字母 ----------
test('stripTitleMarkup: \\{ \\} 在数学内被移除', () => {
  // stripLatexExpression replace /[{}^_]/g, '' → 去除 { 和 }
  const r = stripTitleMarkup('$\\{x\\}$');
  // 期望 \x\(没有大括号)
  assert.equal(r, '\\x\\');
});

test('stripTitleMarkup: 数学内 ^^_ 也被移除', () => {
  const r = stripTitleMarkup('$x^{2}_i$');
  assert.equal(r, 'x2i');
});

// ---------- paperPlainTitle ----------
test('paperPlainTitle: 优先 titlePlain', () => {
  assert.equal(paperPlainTitle('TeX $\\alpha$', 'plain one'), 'plain one');
});

test('paperPlainTitle: titlePlain trim', () => {
  assert.equal(paperPlainTitle('x', '  hello  '), 'hello');
});

test('paperPlainTitle: 无 titlePlain → strip title', () => {
  assert.equal(paperPlainTitle('Hello $\\alpha$', undefined), 'Hello alpha');
});

test('paperPlainTitle: 全空 → 空', () => {
  assert.equal(paperPlainTitle(undefined, undefined), '');
});

test('paperPlainTitle: titlePlain 空 → strip title', () => {
  // '' || stripTitleMarkup(title || '') → stripTitleMarkup(title)
  assert.equal(paperPlainTitle('TeX $\\alpha$', ''), 'TeX alpha');
});

test('paperPlainTitle: title undefined + titlePlain undefined → 空', () => {
  assert.equal(paperPlainTitle(undefined, ''), '');
});

test('paperPlainTitle: stripTitleMarkup 也 trim', () => {
  assert.equal(paperPlainTitle('  hello  ', undefined), 'hello');
});
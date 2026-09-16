#!/usr/bin/env node
// astro-src/scripts/lib-title.test.mjs
//
// Tests for R7 polish: astro-src/lib/title.ts title plain-text extractor.

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

test('stripTitleMarkup: 普通文本不变', () => {
  assert.equal(stripTitleMarkup('Hello World'), 'Hello World');
});

test('stripTitleMarkup: 空字符串', () => {
  assert.equal(stripTitleMarkup(''), '');
  assert.equal(stripTitleMarkup(null), '');
  assert.equal(stripTitleMarkup(undefined), '');
});

test('stripTitleMarkup: 行内公式 $...$ 替换为内容', () => {
  const out = stripTitleMarkup('The $\\alpha$ value');
  assert.equal(out, 'The alpha value');
});

test('stripTitleMarkup: 块级公式 $$..$$ 替换', () => {
  const out = stripTitleMarkup('Display $$x^2$$ formula');
  assert.ok(out.includes('x'));
  assert.ok(!out.includes('$$'));
});

test('stripTitleMarkup: \\(...\\) 括号公式', () => {
  const out = stripTitleMarkup('Inline \\(x\\) math');
  assert.ok(out.includes('x'));
});

test('stripTitleMarkup: \\[...\\] 方括号公式', () => {
  const out = stripTitleMarkup('Display \\[y\\] math');
  assert.ok(out.includes('y'));
});

test('stripTitleMarkup: LaTeX 符号替换', () => {
  assert.ok(stripTitleMarkup('$\\alpha$').includes('alpha'));
  assert.ok(stripTitleMarkup('$\\neq$').includes('≠'));
  assert.ok(stripTitleMarkup('$\\leq$').includes('≤'));
  assert.ok(stripTitleMarkup('$\\geq$').includes('≥'));
  assert.ok(stripTitleMarkup('$\\pm$').includes('±'));
  assert.ok(stripTitleMarkup('$\\times$').includes('×'));
  assert.ok(stripTitleMarkup('$\\rightarrow$').includes('→'));
  assert.ok(stripTitleMarkup('$\\infty$').includes('∞'));
  assert.ok(stripTitleMarkup('$\\sum$').includes('∑'));
});

test('stripTitleMarkup: 未知 LaTeX 命令保留名字', () => {
  // \foo 不是已知符号 → 替换为 "foo"(字母部分)
  const out = stripTitleMarkup('$\\unknowncmd$');
  assert.ok(out.includes('unknowncmd'));
});

test('stripTitleMarkup: 去 {}^_ 字符', () => {
  const out = stripTitleMarkup('${x^2 + y_1}$');
  assert.ok(!out.includes('{'));
  assert.ok(!out.includes('}'));
  assert.ok(!out.includes('^'));
  assert.ok(!out.includes('_'));
});

test('stripTitleMarkup: 合并空白', () => {
  const out = stripTitleMarkup('  Hello   World  ');
  assert.equal(out, 'Hello World');
});

test('stripTitleMarkup: 处理 \\r\\n', () => {
  const out = stripTitleMarkup('Line 1\r\nLine 2');
  assert.equal(out, 'Line 1 Line 2');
});

test('stripTitleMarkup: 中文标题保留', () => {
  assert.equal(stripTitleMarkup('基于深度学习的图像识别'), '基于深度学习的图像识别');
});

test('stripTitleMarkup: 数字/特殊字符', () => {
  assert.equal(stripTitleMarkup('Paper v1.0 (2025)'), 'Paper v1.0 (2025)');
});

test('paperPlainTitle: 优先 titlePlain', () => {
  assert.equal(paperPlainTitle('Rich $title$', 'Plain title'), 'Plain title');
});

test('paperPlainTitle: 无 titlePlain 时 strip', () => {
  assert.equal(paperPlainTitle('Rich $\\alpha$ title', undefined), 'Rich alpha title');
  assert.equal(paperPlainTitle('Rich $\\alpha$ title', ''), 'Rich alpha title');
});

test('paperPlainTitle: 都为空 → ""', () => {
  assert.equal(paperPlainTitle('', ''), '');
  assert.equal(paperPlainTitle(undefined, undefined), '');
});

test('paperPlainTitle: trim 结果', () => {
  assert.equal(paperPlainTitle('  spaces  ', undefined), 'spaces');
  assert.equal(paperPlainTitle(undefined, '  spaced  '), 'spaced');
});

test('stripTitleMarkup: \\( \\) 与 \\[ \\] 混合', () => {
  const out = stripTitleMarkup('\\(a\\) and \\[b\\]');
  assert.ok(out.includes('a'));
  assert.ok(out.includes('b'));
});

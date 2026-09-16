#!/usr/bin/env node
// astro-src/scripts/title-markup.test.mjs
//
// Tests for R7 polish: astro-src/lib/title.ts pure helpers.

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

test('stripTitleMarkup: 普通标题保持不变', () => {
  assert.equal(stripTitleMarkup('A study of attention'), 'A study of attention');
});

test('stripTitleMarkup: 空字符串 → 空', () => {
  assert.equal(stripTitleMarkup(''), '');
});

test('stripTitleMarkup: null → 空', () => {
  assert.equal(stripTitleMarkup(null), '');
});

test('stripTitleMarkup: undefined → 空', () => {
  assert.equal(stripTitleMarkup(undefined), '');
});

test('stripTitleMarkup: inline $x$ 去除定界符', () => {
  assert.equal(stripTitleMarkup('foo $x$ bar'), 'foo x bar');
});

test('stripTitleMarkup: $$display$$ 块', () => {
  // alpha/beta 没有 unicode mapping → 保留字面名
  assert.equal(stripTitleMarkup('head $$\\alpha + \\beta$$ tail'), 'head alpha + beta tail');
});

test('stripTitleMarkup: \\(..\\) 行内', () => {
  assert.equal(stripTitleMarkup('a \\(\\max\\) b'), 'a max b');
});

test('stripTitleMarkup: \\[..\\] 块', () => {
  assert.equal(stripTitleMarkup('\\[\\sum\\]'), '∑');
});

test('stripTitleMarkup: 已知 LaTeX 符号转 Unicode', () => {
  assert.equal(stripTitleMarkup('$x \\leq y$'), 'x ≤ y');
  assert.equal(stripTitleMarkup('$x \\geq y$'), 'x ≥ y');
  assert.equal(stripTitleMarkup('$x \\neq y$'), 'x ≠ y');
  assert.equal(stripTitleMarkup('$a \\pm b$'), 'a ± b');
  assert.equal(stripTitleMarkup('$a \\cdot b$'), 'a · b');
  assert.equal(stripTitleMarkup('$a \\to b$'), 'a → b');
  assert.equal(stripTitleMarkup('$\\infty$'), '∞');
  assert.equal(stripTitleMarkup('$\\partial$'), '∂');
  assert.equal(stripTitleMarkup('$\\sum$'), '∑');
  assert.equal(stripTitleMarkup('$\\prod$'), '∏');
});

test('stripTitleMarkup: 未知 \\command 保留 name', () => {
  assert.equal(stripTitleMarkup('$\\foobar$'), 'foobar');
});

test('stripTitleMarkup: 多次空白折叠为单空格', () => {
  // \\n 折叠为单空格
  assert.equal(stripTitleMarkup('a\nb'), 'a b');
});

test('stripTitleMarkup: \\r\\n → 单空格', () => {
  assert.equal(stripTitleMarkup('a\r\nb'), 'a b');
});

test('stripTitleMarkup: 上标/下标字符移除', () => {
  // 字符 { } ^ _ 被移除
  assert.equal(stripTitleMarkup('$x^{2}_i$'), 'x2i');
});

test('stripTitleMarkup: 命令后标点 (\\, \\; \\!) 当空格', () => {
  // 在 $..$ 里 \\, → ' ' (逗号保留)
  assert.equal(stripTitleMarkup('$a,\\,b$'), 'a, b');
});

test('stripTitleMarkup: \\Greek 字母保留 name (无 unicode)', () => {
  assert.equal(stripTitleMarkup('$\\alpha$'), 'alpha');
  assert.equal(stripTitleMarkup('$\\beta$'), 'beta');
  assert.equal(stripTitleMarkup('$\\theta$'), 'theta');
});

test('stripTitleMarkup: 数学外 \\command 不被替换', () => {
  // \\foo 不在 math,\f 后跟字母 → backslash 保留
  assert.equal(stripTitleMarkup('\\foo bar'), '\\foo bar');
});

test('paperPlainTitle: 优先 titlePlain', () => {
  assert.equal(paperPlainTitle('foo $x$ bar', 'plain text'), 'plain text');
});

test('paperPlainTitle: titlePlain undefined → stripTitleMarkup', () => {
  assert.equal(paperPlainTitle('foo $x$ bar', undefined), 'foo x bar');
});

test('paperPlainTitle: 都为空 → 空', () => {
  assert.equal(paperPlainTitle('', ''), '');
});

test('paperPlainTitle: 两端空白裁剪', () => {
  assert.equal(paperPlainTitle('   plain   ', undefined), 'plain');
});

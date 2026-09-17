#!/usr/bin/env node
// astro-src/scripts/title.test.mjs
//
// Tests for R7 polish: astro-src/lib/title.ts.
// stripTitleMarkup (TeX → plain text) + paperPlainTitle (plain 优先,fallback)。

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

// ---------- stripTitleMarkup ---
test('strip: 纯字符串不变', () => {
  assert.equal(stripTitleMarkup('Hello world'), 'Hello world');
});

test('strip: undefined → ""', () => {
  assert.equal(stripTitleMarkup(undefined), '');
});

test('strip: null → ""', () => {
  assert.equal(stripTitleMarkup(null), '');
});

test('strip: 数字 → 字符串', () => {
  assert.equal(stripTitleMarkup(42), '42');
});

test('strip: inline math $x$ → 内容透传', () => {
  // $x$ 是 math delimiters 内部的内容,没有 \command → 保留 "x"
  assert.equal(stripTitleMarkup('foo $x$ bar'), 'foo x bar');
});

test('strip: display math $$...$$ 移除 $, 内容透传', () => {
  assert.equal(stripTitleMarkup('foo $$x=1$$ bar'), 'foo x=1 bar');
});

test('strip: \\( ... \\) paren math, 内容透传', () => {
  assert.equal(stripTitleMarkup('foo \\(x\\) bar'), 'foo x bar');
});

test('strip: \\[ ... \\] bracket math, 内容透传', () => {
  assert.equal(stripTitleMarkup('foo \\[x\\] bar'), 'foo x bar');
});

test('strip: math 内 \\alpha → alpha', () => {
  assert.equal(stripTitleMarkup('$\\alpha$'), 'alpha');
});

test('strip: math 内 \\neq → ≠', () => {
  assert.equal(stripTitleMarkup('a $\\neq$ b'), 'a ≠ b');
});

test('strip: math 内 \\leq → ≤', () => {
  assert.equal(stripTitleMarkup('a $\\leq$ b'), 'a ≤ b');
});

test('strip: math 内 \\geq → ≥', () => {
  assert.equal(stripTitleMarkup('a $\\geq$ b'), 'a ≥ b');
});

test('strip: math 内 \\times → ×', () => {
  assert.equal(stripTitleMarkup('a $\\times$ b'), 'a × b');
});

test('strip: math 内 \\cdot → ·', () => {
  assert.equal(stripTitleMarkup('a $\\cdot$ b'), 'a · b');
});

test('strip: math 内 \\pm → ±', () => {
  assert.equal(stripTitleMarkup('a $\\pm$ b'), 'a ± b');
});

test('strip: math 内 \\infty → ∞', () => {
  assert.equal(stripTitleMarkup('x $\\infty$'), 'x ∞');
});

test('strip: math 内 \\rightarrow → →', () => {
  assert.equal(stripTitleMarkup('A $\\rightarrow$ B'), 'A → B');
});

test('strip: math 内 \\sum → ∑', () => {
  assert.equal(stripTitleMarkup('$\\sum$ x'), '∑ x');
});

test('strip: math 内 \\partial → ∂', () => {
  assert.equal(stripTitleMarkup('$\\partial$ x'), '∂ x');
});

test('strip: math 内 \\prod → ∏', () => {
  assert.equal(stripTitleMarkup('$\\prod$ x'), '∏ x');
});

test('strip: math 内上标 ^ 移除', () => {
  // $\\alpha^k$ → "alphak" (^ 去掉,然后 {} 移除,然后 \alpha → alpha)
  // 实际是 stripLatexExpression 先替换 \,;:!> 为空格,然后 \command, 然后 {} ^ _, 最后 \non-alpha
  // alpha 后跟 k: alpha → "alpha" then ^ removed → "alphak"
  assert.equal(stripTitleMarkup('$\\alpha^k$'), 'alphak');
});

test('strip: math 内下标 _ 移除', () => {
  assert.equal(stripTitleMarkup('$\\alpha_k$'), 'alphak');
});

test('strip: math 内大括号 {} 移除', () => {
  // $\frac{a}{b}$ → frac + a + b = "fracab"
  assert.equal(stripTitleMarkup('$\\frac{a}{b}$'), 'fracab');
});

test('strip: 多个空格压缩为单空格', () => {
  assert.equal(stripTitleMarkup('foo    bar'), 'foo bar');
});

test('strip: 行尾换行 → 空格', () => {
  assert.equal(stripTitleMarkup('foo\nbar'), 'foo bar');
});

test('strip: 首尾空白 trim', () => {
  assert.equal(stripTitleMarkup('  hello  '), 'hello');
});

test('strip: math 内 \\command 已知 → 符号', () => {
  // $\\max$ → max(在 LATEX_SYMBOLS 里有)
  assert.equal(stripTitleMarkup('$\\max$'), 'max');
});

test('strip: math 内 \\command 未知 → 透传', () => {
  assert.equal(stripTitleMarkup('$\\foo$'), 'foo');
});

test('strip: math 内 \\command 多个 → 都替换', () => {
  // $\\alpha \\beta$ → "alpha beta"(空格保留)
  assert.equal(stripTitleMarkup('$\\alpha \\beta$'), 'alpha beta');
});

test('strip: math 外 \\command 不变', () => {
  // 在 math 之外的 \alpha 不被替换
  assert.equal(stripTitleMarkup('hello \\alpha world'), 'hello \\alpha world');
});

test('strip: 混合 LaTeX + 普通文本', () => {
  assert.equal(
    stripTitleMarkup('Attention $\\alpha^k$ Is All You Need'),
    'Attention alphak Is All You Need',
  );
});

test('strip: 残留 $ 移除', () => {
  // 末尾 $ 移除
  assert.equal(stripTitleMarkup('foo$'), 'foo');
});

// ---------- paperPlainTitle ---
test('paperPlain: titlePlain 优先', () => {
  assert.equal(
    paperPlainTitle('Fancy $\\alpha$ Title', 'Plain Title'),
    'Plain Title',
  );
});

test('paperPlain: titlePlain 空 → fallback stripTitle', () => {
  assert.equal(
    paperPlainTitle('$\\alpha$', ''),
    'alpha',
  );
});

test('paperPlain: titlePlain undefined → fallback', () => {
  assert.equal(
    paperPlainTitle('$\\alpha$', undefined),
    'alpha',
  );
});

test('paperPlain: 两者都有,优先 titlePlain', () => {
  assert.equal(
    paperPlainTitle('$\\alpha$', 'plain'),
    'plain',
  );
});

test('paperPlain: title undefined + titlePlain 缺失 → ""', () => {
  assert.equal(paperPlainTitle(undefined, undefined), '');
});

test('paperPlain: title="" + titlePlain 缺 → ""', () => {
  assert.equal(paperPlainTitle('', undefined), '');
});

test('paperPlain: titlePlain 含前后空格 trim', () => {
  assert.equal(paperPlainTitle('x', '  trimmed  '), 'trimmed');
});

// ---------- 集成 ---
test('集成: 复杂 LaTeX 标题', () => {
  const t = 'Sparse Attention $\\sum_{i=1}^{N} \\alpha_i \\cdot x_i$ for Vision';
  const r = stripTitleMarkup(t);
  assert.match(r, /Sparse Attention/);
  assert.match(r, /∑/);
  assert.match(r, /Vision/);
  assert.ok(!r.includes('$'));
});

test('集成: paperPlainTitle 用 LaTeX title 派生', () => {
  const t = '$\\max$ Entropy';
  const plain = paperPlainTitle(t, undefined);
  assert.equal(plain, 'max Entropy');
});
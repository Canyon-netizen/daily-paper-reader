#!/usr/bin/env node
// astro-src/scripts/markdown-title.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/title.ts title HTML renderer.

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

const mod = await loadTs('lib/markdown/title.ts');
const { renderTitleHtml } = mod;

test('renderTitleHtml: 普通文本不修改(转义)', () => {
  const out = renderTitleHtml('Hello World');
  assert.ok(out.includes('Hello World'));
});

test('renderTitleHtml: 空字符串返回空', () => {
  assert.equal(renderTitleHtml(''), '');
  assert.equal(renderTitleHtml(null), '');
  assert.equal(renderTitleHtml(undefined), '');
});

test('renderTitleHtml: HTML 标签转义', () => {
  const out = renderTitleHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('renderTitleHtml: 行内 $..$ KaTeX 公式渲染', () => {
  const out = renderTitleHtml('Equation $E=mc^2$ in title');
  // 应该有 KaTeX 渲染痕迹(span.katex 或类似)
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderTitleHtml: 块级 $$..$$ KaTeX 公式渲染', () => {
  const out = renderTitleHtml('Display $$x^2 + y^2 = z^2$$ equation');
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderTitleHtml: 不解释 markdown 强调符号(避免误判)', () => {
  const out = renderTitleHtml('Title_with_underscores and **bold** here');
  // 标题里不应当作 markdown 强调
  assert.ok(!out.includes('<strong>'));
  assert.ok(!out.includes('<em>'));
});

test('renderTitleHtml: 不解释 markdown 链接(避免误判)', () => {
  const out = renderTitleHtml('Title with [link](http://x.com) inside');
  assert.ok(!out.match(/<a[^>]+href="http:\/\/x\.com"/));
});

test('renderTitleHtml: KaTeX 错误时降级,不抛', () => {
  // 不完整公式 - 应当 throwOnError:false 仍渲染或降级
  const out = renderTitleHtml('Bad $\frac{1}{ math');
  assert.ok(typeof out === 'string');
  assert.ok(out.length > 0);
});

test('renderTitleHtml: 数学公式优先于 markdown', () => {
  // 公式内的 _ 不应该被当 italic
  const out = renderTitleHtml('Formula $x_1 + x_2$ here');
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderTitleHtml: 中文标题正常', () => {
  const out = renderTitleHtml('基于深度学习的图像识别研究');
  assert.ok(out.includes('基于深度学习的图像识别研究'));
});

test('renderTitleHtml: 特殊字符 & 转义', () => {
  const out = renderTitleHtml('Tom & Jerry');
  assert.ok(out.includes('Tom &amp; Jerry'));
});

test('renderTitleHtml: 长标题不崩溃', () => {
  const long = 'A '.repeat(500) + 'Title';
  const out = renderTitleHtml(long);
  assert.ok(out.length > 500);
});

test('renderTitleHtml: 多个公式段落', () => {
  const out = renderTitleHtml('Both $a$ and $b$ and $c$');
  // 3 个公式,应该有 3 处 KaTeX span 或类似
  const katexMatches = out.match(/katex/g) || [];
  assert.ok(katexMatches.length >= 3, `expected >=3 katex markers, got ${katexMatches.length}`);
});

test('renderTitleHtml: 0 输入安全', () => {
  assert.equal(renderTitleHtml(0), '');
});

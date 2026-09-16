#!/usr/bin/env node
// astro-src/scripts/markdown-inline.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/inline.ts inline markdown renderer.

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

const mod = await loadTs('lib/markdown/inline.ts');
const { renderInline } = mod;

test('renderInline: 空字符串', () => {
  assert.equal(renderInline(''), '');
});

test('renderInline: 普通文本不修改', () => {
  assert.equal(renderInline('hello world'), 'hello world');
});

test('renderInline: HTML 字符转义', () => {
  const out = renderInline('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('renderInline: 块级 $$..$$ 优先于行内', () => {
  const out = renderInline('Display $$x^2$$ here');
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderInline: 行内 $..$ KaTeX 公式', () => {
  const out = renderInline('Inline $E=mc^2$ formula');
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderInline: KaTeX 失败降级(throwOnError:false)', () => {
  const out = renderInline('Bad $\frac{1}{ math');
  assert.ok(typeof out === 'string');
});

test('renderInline: **bold**', () => {
  const out = renderInline('This is **bold** text');
  assert.ok(out.includes('<strong>bold</strong>'));
});

test('renderInline: __bold__', () => {
  const out = renderInline('This is __bold__ text');
  assert.ok(out.includes('<strong>bold</strong>'));
});

test('renderInline: *italic*', () => {
  const out = renderInline('This is *italic* text');
  assert.ok(out.includes('<em>italic</em>'));
});

test('renderInline: _italic_', () => {
  const out = renderInline('This is _italic_ text');
  assert.ok(out.includes('<em>italic</em>'));
});

test('renderInline: 行内 `code`', () => {
  const out = renderInline('Use `npm install` here');
  assert.ok(out.includes('<code>npm install</code>'));
});

test('renderInline: [text](http url) 链接', () => {
  const out = renderInline('See [docs](https://example.com)');
  assert.ok(out.includes('href="https://example.com"'));
  assert.ok(out.includes('>docs</a>'));
  assert.ok(out.includes('target="_blank"'));
});

test('renderInline: 非 http 链接不被识别', () => {
  const out = renderInline('See [docs](relative-path)');
  // 相对路径不会被 md link 模式识别 → 保留原文本
  assert.ok(!out.includes('href="relative-path"'));
});

test('renderInline: ![alt](url) 图片', () => {
  const out = renderInline('Logo ![alt text](https://cdn.example.com/x.png)');
  assert.ok(out.includes('<img'));
  assert.ok(out.includes('src="https://cdn.example.com/x.png"'));
  assert.ok(out.includes('alt="alt text"'));
  assert.ok(out.includes('loading="lazy"'));
});

test('renderInline: wikilink [[name]] 解析为链接', () => {
  const resolver = new Map([['foo', { slug: 'foo-slug', display_name: 'Foo' }]]);
  const out = renderInline('See [[foo]] here', { wikilinkResolver: resolver });
  assert.ok(out.includes('href="/wiki/concepts/foo-slug/"'));
  assert.ok(out.includes('class="wikilink"'));
  // 显示使用 alias || name(原始 key)
  assert.ok(out.includes('foo'));
});

test('renderInline: wikilink [[name|alias]] 显示 alias', () => {
  const resolver = new Map([['foo', { slug: 'foo-slug', display_name: 'Foo' }]]);
  const out = renderInline('See [[foo|My Custom]] here', { wikilinkResolver: resolver });
  assert.ok(out.includes('My Custom'));
  assert.ok(out.includes('href="/wiki/concepts/foo-slug/"'));
});

test('renderInline: wikilink 找不到时显示红字', () => {
  // 有一个 slug 但目标不在 resolver 里 → wikilink--missing 类
  const resolver = new Map([['foo', { slug: 'foo-slug', display_name: 'Foo' }]]);
  const out = renderInline('See [[unknown]] here', { wikilinkResolver: resolver });
  assert.ok(out.includes('wikilink--missing'));
});

test('renderInline: wikilink 没 resolver 时跳过规则', () => {
  const out = renderInline('Raw [[foo]] stays');
  // 占位符不会被替换,但 wikilink 字面量会被 escapeHtml 包裹
  assert.ok(!out.includes('href="/wiki/concepts/'));
});

test('renderInline: wikilink 大小写不敏感', () => {
  const resolver = new Map([['foo', { slug: 'foo-slug', display_name: 'Foo' }]]);
  const out = renderInline('See [[FOO]] here', { wikilinkResolver: resolver });
  assert.ok(out.includes('href="/wiki/concepts/foo-slug/"'));
});

test('renderInline: 公式占位符在 escapeHtml 后正确回填', () => {
  // 即使含 < > 也不应破坏公式渲染
  const out = renderInline('$x < y$ and $a > b$');
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderInline: 组合多个标记', () => {
  const out = renderInline('**bold** with `code` and $x$');
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('<code>code</code>'));
  assert.ok(out.includes('katex') || out.includes('math'));
});

test('renderInline: base 选项拼到 wikilink href', () => {
  const resolver = new Map([['foo', { slug: 'foo-slug', display_name: 'Foo' }]]);
  const out = renderInline('See [[foo]] here', {
    wikilinkResolver: resolver,
    base: '/prefix',
  });
  assert.ok(out.includes('href="/prefix/wiki/concepts/foo-slug/"'));
});

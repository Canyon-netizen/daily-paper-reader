#!/usr/bin/env node
// astro-src/scripts/markdown-figures.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/figures.ts figure URL + carousel HTML builder.

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

const mod = await loadTs('lib/markdown/figures.ts');
const { figureUrlToSrc, buildFiguresCarouselHtml } = mod;

test('figureUrlToSrc: http URL 原样', () => {
  assert.equal(figureUrlToSrc('https://example.com/img.png', '/base'), 'https://example.com/img.png');
  assert.equal(figureUrlToSrc('http://example.com/img.png', '/base'), 'http://example.com/img.png');
});

test('figureUrlToSrc: / 开头的绝对路径原样', () => {
  assert.equal(figureUrlToSrc('/static/img.png', '/base'), '/static/img.png');
});

test('figureUrlToSrc: 相对路径拼 base(去尾 /)', () => {
  assert.equal(figureUrlToSrc('img.png', '/base/'), '/base/img.png');
  assert.equal(figureUrlToSrc('img.png', '/base'), '/base/img.png');
});

test('figureUrlToSrc: ./ 前缀去掉', () => {
  assert.equal(figureUrlToSrc('./img.png', '/base'), '/base/img.png');
  assert.equal(figureUrlToSrc('./sub/img.png', '/base'), '/base/sub/img.png');
});

test('figureUrlToSrc: 多级相对路径', () => {
  assert.equal(figureUrlToSrc('a/b/c.png', '/base'), '/base/a/b/c.png');
});

test('buildFiguresCarouselHtml: 空数组返回空字符串', () => {
  assert.equal(buildFiguresCarouselHtml([], '/base'), '');
});

test('buildFiguresCarouselHtml: 单图渲染 Figure', () => {
  const html = buildFiguresCarouselHtml(
    [{ index: 1, url: 'fig1.png', caption: 'First figure' }],
    '/base',
  );
  assert.ok(html.includes('论文图表'));
  assert.ok(html.includes('fig1.png'));
  assert.ok(html.includes('First figure'));
  assert.ok(html.includes('paper-carousel'));
});

test('buildFiguresCarouselHtml: allRasterized=true 改用页面预览文案', () => {
  const html = buildFiguresCarouselHtml(
    [{ index: 1, url: 'fig1.png' }],
    '/base',
    true,
  );
  assert.ok(html.includes('论文页面预览'));
  assert.ok(html.includes('页'));
  assert.ok(!html.includes('论文图表(共'));
});

test('buildFiguresCarouselHtml: 多图渲染所有 dot + figure', () => {
  const figs = [
    { index: 1, url: 'a.png', caption: 'A' },
    { index: 2, url: 'b.png', caption: 'B' },
    { index: 3, url: 'c.png', caption: 'C' },
  ];
  const html = buildFiguresCarouselHtml(figs, '/base');
  assert.ok(html.includes('a.png'));
  assert.ok(html.includes('b.png'));
  assert.ok(html.includes('c.png'));
  // 3 个 dot
  const dotMatches = html.match(/paper-carousel-dot/g) || [];
  assert.ok(dotMatches.length >= 3);
  // 3 个 figure
  const figureMatches = html.match(/paper-slide/g) || [];
  assert.ok(figureMatches.length >= 3);
});

test('buildFiguresCarouselHtml: 默认 details 元素是 open 状态(防止 lazy 不触发)', () => {
  const html = buildFiguresCarouselHtml([{ index: 1, url: 'x.png' }], '/base');
  assert.ok(html.includes('<details class="paper-figures-wrap" open>'));
});

test('buildFiguresCarouselHtml: 含 width/height 时插入 dim 属性', () => {
  const html = buildFiguresCarouselHtml(
    [{ index: 1, url: 'a.png', width: 800, height: 600 }],
    '/base',
  );
  assert.ok(html.includes('width="800"'));
  assert.ok(html.includes('height="600"'));
});

test('buildFiguresCarouselHtml: width/height 为 0/未定义时省略 dim', () => {
  const html0 = buildFiguresCarouselHtml(
    [{ index: 1, url: 'a.png', width: 0, height: 0 }],
    '/base',
  );
  assert.ok(!html0.includes('width="0"'));
  const htmlNone = buildFiguresCarouselHtml([{ index: 1, url: 'a.png' }], '/base');
  assert.ok(!htmlNone.match(/width="\d+"/));
});

test('buildFiguresCarouselHtml: caption 缺失时显示默认 Figure N', () => {
  const html = buildFiguresCarouselHtml([{ index: 5, url: 'x.png' }], '/base');
  assert.ok(html.includes('Figure 5'));
});

test('buildFiguresCarouselHtml: 转义 caption 中的 HTML', () => {
  const html = buildFiguresCarouselHtml(
    [{ index: 1, url: 'x.png', caption: '<script>alert(1)</script>' }],
    '/base',
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('buildFiguresCarouselHtml: 包含 prev/next 按钮 + a11y label', () => {
  const html = buildFiguresCarouselHtml([{ index: 1, url: 'x.png' }], '/base');
  assert.ok(html.includes('paper-carousel-prev'));
  assert.ok(html.includes('paper-carousel-next'));
  assert.ok(html.includes('aria-label="上一张"'));
  assert.ok(html.includes('aria-label="下一张"'));
});

test('buildFiguresCarouselHtml: URL 拼接使用 figureUrlToSrc 规则', () => {
  const html = buildFiguresCarouselHtml(
    [{ index: 1, url: 'https://cdn.example.com/a.png', caption: 'ext' }],
    '/base',
  );
  // https 完整 URL 原样,不拼 base
  assert.ok(html.includes('https://cdn.example.com/a.png'));
  assert.ok(!html.includes('https://cdn.example.com/base/'));
});

test('buildFiguresCarouselHtml: heading 数量文本与 total 一致', () => {
  const figs = [
    { index: 1, url: 'a.png' },
    { index: 2, url: 'b.png' },
    { index: 3, url: 'c.png' },
    { index: 4, url: 'd.png' },
  ];
  const html = buildFiguresCarouselHtml(figs, '/base');
  assert.ok(html.includes('共 4 张'));
});

test('buildFiguresCarouselHtml: 末尾追加 <hr /> 分隔', () => {
  const html = buildFiguresCarouselHtml([{ index: 1, url: 'a.png' }], '/base');
  assert.ok(html.trimEnd().endsWith('<hr />'));
});

test('buildFiguresCarouselHtml: img 包含 loading="lazy" + decoding="async"', () => {
  const html = buildFiguresCarouselHtml([{ index: 1, url: 'a.png' }], '/base');
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('decoding="async"'));
});

test('buildFiguresCarouselHtml: figcaption 包含序号/total', () => {
  const figs = [
    { index: 1, url: 'a.png', caption: 'A' },
    { index: 2, url: 'b.png', caption: 'B' },
  ];
  const html = buildFiguresCarouselHtml(figs, '/base');
  assert.ok(html.includes('图 1 / 2'));
  assert.ok(html.includes('图 2 / 2'));
});

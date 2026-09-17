#!/usr/bin/env node
// astro-src/scripts/markdown-figures.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/figures.ts.
// figureUrlToSrc + buildFiguresCarouselHtml。

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

const mod = await loadTs('lib/markdown/figures.ts');
const { figureUrlToSrc, buildFiguresCarouselHtml } = mod;

const mkFig = (overrides) => ({
  url: 'img.png',
  caption: '',
  page: 0,
  index: 1,
  width: 0,
  height: 0,
  extractor: '',
  ...overrides,
});

// ---------- figureUrlToSrc ----------
test('figureUrlToSrc: https 原样', () => {
  assert.equal(figureUrlToSrc('https://x.com/a.png', '/base'), 'https://x.com/a.png');
});

test('figureUrlToSrc: http 原样', () => {
  assert.equal(figureUrlToSrc('http://x.com/a.png', '/base'), 'http://x.com/a.png');
});

test('figureUrlToSrc: / 开头原样', () => {
  assert.equal(figureUrlToSrc('/a.png', '/base'), '/a.png');
});

test('figureUrlToSrc: 相对路径拼接', () => {
  assert.equal(figureUrlToSrc('a.png', '/base'), '/base/a.png');
});

test('figureUrlToSrc: ./ 前缀去掉', () => {
  assert.equal(figureUrlToSrc('./a.png', '/base'), '/base/a.png');
});

test('figureUrlToSrc: base 末尾 / 去', () => {
  assert.equal(figureUrlToSrc('a.png', '/base/'), '/base/a.png');
});

test('figureUrlToSrc: base 无末尾 /', () => {
  assert.equal(figureUrlToSrc('a.png', '/base'), '/base/a.png');
});

test('figureUrlToSrc: 嵌套路径', () => {
  assert.equal(figureUrlToSrc('sub/a.png', '/base'), '/base/sub/a.png');
});

// ---------- buildFiguresCarouselHtml ----------
test('buildFiguresCarouselHtml: 空数组 → 空字符串', () => {
  assert.equal(buildFiguresCarouselHtml([], '/base'), '');
});

test('buildFiguresCarouselHtml: 1 张图', () => {
  const r = buildFiguresCarouselHtml([mkFig({ url: 'a.png' })], '/base');
  assert.match(r, /<h2>.*<\/h2>/);
  assert.match(r, /data-count="1"/);
  assert.match(r, /paper-slide/);
  assert.match(r, /<img src="\/base\/a\.png"/);
  assert.match(r, /loading="lazy"/);
  assert.match(r, /decoding="async"/);
});

test('buildFiguresCarouselHtml: 多张图', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', index: 1 }),
    mkFig({ url: 'b.png', index: 2 }),
    mkFig({ url: 'c.png', index: 3 }),
  ], '/base');
  assert.match(r, /data-count="3"/);
  // 3 张图
  const matches = r.match(/paper-slide/g) || [];
  assert.ok(matches.length >= 3);
});

test('buildFiguresCarouselHtml: 标题 allRasterized=false → 图', () => {
  const r = buildFiguresCarouselHtml([mkFig()], '/base', false);
  assert.match(r, /论文图表/);
});

test('buildFiguresCarouselHtml: 标题 allRasterized=true → 页', () => {
  const r = buildFiguresCarouselHtml([mkFig()], '/base', true);
  assert.match(r, /论文页面预览/);
  assert.match(r, /<figcaption>页 1 \/ 1/);
});

test('buildFiguresCarouselHtml: 序号 i+1 / total', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', index: 1 }),
    mkFig({ url: 'b.png', index: 2 }),
  ], '/base');
  assert.match(r, /图 1 \/ 2/);
  assert.match(r, /图 2 \/ 2/);
});

test('buildFiguresCarouselHtml: caption HTML 转义', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', caption: '<script>alert(1)</script>' }),
  ], '/base');
  assert.match(r, /&lt;script&gt;/);
  assert.doesNotMatch(r, /<script>/);
});

test('buildFiguresCarouselHtml: 无 caption → fallback Figure {index}', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', caption: '', index: 3 }),
  ], '/base');
  assert.match(r, /alt="Figure 3"/);
});

test('buildFiguresCarouselHtml: 有 caption → 用 caption', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', caption: 'Custom caption', index: 5 }),
  ], '/base');
  assert.match(r, /alt="Custom caption"/);
});

test('buildFiguresCarouselHtml: width/height 透传', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', width: 800, height: 600 }),
  ], '/base');
  assert.match(r, /width="800"/);
  assert.match(r, /height="600"/);
});

test('buildFiguresCarouselHtml: width/height 为 0 → 不输出', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', width: 0, height: 0 }),
  ], '/base');
  assert.doesNotMatch(r, /width="0"/);
});

test('buildFiguresCarouselHtml: 包含 carousel 按钮', () => {
  const r = buildFiguresCarouselHtml([mkFig()], '/base');
  assert.match(r, /paper-carousel-prev/);
  assert.match(r, /paper-carousel-next/);
});

test('buildFiguresCarouselHtml: dot 数量 = total', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png', index: 1 }),
    mkFig({ url: 'b.png', index: 2 }),
    mkFig({ url: 'c.png', index: 3 }),
  ], '/base');
  // 只数 paper-carousel-dot (单个) 不含 dots container
  const dots = r.match(/paper-carousel-dot"/g) || [];
  assert.equal(dots.length, 3);
});

test('buildFiguresCarouselHtml: <details> 默认 open', () => {
  const r = buildFiguresCarouselHtml([mkFig()], '/base');
  assert.match(r, /<details class="paper-figures-wrap" open>/);
});

test('buildFiguresCarouselHtml: 末尾 hr', () => {
  const r = buildFiguresCarouselHtml([mkFig()], '/base');
  assert.match(r, /<hr \/>/);
});

test('buildFiguresCarouselHtml: data-index 0..n-1', () => {
  const r = buildFiguresCarouselHtml([
    mkFig({ url: 'a.png' }),
    mkFig({ url: 'b.png' }),
    mkFig({ url: 'c.png' }),
  ], '/base');
  assert.match(r, /data-index="0"/);
  assert.match(r, /data-index="1"/);
  assert.match(r, /data-index="2"/);
});
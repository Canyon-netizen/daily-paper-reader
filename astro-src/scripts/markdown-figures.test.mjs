#!/usr/bin/env node
// astro-src/scripts/markdown-figures.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/figures.ts pure helpers.

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
    external: ['./types', '../types', '../../types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/markdown/figures.ts');
const { figureUrlToSrc, buildFiguresCarouselHtml } = mod;

test('figureUrlToSrc: http URL 原样返回', () => {
  assert.equal(figureUrlToSrc('https://example.com/foo.png', '/base'), 'https://example.com/foo.png');
  assert.equal(figureUrlToSrc('http://example.com/foo.png', '/base'), 'http://example.com/foo.png');
});

test('figureUrlToSrc: 绝对路径 / 原样', () => {
  assert.equal(figureUrlToSrc('/static/foo.png', '/base'), '/static/foo.png');
});

test('figureUrlToSrc: 相对路径拼 base', () => {
  assert.equal(figureUrlToSrc('foo.png', '/base'), '/base/foo.png');
});

test('figureUrlToSrc: ./ 前缀去掉后拼 base', () => {
  assert.equal(figureUrlToSrc('./foo.png', '/base'), '/base/foo.png');
});

test('figureUrlToSrc: base 末尾 / 不会双斜杠', () => {
  assert.equal(figureUrlToSrc('foo.png', '/base/'), '/base/foo.png');
});

test('figureUrlToSrc: nested 相对路径', () => {
  assert.equal(figureUrlToSrc('a/b/c.png', '/static'), '/static/a/b/c.png');
});

test('figureUrlToSrc: base="" 时相对路径拼成 /foo', () => {
  assert.equal(figureUrlToSrc('foo.png', ''), '/foo.png');
});

test('buildFiguresCarouselHtml: 空数组 → 空字符串', () => {
  assert.equal(buildFiguresCarouselHtml([], '/base'), '');
});

test('buildFiguresCarouselHtml: 单图 → 含 carousel HTML', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'fig1.png', caption: 'Figure 1' }],
    '/base',
  );
  assert.ok(html.includes('paper-figures-wrap'));
  assert.ok(html.includes('paper-carousel'));
  assert.ok(html.includes('<figure'));
  assert.ok(html.includes('Figure 1'));
});

test('buildFiguresCarouselHtml: data-count 等于 figures 数量', () => {
  const figs = [
    { url: 'a.png' },
    { url: 'b.png' },
    { url: 'c.png' },
  ];
  const html = buildFiguresCarouselHtml(figs, '/base');
  assert.ok(html.includes('data-count="3"'));
});

test('buildFiguresCarouselHtml: caption HTML escape', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png', caption: '<script>alert("x")</script>' }],
    '/base',
  );
  // < > " 都被 escape
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;'));
});

test('buildFiguresCarouselHtml: allRasterized=true → "页面预览" 文案', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png' }],
    '/base',
    true,
  );
  assert.ok(html.includes('页面预览'));
  assert.ok(html.includes('页 1 / 1'));
});

test('buildFiguresCarouselHtml: allRasterized=false → "图" 文案', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png' }],
    '/base',
    false,
  );
  assert.ok(html.includes('论文图表'));
  assert.ok(html.includes('图 1 / 1'));
});

test('buildFiguresCarouselHtml: width/height 设值时进 attrs', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png', width: 800, height: 600 }],
    '/base',
  );
  assert.ok(html.includes('width="800"'));
  assert.ok(html.includes('height="600"'));
});

test('buildFiguresCarouselHtml: width/height=0 跳过', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png', width: 0, height: 0 }],
    '/base',
  );
  assert.ok(!html.includes('width="0"'));
});

test('buildFiguresCarouselHtml: 无 caption 用 index 兜底', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png', index: 7 }],
    '/base',
  );
  // alt 兜底: 'Figure 7'
  assert.ok(html.includes('Figure 7'));
});

test('buildFiguresCarouselHtml: 默认 open (不折叠)', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png' }],
    '/base',
  );
  assert.ok(html.includes('<details class="paper-figures-wrap" open>'));
});

test('buildFiguresCarouselHtml: 上下页/圆点按钮', () => {
  const html = buildFiguresCarouselHtml(
    [{ url: 'a.png' }, { url: 'b.png' }],
    '/base',
  );
  assert.ok(html.includes('paper-carousel-prev'));
  assert.ok(html.includes('paper-carousel-next'));
  assert.ok(html.includes('paper-carousel-dot'));
});

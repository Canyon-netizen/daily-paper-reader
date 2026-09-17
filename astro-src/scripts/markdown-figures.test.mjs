#!/usr/bin/env node
// astro-src/scripts/markdown-figures.test.mjs
//
// Tests for R7: markdown figures URL extraction/transformation.

import { test, describe } from 'node:test';
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
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/markdown/figures.ts');
const { figureUrlToSrc, buildFiguresCarouselHtml } = mod;

describe('figureUrlToSrc', () => {
  test('absolute URL returns as-is', () => {
    assert.strictEqual(figureUrlToSrc('https://example.com/img.png', '/base'), 'https://example.com/img.png');
    assert.strictEqual(figureUrlToSrc('http://example.com/img.png', '/base'), 'http://example.com/img.png');
  });

  test('path starting with / returns as-is', () => {
    assert.strictEqual(figureUrlToSrc('/images/fig1.png', '/base'), '/images/fig1.png');
  });

  test('relative path gets base prepended', () => {
    assert.strictEqual(figureUrlToSrc('fig1.png', '/base'), '/base/fig1.png');
  });

  test('relative path with ./ gets base prepended', () => {
    assert.strictEqual(figureUrlToSrc('./fig1.png', '/base'), '/base/fig1.png');
  });

  test('base without trailing slash', () => {
    assert.strictEqual(figureUrlToSrc('img.png', '/my/base'), '/my/base/img.png');
  });

  test('base with trailing slash', () => {
    assert.strictEqual(figureUrlToSrc('img.png', '/my/base/'), '/my/base/img.png');
  });
});

describe('buildFiguresCarouselHtml', () => {
  test('empty figures returns empty string', () => {
    assert.strictEqual(buildFiguresCarouselHtml([], '/base'), '');
  });

  test('single figure renders correctly', () => {
    const figures = [{ url: 'fig1.png', caption: 'Figure 1', index: 1 }];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.match(html, /<h2>📊 论文图表\(共 1 张\)<\/h2>/);
    assert.match(html, /<img src="\/base\/fig1\.png"/);
    assert.match(html, /Figure 1/);
  });

  test('multiple figures render with carousel', () => {
    const figures = [
      { url: 'fig1.png', index: 1 },
      { url: 'fig2.png', index: 2 },
    ];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.match(html, /共 2 张/);
    assert.match(html, /data-count="2"/);
    assert.match(html, /data-index="0"/);
    assert.match(html, /data-index="1"/);
  });

  test('allRasterized=true uses page terminology', () => {
    const figures = [{ url: 'page1.png', index: 1 }];
    const html = buildFiguresCarouselHtml(figures, '/base', true);
    assert.match(html, /📄 论文页面预览/);
    assert.match(html, /共 1 页/);
    assert.match(html, /论文无独立配图/);
  });

  test('includes carousel buttons', () => {
    const figures = [{ url: 'fig1.png', index: 1 }];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.match(html, /paper-carousel-prev/);
    assert.match(html, /paper-carousel-next/);
  });

  test('includes dots for navigation', () => {
    const figures = [
      { url: 'fig1.png', index: 1 },
      { url: 'fig2.png', index: 2 },
    ];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.match(html, /paper-carousel-dots/);
    assert.match(html, /data-index="0"/);
    assert.match(html, /data-index="1"/);
  });

  test('uses width/height when provided', () => {
    const figures = [{ url: 'fig1.png', index: 1, width: 800, height: 600 }];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.match(html, /width="800"/);
    assert.match(html, /height="600"/);
  });

  test('omits width/height when not provided', () => {
    const figures = [{ url: 'fig1.png', index: 1 }];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.doesNotMatch(html, /width=/);
    assert.doesNotMatch(html, /height=/);
  });

  test('escapes caption HTML', () => {
    const figures = [{ url: 'fig1.png', caption: '<script>alert(1)</script>', index: 1 }];
    const html = buildFiguresCarouselHtml(figures, '/base');
    assert.match(html, /&lt;script&gt;/);
  });
});

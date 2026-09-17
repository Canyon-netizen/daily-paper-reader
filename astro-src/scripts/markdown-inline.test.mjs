#!/usr/bin/env node
// astro-src/scripts/markdown-inline.test.mjs
//
// Tests for R7: markdown inline parsing (bold, italic, code, links, KaTeX, wikilinks).

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

const mod = await loadTs('lib/markdown/inline.ts');
const { renderInline, WikilinkTarget } = mod;

// Note: parseWikilinkContent is not exported, so we test it indirectly through renderInline

describe('renderInline: bold', () => {
  test('bold with **', () => {
    const result = renderInline('hello **world**');
    assert.match(result, /<strong>world<\/strong>/);
  });

  test('bold with __', () => {
    const result = renderInline('hello __world__');
    assert.match(result, /<strong>world<\/strong>/);
  });

  test('multiple bold in one line', () => {
    const result = renderInline('**bold** and **again**');
    assert.match(result, /<strong>bold<\/strong>/);
    assert.match(result, /<strong>again<\/strong>/);
  });
});

describe('renderInline: italic', () => {
  test('italic with *', () => {
    const result = renderInline('hello *world*');
    assert.match(result, /<em>world<\/em>/);
  });

  test('italic with _', () => {
    const result = renderInline('hello _world_');
    assert.match(result, /<em>world<\/em>/);
  });
});

describe('renderInline: code', () => {
  test('inline code with backticks', () => {
    const result = renderInline('use `console.log()`');
    assert.match(result, /<code>console\.log\(\)<\/code>/);
  });
});

describe('renderInline: links and images', () => {
  test('markdown link', () => {
    const result = renderInline('check [google](https://google.com)');
    assert.match(result, /<a href="https:\/\/google\.com".*target="_blank".*>google<\/a>/);
  });

  test('markdown image', () => {
    const result = renderInline('see ![alt text](img.png)');
    assert.match(result, /<img src="img\.png" alt="alt text"/);
  });
});

describe('renderInline: KaTeX', () => {
  test('inline math $...$ renders', () => {
    const result = renderInline('E = mc^2 $x^2$');
    assert.match(result, /katex/);
  });

  test('block math $$...$$', () => {
    const result = renderInline('$$\\int x$$');
    assert.match(result, /katex/);
  });
});

describe('renderInline: wikilink', () => {
  test('wikilink with resolver - found', () => {
    const resolver = new Map();
    resolver.set('foo', { slug: 'foo-bar', display_name: 'Foo Bar' });
    const result = renderInline('see [[foo]]', { wikilinkResolver: resolver });
    assert.match(result, /<a class="wikilink".*href.*foo-bar.*>foo<\/a>/);
  });

  test('wikilink with resolver - alias', () => {
    const resolver = new Map();
    resolver.set('foo', { slug: 'foo-bar', display_name: 'Foo Bar' });
    const result = renderInline('see [[foo|alias]]', { wikilinkResolver: resolver });
    assert.match(result, /<a class="wikilink".*>alias<\/a>/);
  });

  test('wikilink with resolver - missing', () => {
    const resolver = new Map();
    resolver.set('foo', { slug: 'foo-bar', display_name: 'Foo Bar' });
    const result = renderInline('see [[missing]]', { wikilinkResolver: resolver });
    // Missing wikilink renders with escaped HTML
    assert.match(result, /wikilink--missing/);
  });

  test('wikilink without resolver - kept as literal', () => {
    const result = renderInline('see [[foo]]');
    assert.match(result, /\[\[foo\]\]/);
  });

  test('wikilink case insensitive lookup', () => {
    const resolver = new Map();
    resolver.set('foo', { slug: 'foo-slug', display_name: 'Foo' });
    resolver.set('FOO', { slug: 'foo-slug', display_name: 'Foo' }); // lowercase lookup
    const result = renderInline('see [[FOO]]', { wikilinkResolver: resolver });
    assert.match(result, /<a class="wikilink"/);
  });
});

describe('renderInline: escaping', () => {
  test('escapes HTML characters', () => {
    const result = renderInline('<script>alert(1)</script>');
    assert.match(result, /&lt;script&gt;/);
  });
});

describe('renderInline: combined', () => {
  test('mixed bold and italic', () => {
    const result = renderInline('**bold** and *italic*');
    assert.match(result, /<strong>bold<\/strong>/);
    assert.match(result, /<em>italic<\/em>/);
  });

  test('link inside text', () => {
    const result = renderInline('Click [here](http://example.com) now');
    assert.match(result, /href="http:\/\/example\.com"/);
  });
});

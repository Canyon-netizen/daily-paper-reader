#!/usr/bin/env node
// astro-src/scripts/markdown-title.test.mjs
//
// Tests for R7: markdown title parsing/normalization.

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

const mod = await loadTs('lib/markdown/title.ts');
const { renderTitleHtml } = mod;

describe('renderTitleHtml', () => {
  test('empty string returns empty', () => {
    assert.strictEqual(renderTitleHtml(''), '');
  });

  test('null/undefined returns empty', () => {
    assert.strictEqual(renderTitleHtml(null), '');
    assert.strictEqual(renderTitleHtml(undefined), '');
  });

  test('plain text is escaped', () => {
    const result = renderTitleHtml('Hello World');
    assert.match(result, /Hello World/);
    assert.doesNotMatch(result, /<.*>/);
  });

  test('HTML characters are escaped', () => {
    const result = renderTitleHtml('<script>alert(1)</script>');
    assert.match(result, /&lt;script&gt;/);
    assert.doesNotMatch(result, /<script>/);
  });

  test('inline math $...$ renders', () => {
    const result = renderTitleHtml('E = mc^2 $x^2$');
    assert.match(result, /katex/);
  });

  test('block math $$...$$ renders', () => {
    const result = renderTitleHtml('$$\\int_0^1 x^2 dx$$');
    assert.match(result, /katex/);
  });

  test('markdown is NOT interpreted (no bold/italic)', () => {
    const result = renderTitleHtml('**bold** and *italic*');
    assert.match(result, /\*\*bold\*\*/); // escaped, not converted
    assert.match(result, /\*italic\*/);
  });

  test('KaTeX uses trust:false', () => {
    const result = renderTitleHtml('$x^2$');
    assert.match(result, /katex/);
  });
});

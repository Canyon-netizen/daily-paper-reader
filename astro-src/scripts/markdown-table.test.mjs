#!/usr/bin/env node
// astro-src/scripts/markdown-table.test.mjs
//
// Tests for R7: markdown table processing.

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

const mod = await loadTs('lib/markdown/table.ts');
const { isTableRow, isAlignRow, renderTable } = mod;

describe('isTableRow', () => {
  test('recognizes table row with pipes', () => {
    assert.strictEqual(isTableRow('| a | b | c |'), true);
  });

  // Note: regex requires both leading and trailing pipe
  test('rejects row without leading pipe', () => {
    assert.strictEqual(isTableRow('a | b | c |'), false);
  });

  test('rejects row without trailing pipe', () => {
    assert.strictEqual(isTableRow('| a | b | c'), false);
  });

  test('rejects non-table row', () => {
    assert.strictEqual(isTableRow('just some text'), false);
  });

  test('rejects empty string', () => {
    assert.strictEqual(isTableRow(''), false);
  });

  test('handles whitespace', () => {
    assert.strictEqual(isTableRow('  | a | b |  '), true);
  });
});

describe('isAlignRow', () => {
  // Note: the regex requires at least 2 columns (at least one pipe inside)
  test('recognizes center align with 2+ columns', () => {
    assert.strictEqual(isAlignRow('|:---:|:---:|'), true);
  });

  test('recognizes left align with 2+ columns', () => {
    assert.strictEqual(isAlignRow('|:---|:---|'), true);
  });

  test('recognizes right align with 2+ columns', () => {
    assert.strictEqual(isAlignRow('|---:|---:|'), true);
  });

  test('recognizes plain dash with 2+ columns', () => {
    assert.strictEqual(isAlignRow('|---|---|'), true);
  });

  test('rejects non-align row', () => {
    assert.strictEqual(isAlignRow('| a | b |'), false);
  });

  test('handles multiple columns', () => {
    assert.strictEqual(isAlignRow('|:---:|:---:|:---:|'), true);
  });
});

describe('renderTable', () => {
  test('renders basic table', () => {
    const header = '| A | B |';
    const align = '|---|---|';
    const data = ['| 1 | 2 |', '| 3 | 4 |'];
    const html = renderTable(header, align, data);
    assert.match(html, /<table class="paper-md-table">/);
    assert.match(html, /<th.*>A<\/th>/);
    assert.match(html, /<th.*>B<\/th>/);
    assert.match(html, /<td.*>1<\/td>/);
    assert.match(html, /<td.*>2<\/td>/);
  });

  test('renders with alignment', () => {
    const header = '| Left | Center | Right |';
    const align = '|:---|:---:|---:|';
    const data = ['| a | b | c |'];
    const html = renderTable(header, align, data);
    assert.match(html, /text-align:left/);
    assert.match(html, /text-align:center/);
    assert.match(html, /text-align:right/);
  });

  test('renders multiple rows', () => {
    const header = '| X |';
    const align = '|---|';
    const data = ['| 1 |', '| 2 |', '| 3 |'];
    const html = renderTable(header, align, data);
    assert.match(html, /<tr><td.*>1<\/td><\/tr>/);
    assert.match(html, /<tr><td.*>2<\/td><\/tr>/);
    assert.match(html, /<tr><td.*>3<\/td><\/tr>/);
  });

  test('wraps content in renderInline', () => {
    const header = '| **Bold** |';
    const align = '|---|';
    const data = ['| text |'];
    const html = renderTable(header, align, data);
    assert.match(html, /<strong>Bold<\/strong>/);
  });

  test('handles empty data', () => {
    const header = '| A |';
    const align = '|---|';
    const html = renderTable(header, align, []);
    assert.match(html, /<table class="paper-md-table">/);
    assert.match(html, /<tbody><\/tbody>/);
  });
});

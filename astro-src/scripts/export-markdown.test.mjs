#!/usr/bin/env node
// astro-src/scripts/export-markdown.test.mjs
//
// Tests for renderMarkdown in astro-src/scripts/export/markdown.ts (R7 D.1.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTsModule(relPath) {
  const src = readFileSync(join(__dirname, '..', relPath), 'utf8');
  const result = await esbuild.transform(src, { loader: 'ts', format: 'esm' });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(result.code).toString('base64');
  return import(dataUrl);
}

const { renderMarkdown } = await loadTsModule('scripts/export/markdown.ts');

test('renderMarkdown: empty list -> empty string with trailing newline', () => {
  const out = renderMarkdown([]);
  assert.equal(out, '\n');
});

test('renderMarkdown: single paper with tldr', () => {
  const out = renderMarkdown([{
    id: 'p1',
    title: 'A Sample Paper',
    authors: 'Alice, Bob',
    date: '2026-09-01',
    arxivId: '2401.01234',
    tldr: 'Short summary of the paper.',
  }]);
  assert.match(out, /^# A Sample Paper/);
  assert.match(out, /\*\*Authors:\*\* Alice, Bob/);
  assert.match(out, /\*\*Date:\*\* 2026-09-01/);
  assert.match(out, /\*\*arXiv:\*\* \[2401\.01234\]\(https:\/\/arxiv\.org\/abs\/2401\.01234\)/);
  assert.match(out, /> Short summary of the paper\./);
});

test('renderMarkdown: falls back to body when tldr missing', () => {
  const out = renderMarkdown([{
    id: 'p1',
    title: 'No TLDR Paper',
    body: 'This is the first 200 chars of the body.\nIt has newlines and special chars * like * asterisks.',
  }]);
  // body excerpt uses whitespace-collapse + slice(0, 200) (no escapeMd)
  assert.match(out, /> This is the first 200 chars of the body\. It has newlines and special chars \* like \* asterisks\./);
});

test('renderMarkdown: uses title_zh fallback', () => {
  const out = renderMarkdown([{
    id: 'p1',
    title_zh: '中文标题',
    tldr: 't',
  }]);
  assert.match(out, /^# 中文标题/);
});

test('renderMarkdown: separates papers with ---', () => {
  const out = renderMarkdown([
    { id: 'p1', title: 'First', tldr: 'a' },
    { id: 'p2', title: 'Second', tldr: 'b' },
  ]);
  // \n---\n\n appears between sections
  const parts = out.split(/^---$/m);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /First/);
  assert.match(parts[1], /Second/);
});

test('renderMarkdown: escapes special md chars in metadata', () => {
  const out = renderMarkdown([{
    id: 'p1',
    title: 'Title with *asterisks* and [brackets]',
    authors: 'Smith, J.',
    tldr: 't',
  }]);
  // asterisks in title and authors escaped
  assert.match(out, /# Title with \\\*asterisks\\\*/);
  assert.match(out, /Smith, J\./);
});

test('renderMarkdown: missing optional fields gracefully', () => {
  const out = renderMarkdown([{ id: 'p1' }]);
  assert.match(out, /^# p1/);
  // no Authors / Date / arXiv lines
  assert.equal(out.match(/\*\*Authors:\*\*/), null);
  assert.equal(out.match(/\*\*Date:\*\*/), null);
  assert.equal(out.match(/\*\*arXiv:\*\*/), null);
});

test('renderMarkdown: prefers tldr over body excerpt', () => {
  const out = renderMarkdown([{
    id: 'p1',
    title: 'X',
    tldr: 'use this',
    body: 'do not use this',
  }]);
  assert.match(out, /> use this/);
  assert.equal(out.match(/do not use this/), null);
});
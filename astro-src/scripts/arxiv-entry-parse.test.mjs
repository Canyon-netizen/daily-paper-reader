#!/usr/bin/env node
// astro-src/scripts/arxiv-entry-parse.test.mjs
//
// Tests for R7 polish: astro-src/lib/arxiv-entry/parse.ts.
// parseArxivEntry — 需要 mock Element(用最小 stub)。

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

const mod = await loadTs('lib/arxiv-entry/parse.ts');
const { parseArxivEntry } = mod;

// 极简 Element stub
function mkElement({ id, title, summary, authors, published, updated, links }) {
  const findAll = (sel) => {
    if (sel === 'author name') {
      return (authors || []).map((text) => ({ textContent: text }));
    }
    if (sel === 'link') return links || [];
    return [];
  };
  const findOne = (sel) => {
    if (sel === 'id') return { textContent: id || '' };
    if (sel === 'title') return { textContent: title || '' };
    if (sel === 'summary') return { textContent: summary || '' };
    if (sel === 'published') return { textContent: published || '' };
    if (sel === 'updated') return { textContent: updated || '' };
    return null;
  };
  return {
    querySelector: (sel) => findOne(sel),
    querySelectorAll: (sel) => findAll(sel),
  };
}

// ---------- parseArxivEntry: 基本 ----------
test('parseArxivEntry: 标准 entry', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v7',
    title: 'Attention Is All You Need',
    summary: 'We propose a new architecture.',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    published: '2017-06-12T00:00:00Z',
    updated: '2023-08-02T00:00:00Z',
  });
  const r = parseArxivEntry(e);
  assert.equal(r.arxivId, '1706.03762v7');
  assert.equal(r.title, 'Attention Is All You Need');
  assert.deepEqual(r.authors, ['Ashish Vaswani', 'Noam Shazeer']);
  assert.equal(r.published, '2017-06-12T00:00:00Z');
  assert.equal(r.updated, '2023-08-02T00:00:00Z');
});

test('parseArxivEntry: summary 空白折叠', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v1',
    title: 'Foo',
    summary: 'multi\n\nline   summary',
  });
  const r = parseArxivEntry(e);
  assert.equal(r.summary, 'multi line summary');
});

test('parseArxivEntry: title 空白折叠', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v1',
    title: 'multi\n\nline   title',
  });
  const r = parseArxivEntry(e);
  assert.equal(r.title, 'multi line title');
});

test('parseArxivEntry: 无 id → 空字符串', () => {
  const e = mkElement({ title: 'Foo' });
  const r = parseArxivEntry(e);
  // 无 id → arxivId = ''
  assert.equal(r.arxivId, '');
});

test('parseArxivEntry: id 无 /abs/ → arxivId = 整串', () => {
  const e = mkElement({ id: 'plain-id-no-abs', title: 'Foo' });
  const r = parseArxivEntry(e);
  // 'plain-id-no-abs'.split('/abs/').pop() = 'plain-id-no-abs'
  assert.equal(r.arxivId, 'plain-id-no-abs');
});

test('parseArxivEntry: 无 authors → []', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: 'Foo', authors: [] });
  const r = parseArxivEntry(e);
  assert.deepEqual(r.authors, []);
});

test('parseArxivEntry: 作者过滤空字符串', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1234.5678v1',
    title: 'Foo',
    authors: ['Alice', '', '  ', 'Bob'],
  });
  const r = parseArxivEntry(e);
  assert.deepEqual(r.authors, ['Alice', 'Bob']);
});

test('parseArxivEntry: 作者 trim', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1234.5678v1',
    title: 'Foo',
    authors: ['  Alice  '],
  });
  const r = parseArxivEntry(e);
  assert.deepEqual(r.authors, ['Alice']);
});

// ---------- 跳过占位 ----------
test('parseArxivEntry: title 为空 → null', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: '' });
  assert.equal(parseArxivEntry(e), null);
});

test('parseArxivEntry: title="Error" → null', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: 'Error' });
  assert.equal(parseArxivEntry(e), null);
});

test('parseArxivEntry: title="error" (大小写无关) → null', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: 'error' });
  assert.equal(parseArxivEntry(e), null);
});

test('parseArxivEntry: title="ERROR" → null', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: 'ERROR' });
  assert.equal(parseArxivEntry(e), null);
});

test('parseArxivEntry: title 长度 < 3 → null', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: 'ab' });
  assert.equal(parseArxivEntry(e), null);
});

test('parseArxivEntry: title 长度 = 3 → 保留', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1234.5678v1', title: 'abc' });
  const r = parseArxivEntry(e);
  assert.notEqual(r, null);
});

// ---------- pdfUrl ----------
test('parseArxivEntry: link title=pdf → 用其 href', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v1',
    title: 'Foo',
    links: [{ getAttribute: (k) => k === 'title' ? 'pdf' : k === 'href' ? 'https://example.com/pdf' : null }],
  });
  const r = parseArxivEntry(e);
  assert.equal(r.pdfUrl, 'https://example.com/pdf');
});

test('parseArxivEntry: link rel=related → 用其 href', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v1',
    title: 'Foo',
    links: [{ getAttribute: (k) => k === 'rel' ? 'related' : k === 'href' ? 'https://example.com/related' : null }],
  });
  const r = parseArxivEntry(e);
  assert.equal(r.pdfUrl, 'https://example.com/related');
});

test('parseArxivEntry: 无 pdf link → fallback arxiv.org/pdf/<id>', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v1',
    title: 'Foo',
    links: [],
  });
  const r = parseArxivEntry(e);
  assert.equal(r.pdfUrl, 'https://arxiv.org/pdf/1706.03762v1');
});

test('parseArxivEntry: pdf link 无 href → fallback', () => {
  const e = mkElement({
    id: 'http://arxiv.org/abs/1706.03762v1',
    title: 'Foo',
    links: [{ getAttribute: (_k) => null }],
  });
  const r = parseArxivEntry(e);
  assert.equal(r.pdfUrl, 'https://arxiv.org/pdf/1706.03762v1');
});

// ---------- published/updated ----------
test('parseArxivEntry: 无 published/updated → 空', () => {
  const e = mkElement({ id: 'http://arxiv.org/abs/1706.03762v1', title: 'Foo' });
  const r = parseArxivEntry(e);
  assert.equal(r.published, '');
  assert.equal(r.updated, '');
});

test('parseArxivEntry: id 透传', () => {
  const idFull = 'http://arxiv.org/abs/1706.03762v7';
  const e = mkElement({ id: idFull, title: 'Foo' });
  const r = parseArxivEntry(e);
  assert.equal(r.id, idFull);
});
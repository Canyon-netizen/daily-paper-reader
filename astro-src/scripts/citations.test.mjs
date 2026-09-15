#!/usr/bin/env node
// astro-src/scripts/citations.test.mjs
//
// Tests for R7 E.3.3 citation management helpers.

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

const mod = await loadTs('lib/writing/citations.ts');
const {
  generateBibtex,
  deriveBibtexKey,
  stripArxivVersion,
  buildCitationFromRef,
  renderBibtexLibrary,
  renderMarkdownBibliography,
} = mod;

// ----- deriveBibtexKey -----

test('deriveBibtexKey: "Last, First" format takes last name', () => {
  assert.equal(deriveBibtexKey(['Smith, John', 'Doe, Jane'], 2024), 'smith2024');
});

test('deriveBibtexKey: 中文作者使用全名', () => {
  assert.equal(deriveBibtexKey(['张三', '李四'], 2024), '张三2024');
});

test('deriveBibtexKey: 单个名字无逗号', () => {
  assert.equal(deriveBibtexKey(['Alice'], 2023), 'alice2023');
});

test('deriveBibtexKey: 空作者列表 → "anon"', () => {
  assert.equal(deriveBibtexKey([], 2024), 'anon2024');
});

// ----- stripArxivVersion -----

test('stripArxivVersion: removes vN suffix', () => {
  assert.equal(stripArxivVersion('1706.03762v1'), '1706.03762');
  assert.equal(stripArxivVersion('1706.03762v12'), '1706.03762');
});

test('stripArxivVersion: leaves non-versioned ids alone', () => {
  assert.equal(stripArxivVersion('1706.03762'), '1706.03762');
});

// ----- generateBibtex -----

test('generateBibtex: produces well-formed @article entry', () => {
  const c = {
    key: 'vaswani2017attention',
    arxivId: '1706.03762',
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
    year: 2017,
    primaryClass: 'cs.CL',
  };
  const bib = generateBibtex(c);
  assert.match(bib, /^@article\{vaswani2017attention,/);
  assert.match(bib, /title = \{Attention Is All You Need\}/);
  assert.match(bib, /author = \{Vaswani, Ashish and Shazeer, Noam\}/);
  assert.match(bib, /year = \{2017\}/);
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.match(bib, /archivePrefix = \{arXiv\}/);
  assert.match(bib, /primaryClass = \{cs\.CL\}/);
});

test('generateBibtex: strips vN from eprint', () => {
  const c = {
    key: 'k', arxivId: '1706.03762v3',
    title: 'T', authors: ['A'], year: 2024,
  };
  const bib = generateBibtex(c);
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.ok(!bib.includes('v3'));
});

test('generateBibtex: escapes braces and backslashes in title', () => {
  const c = {
    key: 'k', arxivId: '1',
    title: 'Title with {braces} and \\ backslash',
    authors: ['A'], year: 2024,
  };
  const bib = generateBibtex(c);
  // 实际输出:title = {Title with \{braces\} and \\ backslash}
  // 在 regex 里:\{braces\} → \\{braces\\};两个反斜杠 → \\\\
  assert.match(bib, /title = \{Title with \\{braces\\} and \\\\ backslash\}/);
});

test('generateBibtex: omits primaryClass when not provided', () => {
  const c = { key: 'k', arxivId: '1', title: 'T', authors: ['A'], year: 2024 };
  const bib = generateBibtex(c);
  assert.ok(!bib.includes('primaryClass'));
});

// ----- buildCitationFromRef -----

test('buildCitationFromRef: falls back to Anonymous + current year', () => {
  const ref = { arxivId: '1706.03762v1' };
  const c = buildCitationFromRef(ref);
  assert.equal(c.arxivId, '1706.03762');
  assert.equal(c.authors[0], 'Anonymous');
  assert.equal(c.year, new Date().getFullYear());
  assert.equal(c.key, `anonymous${new Date().getFullYear()}`);
  assert.ok(c.bibtex);
});

test('buildCitationFromRef: uses explicit authors + title', () => {
  const ref = { arxivId: '1706.03762' };
  const c = buildCitationFromRef(ref, {
    authors: ['Vaswani, Ashish'],
    title: 'Attention',
    year: 2017,
    primaryClass: 'cs.CL',
  });
  assert.equal(c.key, 'vaswani2017');
  assert.match(c.bibtex, /title = \{Attention\}/);
});

// ----- renderBibtexLibrary -----

test('renderBibtexLibrary: concatenates entries with blank lines', () => {
  const lib = renderBibtexLibrary([
    { key: 'a', arxivId: '1', title: 'A', authors: ['A'], year: 2024, bibtex: '@article{a,\n  t={A}\n}\n' },
    { key: 'b', arxivId: '2', title: 'B', authors: ['B'], year: 2024, bibtex: '@article{b,\n  t={B}\n}\n' },
  ]);
  assert.match(lib, /@article\{a,/);
  assert.match(lib, /@article\{b,/);
  // 至少有一个空行分隔
  assert.match(lib, /\}\s*\n\s*@article\{b,/);
});

test('renderBibtexLibrary: generates bibtex on the fly if missing', () => {
  const lib = renderBibtexLibrary([
    { key: 'a', arxivId: '1', title: 'A', authors: ['A'], year: 2024 },
  ]);
  assert.match(lib, /@article\{a,/);
});

// ----- renderMarkdownBibliography -----

test('renderMarkdownBibliography: empty input returns empty string', () => {
  assert.equal(renderMarkdownBibliography([], []), '');
});

test('renderMarkdownBibliography: uses first author et al + year + title', () => {
  const refs = [{ arxivId: '1706.03762' }];
  const citations = [{
    key: 'vaswani2017',
    arxivId: '1706.03762',
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
    year: 2017,
    bibtex: '',
  }];
  const md = renderMarkdownBibliography(refs, citations);
  assert.match(md, /^- Vaswani, Ashish et al\., 2017\. \*Attention Is All You Need\*\. arXiv:1706\.03762$/m);
});

test('renderMarkdownBibliography: missing citation falls back to arXiv ID', () => {
  const refs = [{ arxivId: '2401.01234' }];
  const md = renderMarkdownBibliography(refs, []);
  assert.match(md, /^- arXiv:2401\.01234$/m);
});
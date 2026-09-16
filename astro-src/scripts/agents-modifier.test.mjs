#!/usr/bin/env node
// astro-src/scripts/agents-modifier.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/modifier.ts pure helpers.
// 测试 checkCrossReference + renderBibliography + getBibliographyConfig + FORMAT_TEMPLATES。

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
    write: false,
    target: 'es2022',
    external: [
      'node:*',
      '../user-libraries/types', '../../user-libraries/types',
      '../ideas', '../../ideas',
      '../experiments', '../../experiments',
      '../writing', '../../writing',
      '../projects', '../../projects',
      '../projects/activity', '../../projects/activity',
    ],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/modifier.ts');
const {
  MIN_CITATIONS,
  FORMAT_TEMPLATES,
  getBibliographyConfig,
  checkCrossReference,
  renderBibliography,
} = mod;

const mkProposal = (overrides) => ({
  id: 'p1',
  type: 'create_draft',
  title: 'T',
  rationale: 'r',
  evidence: { paperIds: [], quotes: [] },
  target: {},
  estimated_effort: 'low',
  risk: '',
  ...overrides,
});

// ---------- MIN_CITATIONS / FORMAT_TEMPLATES ----------
test('MIN_CITATIONS: 3', () => {
  assert.equal(MIN_CITATIONS, 3);
});

test('FORMAT_TEMPLATES: 3 格式', () => {
  assert.ok('arxiv' in FORMAT_TEMPLATES);
  assert.ok('acl' in FORMAT_TEMPLATES);
  assert.ok('journal' in FORMAT_TEMPLATES);
});

test('FORMAT_TEMPLATES: arxiv bibtex', () => {
  assert.equal(FORMAT_TEMPLATES.arxiv.citationStyle, 'bibtex');
});

test('FORMAT_TEMPLATES: acl natbib', () => {
  assert.equal(FORMAT_TEMPLATES.acl.citationStyle, 'natbib');
});

test('FORMAT_TEMPLATES: journal biblatex', () => {
  assert.equal(FORMAT_TEMPLATES.journal.citationStyle, 'biblatex');
});

test('FORMAT_TEMPLATES: sectionOrder 含 abstract + conclusion', () => {
  for (const t of ['arxiv', 'acl', 'journal']) {
    assert.ok(FORMAT_TEMPLATES[t].sectionOrder.includes('abstract'));
    assert.ok(FORMAT_TEMPLATES[t].sectionOrder.includes('conclusion'));
  }
});

// ---------- getBibliographyConfig ----------
test('getBibliographyConfig: arxiv → arxiv config', () => {
  const r = getBibliographyConfig('arxiv');
  assert.equal(r.format, 'arxiv');
});

test('getBibliographyConfig: acl', () => {
  const r = getBibliographyConfig('acl');
  assert.equal(r.format, 'acl');
});

test('getBibliographyConfig: journal', () => {
  const r = getBibliographyConfig('journal');
  assert.equal(r.format, 'journal');
});

test('getBibliographyConfig: 未知 format → 兜底 arxiv', () => {
  const r = getBibliographyConfig('unknown');
  assert.equal(r.format, 'arxiv');
});

// ---------- checkCrossReference ----------
test('checkCrossReference: add_paper 跳过校验', () => {
  const r = checkCrossReference(mkProposal({
    type: 'add_paper',
    evidence: { paperIds: [], quotes: [] },
  }));
  assert.equal(r.ok, true);
});

test('checkCrossReference: experiment_plan 跳过校验', () => {
  const r = checkCrossReference(mkProposal({
    type: 'experiment_plan',
    evidence: { paperIds: [], quotes: [] },
  }));
  assert.equal(r.ok, true);
});

test('checkCrossReference: archive_paper 跳过校验', () => {
  const r = checkCrossReference(mkProposal({
    type: 'archive_paper',
    evidence: { paperIds: [], quotes: [] },
  }));
  assert.equal(r.ok, true);
});

test('checkCrossReference: create_draft + 3 合法 paperIds → ok', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['2310.12345', '2310.12346', '2310.12347'], quotes: [] },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.validPaperIds.length, 3);
});

test('checkCrossReference: create_draft + 2 合法 → not ok', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['2310.12345', '2310.12346'], quotes: [] },
  }));
  assert.equal(r.ok, false);
  assert.equal(r.validPaperIds.length, 2);
});

test('checkCrossReference: create_draft + 全部非法 → not ok', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['bad', 'also-bad'], quotes: [] },
  }));
  assert.equal(r.ok, false);
  assert.equal(r.validPaperIds.length, 0);
  assert.equal(r.invalidPaperIds.length, 2);
});

test('checkCrossReference: 合法 + 非法混合 → 只 valid 计入', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['2310.12345', 'bad', '2310.12346', '2310.12347'], quotes: [] },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.validPaperIds.length, 3);
  assert.equal(r.invalidPaperIds.length, 1);
});

test('checkCrossReference: vN 后缀合法', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['2310.12345v2', '2310.12346v1', '2310.12347'], quotes: [] },
  }));
  assert.equal(r.ok, true);
});

test('checkCrossReference: 自定义 minCitations', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['2310.12345'], quotes: [] },
  }), 1);
  assert.equal(r.ok, true);
});

test('checkCrossReference: reason 含数量信息', () => {
  const r = checkCrossReference(mkProposal({
    type: 'create_draft',
    evidence: { paperIds: ['2310.12345'], quotes: [] },
  }));
  assert.match(r.reason, /不达标/);
  assert.match(r.reason, /3 最低要求/);
});

// ---------- renderBibliography ----------
test('renderBibliography: 空 ids → ""', () => {
  const r = renderBibliography(mkProposal({
    evidence: { paperIds: [], quotes: [] },
  }), 'bibtex');
  assert.equal(r, '');
});

test('renderBibliography: bibtex style', () => {
  const r = renderBibliography(mkProposal({
    evidence: { paperIds: ['2310.12345', '2310.12346'], quotes: [] },
  }), 'bibtex');
  assert.match(r, /\\bibliographystyle\{plain\}/);
  assert.match(r, /\\begin\{thebibliography\}/);
  assert.match(r, /\\bibitem/);
  assert.match(r, /\\end\{thebibliography\}/);
});

test('renderBibliography: natbib style', () => {
  const r = renderBibliography(mkProposal({
    evidence: { paperIds: ['2310.12345'], quotes: [] },
  }), 'natbib');
  assert.match(r, /\\begin\{thebibliography\}/);
  assert.match(r, /\[1\] 2310.12345/);
});

test('renderBibliography: biblatex style', () => {
  const r = renderBibliography(mkProposal({
    evidence: { paperIds: ['2310.12345', '2310.12346'], quotes: [] },
  }), 'biblatex');
  assert.match(r, /\\printbibliography/);
  assert.match(r, /@article/);
  assert.match(r, /2310.12345/);
  assert.match(r, /2310.12346/);
});

test('renderBibliography: 未知 style → 默认 items 格式', () => {
  const r = renderBibliography(mkProposal({
    evidence: { paperIds: ['2310.12345'], quotes: [] },
  }), '???');
  assert.match(r, /\[1\] 2310.12345/);
});

test('renderBibliography: bibtex 含每个 paperId', () => {
  const r = renderBibliography(mkProposal({
    evidence: { paperIds: ['2310.12345', '2310.99999'], quotes: [] },
  }), 'bibtex');
  assert.match(r, /2310.12345/);
  assert.match(r, /2310.99999/);
});
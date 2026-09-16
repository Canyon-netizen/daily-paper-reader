#!/usr/bin/env node
// astro-src/scripts/modifier-cross-ref.test.mjs
//
// Tests for R7 F.3.2 (cross-reference enforcement) and F.3.3 (bibliography formatting).

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
    // 把 dynamic import 的辅助模块标 external(esbuild 跟不动)
    // 我们只要用到顶部静态 export 的常量 / 函数
    external: ['../experiments', '../../experiments', '../paper', '../../paper', '../projects', '../../projects'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/modifier.ts');
const {
  MIN_CITATIONS,
  checkCrossReference,
  renderBibliography,
  getBibliographyConfig,
  FORMAT_TEMPLATES,
} = mod;

// helper: makeProposal
function makeProposal(type, paperIds) {
  return {
    id: 'p1',
    type,
    title: 'Test proposal',
    rationale: 'because',
    risk: 'low',
    evidence: { paperIds, quotes: [] },
    target: {},
    feedbackScore: 0.5,
  };
}

// ----- MIN_CITATIONS -----

test('MIN_CITATIONS 默认 3', () => {
  assert.equal(MIN_CITATIONS, 3);
});

// ----- checkCrossReference -----

test('checkCrossReference: add_paper 不强制', () => {
  const p = makeProposal('add_paper', ['2506.12345']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
});

test('checkCrossReference: experiment_plan 不强制', () => {
  const p = makeProposal('experiment_plan', ['2506.12345']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
});

test('checkCrossReference: create_draft ≥ 3 ok', () => {
  const p = makeProposal('create_draft', ['2506.12345', '2506.67890', '2506.11111']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
  assert.equal(r.validPaperIds.length, 3);
});

test('checkCrossReference: create_draft < 3 fail', () => {
  const p = makeProposal('create_draft', ['2506.12345', '2506.67890']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('不达标'));
});

test('checkCrossReference: literature_review ≥ 3 ok', () => {
  const p = makeProposal('literature_review', ['2506.10001', '2506.10002', '2506.10003']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
});

test('checkCrossReference: rebuttal ≥ 3 ok', () => {
  const p = makeProposal('rebuttal', ['2506.10001', '2506.10002', '2506.10003']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
});

test('checkCrossReference: invalid arxiv id 列入 invalidPaperIds', () => {
  const p = makeProposal('create_draft', ['2506.12345', 'bad-id', '2506.67890', '2506.11111']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
  assert.equal(r.validPaperIds.length, 3);
  assert.deepEqual(r.invalidPaperIds, ['bad-id']);
});

test('checkCrossReference: 全部 invalid → fail', () => {
  const p = makeProposal('create_draft', ['bad', 'also-bad']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, false);
});

test('checkCrossReference: vN 后缀也合法', () => {
  const p = makeProposal('create_draft', ['2506.12345v1', '2506.67890v2', '2506.11111']);
  const r = checkCrossReference(p);
  assert.equal(r.ok, true);
  assert.equal(r.validPaperIds.length, 3);
});

test('checkCrossReference: 自定义 minCitations', () => {
  const p = makeProposal('create_draft', ['2506.10001', '2506.10002']);
  const r = checkCrossReference(p, 2);
  assert.equal(r.ok, true);
});

// ----- renderBibliography -----

test('renderBibliography: bibtex 输出 thebibliography', () => {
  const p = makeProposal('create_draft', ['2506.1', '2506.2', '2506.3']);
  const out = renderBibliography(p, 'bibtex');
  assert.match(out, /\\begin\{thebibliography\}/);
  assert.match(out, /\\bibitem\{2506\.1\}/);
});

test('renderBibliography: natbib 输出 \citep 风格', () => {
  const p = makeProposal('create_draft', ['2506.10001', '2506.10002', '2506.10003']);
  const out = renderBibliography(p, 'natbib');
  assert.match(out, /thebibliography/);
  assert.match(out, /2506\.10001/);
});

test('renderBibliography: biblatex 输出 printbibliography', () => {
  const p = makeProposal('create_draft', ['2506.10001', '2506.10002', '2506.10003']);
  const out = renderBibliography(p, 'biblatex');
  assert.match(out, /\\printbibliography/);
  assert.match(out, /@article/);
});

test('renderBibliography: 空 paperIds → 空字符串', () => {
  const p = makeProposal('create_draft', []);
  assert.equal(renderBibliography(p, 'bibtex'), '');
});

// ----- getBibliographyConfig -----

test('getBibliographyConfig: arxiv → plain citation, method 先', () => {
  const cfg = getBibliographyConfig('arxiv');
  assert.equal(cfg.citationStyle, 'bibtex');
  assert.deepEqual(cfg.sectionOrder.slice(0, 3), ['abstract', 'intro', 'method']);
});

test('getBibliographyConfig: acl → natbib', () => {
  const cfg = getBibliographyConfig('acl');
  assert.equal(cfg.citationStyle, 'natbib');
});

test('getBibliographyConfig: journal → biblatex + results/discussion', () => {
  const cfg = getBibliographyConfig('journal');
  assert.equal(cfg.citationStyle, 'biblatex');
  assert.ok(cfg.sectionOrder.includes('results'));
  assert.ok(cfg.sectionOrder.includes('discussion'));
});

test('getBibliographyConfig: 未知 format → fallback arxiv', () => {
  const cfg = getBibliographyConfig('unknown');
  assert.equal(cfg.format, 'arxiv');
});

test('FORMAT_TEMPLATES: 三种格式齐', () => {
  assert.ok(FORMAT_TEMPLATES.arxiv);
  assert.ok(FORMAT_TEMPLATES.acl);
  assert.ok(FORMAT_TEMPLATES.journal);
});
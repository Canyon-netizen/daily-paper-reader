#!/usr/bin/env node
// astro-src/scripts/deliverable-format.test.mjs
//
// Tests for R7 F.3.1 deliverable format spec + section diffing + validation.

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

const mod = await loadTs('lib/agents/deliverable-format.ts');
const {
  DELIVERABLE_FORMAT_SPECS,
  parseDeliverableFormat,
  diffSections,
  validateAgainstFormat,
} = mod;

// ----- 3 formats -----

test('DELIVERABLE_FORMAT_SPECS: covers all 3 formats', () => {
  for (const f of ['arxiv', 'acl', 'journal']) {
    assert.ok(DELIVERABLE_FORMAT_SPECS[f]);
  }
});

test('arxiv: no limitations, no ethics, numeric citation', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.requiresLimitations, false);
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.requiresEthics, false);
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.citationStyle, 'numeric');
});

test('acl: requires limitations + ethics + related work', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.requiresLimitations, true);
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.requiresEthics, true);
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.requiresRelatedWork, true);
});

test('journal: allows longer abstract (500 vs 250)', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.journal.abstractMaxChars, 500);
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.abstractMaxChars, 250);
});

// ----- parseDeliverableFormat -----

test('parseDeliverableFormat: valid format', () => {
  assert.equal(parseDeliverableFormat('arxiv'), 'arxiv');
  assert.equal(parseDeliverableFormat('acl'), 'acl');
  assert.equal(parseDeliverableFormat('journal'), 'journal');
});

test('parseDeliverableFormat: invalid returns null', () => {
  assert.equal(parseDeliverableFormat('foo'), null);
  assert.equal(parseDeliverableFormat(123), null);
  assert.equal(parseDeliverableFormat(null), null);
});

// ----- diffSections -----

test('diffSections: 完全匹配 → missing/extra 空,orderScore 1', () => {
  const d = diffSections('arxiv', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'method' },
    { id: 'experiments' }, { id: 'results' }, { id: 'discussion' },
    { id: 'conclusion' }, { id: 'references' },
  ]);
  assert.equal(d.missing.length, 0);
  assert.equal(d.extra.length, 0);
  assert.equal(d.orderScore, 1);
});

test('diffSections: acl 缺 limitations + ethics → 报告 missing', () => {
  const d = diffSections('acl', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'method' },
  ]);
  assert.ok(d.missing.includes('limitations'));
  assert.ok(d.missing.includes('ethics'));
});

test('diffSections: extra 章节(arXiv 不需要 related_work)', () => {
  const d = diffSections('arxiv', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'related_work' }, // 多余
    { id: 'method' }, { id: 'experiments' }, { id: 'results' },
    { id: 'discussion' }, { id: 'conclusion' }, { id: 'references' },
  ]);
  assert.ok(d.extra.includes('related_work'));
});

test('diffSections: 顺序错乱 → orderScore < 1', () => {
  const d = diffSections('arxiv', [
    { id: 'method' }, { id: 'abstract' }, { id: 'introduction' },
  ]);
  // LCS = ['abstract'] or similar → orderScore 偏低
  assert.ok(d.orderScore < 1);
});

// ----- validateAgainstFormat -----

test('validateAgainstFormat: arxiv 报告 abstractLengthOk', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(100),
    sections: [{ id: 'abstract' }],
  });
  assert.equal(r.abstractLengthOk, true);
  assert.equal(r.abstractLength, 100);
});

test('validateAgainstFormat: arxiv abstract 超过 250 → abstractLengthOk false', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(300),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, false);
});

test('validateAgainstFormat: 空 abstract → undefined length + false', () => {
  const r = validateAgainstFormat('acl', {
    abstract: '',
    sections: [],
  });
  assert.equal(r.abstractLength, undefined);
  assert.equal(r.abstractLengthOk, false);
});
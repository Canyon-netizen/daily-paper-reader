#!/usr/bin/env node
// astro-src/scripts/agents-deliverable-format.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/deliverable-format.ts.
// DELIVERABLE_FORMAT_SPECS 常量 +
// parseDeliverableFormat +
// diffSections (LCS-based order score) +
// validateAgainstFormat。

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

// ---------- DELIVERABLE_FORMAT_SPECS ---
test('specs: 3 个 format', () => {
  assert.ok(DELIVERABLE_FORMAT_SPECS.arxiv);
  assert.ok(DELIVERABLE_FORMAT_SPECS.acl);
  assert.ok(DELIVERABLE_FORMAT_SPECS.journal);
  assert.equal(Object.keys(DELIVERABLE_FORMAT_SPECS).length, 3);
});

test('specs: arxiv 8 sections, abstract ≤ 250', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.expectedSections.length, 8);
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.abstractMaxChars, 250);
});

test('specs: acl 11 sections, requires Limitations + Ethics', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.requiresLimitations, true);
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.requiresEthics, true);
  assert.ok(DELIVERABLE_FORMAT_SPECS.acl.expectedSections.length >= 10);
});

test('specs: journal 9 sections, abstract ≤ 500, citation author-year', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.journal.abstractMaxChars, 500);
  assert.equal(DELIVERABLE_FORMAT_SPECS.journal.citationStyle, 'author-year');
});

test('specs: arxiv numeric, acl author-year', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.citationStyle, 'numeric');
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.citationStyle, 'author-year');
});

// ---------- parseDeliverableFormat ---
test('parse: "arxiv" → "arxiv"', () => {
  assert.equal(parseDeliverableFormat('arxiv'), 'arxiv');
});

test('parse: "acl" → "acl"', () => {
  assert.equal(parseDeliverableFormat('acl'), 'acl');
});

test('parse: "journal" → "journal"', () => {
  assert.equal(parseDeliverableFormat('journal'), 'journal');
});

test('parse: 未知 → null', () => {
  assert.equal(parseDeliverableFormat('unknown'), null);
});

test('parse: null → null', () => {
  assert.equal(parseDeliverableFormat(null), null);
});

test('parse: undefined → null', () => {
  assert.equal(parseDeliverableFormat(undefined), null);
});

test('parse: 数字 → null', () => {
  assert.equal(parseDeliverableFormat(42), null);
});

// ---------- diffSections: missing/extra ---
test('diff: 完全匹配', () => {
  const r = diffSections('arxiv', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'method' },
    { id: 'experiments' }, { id: 'results' }, { id: 'discussion' },
    { id: 'conclusion' }, { id: 'references' },
  ]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, []);
  assert.equal(r.orderScore, 1);
});

test('diff: 缺 section', () => {
  const r = diffSections('arxiv', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'method' },
  ]);
  assert.ok(r.missing.length > 0);
  assert.ok(r.missing.includes('experiments'));
});

test('diff: 多余 section', () => {
  const r = diffSections('arxiv', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'extra-section' },
  ]);
  assert.ok(r.extra.includes('extra-section'));
});

test('diff: 用 title (无 id)', () => {
  const r = diffSections('arxiv', [
    { title: 'Abstract' }, { title: 'Introduction' },
  ]);
  assert.ok(r.missing.length > 0);
});

test('diff: 大小写不敏感', () => {
  const r = diffSections('arxiv', [
    { id: 'ABSTRACT' }, { id: 'INTRODUCTION' },
  ]);
  // 大小写归一化后视为匹配
  assert.equal(r.missing.includes('abstract'), false);
});

// ---------- diffSections: order score ---
test('diff: 顺序完全匹配 → orderScore=1', () => {
  const r = diffSections('acl', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'related_work' },
    { id: 'method' }, { id: 'experiments' }, { id: 'results' },
    { id: 'discussion' }, { id: 'conclusion' }, { id: 'limitations' },
    { id: 'ethics' }, { id: 'references' },
  ]);
  assert.equal(r.orderScore, 1);
});

test('diff: 顺序反 → orderScore 低', () => {
  const r = diffSections('acl', [
    { id: 'references' }, { id: 'ethics' }, { id: 'limitations' },
    { id: 'conclusion' }, { id: 'discussion' }, { id: 'results' },
    { id: 'experiments' }, { id: 'method' }, { id: 'related_work' },
    { id: 'introduction' }, { id: 'abstract' },
  ]);
  // 反序 LCS = 1 (abstract 唯一匹配),expected=11
  // 实际算下来是 1/11
  assert.ok(r.orderScore < 1);
});

test('diff: 部分顺序 → 中等分数', () => {
  // partial order
  const r = diffSections('arxiv', [
    { id: 'abstract' }, { id: 'introduction' }, { id: 'method' },
    { id: 'results' }, { id: 'experiments' }, // 顺序错
    { id: 'discussion' }, { id: 'conclusion' }, { id: 'references' },
  ]);
  // LCS 长度 = 7 (experiments/results 互换,LCS=7,expected=8)
  // 实际: abstract, introduction, method, results/exp, ..., conclusion, references
  // abstract(1) + introduction(2) + method(3) + 1 of (results/exp) + discussion(5) + conclusion(6) + references(7) = 7
  assert.equal(r.orderScore, 7 / 8);
});

test('diff: 空 sections → orderScore=0', () => {
  const r = diffSections('arxiv', []);
  assert.equal(r.orderScore, 0);
  assert.equal(r.missing.length, 8);
});

test('diff: orderScore 范围 [0, 1]', () => {
  const r = diffSections('arxiv', [
    { id: 'random1' }, { id: 'random2' },
  ]);
  assert.ok(r.orderScore >= 0 && r.orderScore <= 1);
});

// ---------- validateAgainstFormat ---
test('validate: 完整文档', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(100),
    sections: [
      { id: 'abstract' }, { id: 'introduction' }, { id: 'method' },
      { id: 'experiments' }, { id: 'results' }, { id: 'discussion' },
      { id: 'conclusion' }, { id: 'references' },
    ],
  });
  assert.equal(r.abstractLengthOk, true);
  assert.equal(r.diff.orderScore, 1);
  assert.equal(r.format, 'arxiv');
});

test('validate: abstract 太长 → !abstractLengthOk', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(300),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, false);
});

test('validate: abstract 空 → undefined length + !ok', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: '',
    sections: [],
  });
  assert.equal(r.abstractLengthOk, false);
  assert.equal(r.abstractLength, undefined);
});

test('validate: abstract 缺 → undefined length', () => {
  const r = validateAgainstFormat('arxiv', {
    sections: [],
  });
  assert.equal(r.abstractLengthOk, false);
  assert.equal(r.abstractLength, undefined);
});

test('validate: 边界 abstract (正好 maxChars)', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(250),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, true);
  assert.equal(r.abstractLength, 250);
});

test('validate: 包含 spec 字段', () => {
  const r = validateAgainstFormat('acl', {
    abstract: 'x',
    sections: [],
  });
  assert.equal(r.spec.expectedSections.length, 11);
  assert.equal(r.spec.requiresLimitations, true);
});

test('validate: journal 长 abstract ok', () => {
  const r = validateAgainstFormat('journal', {
    abstract: 'x'.repeat(400),
    sections: [],
  });
  // journal maxChars=500
  assert.equal(r.abstractLengthOk, true);
});

// ---------- 集成 ---
test('集成: spec + diff + validate', () => {
  const format = parseDeliverableFormat('acl');
  assert.equal(format, 'acl');
  const spec = DELIVERABLE_FORMAT_SPECS[format];
  assert.equal(spec.requiresEthics, true);
  const v = validateAgainstFormat(format, {
    abstract: 'my abstract',
    sections: [
      { id: 'abstract' }, { id: 'introduction' }, { id: 'related_work' },
      { id: 'method' }, { id: 'experiments' }, { id: 'results' },
      { id: 'discussion' }, { id: 'conclusion' }, { id: 'limitations' },
      { id: 'ethics' }, { id: 'references' },
    ],
  });
  assert.equal(v.diff.orderScore, 1);
  assert.equal(v.abstractLengthOk, true);
});
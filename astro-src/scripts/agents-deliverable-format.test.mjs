#!/usr/bin/env node
// astro-src/scripts/agents-deliverable-format.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/deliverable-format.ts.

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

// ---------- DELIVERABLE_FORMAT_SPECS ----------
test('DELIVERABLE_FORMAT_SPECS: 3 种格式', () => {
  assert.ok('arxiv' in DELIVERABLE_FORMAT_SPECS);
  assert.ok('acl' in DELIVERABLE_FORMAT_SPECS);
  assert.ok('journal' in DELIVERABLE_FORMAT_SPECS);
});

test('DELIVERABLE_FORMAT_SPECS: arxiv 8 段', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.expectedSections.length, 8);
});

test('DELIVERABLE_FORMAT_SPECS: acl 11 段含 limitations/ethics', () => {
  const acl = DELIVERABLE_FORMAT_SPECS.acl.expectedSections;
  assert.ok(acl.includes('limitations'));
  assert.ok(acl.includes('ethics'));
  assert.equal(acl.length, 11);
});

test('DELIVERABLE_FORMAT_SPECS: arxiv 不需要 limitations/ethics', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.requiresLimitations, false);
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.requiresEthics, false);
});

test('DELIVERABLE_FORMAT_SPECS: acl author-year citation', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.citationStyle, 'author-year');
});

test('DELIVERABLE_FORMAT_SPECS: arxiv numeric citation', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.citationStyle, 'numeric');
});

test('DELIVERABLE_FORMAT_SPECS: journal abstract 上限 500', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.journal.abstractMaxChars, 500);
});

test('DELIVERABLE_FORMAT_SPECS: acl + arxiv abstract 上限 250', () => {
  assert.equal(DELIVERABLE_FORMAT_SPECS.arxiv.abstractMaxChars, 250);
  assert.equal(DELIVERABLE_FORMAT_SPECS.acl.abstractMaxChars, 250);
});

// ---------- parseDeliverableFormat ----------
test('parseDeliverableFormat: 合法 "arxiv" → "arxiv"', () => {
  assert.equal(parseDeliverableFormat('arxiv'), 'arxiv');
});

test('parseDeliverableFormat: 合法 "acl" → "acl"', () => {
  assert.equal(parseDeliverableFormat('acl'), 'acl');
});

test('parseDeliverableFormat: 非法 → null', () => {
  assert.equal(parseDeliverableFormat('foo'), null);
});

test('parseDeliverableFormat: 非字符串 → null', () => {
  assert.equal(parseDeliverableFormat(123), null);
  assert.equal(parseDeliverableFormat(null), null);
  assert.equal(parseDeliverableFormat(undefined), null);
  assert.equal(parseDeliverableFormat({}), null);
});

test('parseDeliverableFormat: 大小写敏感', () => {
  assert.equal(parseDeliverableFormat('ArXiv'), null);
});

// ---------- diffSections ----------
test('diffSections: 完全匹配 → missing=[], extra=[], orderScore=1', () => {
  const r = diffSections('arxiv', [
    { id: 'abstract' },
    { id: 'introduction' },
    { id: 'method' },
    { id: 'experiments' },
    { id: 'results' },
    { id: 'discussion' },
    { id: 'conclusion' },
    { id: 'references' },
  ]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, []);
  assert.equal(r.orderScore, 1);
});

test('diffSections: 缺 → missing 列出', () => {
  const r = diffSections('arxiv', [{ id: 'abstract' }]);
  assert.equal(r.missing.length, 7);
  assert.ok(r.missing.includes('introduction'));
});

test('diffSections: 多余 → extra 列出', () => {
  const r = diffSections('arxiv', [
    { id: 'abstract' },
    { id: 'extra-section' },
  ]);
  assert.ok(r.extra.includes('extra-section'));
});

test('diffSections: id 优先于 title', () => {
  // 用 title 是不匹配的 id;diffSections 用 id || title
  const r = diffSections('arxiv', [
    { id: 'abstract', title: '摘要' },
    { id: 'introduction', title: '引言' },
  ]);
  // 缺 6 个
  assert.equal(r.missing.length, 6);
});

test('diffSections: 大小写不敏感', () => {
  const r = diffSections('arxiv', [
    { id: 'Abstract' },
    { id: 'INTRODUCTION' },
  ]);
  // 小写化匹配 → 缺 6 个
  assert.equal(r.missing.length, 6);
});

test('diffSections: 空 sections → 全 missing, orderScore 0', () => {
  const r = diffSections('arxiv', []);
  assert.equal(r.missing.length, 8);
  assert.equal(r.orderScore, 0);
});

test('diffSections: orderScore 0..1', () => {
  // 逆序: orderScore 接近 0
  const r = diffSections('arxiv', [
    { id: 'references' },
    { id: 'conclusion' },
    { id: 'discussion' },
    { id: 'results' },
    { id: 'experiments' },
    { id: 'method' },
    { id: 'introduction' },
    { id: 'abstract' },
  ]);
  // 全部命中但逆序 → LCS = 1 (单方向最长公共子序列)
  assert.ok(r.orderScore >= 0 && r.orderScore <= 1);
});

test('diffSections: 部分顺序匹配', () => {
  const r = diffSections('arxiv', [
    { id: 'abstract' },
    { id: 'introduction' },
    { id: 'method' },
    { id: 'experiments' },
  ]);
  // LCS = 4 (前 4 个)
  assert.equal(r.orderScore, 0.5); // 4/8
  assert.equal(r.missing.length, 4);
});

// ---------- validateAgainstFormat ----------
test('validateAgainstFormat: abstract 空 → abstractLengthOk=false', () => {
  const r = validateAgainstFormat('arxiv', { abstract: '', sections: [] });
  assert.equal(r.abstractLengthOk, false);
  assert.equal(r.abstractLength, undefined);
});

test('validateAgainstFormat: abstract null → length undefined', () => {
  const r = validateAgainstFormat('arxiv', { abstract: undefined, sections: [] });
  assert.equal(r.abstractLengthOk, false);
  assert.equal(r.abstractLength, undefined);
});

test('validateAgainstFormat: abstract 超长 → not ok', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(300),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, false);
  assert.equal(r.abstractLength, 300);
});

test('validateAgainstFormat: abstract 边界 250 → ok', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(250),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, true);
});

test('validateAgainstFormat: abstract 前后 trim', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: '   ' + 'x'.repeat(100) + '   ',
    sections: [],
  });
  assert.equal(r.abstractLength, 100);
});

test('validateAgainstFormat: 完整 sections + ok abstract', () => {
  const r = validateAgainstFormat('arxiv', {
    abstract: 'x'.repeat(100),
    sections: DELIVERABLE_FORMAT_SPECS.arxiv.expectedSections.map((s) => ({ id: s })),
  });
  assert.equal(r.abstractLengthOk, true);
  assert.deepEqual(r.diff.missing, []);
  assert.equal(r.diff.orderScore, 1);
});

test('validateAgainstFormat: 返回 spec + diff + format', () => {
  const r = validateAgainstFormat('arxiv', { abstract: 'x', sections: [] });
  assert.equal(r.format, 'arxiv');
  assert.ok(r.spec);
  assert.ok(r.diff);
});

test('validateAgainstFormat: journal abstract 400 → ok', () => {
  const r = validateAgainstFormat('journal', {
    abstract: 'x'.repeat(400),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, true);
});

test('validateAgainstFormat: journal abstract 600 → not ok', () => {
  const r = validateAgainstFormat('journal', {
    abstract: 'x'.repeat(600),
    sections: [],
  });
  assert.equal(r.abstractLengthOk, false);
});
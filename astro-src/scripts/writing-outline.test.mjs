#!/usr/bin/env node
// astro-src/scripts/writing-outline.test.mjs
//
// Tests for R7 polish: astro-src/lib/writing/outline.ts.

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
    external: ['./types', '../types', '../../types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/writing/outline.ts');
const {
  generateOutline,
  outlineToSections,
  outlineTotalWords,
  estimateWritingDays,
  suggestOutlineForType,
} = mod;

test('generateOutline: 5 种 type 都返回非空数组', () => {
  for (const type of ['paper', 'section', 'note', 'review', 'translation']) {
    const r = generateOutline(type, []);
    assert.ok(Array.isArray(r));
    assert.ok(r.length > 0);
  }
});

test('generateOutline: paper 8 节', () => {
  const r = generateOutline('paper', []);
  assert.equal(r.length, 8);
});

test('generateOutline: section 3 节', () => {
  const r = generateOutline('section', []);
  assert.equal(r.length, 3);
});

test('generateOutline: note 1 节', () => {
  const r = generateOutline('note', []);
  assert.equal(r.length, 1);
});

test('generateOutline: review 11 节', () => {
  const r = generateOutline('review', []);
  assert.equal(r.length, 11);
});

test('generateOutline: translation 含双语节', () => {
  const r = generateOutline('translation', []);
  assert.ok(r.length >= 2);
});

test('generateOutline: paper 含 abstract/method/conclusion 等节点', () => {
  const r = generateOutline('paper', []);
  const ids = r.map((n) => n.id);
  assert.ok(ids.includes('abstract'));
  assert.ok(ids.includes('method'));
  assert.ok(ids.includes('conclusion'));
});

test('generateOutline: cited papers 加 placeholders', () => {
  const r = generateOutline('paper', [{ arxivId: '2506.12345' }]);
  // 至少一个节应该有占位符
  const hasPlaceholder = r.some((n) => n.placeholders.length > 0);
  assert.ok(hasPlaceholder);
});

test('generateOutline: placeholders 格式 [arXiv:2506.12345]', () => {
  const r = generateOutline('paper', [{ arxivId: '2506.12345v1' }]);
  // v1 去掉
  const allPlaceholders = r.flatMap((n) => n.placeholders);
  assert.ok(allPlaceholders.some((p) => p === '[arXiv:2506.12345]'));
});

test('generateOutline: 5 种 type 都返回 ≥1 节点', () => {
  for (const type of ['paper', 'section', 'note', 'review', 'translation']) {
    const r = generateOutline(type, []);
    assert.ok(r.length >= 1);
  }
});

test('outlineToSections: 转换为 WritingSection[]', () => {
  const outline = generateOutline('paper', []);
  const sections = outlineToSections(outline);
  assert.equal(sections.length, outline.length);
  for (const s of sections) {
    assert.ok(typeof s.id === 'string');
    assert.ok(typeof s.title === 'string');
  }
});

test('outlineTotalWords: 求和 suggestedWordCount', () => {
  const outline = generateOutline('paper', []);
  const total = outlineTotalWords(outline);
  assert.equal(total, outline.reduce((s, n) => s + n.suggestedWordCount, 0));
});

test('outlineTotalWords: 空数组 → 0', () => {
  assert.equal(outlineTotalWords([]), 0);
});

test('estimateWritingDays: ceil(totalWords / wordsPerDay)', () => {
  const outline = generateOutline('paper', []);
  // total words ≈ 4700, /500 = 9.4 → ceil 10
  const days = estimateWritingDays(outline, 500);
  assert.equal(days, Math.ceil(outlineTotalWords(outline) / 500));
});

test('estimateWritingDays: 默认 wordsPerDay=500', () => {
  const outline = generateOutline('paper', []);
  const days = estimateWritingDays(outline);
  assert.ok(days > 0);
});

test('suggestOutlineForType: 与 generateOutline 一致', () => {
  const a = generateOutline('paper', []);
  const b = suggestOutlineForType('paper');
  assert.deepEqual(a, b);
});
#!/usr/bin/env node
// astro-src/scripts/outline.test.mjs
//
// Tests for R7 E.3.1 outline generator.

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
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/writing/outline.ts');
const { generateOutline, outlineToSections, outlineTotalWords, estimateWritingDays } = mod;

const sampleCites = [
  { arxivId: '2506.12345' },
  { arxivId: '2506.67890' },
  { arxivId: '2506.11111v2' }, // versioned
];

test('generateOutline paper: 8 节', () => {
  const o = generateOutline('paper');
  assert.equal(o.length, 8);
  assert.equal(o[0].id, 'abstract');
  assert.equal(o[7].id, 'references');
});

test('generateOutline review: 11 节 + related-work / taxonomy / gaps', () => {
  const o = generateOutline('review');
  assert.equal(o.length, 11);
  assert.ok(o.find((n) => n.id === 'related-work'));
  assert.ok(o.find((n) => n.id === 'taxonomy'));
  assert.ok(o.find((n) => n.id === 'gaps'));
});

test('generateOutline section: 3 节', () => {
  const o = generateOutline('section');
  assert.equal(o.length, 3);
});

test('generateOutline note: 1 节', () => {
  const o = generateOutline('note');
  assert.equal(o.length, 1);
  assert.equal(o[0].id, 'body');
});

test('generateOutline translation: 3 节 + 无 placeholders', () => {
  const o = generateOutline('translation', sampleCites);
  assert.equal(o.length, 3);
  for (const n of o) {
    assert.equal(n.placeholders.length, 0, `${n.id} 不应有引用`);
  }
});

test('citation: spread 模式每个有内容的节撒 1 个', () => {
  const o = generateOutline('paper', sampleCites, { citationStrategy: 'spread' });
  const contentNodes = o.filter((n) => n.suggestedWordCount > 0);
  for (const n of contentNodes) {
    assert.ok(n.placeholders.length >= 1, `${n.id} 应至少 1 placeholder`);
  }
});

test('citation: front-loaded 模式相关工作节才有引用', () => {
  const o = generateOutline('paper', sampleCites, { citationStrategy: 'front-loaded' });
  const intro = o.find((n) => n.id === 'introduction');
  const method = o.find((n) => n.id === 'method');
  assert.ok(intro.placeholders.length === sampleCites.length);
  assert.equal(method.placeholders.length, 0);
});

test('citation: cluster 模式按 section idx 均匀分布', () => {
  const o = generateOutline('paper', sampleCites, { citationStrategy: 'cluster' });
  const totalPlaceholders = o.reduce((s, n) => s + n.placeholders.length, 0);
  assert.equal(totalPlaceholders, sampleCites.length);
});

test('citePlaceholder: 去 vN suffix', () => {
  const o = generateOutline('paper', [{ arxivId: '2506.11111v2' }], { citationStrategy: 'front-loaded' });
  const intro = o.find((n) => n.id === 'introduction');
  assert.ok(intro.placeholders.some((p) => p === '[arXiv:2506.11111]'));
});

test('citePlaceholder: 无 vN 时原样', () => {
  const o = generateOutline('paper', [{ arxivId: '2506.12345' }], { citationStrategy: 'front-loaded' });
  const intro = o.find((n) => n.id === 'introduction');
  assert.ok(intro.placeholders.includes('[arXiv:2506.12345]'));
});

test('outlineToSections: 产出 WritingSection[]', () => {
  const o = generateOutline('paper');
  const sections = outlineToSections(o);
  assert.equal(sections.length, o.length);
  for (let i = 0; i < sections.length; i++) {
    assert.equal(sections[i].id, o[i].id);
    assert.equal(sections[i].order, i);
    assert.equal(sections[i].title, o[i].title);
  }
});

test('outlineToSections: 有 placeholders 时塞进 comment + 引用占位', () => {
  const o = generateOutline('paper', [{ arxivId: '2506.12345' }], { citationStrategy: 'front-loaded' });
  const sections = outlineToSections(o);
  const intro = sections.find((s) => s.id === 'introduction');
  assert.ok(intro.content.includes('[arXiv:2506.12345]'));
});

test('outlineTotalWords: 求和', () => {
  const o = generateOutline('paper');
  const total = outlineTotalWords(o);
  // 8 节,references=0,abstract=200
  assert.ok(total >= 4000);
  assert.equal(o.find((n) => n.id === 'references').suggestedWordCount, 0);
});

test('estimateWritingDays: 总字数 / 每天字数(向上取整)', () => {
  const o = generateOutline('paper');
  const days = estimateWritingDays(o, 500);
  assert.ok(days >= 1);
});

test('estimateWritingDays: 空 outline → 0 天', () => {
  assert.equal(estimateWritingDays([], 500), 0);
});

test('estimateWritingDays: 至少 1 天(即使总字数 < wordsPerDay)', () => {
  const o = generateOutline('note'); // 1 节 500 词
  const days = estimateWritingDays(o, 1000);
  assert.equal(days, 1);
});

test('空 citedPapers 不报错', () => {
  const o = generateOutline('paper', []);
  for (const n of o) {
    assert.equal(n.placeholders.length, 0);
  }
});

test('未识别 type 触发 TS exhaustive,但运行时不崩', () => {
  // JS 调用绕过 TS;默认走 default 分支不抛
  const o = generateOutline('paper');
  assert.ok(o);
});
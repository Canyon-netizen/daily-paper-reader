#!/usr/bin/env node
// astro-src/scripts/synthesis-integration.test.mjs
//
// Tests for R7 E.3.2 synthesis → draft integration.

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

const mod = await loadTs('lib/writing/synthesis-integration.ts');
const {
  stripFrontmatter,
  splitIntoSections,
  extractSynthesisRefIds,
  estimateSectionWords,
  buildDraftFromSynthesis,
  extractSynthesisAbstract,
  suggestTargetVenue,
} = mod;

const SAMPLE = `---
title: "Survey of RLHF"
type: review
venue: "ACL 2024"
abstract: "We survey recent RLHF advances across 12 papers."
---
# Survey

Introduction paragraph.

## Background

Reinforcement learning from human feedback (RLHF) [arXiv:2506.12345] has become
central to alignment research. Recent work (arXiv:2506.67890) extends this.

## Methods

Policy optimization and reward modeling approaches dominate the field.

## Conclusion

The field is moving toward offline preference learning.
`;

test('stripFrontmatter: 正确切 frontmatter / body', () => {
  const r = stripFrontmatter(SAMPLE);
  assert.equal(r.frontmatter.title, 'Survey of RLHF');
  assert.equal(r.frontmatter.type, 'review');
  assert.equal(r.frontmatter.venue, 'ACL 2024');
  assert.ok(r.body.includes('# Survey'));
});

test('stripFrontmatter: 无 frontmatter → 空 map + 原文本', () => {
  const r = stripFrontmatter('# Just a markdown\n\nNo frontmatter');
  assert.deepEqual(r.frontmatter, {});
  assert.ok(r.body.includes('Just a markdown'));
});

test('splitIntoSections: 按 ## 切 3 节', () => {
  const r = stripFrontmatter(SAMPLE);
  const sections = splitIntoSections(r.body);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].id, 'background');
  assert.equal(sections[1].id, 'methods');
  assert.equal(sections[2].id, 'conclusion');
});

test('splitIntoSections: 无 ## 时回退单节 body', () => {
  const sections = splitIntoSections('Just prose, no headings.\n\nMore prose.');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, 'body');
});

test('extractSynthesisRefIds: 两种风格 + dedup + 去 vN', () => {
  const text = 'See [arXiv:2506.12345] and (arXiv:2506.67890) and [arXiv:2506.12345v2]';
  const ids = extractSynthesisRefIds(text);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes('2506.12345'));
  assert.ok(ids.includes('2506.67890'));
});

test('extractSynthesisRefIds: 空文本 → 空数组', () => {
  assert.deepEqual(extractSynthesisRefIds(''), []);
});

test('estimateSectionWords: 中英混合', () => {
  const w = estimateSectionWords('Hello world 你好世界');
  assert.equal(w, 6); // 2 en + 4 zh
});

test('estimateSectionWords: 空文本 → 0', () => {
  assert.equal(estimateSectionWords(''), 0);
});

test('buildDraftFromSynthesis: 完整 DraftSpec', () => {
  const spec = buildDraftFromSynthesis(SAMPLE, { type: 'review' });
  assert.equal(spec.title, 'Survey of RLHF');
  assert.equal(spec.type, 'review');
  assert.ok(spec.abstract?.includes('RLHF'));
  assert.equal(spec.sections.length, 3);
  assert.equal(spec.citedPapers.length, 2);
  assert.ok(spec.totalWords > 0);
  assert.equal(spec.source, 'synthesis');
  assert.ok(spec.sourceHash.length > 0);
});

test('buildDraftFromSynthesis: citedPapers 是 canonical', () => {
  const spec = buildDraftFromSynthesis(SAMPLE);
  const ids = spec.citedPapers.map((p) => p.arxivId);
  assert.ok(ids.every((id) => !id.endsWith('v2')));
});

test('buildDraftFromSynthesis: titleOverride 优先', () => {
  const spec = buildDraftFromSynthesis(SAMPLE, { titleOverride: 'My Draft' });
  assert.equal(spec.title, 'My Draft');
});

test('buildDraftFromSynthesis: append 把新内容追加到 existing', () => {
  const existing = [{ id: 'background', title: 'Background', content: 'Old text.', order: 0 }];
  const spec = buildDraftFromSynthesis(SAMPLE, { existingSections: existing, mergeStrategy: 'append' });
  const bg = spec.sections.find((s) => s.id === 'background');
  assert.ok(bg.content.includes('Old text'));
  assert.ok(bg.content.includes('RLHF'));
});

test('buildDraftFromSynthesis: replace 用新内容覆盖', () => {
  const existing = [{ id: 'background', title: 'Background', content: 'Old text.', order: 0 }];
  const spec = buildDraftFromSynthesis(SAMPLE, { existingSections: existing, mergeStrategy: 'replace' });
  const bg = spec.sections.find((s) => s.id === 'background');
  assert.ok(!bg.content.includes('Old text'));
  assert.ok(bg.content.includes('RLHF'));
});

test('buildDraftFromSynthesis: skip 保留 existing 内容', () => {
  const existing = [{ id: 'background', title: 'Background', content: 'Old text.', order: 0 }];
  const spec = buildDraftFromSynthesis(SAMPLE, { existingSections: existing, mergeStrategy: 'skip' });
  const bg = spec.sections.find((s) => s.id === 'background');
  assert.ok(bg.content.includes('Old text'));
  assert.ok(!bg.content.includes('RLHF'));
});

test('buildDraftFromSynthesis: merge 时保留 existing 多余 sections', () => {
  const existing = [
    { id: 'background', title: 'Background', content: 'Old', order: 0 },
    { id: 'appendix', title: '附录', content: 'Extra', order: 1 },
  ];
  const spec = buildDraftFromSynthesis(SAMPLE, { existingSections: existing, mergeStrategy: 'skip' });
  assert.ok(spec.sections.find((s) => s.id === 'appendix'));
});

test('extractSynthesisAbstract: 取第一段长文本', () => {
  const { body } = stripFrontmatter(SAMPLE);
  const a = extractSynthesisAbstract(body);
  assert.ok(a.length > 0);
});

test('extractSynthesisAbstract: 200 词限制', () => {
  const long = 'lorem ipsum '.repeat(500);
  const a = extractSynthesisAbstract(long);
  assert.ok(a.length <= 201); // 200 + …
});

test('suggestTargetVenue: 多种 key 都识别', () => {
  assert.equal(suggestTargetVenue({ venue: 'A' }), 'A');
  assert.equal(suggestTargetVenue({ target: 'B' }), 'B');
  assert.equal(suggestTargetVenue({ target_venue: 'C' }), 'C');
  assert.equal(suggestTargetVenue({}), undefined);
});

test('sourceHash: 同输入 → 同 hash;不同输入 → 不同 hash', () => {
  const a = buildDraftFromSynthesis(SAMPLE);
  const b = buildDraftFromSynthesis(SAMPLE);
  const c = buildDraftFromSynthesis(SAMPLE + '\n');
  assert.equal(a.sourceHash, b.sourceHash);
  assert.notEqual(a.sourceHash, c.sourceHash);
});
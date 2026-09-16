#!/usr/bin/env node
// astro-src/scripts/idea-from-paper.test.mjs
//
// Tests for R7 E.1.1 create idea from paper.

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

const mod = await loadTs('lib/ideas/from-paper.ts');
const { createIdeaFromPaper, previewIdeaFromPaper } = mod;

const samplePaper: any = {
  arxivId: '2501.12345',
  title: 'A Novel Method for Reinforcement Learning with Deep Networks',
  tldr: 'We propose a new RL algorithm that achieves state-of-the-art results.',
  abstract: 'This paper presents a novel approach to reinforcement learning that combines deep neural networks with traditional RL methods. Our method achieves better sample efficiency and higher final performance on benchmark tasks.',
  authors: ['Alice Smith', 'Bob Jones', 'Carol White'],
  date: '2026-08-15',
};

test('createIdeaFromPaper: uses tldr for summary', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper);
  assert.ok(idea.description.includes('state-of-the-art'));
});

test('createIdeaFromPaper: falls back to abstract when no tldr', () => {
  const paperNoTldr = { ...samplePaper, tldr: undefined };
  const idea = createIdeaFromPaper('2501.12345', paperNoTldr);
  assert.ok(idea.description.startsWith('This paper presents'));
});

test('createIdeaFromPaper: includes arxivId in relatedPapers', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper);
  assert.ok(idea.relatedPapers.includes('2501.12345'));
});

test('createIdeaFromPaper: status is draft', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper);
  assert.equal(idea.status, 'draft');
});

test('createIdeaFromPaper: title derived from paper', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper);
  assert.ok(idea.title.startsWith('Idea:'));
  assert.ok(idea.title.includes('Reinforcement Learning'));
});

test('createIdeaFromPaper: additional related papers', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper, {
    additionalRelatedPapers: ['2501.99999', '2501.88888'],
  });
  assert.equal(idea.relatedPapers.length, 3);
  assert.ok(idea.relatedPapers.includes('2501.99999'));
});

test('createIdeaFromPaper: custom tags', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper, {
    tags: ['novel', 'important'],
  });
  assert.deepEqual(idea.tags, ['novel', 'important']);
});

test('createIdeaFromPaper: custom description override', () => {
  const idea = createIdeaFromPaper('2501.12345', samplePaper, {
    description: 'Custom description',
  });
  assert.equal(idea.description, 'Custom description');
});

test('previewIdeaFromPaper: returns preview info', () => {
  const preview = previewIdeaFromPaper('2501.12345', samplePaper);
  assert.ok(preview.title.startsWith('Idea:'));
  assert.ok(preview.relatedPapersCount >= 1);
  assert.ok(preview.summaryLength > 0);
});

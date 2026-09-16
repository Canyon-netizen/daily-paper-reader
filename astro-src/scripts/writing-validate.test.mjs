#!/usr/bin/env node
// astro-src/scripts/writing-validate.test.mjs
//
// Tests for R7 WP.4: validateWriting.

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

const mod = await loadTs('lib/writing/validate.ts');
const { validateWriting, validateWritingId, validateTitle } = mod;

test('validateWriting: 有效 writing 无错误', () => {
  const writing = {
    id: 'test-paper',
    title: 'Test Paper',
    type: 'paper',
    status: 'draft',
    sections: [
      { id: 'abstract', title: '摘要', content: '', order: 0 },
      { id: 'introduction', title: '引言', content: '', order: 1 },
    ],
    citedPapers: [{ arxivId: '2501.00001' }],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 100,
    versions: [],
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
  };
  const result = validateWriting(writing);
  assert.equal(result.errors.length, 0);
});

test('validateWriting: 缺少标题有错误', () => {
  const writing = {
    id: 'test-paper',
    title: '',
    type: 'paper',
    status: 'draft',
    sections: [],
    citedPapers: [],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 0,
    versions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const result = validateWriting(writing);
  assert.ok(result.errors.some((e) => e.includes('标题')));
});

test('validateWriting: 缺少 id 有错误', () => {
  const writing = {
    id: '',
    title: 'Test',
    type: 'paper',
    status: 'draft',
    sections: [],
    citedPapers: [],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 0,
    versions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const result = validateWriting(writing);
  assert.ok(result.errors.some((e) => e.includes('id')));
});

test('validateWriting: 无章节有警告', () => {
  const writing = {
    id: 'test-paper',
    title: 'Test',
    type: 'paper',
    status: 'draft',
    sections: [],
    citedPapers: [],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 0,
    versions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const result = validateWriting(writing);
  assert.ok(result.warnings.some((w) => w.includes('章节')));
});

test('validateWriting: 无引用有警告', () => {
  const writing = {
    id: 'test-paper',
    title: 'Test',
    type: 'paper',
    status: 'draft',
    sections: [{ id: 'abstract', title: '摘要', content: '', order: 0 }],
    citedPapers: [],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 0,
    versions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const result = validateWriting(writing);
  assert.ok(result.warnings.some((w) => w.includes('引用')));
});

test('validateWriting: 无效 type 有错误', () => {
  const writing = {
    id: 'test-paper',
    title: 'Test',
    type: 'invalid-type',
    status: 'draft',
    sections: [],
    citedPapers: [],
    relatedIdeas: [],
    relatedExperiments: [],
    wordCount: 0,
    versions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const result = validateWriting(writing);
  assert.ok(result.errors.some((e) => e.includes('写作类型')));
});

test('validateWritingId: 有效 kebab-case', () => {
  const result = validateWritingId('my-test-paper');
  assert.equal(result.errors.length, 0);
});

test('validateWritingId: 无效格式', () => {
  const result = validateWritingId('MyTestPaper');
  assert.ok(result.errors.length > 0);
});

test('validateTitle: 有效标题', () => {
  const result = validateTitle('My Test Paper');
  assert.equal(result.errors.length, 0);
});

test('validateTitle: 空标题', () => {
  const result = validateTitle('');
  assert.ok(result.errors.length > 0);
});

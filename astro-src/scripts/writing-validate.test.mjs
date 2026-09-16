#!/usr/bin/env node
// astro-src/scripts/writing-validate.test.mjs
//
// Tests for R7 polish: astro-src/lib/writing/validate.ts.

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

const mod = await loadTs('lib/writing/validate.ts');
const { validateWriting, validateWritingId, validateTitle } = mod;

function mkWriting(overrides = {}) {
  return {
    id: 'paper-x',
    title: 'A reasonable title',
    type: 'paper',
    sections: [
      { id: 'abstract', title: 'Abstract', order: 0, content: '...' },
    ],
    citedPapers: [{ arxivId: '2501.00001' }],
    wordCount: 1000,
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

test('validateWriting: 合法 writing → 无 errors', () => {
  const r = validateWriting(mkWriting());
  assert.equal(r.errors.length, 0);
});

test('validateWriting: 缺 id → error', () => {
  const r = validateWriting(mkWriting({ id: '' }));
  assert.ok(r.errors.some((e) => e.includes('id')));
});

test('validateWriting: 缺 title → error', () => {
  const r = validateWriting(mkWriting({ title: '' }));
  assert.ok(r.errors.some((e) => e.includes('标题')));
});

test('validateWriting: 缺 type → error', () => {
  const r = validateWriting(mkWriting({ type: undefined }));
  assert.ok(r.errors.some((e) => e.includes('写作类型')));
});

test('validateWriting: 非法 type → error', () => {
  const r = validateWriting(mkWriting({ type: 'invalid-type' }));
  assert.ok(r.errors.some((e) => e.includes('无效的写作类型')));
});

test('validateWriting: 空 sections → warning', () => {
  const r = validateWriting(mkWriting({ sections: [] }));
  assert.ok(r.warnings.some((w) => w.includes('没有章节')));
});

test('validateWriting: section order 错位 → warning', () => {
  const r = validateWriting(mkWriting({
    sections: [
      { id: 'a', title: 'A', order: 0, content: '' },
      { id: 'b', title: 'B', order: 5, content: '' }, // order=5 but index=1
    ],
  }));
  assert.ok(r.warnings.some((w) => w.includes('章节顺序')));
});

test('validateWriting: 空 citedPapers → warning', () => {
  const r = validateWriting(mkWriting({ citedPapers: [] }));
  assert.ok(r.warnings.some((w) => w.includes('没有引用')));
});

test('validateWriting: paper 缺 abstract → warning', () => {
  const r = validateWriting(mkWriting({
    type: 'paper',
    sections: [{ id: 'method', title: 'Method', order: 0, content: '' }],
  }));
  assert.ok(r.warnings.some((w) => w.includes('摘要')));
});

test('validateWriting: 负 wordCount → error', () => {
  const r = validateWriting(mkWriting({ wordCount: -1 }));
  assert.ok(r.errors.some((e) => e.includes('字数不能为负')));
});

test('validateWriting: createdAt 晚于 now → warning', () => {
  const r = validateWriting(mkWriting({ createdAt: Date.now() + 100000 }));
  assert.ok(r.warnings.some((w) => w.includes('创建时间')));
});

test('validateWriting: updatedAt < createdAt → error', () => {
  const now = Date.now();
  const r = validateWriting(mkWriting({ createdAt: now, updatedAt: now - 1000 }));
  assert.ok(r.errors.some((e) => e.includes('更新时间')));
});

test('validateWritingId: kebab-case 合法 → 无 error', () => {
  const r = validateWritingId('paper-abc-123');
  assert.equal(r.errors.length, 0);
});

test('validateWritingId: 空 → error', () => {
  const r = validateWritingId('');
  assert.ok(r.errors.some((e) => e.includes('不能为空')));
});

test('validateWritingId: 含大写 → error', () => {
  const r = validateWritingId('Paper-abc');
  assert.ok(r.errors.some((e) => e.includes('kebab-case')));
});

test('validateWritingId: 含下划线 → error', () => {
  const r = validateWritingId('paper_abc');
  assert.ok(r.errors.some((e) => e.includes('kebab-case')));
});

test('validateWritingId: 含空格 → error', () => {
  const r = validateWritingId('paper abc');
  assert.ok(r.errors.some((e) => e.includes('kebab-case')));
});

test('validateWritingId: 头/尾连字符 → error', () => {
  assert.ok(validateWritingId('-foo').errors.length > 0);
  assert.ok(validateWritingId('foo-').errors.length > 0);
});

test('validateWritingId: 长度 > 100 → warning', () => {
  const r = validateWritingId('a'.repeat(101));
  assert.ok(r.warnings.some((w) => w.includes('过长')));
});

test('validateTitle: 合法 title → 无 error', () => {
  const r = validateTitle('A reasonable title');
  assert.equal(r.errors.length, 0);
});

test('validateTitle: 空 → error', () => {
  const r = validateTitle('');
  assert.ok(r.errors.some((e) => e.includes('不能为空')));
});

test('validateTitle: 长度 > 300 → warning', () => {
  const r = validateTitle('a'.repeat(301));
  assert.ok(r.warnings.some((w) => w.includes('过长')));
});

test('validateTitle: 长度 < 5 → warning', () => {
  const r = validateTitle('abc');
  assert.ok(r.warnings.some((w) => w.includes('过短')));
});
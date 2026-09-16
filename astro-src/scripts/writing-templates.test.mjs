#!/usr/bin/env node
// astro-src/scripts/writing-templates.test.mjs
//
// Tests for R7 polish: astro-src/lib/writing/templates.ts writing template library.

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

const mod = await loadTs('lib/writing/templates.ts');
const { writingTemplates, getWritingTemplate } = mod;

test('writingTemplates: 是数组且非空', () => {
  assert.ok(Array.isArray(writingTemplates));
  assert.ok(writingTemplates.length >= 1);
});

test('writingTemplates: 每个模板 id 唯一', () => {
  const ids = writingTemplates.map((t) => t.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
});

test('writingTemplates: 每个模板有 name / nameZh / description / descriptionZh', () => {
  for (const t of writingTemplates) {
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(typeof t.nameZh === 'string' && t.nameZh.length > 0);
    assert.ok(typeof t.description === 'string' && t.description.length > 0);
    assert.ok(typeof t.descriptionZh === 'string' && t.descriptionZh.length > 0);
  }
});

test('writingTemplates: 每个模板 sections 是数组,order 单调递增', () => {
  for (const t of writingTemplates) {
    assert.ok(Array.isArray(t.sections));
    assert.ok(t.sections.length > 0);
    for (let i = 0; i < t.sections.length; i++) {
      const s = t.sections[i];
      assert.ok(s.title && s.titleZh);
      assert.ok(s.placeholder && s.placeholderZh);
      assert.equal(s.order, i + 1); // 从 1 开始递增
    }
  }
});

test('writingTemplates: 包含 workshop-paper / blog-post / research-proposal', () => {
  const ids = writingTemplates.map((t) => t.id);
  assert.ok(ids.includes('workshop-paper'));
  assert.ok(ids.includes('blog-post'));
  assert.ok(ids.includes('research-proposal'));
});

test('writingTemplates: workshop-paper 6 节', () => {
  const t = writingTemplates.find((t) => t.id === 'workshop-paper');
  assert.equal(t.sections.length, 6);
  assert.equal(t.type, 'paper');
});

test('writingTemplates: blog-post 5 节, type=note', () => {
  const t = writingTemplates.find((t) => t.id === 'blog-post');
  assert.equal(t.sections.length, 5);
  assert.equal(t.type, 'note');
});

test('writingTemplates: research-proposal 7 节, type=paper', () => {
  const t = writingTemplates.find((t) => t.id === 'research-proposal');
  assert.equal(t.sections.length, 7);
  assert.equal(t.type, 'paper');
});

test('getWritingTemplate: 找到', () => {
  const t = getWritingTemplate('blog-post');
  assert.ok(t);
  assert.equal(t.id, 'blog-post');
});

test('getWritingTemplate: 找不到 → undefined', () => {
  assert.equal(getWritingTemplate('non-existent'), undefined);
  assert.equal(getWritingTemplate(''), undefined);
});

test('getWritingTemplate: workshop-paper sections 顺序正确', () => {
  const t = getWritingTemplate('workshop-paper');
  const titles = t.sections.map((s) => s.title);
  assert.deepEqual(titles.slice(0, 4), ['Abstract', 'Introduction', 'Related Work', 'Method']);
});

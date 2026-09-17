#!/usr/bin/env node
// astro-src/scripts/idea-templates.test.mjs
//
// Tests for R7 polish: astro-src/lib/idea-templates.ts.
// IDEA_TEMPLATES + listIdeaTemplateKeys + getIdeaTemplate。

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
    external: ['node:*'],
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/idea-templates.ts');
const { IDEA_TEMPLATES, listIdeaTemplateKeys, getIdeaTemplate } = mod;

// ---------- IDEA_TEMPLATES ----------
test('IDEA_TEMPLATES: 3 个 key', () => {
  assert.deepEqual(Object.keys(IDEA_TEMPLATES).sort(), ['discussion', 'experiment', 'survey']);
});

test('IDEA_TEMPLATES: 每条都有 title/description/tags', () => {
  for (const k of Object.keys(IDEA_TEMPLATES)) {
    const t = IDEA_TEMPLATES[k];
    assert.ok(typeof t.title === 'string' && t.title.length > 0);
    assert.ok(typeof t.description === 'string' && t.description.length > 0);
    assert.ok(Array.isArray(t.tags));
  }
});

test('IDEA_TEMPLATES: survey 含 "综述"', () => {
  assert.match(IDEA_TEMPLATES.survey.title, /综述/);
});

test('IDEA_TEMPLATES: experiment 含 "实验"', () => {
  assert.match(IDEA_TEMPLATES.experiment.title, /实验/);
});

test('IDEA_TEMPLATES: discussion 含 "讨论"', () => {
  assert.match(IDEA_TEMPLATES.discussion.title, /讨论/);
});

test('IDEA_TEMPLATES: tags 至少 1 个', () => {
  for (const k of Object.keys(IDEA_TEMPLATES)) {
    assert.ok(IDEA_TEMPLATES[k].tags.length > 0);
  }
});

// ---------- listIdeaTemplateKeys ----------
test('listIdeaTemplateKeys: 返回 3 个 key', () => {
  assert.equal(listIdeaTemplateKeys().length, 3);
});

test('listIdeaTemplateKeys: 包含预期 key', () => {
  const keys = listIdeaTemplateKeys();
  assert.ok(keys.includes('survey'));
  assert.ok(keys.includes('experiment'));
  assert.ok(keys.includes('discussion'));
});

test('listIdeaTemplateKeys: 返回数组', () => {
  assert.ok(Array.isArray(listIdeaTemplateKeys()));
});

// ---------- getIdeaTemplate ----------
test('getIdeaTemplate: survey → 对象', () => {
  const r = getIdeaTemplate('survey');
  assert.notEqual(r, null);
  assert.equal(r.title, IDEA_TEMPLATES.survey.title);
});

test('getIdeaTemplate: experiment → 对象', () => {
  const r = getIdeaTemplate('experiment');
  assert.notEqual(r, null);
});

test('getIdeaTemplate: discussion → 对象', () => {
  const r = getIdeaTemplate('discussion');
  assert.notEqual(r, null);
});

test('getIdeaTemplate: 未知 key → null', () => {
  assert.equal(getIdeaTemplate('unknown'), null);
});

test('getIdeaTemplate: 空字符串 → null', () => {
  assert.equal(getIdeaTemplate(''), null);
});

test('getIdeaTemplate: 大小写敏感', () => {
  // 'Survey' ≠ 'survey'
  assert.equal(getIdeaTemplate('Survey'), null);
});

test('getIdeaTemplate: 返回的 tags 是数组', () => {
  const r = getIdeaTemplate('survey');
  assert.ok(Array.isArray(r.tags));
});

test('getIdeaTemplate: 返回的对象与 IDEA_TEMPLATES 同引用', () => {
  // 实现:IDEA_TEMPLATES[key] ?? null → 同引用
  assert.equal(getIdeaTemplate('survey'), IDEA_TEMPLATES.survey);
});
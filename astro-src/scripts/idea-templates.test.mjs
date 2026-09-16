#!/usr/bin/env node
// astro-src/scripts/idea-templates.test.mjs
//
// Tests for R7 polish: astro-src/lib/idea-templates.ts.
// 注:applyIdeaTemplate 需要 HTMLFormElement,这里只测纯函数(模板常量 + getters)。

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

const mod = await loadTs('lib/idea-templates.ts');
const { IDEA_TEMPLATES, listIdeaTemplateKeys, getIdeaTemplate } = mod;

test('IDEA_TEMPLATES: 含 3 个类型', () => {
  assert.ok(IDEA_TEMPLATES.survey);
  assert.ok(IDEA_TEMPLATES.experiment);
  assert.ok(IDEA_TEMPLATES.discussion);
});

test('IDEA_TEMPLATES.survey: tags 含 survey + review', () => {
  assert.ok(IDEA_TEMPLATES.survey.tags.includes('survey'));
  assert.ok(IDEA_TEMPLATES.survey.tags.includes('review'));
});

test('IDEA_TEMPLATES.experiment: tags 含 experiment + hypothesis', () => {
  assert.ok(IDEA_TEMPLATES.experiment.tags.includes('experiment'));
  assert.ok(IDEA_TEMPLATES.experiment.tags.includes('hypothesis'));
});

test('IDEA_TEMPLATES.discussion: tags 含 discussion', () => {
  assert.ok(IDEA_TEMPLATES.discussion.tags.includes('discussion'));
});

test('IDEA_TEMPLATES.survey: description 含 markdown section', () => {
  assert.ok(IDEA_TEMPLATES.survey.description.includes('## 研究背景'));
  assert.ok(IDEA_TEMPLATES.survey.description.includes('## 综述目标'));
});

test('IDEA_TEMPLATES.experiment: description 含自变量/因变量/控制变量', () => {
  const d = IDEA_TEMPLATES.experiment.description;
  assert.ok(d.includes('自变量'));
  assert.ok(d.includes('因变量'));
  assert.ok(d.includes('控制变量'));
});

test('IDEA_TEMPLATES.discussion: description 含"我的观点"', () => {
  assert.ok(IDEA_TEMPLATES.discussion.description.includes('## 我的观点'));
});

test('IDEA_TEMPLATES 各 title 含占位符 XXX', () => {
  assert.ok(IDEA_TEMPLATES.survey.title.includes('XXX'));
  assert.ok(IDEA_TEMPLATES.experiment.title.includes('XXX'));
  assert.ok(IDEA_TEMPLATES.discussion.title.includes('XXX'));
});

test('listIdeaTemplateKeys: 3 个 key', () => {
  const keys = listIdeaTemplateKeys();
  assert.equal(keys.length, 3);
  assert.ok(keys.includes('survey'));
  assert.ok(keys.includes('experiment'));
  assert.ok(keys.includes('discussion'));
});

test('getIdeaTemplate: survey/experiment/discussion 都拿到', () => {
  for (const k of ['survey', 'experiment', 'discussion']) {
    const t = getIdeaTemplate(k);
    assert.ok(t);
    assert.equal(typeof t.title, 'string');
    assert.equal(typeof t.description, 'string');
    assert.ok(Array.isArray(t.tags));
  }
});

test('getIdeaTemplate: 不存在的 key → null', () => {
  assert.equal(getIdeaTemplate('unknown'), null);
  assert.equal(getIdeaTemplate(''), null);
});

test('getIdeaTemplate: 返回的 description 含换行符', () => {
  const t = getIdeaTemplate('experiment');
  assert.ok(t.description.includes('\n'));
});

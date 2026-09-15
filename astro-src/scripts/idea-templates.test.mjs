#!/usr/bin/env node
// astro-src/scripts/idea-templates.test.mjs
//
// Tests for astro-src/lib/idea-templates.ts (R7 E.1.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTsModule(relPath) {
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

const mod = await loadTsModule('lib/idea-templates.ts');
const { IDEA_TEMPLATES, listIdeaTemplateKeys, getIdeaTemplate, applyIdeaTemplate } = mod;

// ----- shape -----

test('IDEA_TEMPLATES: contains the 3 planned keys', () => {
  for (const k of ['survey', 'experiment', 'discussion']) {
    assert.ok(IDEA_TEMPLATES[k], `missing ${k}`);
    assert.equal(typeof IDEA_TEMPLATES[k].title, 'string');
    assert.equal(typeof IDEA_TEMPLATES[k].description, 'string');
    assert.ok(Array.isArray(IDEA_TEMPLATES[k].tags));
    assert.ok(IDEA_TEMPLATES[k].tags.length > 0);
  }
});

test('IDEA_TEMPLATES: descriptions are markdown with ## sections', () => {
  for (const k of Object.keys(IDEA_TEMPLATES)) {
    const desc = IDEA_TEMPLATES[k].description;
    assert.match(desc, /^##\s/m, `${k} should have at least one ## section`);
    // 至少 50 字
    assert.ok(desc.length >= 50, `${k} description too short`);
  }
});

test('listIdeaTemplateKeys: returns Object.keys', () => {
  const keys = listIdeaTemplateKeys();
  assert.deepEqual(keys.sort(), ['discussion', 'experiment', 'survey']);
});

test('getIdeaTemplate: unknown key returns null', () => {
  assert.equal(getIdeaTemplate('not-a-template'), null);
});

test('getIdeaTemplate: known key returns full template', () => {
  const tpl = getIdeaTemplate('experiment');
  assert.ok(tpl);
  assert.ok(tpl.description.includes('实验假设'));
});

// ----- applyIdeaTemplate with HTMLFormElement -----

function makeForm(fields = {}) {
  const form = {
    querySelector(sel) {
      if (sel.includes('title') || sel === '#idea-title' || sel === '[name="title"]') {
        return fields.title ?? null;
      }
      if (sel.includes('description') || sel === '#idea-description' || sel === '[name="description"]') {
        return fields.description ?? null;
      }
      if (sel.includes('tags') || sel === '#idea-tags' || sel === '[name="tags"]') {
        return fields.tags ?? null;
      }
      return null;
    },
  };
  // 注:applyIdeaTemplate 通过 duck-typing(`typeof querySelector === 'function'`)
  // 检测 form,不再依赖 `instanceof HTMLFormElement`,所以 Node 测试环境
  // 不需要 jsdom。
  return form;
}

test('applyIdeaTemplate: with fieldMap fills description + tags', () => {
  let titleValue = '';
  let descValue = '';
  let tagsValue = '';
  const title = { value: titleValue, set value(v) { titleValue = v; } };
  const description = { value: descValue, set value(v) { descValue = v; } };
  const tags = { value: tagsValue, set value(v) { tagsValue = v; } };

  const r = applyIdeaTemplate({ title, description, tags }, 'experiment');
  assert.equal(r.applied, true);
  assert.match(descValue, /实验假设/);
  assert.match(tagsValue, /experiment, hypothesis/);
  // title 留空(plan 决定):因为模板 title 非空但用户输入为空 → 写入 title
  // 我们的逻辑:如果用户已输入非空,不覆盖;空时才填。
  // 这里 titleValue 初值空,所以填入模板 title
});

test('applyIdeaTemplate: respects existing title (does not overwrite)', () => {
  const title = { value: '我自己的标题' };
  const description = { value: '' };
  const tags = { value: '' };
  applyIdeaTemplate({ title, description, tags }, 'experiment');
  assert.equal(title.value, '我自己的标题');
  // description/tags 会被填
  assert.ok(description.value.includes('实验假设'));
  assert.ok(tags.value.includes('experiment'));
});

test('applyIdeaTemplate: unknown key is no-op', () => {
  const desc = { value: '' };
  const tags = { value: '' };
  const r = applyIdeaTemplate({ description: desc, tags }, 'not-a-template');
  assert.equal(r.applied, false);
  assert.equal(desc.value, '');
  assert.equal(tags.value, '');
});

test('applyIdeaTemplate: tags joined with ", "', () => {
  const desc = { value: '' };
  const tags = { value: '' };
  applyIdeaTemplate({ description: desc, tags }, 'discussion');
  assert.equal(tags.value, 'discussion');
});

test('applyIdeaTemplate: with HTMLFormElement variant uses querySelector', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  const form = makeForm(fields);
  const r = applyIdeaTemplate(form, 'survey');
  assert.equal(r.applied, true);
  assert.match(fields.description.value, /研究背景/);
  assert.match(fields.tags.value, /survey, review/);
});

test('applyIdeaTemplate: missing optional fields gracefully no-op', () => {
  // 只传 description,不传 title / tags
  const desc = { value: '' };
  const r = applyIdeaTemplate({ description: desc }, 'experiment');
  assert.equal(r.applied, true);
  assert.match(desc.value, /实验假设/);
});
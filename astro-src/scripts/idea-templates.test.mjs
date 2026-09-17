#!/usr/bin/env node
// astro-src/scripts/idea-templates.test.mjs
//
// Tests for R7 polish: astro-src/lib/idea-templates.ts.
// IDEA_TEMPLATES 常量 + listIdeaTemplateKeys + getIdeaTemplate +
// applyIdeaTemplate (form/fieldMap → 填充 description/tags, 留空 title)。

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
const {
  IDEA_TEMPLATES,
  listIdeaTemplateKeys,
  getIdeaTemplate,
  applyIdeaTemplate,
} = mod;

// ---------- IDEA_TEMPLATES ---
test('TEMPLATES: 3 个固定 key', () => {
  const keys = Object.keys(IDEA_TEMPLATES);
  assert.equal(keys.length, 3);
  assert.ok(keys.includes('survey'));
  assert.ok(keys.includes('experiment'));
  assert.ok(keys.includes('discussion'));
});

test('TEMPLATES: 每个有 title/description/tags', () => {
  for (const key of Object.keys(IDEA_TEMPLATES)) {
    const t = IDEA_TEMPLATES[key];
    assert.equal(typeof t.title, 'string');
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.ok(Array.isArray(t.tags));
  }
});

test('TEMPLATES: survey 含占位符', () => {
  const t = IDEA_TEMPLATES.survey;
  assert.match(t.title, /XXX/);
  assert.match(t.description, /\[子领域 A\]/);
});

test('TEMPLATES: experiment 含自变量/因变量', () => {
  const t = IDEA_TEMPLATES.experiment;
  assert.match(t.description, /自变量/);
  assert.match(t.description, /因变量/);
});

test('TEMPLATES: discussion 含讨论/观点', () => {
  const t = IDEA_TEMPLATES.discussion;
  assert.match(t.description, /讨论主题/);
  assert.match(t.description, /已有观点/);
  assert.match(t.description, /我的观点/);
});

// ---------- listIdeaTemplateKeys ---
test('listKeys: 3 个 key', () => {
  const r = listIdeaTemplateKeys();
  assert.equal(r.length, 3);
});

test('listKeys: 含 survey/experiment/discussion', () => {
  const r = listIdeaTemplateKeys();
  assert.ok(r.includes('survey'));
  assert.ok(r.includes('experiment'));
  assert.ok(r.includes('discussion'));
});

// ---------- getIdeaTemplate ---
test('getTpl: 已知 key', () => {
  const r = getIdeaTemplate('survey');
  assert.equal(r.title, IDEA_TEMPLATES.survey.title);
});

test('getTpl: 未知 key → null', () => {
  assert.equal(getIdeaTemplate('unknown'), null);
});

test('getTpl: 空字符串 → null', () => {
  assert.equal(getIdeaTemplate(''), null);
});

// ---------- applyIdeaTemplate (fieldMap form) ---
test('apply: fieldMap → 填 description + tags', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  const r = applyIdeaTemplate(fields, 'survey');
  assert.equal(r.applied, true);
  assert.equal(fields.description.value, IDEA_TEMPLATES.survey.description);
  assert.equal(fields.tags.value, IDEA_TEMPLATES.survey.tags.join(', '));
});

test('apply: 未知 key → applied=false', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  const r = applyIdeaTemplate(fields, 'unknown');
  assert.equal(r.applied, false);
  assert.match(r.reason, /unknown template/);
  assert.equal(fields.description.value, ''); // 没动
});

test('apply: title 空 → 填入模板 title', () => {
  // 代码:if (titleEl && tpl.title && !titleEl.value) titleEl.value = tpl.title
  // 即 title 字段为空时填入(看似与注释"留空"不符,但代码就是这么写的)
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'survey');
  assert.equal(fields.title.value, IDEA_TEMPLATES.survey.title);
});

test('apply: title 已有值 → 保留(不覆盖)', () => {
  const fields = {
    title: { value: 'user custom title' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'survey');
  assert.equal(fields.title.value, 'user custom title');
});

test('apply: description join → ", "', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'experiment');
  assert.equal(fields.tags.value, 'experiment, hypothesis');
});

test('apply: 3 个 key 各自正确填充', () => {
  for (const key of ['survey', 'experiment', 'discussion']) {
    const fields = {
      title: { value: '' },
      description: { value: '' },
      tags: { value: '' },
    };
    applyIdeaTemplate(fields, key);
    assert.equal(fields.description.value, IDEA_TEMPLATES[key].description);
    assert.equal(fields.tags.value, IDEA_TEMPLATES[key].tags.join(', '));
  }
});

test('apply: fieldMap 缺 title → 不抛', () => {
  const fields = { description: { value: '' }, tags: { value: '' } };
  const r = applyIdeaTemplate(fields, 'survey');
  assert.equal(r.applied, true);
});

test('apply: fieldMap 缺 description → 不抛', () => {
  const fields = { title: { value: '' }, tags: { value: '' } };
  const r = applyIdeaTemplate(fields, 'survey');
  assert.equal(r.applied, true);
  assert.equal(fields.tags.value, IDEA_TEMPLATES.survey.tags.join(', '));
});

test('apply: fieldMap 缺 tags → 不抛', () => {
  const fields = { title: { value: '' }, description: { value: '' } };
  const r = applyIdeaTemplate(fields, 'survey');
  assert.equal(r.applied, true);
  assert.equal(fields.description.value, IDEA_TEMPLATES.survey.description);
});

test('apply: fieldMap 全空 → 不抛', () => {
  const fields = {};
  const r = applyIdeaTemplate(fields, 'survey');
  assert.equal(r.applied, true);
});

// ---------- applyIdeaTemplate (HTMLFormElement form) ---
test('apply: form 走 querySelector', () => {
  const calls = [];
  const fakeForm = {
    querySelector: (sel) => {
      calls.push(sel);
      if (sel.includes('title')) return { value: '' };
      if (sel.includes('description')) return { value: '' };
      if (sel.includes('tags')) return { value: '' };
      return null;
    },
  };
  const r = applyIdeaTemplate(fakeForm, 'survey');
  assert.equal(r.applied, true);
  // querySelector 应被调用 3 次
  assert.equal(calls.length, 3);
  assert.ok(calls.some((s) => s.includes('idea-title')));
  assert.ok(calls.some((s) => s.includes('idea-description')));
  assert.ok(calls.some((s) => s.includes('idea-tags')));
});

test('apply: form 缺字段 → null 不抛', () => {
  const fakeForm = { querySelector: () => null };
  const r = applyIdeaTemplate(fakeForm, 'survey');
  assert.equal(r.applied, true);
});

// ---------- 集成 ---
test('集成: getTpl → apply', () => {
  const tpl = getIdeaTemplate('discussion');
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'discussion');
  assert.equal(fields.description.value, tpl.description);
  assert.deepEqual(fields.tags.value.split(', '), tpl.tags);
});
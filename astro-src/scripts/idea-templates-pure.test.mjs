#!/usr/bin/env node
// astro-src/scripts/idea-templates-pure.test.mjs
//
// Tests for R7 polish: astro-src/lib/idea-templates.ts
// Additional edge-case tests beyond idea-templates.test.mjs

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

// ---------- Additional edge-case tests ----------

// Test: listIdeaTemplateKeys returns same keys as Object.keys
test('listKeys: 与 Object.keys 一致', () => {
  const listKeys = listIdeaTemplateKeys();
  const objKeys = Object.keys(IDEA_TEMPLATES);
  assert.deepEqual(listKeys.sort(), objKeys.sort());
});

// Test: getIdeaTemplate returns exact reference
test('getTpl: 返回相同引用', () => {
  const t1 = getIdeaTemplate('survey');
  const t2 = IDEA_TEMPLATES.survey;
  assert.equal(t1, t2);
});

// Test: applyIdeaTemplate with partial fieldMap (some fields null)
test('apply: fieldMap 部分字段为 null', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: null, // explicitly null
  };
  const r = applyIdeaTemplate(fields, 'experiment');
  assert.equal(r.applied, true);
  assert.equal(fields.description.value, IDEA_TEMPLATES.experiment.description);
});

// Test: applyIdeaTemplate with partial fieldMap (some fields undefined)
test('apply: fieldMap 部分字段为 undefined', () => {
  const fields = {
    title: undefined,
    description: { value: '' },
    tags: { value: '' },
  };
  const r = applyIdeaTemplate(fields, 'discussion');
  assert.equal(r.applied, true);
  assert.equal(fields.description.value, IDEA_TEMPLATES.discussion.description);
});

// Test: applyIdeaTemplate - tags array order preserved
test('apply: tags 顺序与数组一致', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'survey');
  // survey has tags: ['survey', 'review']
  assert.equal(fields.tags.value, 'survey, review');
});

// Test: applyIdeaTemplate - template description contains markdown
test('apply: description 含 markdown 语法', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'experiment');
  const desc = fields.description.value;
  // experiment template has ## headers and ### subheaders
  assert.ok(desc.includes('##'));
  assert.ok(desc.includes('###'));
});

// Test: applyIdeaTemplate - unknown key returns correct reason message
test('apply: 未知 key reason 含传入的 key', () => {
  const fields = { title: { value: '' }, description: { value: '' }, tags: { value: '' } };
  const r = applyIdeaTemplate(fields, 'foobar');
  assert.equal(r.applied, false);
  assert.ok(r.reason.includes('foobar'));
});

// Test: applyIdeaTemplate - empty key treated as unknown
test('apply: 空 key → unknown', () => {
  const fields = { title: { value: '' }, description: { value: '' }, tags: { value: '' } };
  const r = applyIdeaTemplate(fields, '');
  assert.equal(r.applied, false);
});

// Test: getIdeaTemplate - all templates have non-empty tags array
test('getTpl: 所有模板 tags 非空', () => {
  for (const key of listIdeaTemplateKeys()) {
    const t = getIdeaTemplate(key);
    assert.ok(t);
    assert.ok(Array.isArray(t.tags));
    assert.ok(t.tags.length > 0);
  }
});

// Test: applyIdeaTemplate - whitespace in tags join
test('apply: tags join 无多余空格', () => {
  const fields = {
    title: { value: '' },
    description: { value: '' },
    tags: { value: '' },
  };
  applyIdeaTemplate(fields, 'survey');
  // Should be "tag1, tag2" not "tag1,tag2" or "tag1,  tag2"
  assert.equal(fields.tags.value, 'survey, review');
});

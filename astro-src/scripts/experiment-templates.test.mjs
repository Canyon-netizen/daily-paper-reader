#!/usr/bin/env node
// astro-src/scripts/experiment-templates.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/templates.ts.

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

const mod = await loadTs('lib/experiments/templates.ts');
const { experimentTemplates, getExperimentTemplate } = mod;

test('experimentTemplates: 非空数组', () => {
  assert.ok(Array.isArray(experimentTemplates));
  assert.ok(experimentTemplates.length >= 3);
});

test('experimentTemplates: 每个 template 有 id/name/nameZh/description/title/method/variables/tags', () => {
  for (const t of experimentTemplates) {
    assert.ok(t.id && typeof t.id === 'string');
    assert.ok(t.name && typeof t.name === 'string');
    assert.ok(t.nameZh && typeof t.nameZh === 'string');
    assert.ok(t.description);
    assert.ok(t.title);
    assert.ok(t.method);
    assert.ok(Array.isArray(t.variables));
    assert.ok(Array.isArray(t.tags));
  }
});

test('experimentTemplates: id 唯一', () => {
  const ids = experimentTemplates.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('experimentTemplates: variable.type 只能是 independent/dependent/controlled', () => {
  for (const t of experimentTemplates) {
    for (const v of t.variables) {
      assert.ok(['independent', 'dependent', 'controlled'].includes(v.type));
    }
  }
});

test('experimentTemplates: 至少包含 ablation-study 和 ab-test', () => {
  const ids = experimentTemplates.map((t) => t.id);
  assert.ok(ids.includes('ablation-study'));
  assert.ok(ids.includes('ab-test'));
});

test('experimentTemplates: tags 是数组', () => {
  for (const t of experimentTemplates) {
    assert.ok(t.tags.length > 0, `${t.id} 至少 1 个 tag`);
  }
});

test('getExperimentTemplate: 找到', () => {
  const t = getExperimentTemplate('ablation-study');
  assert.ok(t);
  assert.equal(t.id, 'ablation-study');
});

test('getExperimentTemplate: 找不到 → undefined', () => {
  assert.equal(getExperimentTemplate('nonexistent'), undefined);
  assert.equal(getExperimentTemplate(''), undefined);
});

test('getExperimentTemplate: id 与 experimentTemplates 集合一致', () => {
  for (const t of experimentTemplates) {
    const r = getExperimentTemplate(t.id);
    assert.equal(r, t);
  }
});

test('experimentTemplates: hypothesisZh 与 hypothesis 都是 string', () => {
  for (const t of experimentTemplates) {
    assert.equal(typeof t.hypothesis, 'string');
    assert.equal(typeof t.hypothesisZh, 'string');
  }
});

test('experimentTemplates: methodZh 与 method 都是 string', () => {
  for (const t of experimentTemplates) {
    assert.equal(typeof t.method, 'string');
    assert.equal(typeof t.methodZh, 'string');
  }
});
#!/usr/bin/env node
// astro-src/scripts/facet.test.mjs
//
// Tests for R7 polish: astro-src/lib/types/facet.ts facet category whitelist + labels.

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

const mod = await loadTs('lib/types/facet.ts');
const { ALLOWED_FACET_CATEGORIES, FACET_CATEGORY_LABELS } = mod;

test('ALLOWED_FACET_CATEGORIES: 5 个稳定枚举', () => {
  assert.equal(ALLOWED_FACET_CATEGORIES.size, 5);
  assert.ok(ALLOWED_FACET_CATEGORIES.has('method'));
  assert.ok(ALLOWED_FACET_CATEGORIES.has('data_task'));
  assert.ok(ALLOWED_FACET_CATEGORIES.has('structure_property'));
  assert.ok(ALLOWED_FACET_CATEGORIES.has('application_transfer'));
  assert.ok(ALLOWED_FACET_CATEGORIES.has('evaluation_benchmark'));
});

test('ALLOWED_FACET_CATEGORIES: 未知类别不在', () => {
  assert.ok(!ALLOWED_FACET_CATEGORIES.has('unknown'));
  assert.ok(!ALLOWED_FACET_CATEGORIES.has(''));
  assert.ok(!ALLOWED_FACET_CATEGORIES.has('Method')); // 大小写敏感
});

test('ALLOWED_FACET_CATEGORIES: 是 ReadonlySet', () => {
  assert.equal(typeof ALLOWED_FACET_CATEGORIES[Symbol.iterator], 'function');
});

test('FACET_CATEGORY_LABELS: 5 个中文标签', () => {
  assert.equal(Object.keys(FACET_CATEGORY_LABELS).length, 5);
});

test('FACET_CATEGORY_LABELS: method → 方法路线', () => {
  assert.equal(FACET_CATEGORY_LABELS.method, '方法路线');
});

test('FACET_CATEGORY_LABELS: data_task → 数据与任务', () => {
  assert.equal(FACET_CATEGORY_LABELS.data_task, '数据与任务');
});

test('FACET_CATEGORY_LABELS: structure_property → 结构与性质', () => {
  assert.equal(FACET_CATEGORY_LABELS.structure_property, '结构与性质');
});

test('FACET_CATEGORY_LABELS: application_transfer → 应用与迁移', () => {
  assert.equal(FACET_CATEGORY_LABELS.application_transfer, '应用与迁移');
});

test('FACET_CATEGORY_LABELS: evaluation_benchmark → 评测与基准', () => {
  assert.equal(FACET_CATEGORY_LABELS.evaluation_benchmark, '评测与基准');
});

test('FACET_CATEGORY_LABELS: 每个值非空字符串', () => {
  for (const [key, val] of Object.entries(FACET_CATEGORY_LABELS)) {
    assert.ok(typeof val === 'string' && val.length > 0, `${key} 应有非空中文`);
  }
});

test('ALLOWED 与 LABELS 同步(同 key 集合)', () => {
  const allowed = [...ALLOWED_FACET_CATEGORIES].sort();
  const labelKeys = Object.keys(FACET_CATEGORY_LABELS).sort();
  assert.deepEqual(allowed, labelKeys);
});
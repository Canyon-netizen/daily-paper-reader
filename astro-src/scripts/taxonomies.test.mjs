#!/usr/bin/env node
// astro-src/scripts/taxonomies.test.mjs
//
// Tests for R7 polish: astro-src/lib/taxonomies.ts.
// normalizeCategoryDim + buildCategories + categoriesToYamlInline + ALIAS_* constants.

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

const mod = await loadTs('lib/taxonomies.ts');
const {
  TASK_ALLOWLIST,
  METHOD_ALLOWLIST,
  TYPE_ALLOWLIST,
  TASK_ALLOWLIST_RAW,
  METHOD_ALLOWLIST_RAW,
  TYPE_ALLOWLIST_RAW,
  ALIAS_OLD_TAG_TO_TASK,
  ALIAS_OLD_TAG_TO_METHOD,
  normalizeCategoryDim,
  buildCategories,
  categoriesToYamlInline,
} = mod;

// ---------- ALLOWLIST 基本属性 ----------
test('TASK_ALLOWLIST: 是 Set', () => {
  assert.ok(TASK_ALLOWLIST instanceof Set);
});

test('TASK_ALLOWLIST: 非空', () => {
  assert.ok(TASK_ALLOWLIST.size > 0);
});

test('METHOD_ALLOWLIST: 是 Set', () => {
  assert.ok(METHOD_ALLOWLIST instanceof Set);
});

test('TYPE_ALLOWLIST: 是 Set', () => {
  assert.ok(TYPE_ALLOWLIST instanceof Set);
});

test('ALLOWLIST_RAW: 数组', () => {
  assert.ok(Array.isArray(TASK_ALLOWLIST_RAW));
  assert.ok(Array.isArray(METHOD_ALLOWLIST_RAW));
  assert.ok(Array.isArray(TYPE_ALLOWLIST_RAW));
});

test('ALLOWLIST: 大小写无关 (lowercase)', () => {
  // 内部一律 lowercase
  // 任意 sample 字段查 set
  assert.ok(TASK_ALLOWLIST_RAW.length > 0);
  for (const x of TASK_ALLOWLIST_RAW.slice(0, 3)) {
    assert.ok(TASK_ALLOWLIST.has(x.toLowerCase()));
  }
});

// ---------- ALIAS 映射 ----------
test('ALIAS_OLD_TAG_TO_TASK: rl → rl', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK.rl, 'rl');
});

test('ALIAS_OLD_TAG_TO_TASK: llm-agent → agent', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK['llm-agent'], 'agent');
});

test('ALIAS_OLD_TAG_TO_TASK: reasoning → reasoning', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK.reasoning, 'reasoning');
});

test('ALIAS_OLD_TAG_TO_TASK: game ai → game-ai', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK['game ai'], 'game-ai');
});

test('ALIAS_OLD_TAG_TO_TASK: 故意不映射 intervention', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK.intervention, undefined);
});

test('ALIAS_OLD_TAG_TO_METHOD: self distillation → distillation', () => {
  assert.equal(ALIAS_OLD_TAG_TO_METHOD['self distillation'], 'distillation');
});

test('ALIAS_OLD_TAG_TO_METHOD: 其它不在内', () => {
  assert.equal(ALIAS_OLD_TAG_TO_METHOD.foo, undefined);
});

// ---------- normalizeCategoryDim: venue ----------
test('normalizeCategoryDim: venue 空数组', () => {
  assert.deepEqual(normalizeCategoryDim([], 'venue'), []);
});

test('normalizeCategoryDim: venue undefined → []', () => {
  assert.deepEqual(normalizeCategoryDim(undefined, 'venue'), []);
});

test('normalizeCategoryDim: venue 非数组 → []', () => {
  assert.deepEqual(normalizeCategoryDim('foo', 'venue'), []);
  assert.deepEqual(normalizeCategoryDim({}, 'venue'), []);
});

test('normalizeCategoryDim: venue 保留大小写 (不做 lowercase)', () => {
  const r = normalizeCategoryDim(['ICML 2025', 'NeurIPS 2024'], 'venue');
  assert.deepEqual(r, ['ICML 2025', 'NeurIPS 2024']);
});

test('normalizeCategoryDim: venue 去重', () => {
  const r = normalizeCategoryDim(['a', 'a', 'b'], 'venue');
  assert.deepEqual(r, ['a', 'b']);
});

test('normalizeCategoryDim: venue trim', () => {
  const r = normalizeCategoryDim(['  hello  '], 'venue');
  assert.deepEqual(r, ['hello']);
});

test('normalizeCategoryDim: venue 去空字符串', () => {
  const r = normalizeCategoryDim(['', '  ', 'foo'], 'venue');
  assert.deepEqual(r, ['foo']);
});

test('normalizeCategoryDim: venue 跳过非字符串', () => {
  const r = normalizeCategoryDim(['a', 123, null, 'b'], 'venue');
  assert.deepEqual(r, ['a', 'b']);
});

test('normalizeCategoryDim: venue 保序', () => {
  const r = normalizeCategoryDim(['c', 'a', 'b'], 'venue');
  assert.deepEqual(r, ['c', 'a', 'b']);
});

// ---------- normalizeCategoryDim: task/method/type 白名单 ----------
test('normalizeCategoryDim: task 合法 tag 保留', () => {
  // 任意 sample
  const sample = TASK_ALLOWLIST_RAW[0];
  const r = normalizeCategoryDim([sample], 'task');
  assert.deepEqual(r, [sample]);
});

test('normalizeCategoryDim: task lowercase 化', () => {
  // 取 raw 中的某项,大写化输入,期望输出 lowercase
  const sample = TASK_ALLOWLIST_RAW[0];
  const r = normalizeCategoryDim([sample.toUpperCase()], 'task');
  assert.deepEqual(r, [sample]);
});

test('normalizeCategoryDim: task 非法 → 过滤', () => {
  const r = normalizeCategoryDim(['not-in-allowlist-xyz'], 'task');
  assert.deepEqual(r, []);
});

test('normalizeCategoryDim: task 混合合法 + 非法', () => {
  const sample = TASK_ALLOWLIST_RAW[0];
  const r = normalizeCategoryDim([sample, 'foo-bar-baz', sample.toUpperCase()], 'task');
  // 大写版本 lowercase 后等于 sample,但要去重 → 1 条
  assert.deepEqual(r, [sample]);
});

test('normalizeCategoryDim: task 去重', () => {
  const sample = TASK_ALLOWLIST_RAW[0];
  const r = normalizeCategoryDim([sample, sample], 'task');
  assert.deepEqual(r, [sample]);
});

test('normalizeCategoryDim: method 合法', () => {
  const sample = METHOD_ALLOWLIST_RAW[0];
  const r = normalizeCategoryDim([sample], 'method');
  assert.deepEqual(r, [sample]);
});

test('normalizeCategoryDim: type 合法', () => {
  const sample = TYPE_ALLOWLIST_RAW[0];
  const r = normalizeCategoryDim([sample], 'type');
  assert.deepEqual(r, [sample]);
});

test('normalizeCategoryDim: task undefined → []', () => {
  assert.deepEqual(normalizeCategoryDim(undefined, 'task'), []);
});

test('normalizeCategoryDim: unknown dim → throw', () => {
  assert.throws(
    () => normalizeCategoryDim(['x'], 'foo'),
    /unknown category dim/,
  );
});

// ---------- buildCategories ----------
test('buildCategories: 默认空', () => {
  const r = buildCategories();
  assert.deepEqual(r, { venue: [], task: [], method: [], type: [] });
});

test('buildCategories: 4 dim 全部给出', () => {
  const r = buildCategories({
    venue: ['ICML 2025'],
    task: [TASK_ALLOWLIST_RAW[0]],
    method: [METHOD_ALLOWLIST_RAW[0]],
    type: [TYPE_ALLOWLIST_RAW[0]],
  });
  assert.equal(r.venue[0], 'ICML 2025');
  assert.equal(r.task[0], TASK_ALLOWLIST_RAW[0]);
  assert.equal(r.method[0], METHOD_ALLOWLIST_RAW[0]);
  assert.equal(r.type[0], TYPE_ALLOWLIST_RAW[0]);
});

test('buildCategories: 缺字段 → 该 dim 空数组', () => {
  const r = buildCategories({ venue: ['ICML'] });
  assert.deepEqual(r.task, []);
  assert.deepEqual(r.method, []);
  assert.deepEqual(r.type, []);
});

test('buildCategories: task 非法过滤', () => {
  const r = buildCategories({ task: ['nonexistent'] });
  assert.deepEqual(r.task, []);
});

test('buildCategories: 返回 4 个固定 dim key', () => {
  const r = buildCategories();
  assert.deepEqual(Object.keys(r).sort(), ['method', 'task', 'type', 'venue']);
});

// ---------- categoriesToYamlInline ----------
test('categoriesToYamlInline: 全空', () => {
  const r = categoriesToYamlInline({ venue: [], task: [], method: [], type: [] });
  assert.equal(r, '{ venue: [], task: [], method: [], type: [] }');
});

test('categoriesToYamlInline: venue 单元素', () => {
  const r = categoriesToYamlInline({ venue: ['ICML 2025'], task: [], method: [], type: [] });
  assert.match(r, /venue: \["ICML 2025"\]/);
});

test('categoriesToYamlInline: 多元素', () => {
  const r = categoriesToYamlInline({
    venue: ['ICML 2025'],
    task: ['rl'],
    method: [],
    type: ['benchmark'],
  });
  assert.match(r, /venue: \["ICML 2025"\]/);
  assert.match(r, /task: \["rl"\]/);
  assert.match(r, /type: \["benchmark"\]/);
});

test('categoriesToYamlInline: method 空 → method: []', () => {
  const r = categoriesToYamlInline({ venue: [], task: [], method: [], type: [] });
  assert.match(r, /method: \[\]/);
});

test('categoriesToYamlInline: 4 dim 顺序固定', () => {
  const r = categoriesToYamlInline({
    venue: ['V'],
    task: ['T'],
    method: ['M'],
    type: ['X'],
  });
  // venue → task → method → type
  const vi = r.indexOf('venue:');
  const ti = r.indexOf('task:');
  const mi = r.indexOf('method:');
  const xi = r.indexOf('type:');
  assert.ok(vi >= 0 && ti > vi && mi > ti && xi > mi);
});

test('categoriesToYamlInline: 双引号 escape', () => {
  const r = categoriesToYamlInline({
    venue: ['foo "bar" baz'],
    task: [], method: [], type: [],
  });
  assert.match(r, /\\"/);
});

test('categoriesToYamlInline: 大括号包裹', () => {
  const r = categoriesToYamlInline({ venue: [], task: [], method: [], type: [] });
  assert.ok(r.startsWith('{ '));
  assert.ok(r.endsWith(' }'));
});
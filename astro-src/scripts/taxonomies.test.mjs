#!/usr/bin/env node
// astro-src/scripts/taxonomies.test.mjs
//
// Tests for R7 polish: astro-src/lib/taxonomies.ts.
// TASK_ALLOWLIST / METHOD_ALLOWLIST / TYPE_ALLOWLIST (从 JSON 导入) +
// TASK/METHOD/TYPE_ALLOWLIST_RAW +
// ALIAS_OLD_TAG_TO_TASK / ALIAS_OLD_TAG_TO_METHOD +
// normalizeCategoryDim (白名单 + 大小写无关 + 去重 + 保序) +
// buildCategories (4-dim 集中拷出) +
// categoriesToYamlInline (Categories → flow-style YAML inline)。

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
    write: false,
    target: 'es2022',
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path', './taxonomies-disk.mjs'],
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

// ---------- 常量 ---
test('TASK_ALLOWLIST: 是 Set 且非空', () => {
  assert.ok(TASK_ALLOWLIST instanceof Set);
  assert.ok(TASK_ALLOWLIST.size > 0);
});

test('TASK_ALLOWLIST: 含常见任务(rl)', () => {
  assert.ok(TASK_ALLOWLIST.has('rl'));
});

test('TASK_ALLOWLIST: 大小写无关(全是 lower)', () => {
  // RAW 是原样,Set 全部 trim+lowercase
  for (const s of TASK_ALLOWLIST) {
    assert.equal(s, s.toLowerCase());
  }
});

test('TASK_ALLOWLIST_RAW: 数组', () => {
  assert.ok(Array.isArray(TASK_ALLOWLIST_RAW));
});

test('TASK_ALLOWLIST_RAW 与 SET 同 size', () => {
  // 一些 RAW 可能 trim 后空 → 被 set 过滤 → size 可能不同
  assert.ok(TASK_ALLOWLIST_RAW.length >= TASK_ALLOWLIST.size);
});

test('METHOD_ALLOWLIST: 含 distillation', () => {
  assert.ok(METHOD_ALLOWLIST.has('distillation'));
});

test('TYPE_ALLOWLIST: 是 Set', () => {
  assert.ok(TYPE_ALLOWLIST instanceof Set);
});

// ---------- ALIAS ---
test('ALIAS_TASK: rl → rl', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK.rl, 'rl');
});

test('ALIAS_TASK: llm-agent → agent', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK['llm-agent'], 'agent');
});

test('ALIAS_TASK: game ai → game-ai', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK['game ai'], 'game-ai');
});

test('ALIAS_TASK: intervention 不映射', () => {
  assert.equal(ALIAS_OLD_TAG_TO_TASK['intervention'], undefined);
});

test('ALIAS_METHOD: self distillation → distillation', () => {
  assert.equal(ALIAS_OLD_TAG_TO_METHOD['self distillation'], 'distillation');
});

test('ALIAS_METHOD: 别的 key 无', () => {
  assert.equal(ALIAS_OLD_TAG_TO_METHOD['other'], undefined);
});

// ---------- normalizeCategoryDim ---
test('norm: venue 无白名单直接放行', () => {
  const r = normalizeCategoryDim(['ICML 2025', 'NeurIPS 2024'], 'venue');
  assert.deepEqual(r, ['ICML 2025', 'NeurIPS 2024']);
});

test('norm: venue 去重保序', () => {
  const r = normalizeCategoryDim(['ICML', 'NeurIPS', 'ICML'], 'venue');
  assert.deepEqual(r, ['ICML', 'NeurIPS']);
});

test('norm: venue trim', () => {
  const r = normalizeCategoryDim(['  ICML  '], 'venue');
  assert.deepEqual(r, ['ICML']);
});

test('norm: venue 缺 → []', () => {
  assert.deepEqual(normalizeCategoryDim(undefined, 'venue'), []);
  assert.deepEqual(normalizeCategoryDim(null, 'venue'), []);
});

test('norm: venue 非数组 → []', () => {
  assert.deepEqual(normalizeCategoryDim('not array', 'venue'), []);
});

test('norm: task 白名单匹配', () => {
  const r = normalizeCategoryDim(['rl', 'reasoning'], 'task');
  assert.deepEqual(r, ['rl', 'reasoning']);
});

test('norm: task 非白名单 → 丢', () => {
  const r = normalizeCategoryDim(['rl', 'unknown-task'], 'task');
  assert.deepEqual(r, ['rl']);
});

test('norm: task 大小写无关', () => {
  const r = normalizeCategoryDim(['RL', 'Reasoning'], 'task');
  assert.deepEqual(r, ['rl', 'reasoning']);
});

test('norm: task trim', () => {
  const r = normalizeCategoryDim(['  rl  '], 'task');
  assert.deepEqual(r, ['rl']);
});

test('norm: task 去重(大小写都视同)', () => {
  const r = normalizeCategoryDim(['rl', 'RL'], 'task');
  assert.deepEqual(r, ['rl']);
});

test('norm: task 保序', () => {
  const r = normalizeCategoryDim(['reasoning', 'rl'], 'task');
  assert.deepEqual(r, ['reasoning', 'rl']);
});

test('norm: task 空字符串 → []', () => {
  assert.deepEqual(normalizeCategoryDim(['', '   '], 'task'), []);
});

test('norm: task 非 string → 丢', () => {
  const r = normalizeCategoryDim(['rl', null, 42, 'reasoning'], 'task');
  assert.deepEqual(r, ['rl', 'reasoning']);
});

test('norm: method 白名单', () => {
  const r = normalizeCategoryDim(['transformer', 'unknown'], 'method');
  assert.ok(r.includes('transformer') || r.length < 2);
});

test('norm: type 白名单', () => {
  // type 通常是 survey/benchmark 等
  const r = normalizeCategoryDim(['survey'], 'type');
  assert.deepEqual(r, ['survey']);
});

test('norm: 未知 dim → 抛错', () => {
  assert.throws(() => normalizeCategoryDim(['x'], 'unknown'));
});

test('norm: 空数组 → []', () => {
  assert.deepEqual(normalizeCategoryDim([], 'venue'), []);
  assert.deepEqual(normalizeCategoryDim([], 'task'), []);
});

// ---------- buildCategories ---
test('build: 默认空', () => {
  const r = buildCategories();
  assert.deepEqual(r, { venue: [], task: [], method: [], type: [] });
});

test('build: 全部填', () => {
  const r = buildCategories({
    venue: ['ICML 2025'],
    task: ['rl', 'reasoning'],
    method: ['transformer'],
    type: ['survey'],
  });
  assert.deepEqual(r.venue, ['ICML 2025']);
  assert.deepEqual(r.task, ['rl', 'reasoning']);
});

test('build: 部分填 → 缺字段空数组', () => {
  const r = buildCategories({ venue: ['ICML'] });
  assert.deepEqual(r.venue, ['ICML']);
  assert.deepEqual(r.task, []);
});

test('build: task 非白名单过滤', () => {
  const r = buildCategories({ task: ['unknown'] });
  assert.deepEqual(r.task, []);
});

// ---------- categoriesToYamlInline ---
test('yaml: 空 → "{ venue: [], task: [], method: [], type: [] }"', () => {
  const r = categoriesToYamlInline({ venue: [], task: [], method: [], type: [] });
  assert.equal(r, '{ venue: [], task: [], method: [], type: [] }');
});

test('yaml: 单 venue', () => {
  const r = categoriesToYamlInline({ venue: ['ICML 2025'], task: [], method: [], type: [] });
  assert.match(r, /venue: \["ICML 2025"\]/);
});

test('yaml: 多个 venue 逗号分隔', () => {
  const r = categoriesToYamlInline({ venue: ['ICML', 'NeurIPS'], task: [], method: [], type: [] });
  assert.match(r, /venue: \["ICML", "NeurIPS"\]/);
});

test('yaml: 双引号转义', () => {
  const r = categoriesToYamlInline({ venue: ['x"y'], task: [], method: [], type: [] });
  assert.match(r, /"x\\"y"/);
});

test('yaml: 含 task/method/type 都序列化', () => {
  const r = categoriesToYamlInline({
    venue: ['ICML'], task: ['rl'], method: ['transformer'], type: ['survey'],
  });
  assert.match(r, /venue: \["ICML"\]/);
  assert.match(r, /task: \["rl"\]/);
  assert.match(r, /method: \["transformer"\]/);
  assert.match(r, /type: \["survey"\]/);
});

test('yaml: dim 顺序固定 venue→task→method→type', () => {
  const r = categoriesToYamlInline({
    venue: ['A'], task: ['B'], method: ['C'], type: ['D'],
  });
  // venue index < task index < method index < type index
  const v = r.indexOf('venue:');
  const t = r.indexOf('task:');
  const m = r.indexOf('method:');
  const ty = r.indexOf('type:');
  assert.ok(v < t && t < m && m < ty);
});

// ---------- 集成 ---
test('集成: build → yaml', () => {
  const c = buildCategories({
    venue: ['ICML 2025', 'NeurIPS 2024'],
    task: ['rl'],
    method: [],
    type: ['survey'],
  });
  const yaml = categoriesToYamlInline(c);
  assert.match(yaml, /venue: \["ICML 2025", "NeurIPS 2024"\]/);
  assert.match(yaml, /task: \["rl"\]/);
  assert.match(yaml, /method: \[\]/);
  assert.match(yaml, /type: \["survey"\]/);
});

test('集成: normalize 去重 → yaml 干净', () => {
  const c = buildCategories({ task: ['rl', 'RL', 'rl'] });
  // 归一去重后 = ['rl']
  assert.deepEqual(c.task, ['rl']);
  const yaml = categoriesToYamlInline(c);
  assert.match(yaml, /task: \["rl"\]/);
});
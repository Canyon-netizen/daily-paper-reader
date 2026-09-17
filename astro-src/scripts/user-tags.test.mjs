#!/usr/bin/env node
// astro-src/scripts/user-tags.test.mjs
//
// Tests for R7 polish: astro-src/lib/user-tags.ts.
// flattenUserTags (UserTag[] → "kind:label" 数组) +
// mergeWithPaperCategories (Categories + UserTag[] → 去重合并) +
// mergeWithPaperTags (string[] + UserTag[] → 反推 Categories 再合并)。

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
    external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/user-tags.ts');
const {
  flattenUserTags,
  mergeWithPaperCategories,
  mergeWithPaperTags,
  STORAGE_KEY,
} = mod;

// ---------- STORAGE_KEY ---
test('STORAGE_KEY: 旧 key 名', () => {
  assert.equal(STORAGE_KEY, 'dpr_user_tags_v1');
});

// ---------- flattenUserTags ---
test('flatten: 空数组 → []', () => {
  assert.deepEqual(flattenUserTags([]), []);
});

test('flatten: 单 tag → ["task:rl"]', () => {
  const r = flattenUserTags([{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['task:rl']);
});

test('flatten: 多 tag → 顺序保留', () => {
  const r = flattenUserTags([
    { kind: 'task', label: 'rl' },
    { kind: 'method', label: 'transformer' },
    { kind: 'type', label: 'survey' },
  ]);
  assert.deepEqual(r, ['task:rl', 'method:transformer', 'type:survey']);
});

test('flatten: 同 kind 不同 label', () => {
  const r = flattenUserTags([
    { kind: 'task', label: 'rl' },
    { kind: 'task', label: 'reasoning' },
  ]);
  assert.deepEqual(r, ['task:rl', 'task:reasoning']);
});

// ---------- mergeWithPaperCategories ---
test('merge: paperCats undefined → 仅 userTags', () => {
  const r = mergeWithPaperCategories(undefined, [{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['user:task:rl']);
});

test('merge: paperCats null → 仅 userTags', () => {
  const r = mergeWithPaperCategories(null, [{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['user:task:rl']);
});

test('merge: paperCats 全空 → 仅 userTags', () => {
  const r = mergeWithPaperCategories(
    { venue: [], task: [], method: [], type: [] },
    [{ kind: 'task', label: 'rl' }],
  );
  assert.deepEqual(r, ['user:task:rl']);
});

test('merge: userTags 空 → 仅 paperCats', () => {
  const r = mergeWithPaperCategories(
    { venue: ['ICML 2025'], task: ['rl'], method: [], type: [] },
    [],
  );
  assert.deepEqual(r, ['venue:ICML 2025', 'task:rl']);
});

test('merge: 全有 → venue/task/method/type + user:task:*', () => {
  const r = mergeWithPaperCategories(
    { venue: ['ICML 2025'], task: ['rl'], method: ['transformer'], type: ['survey'] },
    [
      { kind: 'task', label: 'reasoning' },
      { kind: 'method', label: 'diffusion' },
    ],
  );
  // flattenCategories 按 venue→task→method→type 顺序,user: 后追加
  assert.deepEqual(r, [
    'venue:ICML 2025',
    'task:rl',
    'method:transformer',
    'type:survey',
    'user:task:reasoning',
    'user:method:diffusion',
  ]);
});

test('merge: userTags undefined → 不抛', () => {
  const r = mergeWithPaperCategories(
    { venue: ['ICML'], task: [], method: [], type: [] },
    undefined,
  );
  assert.deepEqual(r, ['venue:ICML']);
});

test('merge: userTags null → 不抛', () => {
  const r = mergeWithPaperCategories(
    { venue: ['ICML'], task: [], method: [], type: [] },
    null,
  );
  assert.deepEqual(r, ['venue:ICML']);
});

test('merge: paper 与 user 同 kind 不同 label → 两条', () => {
  const r = mergeWithPaperCategories(
    { venue: [], task: ['rl'], method: [], type: [] },
    [{ kind: 'task', label: 'reasoning' }],
  );
  // task:rl vs user:task:reasoning → 不同
  assert.deepEqual(r, ['task:rl', 'user:task:reasoning']);
});

test('merge: paper 与 user 完全相同 → 去重(仅 paper)', () => {
  // paper: task:rl; user: task:rl → key 是 "user:task:rl" → 不等于 "task:rl" → 两条
  const r = mergeWithPaperCategories(
    { venue: [], task: ['rl'], method: [], type: [] },
    [{ kind: 'task', label: 'rl' }],
  );
  assert.deepEqual(r, ['task:rl', 'user:task:rl']);
});

test('merge: flattenCategories 内部去重', () => {
  // venue:["ICML","ICML"] → flatten 后只有一个
  const r = mergeWithPaperCategories(
    { venue: ['ICML', 'ICML'], task: [], method: [], type: [] },
    [],
  );
  assert.deepEqual(r, ['venue:ICML']);
});

test('merge: paper venue 顺序固定(venue→task→method→type)', () => {
  const r = mergeWithPaperCategories(
    { type: ['survey'], venue: ['ICML'], method: ['m1'], task: ['rl'] },
    [],
  );
  assert.deepEqual(r, ['venue:ICML', 'task:rl', 'method:m1', 'type:survey']);
});

// ---------- mergeWithPaperTags ---
test('legacyMerge: undefined frontmatterTags → 仅 userTags', () => {
  const r = mergeWithPaperTags(undefined, [{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['user:task:rl']);
});

test('legacyMerge: null frontmatterTags → 仅 userTags', () => {
  const r = mergeWithPaperTags(null, [{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['user:task:rl']);
});

test('legacyMerge: 空数组 → 仅 userTags', () => {
  const r = mergeWithPaperTags([], [{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['user:task:rl']);
});

test('legacyMerge: 简单 "dim:label" → 还原到对应 dim', () => {
  const r = mergeWithPaperTags(['task:rl', 'method:transformer'], []);
  assert.deepEqual(r, ['task:rl', 'method:transformer']);
});

test('legacyMerge: "query:foo" → task:foo(兼容性)', () => {
  const r = mergeWithPaperTags(['query:rl'], []);
  assert.deepEqual(r, ['task:rl']);
});

test('legacyMerge: 非法 dim → 丢弃', () => {
  const r = mergeWithPaperTags(['unknown:foo', 'task:rl'], []);
  assert.deepEqual(r, ['task:rl']);
});

test('legacyMerge: 无冒号 → 进 task', () => {
  const r = mergeWithPaperTags(['foo'], []);
  assert.deepEqual(r, ['task:foo']);
});

test('legacyMerge: 非 string 元素 → 跳过', () => {
  const r = mergeWithPaperTags(['task:rl', null, 42, 'method:m'], []);
  assert.deepEqual(r, ['task:rl', 'method:m']);
});

test('legacyMerge: 多个 query: 全部转 task', () => {
  const r = mergeWithPaperTags(['query:rl', 'query:reasoning'], []);
  assert.deepEqual(r, ['task:rl', 'task:reasoning']);
});

test('legacyMerge: 合并 userTags', () => {
  const r = mergeWithPaperTags(
    ['task:rl'],
    [{ kind: 'task', label: 'reasoning' }],
  );
  assert.deepEqual(r, ['task:rl', 'user:task:reasoning']);
});

test('legacyMerge: 顺序 venue→task→method→type', () => {
  const r = mergeWithPaperTags(
    ['type:survey', 'venue:ICML', 'task:rl', 'method:m'],
    [],
  );
  assert.deepEqual(r, ['venue:ICML', 'task:rl', 'method:m', 'type:survey']);
});

// ---------- 集成 ---
test('集成: 合并 frontmatter + user + 排序', () => {
  const r = mergeWithPaperCategories(
    { venue: ['NeurIPS 2024'], task: ['rl', 'reasoning'], method: [], type: ['survey'] },
    [
      { kind: 'task', label: 'reasoning' },
      { kind: 'method', label: 'transformer' },
    ],
  );
  // task 内部去重:flattenCategories 看 c.task=['rl','reasoning'] → 两条都进
  // user:task:reasoning 不与 task:reasoning 重复(前缀不同)
  assert.deepEqual(r, [
    'venue:NeurIPS 2024',
    'task:rl',
    'task:reasoning',
    'type:survey',
    'user:task:reasoning',
    'user:method:transformer',
  ]);
});

test('集成: legacy path → user tags 合并', () => {
  // 旧 frontmatter ['query:rl'] 等价于新 {task:['rl']}
  const r = mergeWithPaperTags(
    ['query:rl', 'venue:ICML 2025'],
    [{ kind: 'task', label: 'reasoning' }],
  );
  assert.deepEqual(r, [
    'venue:ICML 2025',
    'task:rl',
    'user:task:reasoning',
  ]);
});
#!/usr/bin/env node
// astro-src/scripts/user-tags.test.mjs
//
// Tests for R7 polish: astro-src/lib/user-tags.ts.
// 纯函数 flattenUserTags + mergeWithPaperCategories + mergeWithPaperTags + STORAGE_KEY.

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

const mod = await loadTs('lib/user-tags.ts');
const {
  flattenUserTags,
  mergeWithPaperCategories,
  mergeWithPaperTags,
  STORAGE_KEY,
} = mod;

// ---------- STORAGE_KEY ----------
test('STORAGE_KEY: dpr_user_tags_v1', () => {
  assert.equal(STORAGE_KEY, 'dpr_user_tags_v1');
});

// ---------- flattenUserTags ----------
test('flattenUserTags: 空数组 → []', () => {
  assert.deepEqual(flattenUserTags([]), []);
});

test('flattenUserTags: 单条', () => {
  const r = flattenUserTags([{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(r, ['task:rl']);
});

test('flattenUserTags: 多条', () => {
  const r = flattenUserTags([
    { kind: 'task', label: 'rl' },
    { kind: 'method', label: 'distillation' },
    { kind: 'type', label: 'benchmark' },
  ]);
  assert.deepEqual(r, ['task:rl', 'method:distillation', 'type:benchmark']);
});

test('flattenUserTags: 保留顺序', () => {
  const r = flattenUserTags([
    { kind: 'a', label: '1' },
    { kind: 'b', label: '2' },
    { kind: 'c', label: '3' },
  ]);
  assert.deepEqual(r, ['a:1', 'b:2', 'c:3']);
});

test('flattenUserTags: 含空格 label', () => {
  const r = flattenUserTags([{ kind: 'task', label: 'self distillation' }]);
  assert.deepEqual(r, ['task:self distillation']);
});

test('flattenUserTags: 不去重 (重复 kind:label 保留)', () => {
  const r = flattenUserTags([
    { kind: 'task', label: 'rl' },
    { kind: 'task', label: 'rl' },
  ]);
  assert.deepEqual(r, ['task:rl', 'task:rl']);
});

// ---------- mergeWithPaperCategories ----------
test('mergeWithPaperCategories: paperCats undefined', () => {
  const r = mergeWithPaperCategories(undefined, []);
  assert.deepEqual(r, []);
});

test('mergeWithPaperCategories: paperCats null', () => {
  const r = mergeWithPaperCategories(null, []);
  assert.deepEqual(r, []);
});

test('mergeWithPaperCategories: 空 paperCats + 空 userTags → []', () => {
  assert.deepEqual(
    mergeWithPaperCategories({ venue: [], task: [], method: [], type: [] }, []),
    [],
  );
});

test('mergeWithPaperCategories: paperCats 完整 flatten', () => {
  const r = mergeWithPaperCategories(
    { venue: ['ICML 2025'], task: ['rl'], method: [], type: ['benchmark'] },
    [],
  );
  assert.deepEqual(r, ['venue:ICML 2025', 'task:rl', 'type:benchmark']);
});

test('mergeWithPaperCategories: userTag 加 user: 前缀', () => {
  const r = mergeWithPaperCategories(
    { venue: [], task: [], method: [], type: [] },
    [{ kind: 'task', label: 'reasoning' }],
  );
  assert.deepEqual(r, ['user:task:reasoning']);
});

test('mergeWithPaperCategories: paperCats 先 + userTag 后', () => {
  const r = mergeWithPaperCategories(
    { venue: ['ICML 2025'], task: ['rl'], method: [], type: [] },
    [{ kind: 'task', label: 'reasoning' }],
  );
  assert.deepEqual(r, ['venue:ICML 2025', 'task:rl', 'user:task:reasoning']);
});

test('mergeWithPaperCategories: 去重 paper 内重复', () => {
  // flattenCategories 不会重复,但 paper 内某 dim 重复 → 经过去重
  const r = mergeWithPaperCategories(
    { venue: ['ICML'], task: ['rl', 'rl'], method: [], type: [] },
    [],
  );
  // task 重复 flatten 后还是 1 个 'task:rl'
  assert.deepEqual(r, ['venue:ICML', 'task:rl']);
});

test('mergeWithPaperCategories: user tag 不与 paper 冲突', () => {
  // paper 没 user:* → 不去重
  const r = mergeWithPaperCategories(
    { venue: ['ICML'], task: ['rl'], method: [], type: [] },
    [
      { kind: 'task', label: 'reasoning' },
      { kind: 'method', label: 'distillation' },
    ],
  );
  assert.deepEqual(r, [
    'venue:ICML',
    'task:rl',
    'user:task:reasoning',
    'user:method:distillation',
  ]);
});

test('mergeWithPaperCategories: 重复 userTag 去重', () => {
  const r = mergeWithPaperCategories(
    { venue: [], task: [], method: [], type: [] },
    [
      { kind: 'task', label: 'reasoning' },
      { kind: 'task', label: 'reasoning' },
    ],
  );
  assert.deepEqual(r, ['user:task:reasoning']);
});

test('mergeWithPaperCategories: userTags undefined → []', () => {
  const r = mergeWithPaperCategories({ venue: ['ICML'], task: [], method: [], type: [] }, undefined);
  assert.deepEqual(r, ['venue:ICML']);
});

test('mergeWithPaperCategories: userTags null → []', () => {
  const r = mergeWithPaperCategories({ venue: ['ICML'], task: [], method: [], type: [] }, null);
  assert.deepEqual(r, ['venue:ICML']);
});

// ---------- mergeWithPaperTags (旧 API 兼容) ----------
test('mergeWithPaperTags: 旧 frontmatterTags 解析 dim:label', () => {
  const r = mergeWithPaperTags(['task:rl', 'type:benchmark'], []);
  // ACC.task = ['rl'], ACC.type = ['benchmark'] → flatten
  assert.deepEqual(r, ['task:rl', 'type:benchmark']);
});

test('mergeWithPaperTags: 旧 query: 前缀 → task', () => {
  // 'query:foo' → ACC.task.push('foo')
  const r = mergeWithPaperTags(['query:foo'], []);
  assert.deepEqual(r, ['task:foo']);
});

test('mergeWithPaperTags: venue dim', () => {
  const r = mergeWithPaperTags(['venue:ICML 2025'], []);
  assert.deepEqual(r, ['venue:ICML 2025']);
});

test('mergeWithPaperTags: method dim', () => {
  const r = mergeWithPaperTags(['method:distillation'], []);
  assert.deepEqual(r, ['method:distillation']);
});

test('mergeWithPaperTags: 未知 dim 跳过', () => {
  const r = mergeWithPaperTags(['foo:bar'], []);
  assert.deepEqual(r, []);
});

test('mergeWithPaperTags: 无冒号 → 默认 task', () => {
  const r = mergeWithPaperTags(['lonely-tag'], []);
  assert.deepEqual(r, ['task:lonely-tag']);
});

test('mergeWithPaperTags: 无冒号 + query 前缀被剥', () => {
  // 'query:foo' 走的是 query-prefix branch (有冒号),无冒号才默认 task
  const r = mergeWithPaperTags(['queryfoo'], []);
  // 无冒号 → task.push
  assert.deepEqual(r, ['task:queryfoo']);
});

test('mergeWithPaperTags: 多个 tag', () => {
  const r = mergeWithPaperTags(['task:rl', 'type:benchmark', 'venue:ICML'], []);
  // flattenCategories 固定输出顺序:venue → task → method → type
  assert.deepEqual(r, ['venue:ICML', 'task:rl', 'type:benchmark']);
});

test('mergeWithPaperTags: 非字符串跳过', () => {
  const r = mergeWithPaperTags(['task:rl', 123, null, 'type:b'], []);
  assert.deepEqual(r, ['task:rl', 'type:b']);
});

test('mergeWithPaperTags: undefined → 仅 userTags', () => {
  const r = mergeWithPaperTags(undefined, [{ kind: 'task', label: 'x' }]);
  assert.deepEqual(r, ['user:task:x']);
});

test('mergeWithPaperTags: frontmatter + userTags 合并', () => {
  const r = mergeWithPaperTags(['task:rl'], [{ kind: 'task', label: 'reasoning' }]);
  assert.deepEqual(r, ['task:rl', 'user:task:reasoning']);
});

test('mergeWithPaperTags: frontmatter 内部去重', () => {
  const r = mergeWithPaperTags(['task:rl', 'task:rl'], []);
  assert.deepEqual(r, ['task:rl']);
});

test('mergeWithPaperTags: query:foo + task:foo 都进 task', () => {
  const r = mergeWithPaperTags(['query:foo', 'task:foo'], []);
  // ACC.task = ['foo', 'foo'] → flattenCategories 去重 → 1 条 'task:foo'
  assert.deepEqual(r, ['task:foo']);
});

test('mergeWithPaperTags: idx === 0 跳过 (无冒号)', () => {
  // ':lonely' idx=0 → if 分支跳过;else if (s) ACC.task.push(':lonely')
  // → flatten 后 'task::lonely'
  const r = mergeWithPaperTags([':lonely'], []);
  assert.deepEqual(r, ['task::lonely']);
});
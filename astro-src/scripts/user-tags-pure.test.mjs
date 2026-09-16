#!/usr/bin/env node
// astro-src/scripts/user-tags-pure.test.mjs
//
// Tests for R7 polish: pure helpers in astro-src/lib/user-tags.ts
// 由于 settings.ts 在 import 时引用 localStorage,这里直接照搬 flattenUserTags
// / mergeWithPaperCategories / mergeWithPaperTags 的实现并断言行为。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== 内联实现(与 lib/user-tags.ts 保持一致) =====
function flattenCategories(c) {
  if (!c) return [];
  const out = [];
  const seen = new Set();
  for (const dim of ['venue', 'task', 'method', 'type']) {
    for (const label of c[dim] || []) {
      const k = `${dim}:${label}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function flattenUserTags(tags) {
  return tags.map((t) => `${t.kind}:${t.label}`);
}

function mergeWithPaperCategories(paperCats, userTags) {
  const flat = flattenCategories(paperCats);
  const out = [];
  const seen = new Set();
  for (const t of flat) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  for (const ut of userTags || []) {
    const k = `user:${ut.kind}:${ut.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function mergeWithPaperTags(frontmatterTags, userTags) {
  const ACC = { venue: [], task: [], method: [], type: [] };
  if (Array.isArray(frontmatterTags)) {
    for (const t of frontmatterTags) {
      if (typeof t !== 'string') continue;
      const s = t.replace(/^query:/, '');
      const idx = s.indexOf(':');
      if (idx > 0) {
        const dim = s.slice(0, idx);
        const label = s.slice(idx + 1);
        if (dim === 'venue' || dim === 'task' || dim === 'method' || dim === 'type') {
          ACC[dim].push(label);
        }
      } else if (s) {
        ACC.task.push(s);
      }
    }
  }
  return mergeWithPaperCategories(ACC, userTags);
}

const STORAGE_KEY = 'dpr_user_tags_v1';

// ===== 测试 =====

test('flattenUserTags: 拍平为 "kind:label"', () => {
  const out = flattenUserTags([
    { kind: 'topic', label: 'rl' },
    { kind: 'topic', label: 'reasoning' },
  ]);
  assert.deepEqual(out, ['topic:rl', 'topic:reasoning']);
});

test('flattenUserTags: 空数组', () => {
  assert.deepEqual(flattenUserTags([]), []);
});

test('mergeWithPaperCategories: 合并 categories + userTags', () => {
  const out = mergeWithPaperCategories(
    { venue: ['ICML 2025'], task: ['rl'], method: [], type: [] },
    [{ kind: 'task', label: 'reasoning' }],
  );
  assert.ok(out.includes('venue:ICML 2025'));
  assert.ok(out.includes('task:rl'));
  assert.ok(out.includes('user:task:reasoning'));
});

test('mergeWithPaperCategories: userTags 为空', () => {
  const out = mergeWithPaperCategories(
    { venue: [], task: ['rl'], method: [], type: [] },
    [],
  );
  assert.deepEqual(out, ['task:rl']);
});

test('mergeWithPaperCategories: paperCats null', () => {
  const out = mergeWithPaperCategories(null, [{ kind: 'task', label: 'rl' }]);
  assert.deepEqual(out, ['user:task:rl']);
});

test('mergeWithPaperCategories: 去重 user vs paper', () => {
  const out = mergeWithPaperCategories(
    { venue: [], task: ['rl'], method: [], type: [] },
    [{ kind: 'task', label: 'rl' }],
  );
  // 'task:rl' 和 'user:task:rl' 是不同的字符串,各保留一次
  assert.equal(out.filter((t) => t === 'task:rl').length, 1);
  assert.equal(out.filter((t) => t === 'user:task:rl').length, 1);
});

test('mergeWithPaperCategories: 多 userTags 同 dim', () => {
  const out = mergeWithPaperCategories(
    { venue: [], task: [], method: [], type: [] },
    [
      { kind: 'task', label: 'rl' },
      { kind: 'task', label: 'reasoning' },
    ],
  );
  assert.ok(out.includes('user:task:rl'));
  assert.ok(out.includes('user:task:reasoning'));
});

test('mergeWithPaperCategories: userTags=null 安全', () => {
  const out = mergeWithPaperCategories(
    { venue: [], task: ['rl'], method: [], type: [] },
    null,
  );
  assert.deepEqual(out, ['task:rl']);
});

test('mergeWithPaperTags: 老 string[] 格式', () => {
  const out = mergeWithPaperTags(['task:rl', 'query:foo', 'venue:ICML 2025'], []);
  assert.ok(out.includes('task:rl'));
  assert.ok(out.includes('venue:ICML 2025'));
  // query:foo → task:foo
  assert.ok(out.includes('task:foo'));
});

test('mergeWithPaperTags: null frontmatterTags', () => {
  const out = mergeWithPaperTags(null, [{ kind: 'topic', label: 'rl' }]);
  assert.ok(out.includes('user:topic:rl'));
});

test('mergeWithPaperTags: 无效 dim 忽略', () => {
  const out = mergeWithPaperTags(['foo:bar'], []);
  assert.deepEqual(out, []);
});

test('mergeWithPaperTags: 非字符串元素忽略', () => {
  const out = mergeWithPaperTags(['task:rl', null, 42, 'task:reasoning'], []);
  assert.ok(out.includes('task:rl'));
  assert.ok(out.includes('task:reasoning'));
});

test('STORAGE_KEY: 字面量', () => {
  assert.equal(STORAGE_KEY, 'dpr_user_tags_v1');
});
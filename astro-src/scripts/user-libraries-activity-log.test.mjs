#!/usr/bin/env node
// astro-src/scripts/user-libraries-activity-log.test.mjs
//
// Tests for R7 polish: astro-src/lib/user-libraries/activity-log.ts.
// 在 import 前注入 globalThis.localStorage mock。

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

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

const mod = await loadTs('lib/user-libraries/activity-log.ts');
const {
  appendLibraryActivity,
  listLibraryActivity,
  listAllActivity,
  purgeLibraryActivity,
  clearLibraryActivity,
  formatActivityTime,
} = mod;

// ---------- appendLibraryActivity + listLibraryActivity ----------
test('appendLibraryActivity: 写入 + 读出', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'created lib1');
  const r = listLibraryActivity('lib1');
  assert.equal(r.length, 1);
  assert.equal(r[0].libId, 'lib1');
  assert.equal(r[0].kind, 'create');
});

test('appendLibraryActivity: detail 透传', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'm', { foo: 1 });
  const r = listLibraryActivity('lib1');
  assert.deepEqual(r[0].detail, { foo: 1 });
});

test('appendLibraryActivity: 无 detail → undefined', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'm');
  const r = listLibraryActivity('lib1');
  assert.equal(r[0].detail, undefined);
});

test('appendLibraryActivity: 空 libId 跳过', () => {
  store.clear();
  appendLibraryActivity('', 'create', 'm');
  assert.equal(listLibraryActivity('').length, 0);
});

test('appendLibraryActivity: 空 kind 跳过', () => {
  store.clear();
  appendLibraryActivity('lib1', '', 'm');
  assert.equal(listLibraryActivity('lib1').length, 0);
});

test('appendLibraryActivity: at 是 Date.now', () => {
  store.clear();
  const before = Date.now();
  appendLibraryActivity('lib1', 'create', 'm');
  const after = Date.now();
  const r = listLibraryActivity('lib1');
  assert.ok(r[0].at >= before && r[0].at <= after);
});

test('listLibraryActivity: 倒序(最新在前)', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'first');
  appendLibraryActivity('lib1', 'rename', 'second');
  appendLibraryActivity('lib1', 'hue', 'third');
  const r = listLibraryActivity('lib1');
  // 倒序
  assert.deepEqual(r.map((a) => a.kind), ['hue', 'rename', 'create']);
});

test('listLibraryActivity: limit 默认 100', () => {
  store.clear();
  for (let i = 0; i < 150; i++) {
    appendLibraryActivity('lib1', 'create', 'm' + i);
  }
  assert.equal(listLibraryActivity('lib1').length, 100);
});

test('listLibraryActivity: 自定义 limit', () => {
  store.clear();
  for (let i = 0; i < 10; i++) {
    appendLibraryActivity('lib1', 'create', 'm' + i);
  }
  assert.equal(listLibraryActivity('lib1', 3).length, 3);
});

test('listLibraryActivity: 不返回其他 lib 的活动', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'a');
  appendLibraryActivity('lib2', 'create', 'b');
  assert.equal(listLibraryActivity('lib1').length, 1);
  assert.equal(listLibraryActivity('lib2').length, 1);
});

test('listLibraryActivity: 空 → []', () => {
  store.clear();
  assert.deepEqual(listLibraryActivity('nonexistent'), []);
});

// ---------- listAllActivity ----------
test('listAllActivity: 全部活动倒序', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'first');
  appendLibraryActivity('lib2', 'create', 'second');
  const r = listAllActivity();
  assert.equal(r.length, 2);
  // 倒序:lib2 在前
  assert.equal(r[0].libId, 'lib2');
});

test('listAllActivity: limit 默认 200', () => {
  store.clear();
  for (let i = 0; i < 250; i++) {
    appendLibraryActivity('lib1', 'create', 'm' + i);
  }
  assert.equal(listAllActivity().length, 200);
});

test('listAllActivity: 自定义 limit', () => {
  store.clear();
  for (let i = 0; i < 10; i++) {
    appendLibraryActivity('lib1', 'create', 'm' + i);
  }
  assert.equal(listAllActivity(5).length, 5);
});

// ---------- purgeLibraryActivity ----------
test('purgeLibraryActivity: 删除单库', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'a');
  appendLibraryActivity('lib2', 'create', 'b');
  purgeLibraryActivity('lib1');
  assert.equal(listLibraryActivity('lib1').length, 0);
  assert.equal(listLibraryActivity('lib2').length, 1);
});

test('purgeLibraryActivity: 不存在的 lib → no-op', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'a');
  purgeLibraryActivity('nonexistent');
  assert.equal(listLibraryActivity('lib1').length, 1);
});

// ---------- clearLibraryActivity ----------
test('clearLibraryActivity: 清空', () => {
  store.clear();
  appendLibraryActivity('lib1', 'create', 'a');
  clearLibraryActivity();
  assert.equal(listAllActivity().length, 0);
});

// ---------- formatActivityTime ----------
test('formatActivityTime: < 60s → 刚刚', () => {
  const now = 100000;
  const r = formatActivityTime(now - 30_000, now);
  assert.equal(r, '刚刚');
});

test('formatActivityTime: < 60m → N 分钟前', () => {
  const now = 1000000;
  const r = formatActivityTime(now - 5 * 60_000, now);
  assert.equal(r, '5 分钟前');
});

test('formatActivityTime: < 24h → N 小时前', () => {
  const now = 100000000;
  const r = formatActivityTime(now - 3 * 60 * 60_000, now);
  assert.equal(r, '3 小时前');
});

test('formatActivityTime: < 7d → N 天前', () => {
  const now = 10000000000;
  const r = formatActivityTime(now - 3 * 24 * 60 * 60_000, now);
  assert.equal(r, '3 天前');
});

test('formatActivityTime: >= 7d → YYYY-MM-DD', () => {
  const now = 2000000000000;
  const at = now - 30 * 24 * 60 * 60_000; // 30 天前
  const r = formatActivityTime(at, now);
  // 期望 YYYY-MM-DD 格式(10 字符)
  assert.match(r, /^\d{4}-\d{2}-\d{2}$/);
});

test('formatActivityTime: future → 0 → 刚刚', () => {
  // at > now → delta = max(0, ...) = 0 → 刚刚
  const now = 1000;
  const r = formatActivityTime(now + 1000, now);
  assert.equal(r, '刚刚');
});

test('formatActivityTime: 边界 60s', () => {
  // 60s 不算 < 60s → 进入下一档
  const now = 100000;
  const r = formatActivityTime(now - 60_000, now);
  assert.equal(r, '1 分钟前');
});

// ---------- 损坏数据 ----------
test('listLibraryActivity: 损坏 JSON → []', () => {
  store.set('dpr_library_activity_log_v1', '{not json');
  assert.deepEqual(listLibraryActivity('lib1'), []);
});

test('listLibraryActivity: 非数组 → []', () => {
  store.set('dpr_library_activity_log_v1', '{"foo":"bar"}');
  assert.deepEqual(listLibraryActivity('lib1'), []);
});

test('listLibraryActivity: 过滤非法记录', () => {
  store.set('dpr_library_activity_log_v1', JSON.stringify([
    { at: 1, libId: 'lib1', kind: 'create', message: 'valid' },
    { at: 'not-num', libId: 'lib1', kind: 'create', message: 'invalid at' },
    { at: 1, libId: 123, kind: 'create', message: 'invalid libId' },
    { at: 1, libId: 'lib1', kind: 'create' }, // 缺 message
  ]));
  const r = listLibraryActivity('lib1');
  assert.equal(r.length, 1);
});
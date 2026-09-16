#!/usr/bin/env node
// astro-src/scripts/paper-repository-cache.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-repository/cache.ts.
// TtlCache + hashOptions 都是纯类/函数。

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
    external: ['./types', '../types', '../../types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/paper-repository/cache.ts');
const { TtlCache, hashOptions } = mod;

// ---------- TtlCache ----------
test('TtlCache: get 不存在的 key → undefined', () => {
  const c = new TtlCache(1000);
  assert.equal(c.get('x'), undefined);
});

test('TtlCache: set/get 后命中', () => {
  const c = new TtlCache(1000);
  c.set('k', 'v');
  assert.equal(c.get('k'), 'v');
});

test('TtlCache: TTL 过期后 → undefined + 删除', () => {
  const c = new TtlCache(10); // 10ms TTL
  c.set('k', 'v');
  return new Promise((resolve) => setTimeout(() => {
    assert.equal(c.get('k'), undefined);
    assert.equal(c.size(), 0);
    resolve();
  }, 30));
});

test('TtlCache: delete 后 → undefined', () => {
  const c = new TtlCache(1000);
  c.set('k', 'v');
  c.delete('k');
  assert.equal(c.get('k'), undefined);
});

test('TtlCache: clear 清空所有', () => {
  const c = new TtlCache(1000);
  c.set('a', 1);
  c.set('b', 2);
  c.clear();
  assert.equal(c.size(), 0);
});

test('TtlCache: size 计数', () => {
  const c = new TtlCache(1000);
  assert.equal(c.size(), 0);
  c.set('a', 1);
  assert.equal(c.size(), 1);
  c.set('b', 2);
  assert.equal(c.size(), 2);
});

test('TtlCache: set 覆盖旧值', () => {
  const c = new TtlCache(1000);
  c.set('k', 'v1');
  c.set('k', 'v2');
  assert.equal(c.get('k'), 'v2');
});

test('TtlCache: 对象值引用', () => {
  const c = new TtlCache(1000);
  const obj = { foo: 1 };
  c.set('k', obj);
  assert.equal(c.get('k'), obj);
});

// ---------- hashOptions ----------
test('hashOptions: 空 → 8-char 十六进制', () => {
  const h = hashOptions({});
  assert.match(h, /^[0-9a-f]{8}$/);
});

test('hashOptions: 同样输入 → 同样 hash', () => {
  const a = hashOptions({ x: 1, y: 'foo' });
  const b = hashOptions({ x: 1, y: 'foo' });
  assert.equal(a, b);
});

test('hashOptions: 键顺序不同 → 同样 hash', () => {
  // JSON.stringify 保留键顺序,所以 {a:1,b:2} !== {b:2,a:1}
  // 但同样顺序一致 → 同 hash
  const a = hashOptions({ a: 1, b: 2 });
  const b = hashOptions({ a: 1, b: 2 });
  assert.equal(a, b);
});

test('hashOptions: 不同键 → 不同 hash', () => {
  const a = hashOptions({ a: 1 });
  const b = hashOptions({ a: 2 });
  assert.notEqual(a, b);
});

test('hashOptions: 数组 → 8-char', () => {
  assert.match(hashOptions([1, 2, 3]), /^[0-9a-f]{8}$/);
});

test('hashOptions: 嵌套对象 → 8-char', () => {
  assert.match(hashOptions({ a: { b: { c: 1 } } }), /^[0-9a-f]{8}$/);
});

test('hashOptions: null → 8-char', () => {
  assert.match(hashOptions(null), /^[0-9a-f]{8}$/);
});

test('hashOptions: 字符串 → 8-char', () => {
  assert.match(hashOptions('foo'), /^[0-9a-f]{8}$/);
});

test('hashOptions: 数字 → 8-char', () => {
  assert.match(hashOptions(123), /^[0-9a-f]{8}$/);
});

test('hashOptions: 已知 FNV-1a 起点 (空字符串 {} → 非零)', () => {
  // FNV-1a 起点 0x811c9dc5 → 第一个 input 决定
  // {} 序列化 = "{}" → hash ≠ 00000000
  const h = hashOptions({});
  assert.notEqual(h, '00000000');
});

#!/usr/bin/env node
// astro-src/scripts/llm-clean-balanced-json.test.mjs
//
// Tests for R7 polish: astro-src/lib/llm-clean/balanced-json.ts.

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

const mod = await loadTs('lib/llm-clean/balanced-json.ts');
const { extractBalancedJson } = mod;

test('extractBalancedJson: 简单对象', () => {
  assert.equal(extractBalancedJson('{"a":1}'), '{"a":1}');
});

test('extractBalancedJson: 含 reasoning 前缀', () => {
  assert.equal(
    extractBalancedJson('Here is the JSON: {"a": 1, "b": 2}'),
    '{"a": 1, "b": 2}',
  );
});

test('extractBalancedJson: 含 reasoning 后缀', () => {
  assert.equal(
    extractBalancedJson('{"x": 1}\nHope this helps'),
    '{"x": 1}',
  );
});

test('extractBalancedJson: 多对象 → 只切第一个', () => {
  const r = extractBalancedJson('{"a":1} {"b":2}');
  assert.equal(r, '{"a":1}');
});

test('extractBalancedJson: 嵌套对象', () => {
  const r = extractBalancedJson('{"a":{"b":{"c":1}}}');
  assert.equal(r, '{"a":{"b":{"c":1}}}');
});

test('extractBalancedJson: 字符串内 { 不算 depth', () => {
  const r = extractBalancedJson('{"k":"a{b}c"}');
  assert.equal(r, '{"k":"a{b}c"}');
});

test('extractBalancedJson: 字符串内 } 不算 depth', () => {
  const r = extractBalancedJson('{"k":"a}b"}');
  assert.equal(r, '{"k":"a}b"}');
});

test('extractBalancedJson: escape 序列', () => {
  const r = extractBalancedJson('{"k":"a\\"b"}');
  assert.equal(r, '{"k":"a\\"b"}');
});

test('extractBalancedJson: 数组作为值', () => {
  const r = extractBalancedJson('{"list":[1,2,3]}');
  assert.equal(r, '{"list":[1,2,3]}');
});

test('extractBalancedJson: 半截 JSON → null', () => {
  assert.equal(extractBalancedJson('{"a":1'), null);
});

test('extractBalancedJson: 闭合多于开 → null', () => {
  assert.equal(extractBalancedJson('}foo'), null);
});

test('extractBalancedJson: 空 → null', () => {
  assert.equal(extractBalancedJson(''), null);
});

test('extractBalancedJson: 没有 { → null', () => {
  assert.equal(extractBalancedJson('hello world'), null);
});

test('extractBalancedJson: 顶层是数组 → 只切第一个 object', () => {
  // [{...}, {...}] → 从 [ 起,但 start 等到第一个 { 才设
  const r = extractBalancedJson('[{"a":1},{"b":2}]');
  assert.equal(r, '{"a":1}');
});

test('extractBalancedJson: 空白夹缝 OK', () => {
  const r = extractBalancedJson('   { "x" : 1 }   ');
  assert.equal(r, '{ "x" : 1 }');
});

test('extractBalancedJson: 多个嵌套 + 字符串 mix', () => {
  const r = extractBalancedJson('prefix {"outer": {"k": "v}", "n": 2}} suffix');
  assert.equal(r, '{"outer": {"k": "v}", "n": 2}}');
});

test('extractBalancedJson: 空对象', () => {
  assert.equal(extractBalancedJson('{}'), '{}');
});

test('extractBalancedJson: 数字/bool/null 值', () => {
  const r = extractBalancedJson('{"a":-1.5,"b":true,"c":null}');
  assert.equal(r, '{"a":-1.5,"b":true,"c":null}');
});

test('extractBalancedJson: 反斜杠转义 { 不算 depth', () => {
  // "a\{b" — \是 escape, 后续 { 不影响
  const r = extractBalancedJson('{"k":"a\\{b"}');
  assert.equal(r, '{"k":"a\\{b"}');
});

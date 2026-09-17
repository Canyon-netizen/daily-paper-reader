#!/usr/bin/env node
// astro-src/scripts/llm-clean-balanced-json.test.mjs
//
// Tests for R7 polish: astro-src/lib/llm-clean/balanced-json.ts.
// extractBalancedJson — 字符串括号配对提取。

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

const mod = await loadTs('lib/llm-clean/balanced-json.ts');
const { extractBalancedJson } = mod;

// ---------- 基本 ----------
test('extractBalancedJson: 简单 {}', () => {
  assert.equal(extractBalancedJson('{}'), '{}');
});

test('extractBalancedJson: {"k":1}', () => {
  assert.equal(extractBalancedJson('{"k":1}'), '{"k":1}');
});

test('extractBalancedJson: 空字符串 → null', () => {
  assert.equal(extractBalancedJson(''), null);
});

test('extractBalancedJson: 无 { → null', () => {
  assert.equal(extractBalancedJson('just text'), null);
});

// ---------- 配对 ----------
test('extractBalancedJson: 嵌套 {}', () => {
  const r = extractBalancedJson('{"a":{"b":2}}');
  assert.equal(r, '{"a":{"b":2}}');
});

test('extractBalancedJson: 多层嵌套', () => {
  const r = extractBalancedJson('{"a":{"b":{"c":{"d":1}}}}');
  assert.equal(r, '{"a":{"b":{"c":{"d":1}}}}');
});

test('extractBalancedJson: 多个顶层 → 取第一个', () => {
  const r = extractBalancedJson('{"a":1}{"b":2}');
  assert.equal(r, '{"a":1}');
});

test('extractBalancedJson: 顶层未闭 → null', () => {
  assert.equal(extractBalancedJson('{"k":1'), null);
});

test('extractBalancedJson: 嵌套闭合但顶层未闭 → null', () => {
  // '{{}}' 这种两个 { 一个 } → 仍 depth 1
  assert.equal(extractBalancedJson('{{}}'), '{{}}');
});

// ---------- 字符串边界 ----------
test('extractBalancedJson: 字符串内的 { 不算 depth', () => {
  const r = extractBalancedJson('{"k":"hello { world}"}');
  assert.equal(r, '{"k":"hello { world}"}');
});

test('extractBalancedJson: 字符串内的 } 不算 depth-1', () => {
  const r = extractBalancedJson('{"k":"a}b"}');
  assert.equal(r, '{"k":"a}b"}');
});

test('extractBalancedJson: 转义 \\\\"', () => {
  // '{"k":"a\\"b"}' 字符串内的 \" 是转义 → 不退出 string
  const r = extractBalancedJson('{"k":"a\\"b"}');
  assert.equal(r, '{"k":"a\\"b"}');
});

test('extractBalancedJson: 转义 \\\\', () => {
  // '\\\\' 表示字面 \
  const r = extractBalancedJson('{"k":"a\\\\"}');
  assert.equal(r, '{"k":"a\\\\"}');
});

// ---------- 周围文本 ----------
test('extractBalancedJson: 前缀文本', () => {
  const r = extractBalancedJson('reasoning before {"k":1}');
  assert.equal(r, '{"k":1}');
});

test('extractBalancedJson: 后缀文本', () => {
  const r = extractBalancedJson('{"k":1} and after');
  assert.equal(r, '{"k":1}');
});

test('extractBalancedJson: 前后缀都', () => {
  const r = extractBalancedJson('foo{"a":1}bar');
  assert.equal(r, '{"a":1}');
});

// ---------- 数组内嵌 ----------
test('extractBalancedJson: 数组 [{...}] → 取第一个 object', () => {
  // '[]' 第一个 { 之前有 '[',遇到 '{' 时 start=i,depth++=1
  // ']' 是无关字符;'}' 让 depth=0 → 返回 {...}
  const r = extractBalancedJson('[{"a":1},{"b":2}]');
  assert.equal(r, '{"a":1}');
});

// ---------- 边界 ----------
test('extractBalancedJson: 多余 } 在前', () => {
  // '}{"k":1}' 第一个 } 在 depth=0 时被跳过,遇到 { → start,depth=1
  // 第二个 } 让 depth=0 → 返回 {"k":1}
  const r = extractBalancedJson('}{"k":1}');
  assert.equal(r, '{"k":1}');
});

test('extractBalancedJson: 空格/换行', () => {
  const r = extractBalancedJson('  {\n  "k": 1\n}  ');
  assert.equal(r, '{\n  "k": 1\n}');
});

test('extractBalancedJson: 字符串内有换行', () => {
  const r = extractBalancedJson('{"k":"line1\\nline2"}');
  assert.equal(r, '{"k":"line1\\nline2"}');
});

// ---------- 转义序列 ----------
test('extractBalancedJson: \\\\n 在字符串内', () => {
  // '\\\\n' 实际是 "\\n" → 反斜杠 + n(不是真换行符,但 \ 后跟任何字符都 consume escape)
  const r = extractBalancedJson('{"k":"a\\nb"}');
  assert.equal(r, '{"k":"a\\nb"}');
});

test('extractBalancedJson: \\\\t 在字符串内', () => {
  const r = extractBalancedJson('{"k":"a\\tb"}');
  assert.equal(r, '{"k":"a\\tb"}');
});

test('extractBalancedJson: \\u 转义', () => {
  // \\u 后跟 4 位数字
  const r = extractBalancedJson('{"k":"\\u0041"}');
  assert.equal(r, '{"k":"\\u0041"}');
});
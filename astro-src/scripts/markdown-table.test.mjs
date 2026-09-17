#!/usr/bin/env node
// astro-src/scripts/markdown-table.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/table.ts.
// isTableRow + isAlignRow + renderTable — GFM table 渲染。

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

const mod = await loadTs('lib/markdown/table.ts');
const { isTableRow, isAlignRow, renderTable } = mod;

// ---------- isTableRow ----------
test('isTableRow: 标准行', () => {
  assert.equal(isTableRow('| a | b |'), true);
});

test('isTableRow: 前后空白', () => {
  assert.equal(isTableRow('  | a | b |  '), true);
});

test('isTableRow: 不以 | 结尾', () => {
  assert.equal(isTableRow('| a | b'), false);
});

test('isTableRow: 不以 | 开头', () => {
  assert.equal(isTableRow('a | b |'), false);
});

test('isTableRow: 无 |', () => {
  assert.equal(isTableRow('plain text'), false);
});

test('isTableRow: 空字符串', () => {
  assert.equal(isTableRow(''), false);
});

// ---------- isAlignRow ----------
test('isAlignRow: | --- | --- |', () => {
  assert.equal(isAlignRow('| --- | --- |'), true);
});

test('isAlignRow: | :---: | :--- |', () => {
  assert.equal(isAlignRow('| :---: | :--- |'), true);
});

test('isAlignRow: | ---: | ---: |', () => {
  assert.equal(isAlignRow('| ---: | ---: |'), true);
});

test('isAlignRow: 数据行 → false', () => {
  assert.equal(isAlignRow('| a | b |'), false);
});

test('isAlignRow: 仅 ---: 不算(需要整行结构)', () => {
  // '---' 单段无 | → 不匹配
  assert.equal(isAlignRow('---'), false);
});

test('isAlignRow: 多 dash', () => {
  assert.equal(isAlignRow('| ------ | ------ |'), true);
});

// ---------- renderTable: 基础 ----------
test('renderTable: 简单 2 列 1 行', () => {
  const r = renderTable('| A | B |', '| --- | --- |', ['| 1 | 2 |']);
  assert.match(r, /<table class="paper-md-table">/);
  assert.match(r, /<thead>/);
  assert.match(r, /<tbody>/);
  assert.match(r, /<th[^>]*>A<\/th>/);
  assert.match(r, /<th[^>]*>B<\/th>/);
  assert.match(r, /<td[^>]*>1<\/td>/);
  assert.match(r, /<td[^>]*>2<\/td>/);
});

test('renderTable: 多行数据', () => {
  const r = renderTable('| A |', '| --- |', ['| 1 |', '| 2 |', '| 3 |']);
  assert.match(r, /<td[^>]*>1<\/td>/);
  assert.match(r, /<td[^>]*>2<\/td>/);
  assert.match(r, /<td[^>]*>3<\/td>/);
});

test('renderTable: 无数据行', () => {
  const r = renderTable('| A | B |', '| --- | --- |', []);
  // 无 <tbody>...</tbody> 中 <tr>
  assert.match(r, /<tbody><\/tbody>/);
});

// ---------- align ----------
test('renderTable: 左对齐默认', () => {
  const r = renderTable('| A | B |', '| --- | --- |', ['| 1 | 2 |']);
  assert.match(r, /text-align:left/);
});

test('renderTable: 右对齐 ---:', () => {
  const r = renderTable('| A |', '| ---: |', ['| 1 |']);
  assert.match(r, /text-align:right/);
});

test('renderTable: 居中对齐 :---:', () => {
  const r = renderTable('| A |', '| :---: |', ['| 1 |']);
  assert.match(r, /text-align:center/);
});

test('renderTable: 混合 align', () => {
  const r = renderTable('| L | C | R |', '| :--- | :---: | ---: |', ['| 1 | 2 | 3 |']);
  assert.match(r, /text-align:left/);
  assert.match(r, /text-align:center/);
  assert.match(r, /text-align:right/);
});

test('renderTable: align 数 < 列数 → 默认 left', () => {
  // '| --- | --- |' 2 列 vs header 3 列 → 第 3 列默认 left
  const r = renderTable('| A | B | C |', '| --- | --- |', ['| 1 | 2 | 3 |']);
  // 第 3 列没 align spec → 'left'
  const matches = r.match(/text-align:left/g);
  assert.ok((matches?.length ?? 0) >= 1);
});

// ---------- renderInline 集成 ----------
test('renderTable: 单元格含 inline markdown', () => {
  const r = renderTable('| A |', '| --- |', ['| **bold** |']);
  // renderInline 处理 **bold** → <strong>
  assert.match(r, /<strong>bold<\/strong>/);
});

test('renderTable: 单元格 HTML 转义', () => {
  const r = renderTable('| A |', '| --- |', ['| <script> |']);
  assert.match(r, /&lt;script&gt;/);
  assert.doesNotMatch(r, /<script>/);
});

test('renderTable: 单元格含 $x$ 数学', () => {
  const r = renderTable('| A |', '| --- |', ['| $x$ |']);
  assert.match(r, /katex/);
});

// ---------- 边界 ----------
test('renderTable: 单元格 trim', () => {
  const r = renderTable('| A | B |', '| --- | --- |', ['| 1 | 2 |']);
  // header 单元格 'A' 'B' (trim 后) → 不含多余空白
  assert.match(r, />A<\/th>/);
  assert.match(r, />B<\/th>/);
});

test('renderTable: header 空 cell', () => {
  const r = renderTable('|  | A |', '| --- | --- |', ['| 1 | 2 |']);
  // 空 cell → '' th
  assert.match(r, /<th[^>]*><\/th>/);
});

test('renderTable: 数据空 cell', () => {
  const r = renderTable('| A | B |', '| --- | --- |', ['| 1 |  |']);
  assert.match(r, /<td[^>]*>1<\/td>/);
  assert.match(r, /<td[^>]*><\/td>/);
});
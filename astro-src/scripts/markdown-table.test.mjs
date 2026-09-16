#!/usr/bin/env node
// astro-src/scripts/markdown-table.test.mjs
//
// Tests for R7 polish: astro-src/lib/markdown/table.ts markdown table renderer.

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

const mod = await loadTs('lib/markdown/table.ts');
const { isTableRow, isAlignRow, renderTable } = mod;

test('isTableRow: 含首尾 | 的行', () => {
  assert.equal(isTableRow('| a | b |'), true);
  assert.equal(isTableRow('  | x | y |  '), true);
});

test('isTableRow: 不含 | 的行', () => {
  assert.equal(isTableRow('plain text'), false);
  assert.equal(isTableRow(''), false);
  assert.equal(isTableRow('| only left'), false);
});

test('isAlignRow: --- 分隔行', () => {
  assert.equal(isAlignRow('| --- | --- |'), true);
  assert.equal(isAlignRow('|---|---|'), true);
});

test('isAlignRow: :---: 居中', () => {
  assert.equal(isAlignRow('| :---: | :---: |'), true);
});

test('isAlignRow: :--- 左对齐', () => {
  assert.equal(isAlignRow('| :--- | --- |'), true);
});

test('isAlignRow: ---: 右对齐', () => {
  assert.equal(isAlignRow('| ---: | :--- |'), true);
});

test('isAlignRow: 普通文本行不是 align', () => {
  assert.equal(isAlignRow('not an align line'), false);
});

test('renderTable: 基本表头/对齐/数据', () => {
  const html = renderTable(
    '| Name | Score |',
    '| :--- | ---: |',
    ['| Alice | 90 |', '| Bob | 85 |'],
  );
  assert.ok(html.includes('<table class="paper-md-table">'));
  assert.ok(html.includes('<thead>'));
  assert.ok(html.includes('<tbody>'));
  assert.ok(html.includes('<th style="text-align:left">Name</th>'));
  assert.ok(html.includes('<th style="text-align:right">Score</th>'));
  assert.ok(html.includes('<td style="text-align:right">90</td>'));
  assert.ok(html.includes('<td style="text-align:left">Alice</td>'));
});

test('renderTable: 居中对齐', () => {
  const html = renderTable(
    '| A | B |',
    '| :---: | :---: |',
    ['| 1 | 2 |'],
  );
  assert.ok(html.includes('text-align:center'));
});

test('renderTable: 多行数据', () => {
  const html = renderTable(
    '| Col1 | Col2 |',
    '| --- | --- |',
    ['| a1 | a2 |', '| b1 | b2 |', '| c1 | c2 |'],
  );
  const trMatches = html.match(/<tr>/g) || [];
  // 1 表头 + 3 数据 = 4 行
  assert.equal(trMatches.length, 4);
});

test('renderTable: 列数少于对齐时默认 left', () => {
  const html = renderTable(
    '| A | B | C |',
    '| --- | --- |', // 仅 2 个对齐
    ['| x | y | z |'], // 3 列
  );
  // 缺的列默认左对齐
  assert.ok(html.includes('text-align:left'));
});

test('renderTable: 行内 markdown 在 cell 内渲染', () => {
  const html = renderTable(
    '| Header |',
    '| --- |',
    ['| **bold** text |'],
  );
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('renderTable: 空 dataLines → 只有 thead', () => {
  const html = renderTable(
    '| A | B |',
    '| --- | --- |',
    [],
  );
  assert.ok(html.includes('<thead>'));
  assert.ok(html.includes('<tbody></tbody>'));
});

test('renderTable: 完整 HTML 闭合', () => {
  const html = renderTable(
    '| A |',
    '| --- |',
    ['| 1 |'],
  );
  assert.ok(html.startsWith('<table'));
  assert.ok(html.endsWith('</table>'));
});

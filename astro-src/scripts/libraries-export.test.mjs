#!/usr/bin/env node
// astro-src/scripts/libraries-export.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/export.ts.
// libraryToJson / libraryToJsonString / parseLibraryExport。

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

const mod = await loadTs('lib/libraries/export.ts');
const { libraryToJson, libraryToJsonString, parseLibraryExport } = mod;

const mkLib = (overrides) => ({
  id: 'lib1',
  name: 'Test Library',
  description: 'desc',
  tags: ['a', 'b'],
  paperCount: 10,
  ...overrides,
});

// ---------- libraryToJson ----------
test('libraryToJson: 含 schemaVersion', () => {
  const r = libraryToJson(mkLib());
  assert.equal(r.schemaVersion, '1.0.0');
});

test('libraryToJson: exportedAt 是 ISO', () => {
  const r = libraryToJson(mkLib());
  assert.match(r.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('libraryToJson: library 字段透传', () => {
  const lib = mkLib({ name: 'Special', paperCount: 42 });
  const r = libraryToJson(lib);
  assert.equal(r.library.id, 'lib1');
  assert.equal(r.library.name, 'Special');
  assert.equal(r.library.paperCount, 42);
});

test('libraryToJson: 不修改原 library', () => {
  const orig = mkLib();
  libraryToJson(orig);
  assert.deepEqual(orig.name, 'Test Library');
});

// ---------- libraryToJsonString ----------
test('libraryToJsonString: 默认 pretty 缩进 2', () => {
  const s = libraryToJsonString(mkLib());
  assert.match(s, /\n  "schemaVersion"/);
});

test('libraryToJsonString: pretty=false 无缩进', () => {
  const s = libraryToJsonString(mkLib(), false);
  assert.ok(!s.includes('\n'));
});

test('libraryToJsonString: 含完整结构', () => {
  const s = libraryToJsonString(mkLib());
  const parsed = JSON.parse(s);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.library.name, 'Test Library');
});

test('libraryToJsonString: 中文字段', () => {
  const s = libraryToJsonString(mkLib({ name: '测试' }));
  // JSON 应该正确处理 unicode
  assert.match(s, /测试/);
});

// ---------- parseLibraryExport ----------
test('parseLibraryExport: 合法 JSON → library', () => {
  const s = libraryToJsonString(mkLib({ name: 'RoundTrip' }));
  const r = parseLibraryExport(s);
  assert.notEqual(r, null);
  assert.equal(r.name, 'RoundTrip');
});

test('parseLibraryExport: 缺 schemaVersion → null', () => {
  const r = parseLibraryExport(JSON.stringify({
    exportedAt: '2026-01-01',
    library: { id: 'x' },
  }));
  assert.equal(r, null);
});

test('parseLibraryExport: 缺 exportedAt → null', () => {
  const r = parseLibraryExport(JSON.stringify({
    schemaVersion: '1.0',
    library: { id: 'x' },
  }));
  assert.equal(r, null);
});

test('parseLibraryExport: 缺 library → null', () => {
  const r = parseLibraryExport(JSON.stringify({
    schemaVersion: '1.0',
    exportedAt: '2026-01-01',
  }));
  assert.equal(r, null);
});

test('parseLibraryExport: 无效 JSON → null', () => {
  assert.equal(parseLibraryExport('not json'), null);
});

test('parseLibraryExport: 空字符串 → null', () => {
  assert.equal(parseLibraryExport(''), null);
});

test('parseLibraryExport: array → null (不是 object)', () => {
  assert.equal(parseLibraryExport('[]'), null);
});

// ---------- round-trip ----------
test('round-trip: libraryToJson → JSON → parseLibraryExport', () => {
  const orig = mkLib({ name: 'Round', tags: ['x', 'y'], paperCount: 5 });
  const s = libraryToJsonString(orig);
  const back = parseLibraryExport(s);
  assert.notEqual(back, null);
  assert.equal(back.id, orig.id);
  assert.equal(back.name, orig.name);
  assert.deepEqual(back.tags, orig.tags);
});

test('round-trip: 保留所有字段', () => {
  const orig = {
    id: '1',
    name: 'X',
    description: 'desc',
    tags: ['a'],
    paperCount: 100,
    customField: 'custom', // 任意额外字段
  };
  const s = libraryToJsonString(orig);
  const back = parseLibraryExport(s);
  assert.equal(back.customField, 'custom');
});

// ---------- exportedAt 时间戳 ---
test('libraryToJson: 多次调用 exportedAt 不同', async () => {
  const a = libraryToJson(mkLib()).exportedAt;
  await new Promise((r) => setTimeout(r, 5));
  const b = libraryToJson(mkLib()).exportedAt;
  assert.notEqual(a, b);
});
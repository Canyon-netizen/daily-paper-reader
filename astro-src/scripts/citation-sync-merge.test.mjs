#!/usr/bin/env node
// astro-src/scripts/citation-sync-merge.test.mjs
//
// Tests for R7 WP.3: mergeCitedPapers.

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
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/writing/citation-sync.ts');
const { mergeCitedPapers } = mod;

test('mergeCitedPapers: 全部新增', () => {
  const result = mergeCitedPapers([], ['2501.00001', '2501.00002']);
  assert.deepEqual(result.added, ['2501.00001', '2501.00002']);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.merged, ['2501.00001', '2501.00002']);
});

test('mergeCitedPapers: 全部删除', () => {
  const result = mergeCitedPapers(['2501.00001', '2501.00002'], []);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, ['2501.00001', '2501.00002']);
  // merged = newRefs (empty means remove all)
  assert.deepEqual(result.merged, []);
});

test('mergeCitedPapers: 混合变化', () => {
  const result = mergeCitedPapers(
    ['2501.00001', '2501.00002', '2501.00003'],
    ['2501.00002', '2501.00003', '2501.00004'],
  );
  assert.deepEqual(result.added, ['2501.00004']);
  assert.deepEqual(result.removed, ['2501.00001']);
  // merged = newRefs
  assert.deepEqual(result.merged, ['2501.00002', '2501.00003', '2501.00004']);
});

test('mergeCitedPapers: 版本号去重', () => {
  const result = mergeCitedPapers(
    ['2501.00001v2'],
    ['2501.00001v3', '2501.00002'],
  );
  assert.deepEqual(result.added, ['2501.00002']);
  assert.deepEqual(result.removed, []);
  // merged = newRefs
  assert.deepEqual(result.merged, ['2501.00001v3', '2501.00002']);
});

test('mergeCitedPapers: 空输入', () => {
  const result = mergeCitedPapers([], []);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.merged, []);
});

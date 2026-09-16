#!/usr/bin/env node
// astro-src/scripts/citation-sync.test.mjs
//
// Tests for R7 E.3.5: citation sync.

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

// Mock localStorage for Node environment
const mockStorage = new Map();
const mockLocalStorage = {
  getItem: (key) => mockStorage.get(key) ?? null,
  setItem: (key, value) => mockStorage.set(key, value),
  removeItem: (key) => mockStorage.delete(key),
};
globalThis.localStorage = mockLocalStorage;

const mod = await loadTs('lib/writing/citation-sync.ts');
const {
  syncWritingCitedPapers,
  findOrphanCitations,
  extractAllCitedArxivIds,
  getStoredCitedPapers,
  clearCitedPapers,
} = mod;

test('extractAllCitedArxivIds: 从 sections 提取引用', () => {
  const sections = [
    { content: 'According to [arXiv:2506.12345], this method works.' },
    { content: 'Prior work (arXiv:2506.67890) shows similar results.' },
  ];
  const ids = extractAllCitedArxivIds(sections);
  assert.ok(ids.includes('2506.12345'));
  assert.ok(ids.includes('2506.67890'));
  assert.equal(ids.length, 2);
});

test('extractAllCitedArxivIds: 去除版本号', () => {
  const sections = [
    { content: 'See arXiv:2506.11111v2 for details.' },
  ];
  const ids = extractAllCitedArxivIds(sections);
  assert.ok(ids.includes('2506.11111'));
  assert.ok(!ids.includes('2506.11111v2'));
});

test('syncWritingCitedPapers: 新增引用', () => {
  const sections = [
    { content: 'Based on [arXiv:2506.12345].' },
  ];
  const result = syncWritingCitedPapers('w001', [], { sections });
  assert.equal(result.added.length, 1);
  assert.ok(result.added.includes('2506.12345'));
  assert.equal(result.kept.length, 0);
  assert.equal(result.removed.length, 0);
});

test('syncWritingCitedPapers: 保留已有引用', () => {
  const sections = [
    { content: 'According to [arXiv:2506.12345].' },
  ];
  const result = syncWritingCitedPapers('w002', ['2506.12345'], { sections });
  assert.equal(result.added.length, 0);
  assert.equal(result.kept.length, 1);
  assert.ok(result.kept.includes('2506.12345'));
});

test('syncWritingCitedPapers: 检测移除的引用', () => {
  const sections = [
    { content: 'No citations here.' },
  ];
  const result = syncWritingCitedPapers('w003', ['2506.12345', '2506.67890'], { sections });
  assert.equal(result.added.length, 0);
  assert.equal(result.kept.length, 0);
  assert.equal(result.removed.length, 2);
});

test('syncWritingCitedPapers: dryRun 不写入存储', () => {
  const sections = [
    { content: 'arXiv:2506.12345 is cited.' },
  ];
  syncWritingCitedPapers('w004', [], { sections, dryRun: true });
  const stored = getStoredCitedPapers('w004');
  assert.equal(stored.length, 0);
});

test('syncWritingCitedPapers: 非 dryRun 写入存储', () => {
  clearCitedPapers('w005');
  const sections = [
    { content: 'arXiv:2506.12345 is cited.' },
  ];
  syncWritingCitedPapers('w005', [], { sections, dryRun: false });
  const stored = getStoredCitedPapers('w005');
  assert.equal(stored.length, 1);
  assert.ok(stored.includes('2506.12345'));
});

test('findOrphanCitations: 查找孤立引用', () => {
  clearCitedPapers('w006');
  // 先写入一些引用
  const sections = [
    { content: 'arXiv:2506.12345 and arXiv:2506.67890.' },
  ];
  syncWritingCitedPapers('w006', [], { sections, dryRun: false });

  // knownPapers 只有第一个
  const orphans = findOrphanCitations('w006', [{ arxivId: '2506.12345' }]);
  assert.equal(orphans.length, 1);
  assert.ok(orphans.includes('2506.67890'));
});

test('findOrphanCitations: 无存储记录返回空', () => {
  clearCitedPapers('w007');
  const orphans = findOrphanCitations('w007', []);
  assert.equal(orphans.length, 0);
});

test('syncWritingCitedPapers: 多个 sections 合并去重', () => {
  const sections = [
    { content: 'arXiv:2506.12345 appears.' },
    { content: 'arXiv:2506.12345 appears again.' },
    { content: 'arXiv:2506.67890 also.' },
  ];
  const result = syncWritingCitedPapers('w008', [], { sections });
  assert.equal(result.added.length, 2);
});

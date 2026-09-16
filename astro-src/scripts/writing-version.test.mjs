#!/usr/bin/env node
// astro-src/scripts/writing-version.test.mjs
//
// Tests for R7 E.3.4: draft versioning.

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

const mod = await loadTs('lib/writing/version.ts');
const {
  bindDraftToGit,
  getVersionHistory,
  compareVersions,
  clearVersionHistory,
  getAllWritingIds,
} = mod;

test('bindDraftToGit: 创建版本记录', () => {
  const v = bindDraftToGit('w001', { wordCount: 1000, message: 'First draft' });
  assert.ok(v.commitSha);
  assert.equal(v.message, 'First draft');
  assert.equal(v.wordCount, 1000);
  assert.ok(v.savedAt > 0);
});

test('bindDraftToGit: 使用指定的 commitSha', () => {
  const v = bindDraftToGit('w002', { wordCount: 500, commitSha: 'abc1234' });
  assert.equal(v.commitSha, 'abc1234');
});

test('bindDraftToGit: 未给 commitSha 时生成 fallback hash', () => {
  const v = bindDraftToGit('w003', { wordCount: 300 });
  assert.ok(v.commitSha);
  assert.equal(v.commitSha.length, 7);
});

test('getVersionHistory: 读取版本历史', () => {
  clearVersionHistory('w004');
  bindDraftToGit('w004', { wordCount: 100 });
  bindDraftToGit('w004', { wordCount: 200 });
  const history = getVersionHistory('w004');
  assert.equal(history.length, 2);
  assert.equal(history[0].wordCount, 200); // newest first
  assert.equal(history[1].wordCount, 100);
});

test('getVersionHistory: 不存在的 writing 返回空数组', () => {
  const history = getVersionHistory('nonexistent-id');
  assert.equal(Array.isArray(history), true);
  assert.equal(history.length, 0);
});

test('compareVersions: 计算 wordDelta 和 timeDeltaMs', () => {
  const a = { commitSha: 'a1', message: 'v1', savedAt: 1000, wordCount: 500 };
  const b = { commitSha: 'b2', message: 'v2', savedAt: 2000, wordCount: 800 };
  const diff = compareVersions(a, b);
  assert.equal(diff.wordDelta, 300);
  assert.equal(diff.timeDeltaMs, 1000);
});

test('compareVersions: linesAdded / linesRemoved 基于字数估算', () => {
  const a = { commitSha: 'a1', message: 'v1', savedAt: 1000, wordCount: 500 };
  const b = { commitSha: 'b2', message: 'v2', savedAt: 2000, wordCount: 200 };
  const diff = compareVersions(a, b);
  assert.equal(diff.wordDelta, -300);
  assert.ok(diff.linesRemoved > 0);
  assert.equal(diff.linesAdded, 0);
});

test('clearVersionHistory: 删除版本历史', () => {
  clearVersionHistory('w005');
  bindDraftToGit('w005', { wordCount: 100 });
  clearVersionHistory('w005');
  const history = getVersionHistory('w005');
  assert.equal(history.length, 0);
});

test('getAllWritingIds: 返回所有有版本的 writingId', () => {
  clearVersionHistory('w006');
  clearVersionHistory('w007');
  bindDraftToGit('w006', { wordCount: 100 });
  bindDraftToGit('w007', { wordCount: 200 });
  const ids = getAllWritingIds();
  assert.ok(ids.includes('w006'));
  assert.ok(ids.includes('w007'));
});

test('bindDraftToGit: 支持 author 字段', () => {
  const v = bindDraftToGit('w008', { wordCount: 150, author: 'Zhou Rui' });
  assert.equal(v.author, 'Zhou Rui');
});

test('版本历史按时间倒序(最新在前)', () => {
  clearVersionHistory('w009');
  bindDraftToGit('w009', { wordCount: 100, updatedAt: 1000 });
  bindDraftToGit('w009', { wordCount: 200, updatedAt: 2000 });
  bindDraftToGit('w009', { wordCount: 150, updatedAt: 1500 });
  const history = getVersionHistory('w009');
  assert.equal(history[0].savedAt, 2000);
  assert.equal(history[1].savedAt, 1500);
  assert.equal(history[2].savedAt, 1000);
});

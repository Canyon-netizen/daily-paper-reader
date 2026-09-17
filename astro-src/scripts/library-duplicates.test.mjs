#!/usr/bin/env node
// astro-src/scripts/library-duplicates.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-duplicates.ts.
// toFileRef + findVersionClusters + findCrossIdTitleDupes + findDuplicateGroups + duplicateStats.

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

const mod = await loadTs('lib/library-duplicates.ts');
const {
  toFileRef,
  findVersionClusters,
  findCrossIdTitleDupes,
  findDuplicateGroups,
  duplicateStats,
} = mod;

const mkPaper = (overrides) => ({
  id: 'papers/2310.12345.md',
  arxivId: '2310.12345',
  canonicalArxivId: '2310.12345',
  title: 'Some title',
  title_plain: 'Some title plain',
  date: '2026-09-10',
  wikiContent: '',
  ...overrides,
});

const mkRef = (overrides) => ({
  relPath: 'papers/2310.12345.md',
  arxivId: '2310.12345',
  canonicalId: '2310.12345',
  version: 1,
  title: 'Some title',
  date: '2026-09-10',
  hasWiki: false,
  ...overrides,
});

// ---------- toFileRef ----------
test('toFileRef: 基本字段映射', () => {
  const r = toFileRef(mkPaper());
  assert.equal(r.relPath, 'papers/2310.12345.md');
  assert.equal(r.arxivId, '2310.12345');
  assert.equal(r.canonicalId, '2310.12345');
  assert.equal(r.title, 'Some title plain');
  assert.equal(r.date, '2026-09-10');
  assert.equal(r.hasWiki, false);
});

test('toFileRef: 无 title_plain → 用 title', () => {
  const r = toFileRef(mkPaper({ title_plain: undefined }));
  assert.equal(r.title, 'Some title');
});

test('toFileRef: 无 title_plain 且无 title → 空', () => {
  const r = toFileRef(mkPaper({ title_plain: undefined, title: undefined }));
  assert.equal(r.title, '');
});

test('toFileRef: 无 date → 空', () => {
  const r = toFileRef(mkPaper({ date: undefined }));
  assert.equal(r.date, '');
});

test('toFileRef: 有 wikiContent → hasWiki=true', () => {
  const r = toFileRef(mkPaper({ wikiContent: 'some content' }));
  assert.equal(r.hasWiki, true);
});

test('toFileRef: version 从 arxivId 解析', () => {
  const r = toFileRef(mkPaper({ arxivId: '2310.12345v3' }));
  assert.equal(r.version, 3);
});

// ---------- findVersionClusters ----------
test('findVersionClusters: 空数组', () => {
  assert.deepEqual(findVersionClusters([]), []);
});

test('findVersionClusters: 单 paper (无重复)', () => {
  const r = findVersionClusters([mkRef()]);
  assert.deepEqual(r, []);
});

test('findVersionClusters: 2 个版本同 canonicalId', () => {
  const r = findVersionClusters([
    mkRef({ relPath: 'a.md', arxivId: '2310.12345v1', version: 1 }),
    mkRef({ relPath: 'b.md', arxivId: '2310.12345v2', version: 2 }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'version-cluster');
  assert.equal(r[0].groupKey, '2310.12345');
  assert.equal(r[0].files.length, 2);
});

test('findVersionClusters: 按版本号降序 (newest first)', () => {
  const r = findVersionClusters([
    mkRef({ relPath: 'a.md', arxivId: '2310.12345v1', version: 1 }),
    mkRef({ relPath: 'b.md', arxivId: '2310.12345v3', version: 3 }),
    mkRef({ relPath: 'c.md', arxivId: '2310.12345v2', version: 2 }),
  ]);
  assert.equal(r[0].files[0].version, 3);
  assert.equal(r[0].files[1].version, 2);
  assert.equal(r[0].files[2].version, 1);
});

test('findVersionClusters: 多组按文件数降序', () => {
  const r = findVersionClusters([
    mkRef({ relPath: 'a.md', arxivId: '2310.11111v1', canonicalId: '2310.11111', version: 1 }),
    mkRef({ relPath: 'b.md', arxivId: '2310.11111v2', canonicalId: '2310.11111', version: 2 }),
    mkRef({ relPath: 'c.md', arxivId: '2310.22222v1', canonicalId: '2310.22222', version: 1 }),
  ]);
  assert.equal(r.length, 1); // 22222 只有 1 → 不算
  assert.equal(r[0].files.length, 2);
});

test('findVersionClusters: 无 canonicalId 跳过', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: '' }),
    mkRef({ canonicalId: '' }),
  ]);
  assert.deepEqual(r, []);
});

// ---------- findCrossIdTitleDupes ----------
test('findCrossIdTitleDupes: 短标题 (<30) 不参与比较', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title: 'short' }),
    mkRef({ canonicalId: '2310.22222', title: 'short' }),
  ]);
  assert.deepEqual(r, []);
});

test('findCrossIdTitleDupes: 不同 canonicalId + 同长标题', () => {
  const title = 'a long title about transformers and attention mechanisms';
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title }),
    mkRef({ canonicalId: '2310.22222', title }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'cross-id-similar-title');
  assert.equal(r[0].files.length, 2);
});

test('findCrossIdTitleDupes: 同 canonicalId 不算跨 ID 重复', () => {
  const title = 'a long title about transformers and attention mechanisms';
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title }),
    mkRef({ canonicalId: '2310.11111', title }),
  ]);
  assert.deepEqual(r, []);
});

test('findCrossIdTitleDupes: 标题归一化 (标点/空格忽略)', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title: 'A Long Title About Transformers and Attention Mechanisms' }),
    mkRef({ canonicalId: '2310.22222', title: 'A  long  title about transformers and attention mechanisms!' }),
  ]);
  // 归一化后两者都是 "alongtitleabouttransformersandattentionmechanisms" (39 字符) ≥ 30
  assert.equal(r.length, 1);
  assert.equal(r[0].files.length, 2);
});

test('findCrossIdTitleDupes: 大小写不敏感', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title: 'A LONG TITLE ABOUT TRANSFORMERS AND ATTENTION MECHANISMS' }),
    mkRef({ canonicalId: '2310.22222', title: 'a long title about transformers and attention mechanisms' }),
  ]);
  assert.equal(r.length, 1);
});

test('findCrossIdTitleDupes: 中文标题不算 (<30 字母数字)', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title: '机器学习' }),
    mkRef({ canonicalId: '2310.22222', title: '机器学习' }),
  ]);
  // normalizeTitle 把中文全过滤掉 → 归一化后 ''
  assert.deepEqual(r, []);
});

test('findCrossIdTitleDupes: 按文件数降序排', () => {
  const longTitle = 'a long title about transformers and attention mechanisms and more';
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title: longTitle }),
    mkRef({ canonicalId: '2310.22222', title: longTitle }),
    mkRef({ canonicalId: '2310.33333', title: longTitle }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].files.length, 3);
});

test('findCrossIdTitleDupes: groupKey 是归一化标题', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: '2310.11111', title: 'A Long Title About Transformers and Attention Mechanisms' }),
    mkRef({ canonicalId: '2310.22222', title: 'a long title about transformers and attention mechanisms' }),
  ]);
  assert.equal(r[0].groupKey, 'alongtitleabouttransformersandattentionmechanisms');
});

// ---------- findDuplicateGroups ----------
test('findDuplicateGroups: 综合 — version + cross-id', () => {
  const longTitle = 'a long title about transformers and attention mechanisms';
  const r = findDuplicateGroups([
    mkPaper({ id: 'a.md', arxivId: '2310.11111v1', canonicalArxivId: '2310.11111', title: 'foo', title_plain: 'foo' }),
    mkPaper({ id: 'b.md', arxivId: '2310.11111v2', canonicalArxivId: '2310.11111', title: 'foo', title_plain: 'foo' }),
    mkPaper({ id: 'c.md', arxivId: '2310.22222', canonicalArxivId: '2310.22222', title: longTitle, title_plain: longTitle }),
    mkPaper({ id: 'd.md', arxivId: '2310.33333', canonicalArxivId: '2310.33333', title: longTitle, title_plain: longTitle }),
  ]);
  // 1 version-cluster + 1 cross-id → 2 groups
  assert.equal(r.length, 2);
});

test('findDuplicateGroups: 全空', () => {
  assert.deepEqual(findDuplicateGroups([]), []);
});

test('findDuplicateGroups: 按文件数降序', () => {
  const longTitle = 'a long title about transformers and attention mechanisms';
  const r = findDuplicateGroups([
    mkPaper({ id: 'a.md', arxivId: '2310.11111v1', canonicalArxivId: '2310.11111', title: longTitle, title_plain: longTitle }),
    mkPaper({ id: 'b.md', arxivId: '2310.22222', canonicalArxivId: '2310.22222', title: longTitle, title_plain: longTitle }),
    mkPaper({ id: 'c.md', arxivId: '2310.33333', canonicalArxivId: '2310.33333', title: longTitle, title_plain: longTitle }),
    mkPaper({ id: 'd.md', arxivId: '2310.44444v1', canonicalArxivId: '2310.44444', title: 'foo', title_plain: 'foo' }),
    mkPaper({ id: 'e.md', arxivId: '2310.44444v2', canonicalArxivId: '2310.44444', title: 'foo', title_plain: 'foo' }),
  ]);
  // cross-id 3 文件 > version-cluster 2 文件
  assert.equal(r[0].reason, 'cross-id-similar-title');
  assert.equal(r[0].files.length, 3);
  assert.equal(r[1].reason, 'version-cluster');
  assert.equal(r[1].files.length, 2);
});

// ---------- duplicateStats ----------
test('duplicateStats: 空 → 全 0', () => {
  assert.deepEqual(duplicateStats([]), { versionCluster: 0, crossIdTitle: 0 });
});

test('duplicateStats: 混合', () => {
  assert.deepEqual(
    duplicateStats([
      { groupKey: 'g1', reason: 'version-cluster', files: [] },
      { groupKey: 'g2', reason: 'version-cluster', files: [] },
      { groupKey: 'g3', reason: 'cross-id-similar-title', files: [] },
    ]),
    { versionCluster: 2, crossIdTitle: 1 },
  );
});

test('duplicateStats: 全 version-cluster', () => {
  assert.deepEqual(
    duplicateStats([
      { groupKey: 'g1', reason: 'version-cluster', files: [] },
    ]),
    { versionCluster: 1, crossIdTitle: 0 },
  );
});

test('duplicateStats: 全 cross-id-similar-title', () => {
  assert.deepEqual(
    duplicateStats([
      { groupKey: 'g1', reason: 'cross-id-similar-title', files: [] },
    ]),
    { versionCluster: 0, crossIdTitle: 1 },
  );
});
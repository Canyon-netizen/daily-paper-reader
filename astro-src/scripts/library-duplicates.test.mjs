#!/usr/bin/env node
// astro-src/scripts/library-duplicates.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-duplicates.ts paper dedup groups.

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

const mod = await loadTs('lib/library-duplicates.ts');
const {
  toFileRef,
  findVersionClusters,
  findCrossIdTitleDupes,
  findDuplicateGroups,
  duplicateStats,
} = mod;

function paper(over) {
  return {
    id: 'papers/x.md',
    slug: 'x',
    title: 'Sample',
    title_plain: 'Sample',
    date: '2025-01-01',
    yearMonth: '2025-01',
    day: '01',
    wikiContent: null,
    ...over,
  };
}

test('toFileRef: 抽取必要字段', () => {
  const ref = toFileRef(
    paper({
      id: 'papers/a.md',
      arxivId: '2501.00001v1',
      canonicalArxivId: '2501.00001',
      title_plain: 'My paper',
      wikiContent: '<div>wiki</div>',
    }),
  );
  assert.equal(ref.relPath, 'papers/a.md');
  assert.equal(ref.arxivId, '2501.00001v1');
  assert.equal(ref.canonicalId, '2501.00001');
  assert.equal(ref.version, 1);
  assert.equal(ref.title, 'My paper');
  assert.equal(ref.hasWiki, true);
});

test('toFileRef: 无 wikiContent → hasWiki=false', () => {
  const ref = toFileRef(paper({ wikiContent: null }));
  assert.equal(ref.hasWiki, false);
});

test('findVersionClusters: 同一 canonicalId 多版本 → 1 组', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: 'T', date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00001v2', canonicalId: '2501.00001', version: 2, title: 'T', date: '', hasWiki: false },
    { relPath: 'c.md', arxivId: '2501.00001v3', canonicalId: '2501.00001', version: 3, title: 'T', date: '', hasWiki: false },
  ];
  const groups = findVersionClusters(refs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'version-cluster');
  assert.equal(groups[0].files.length, 3);
  // 最新版本在前
  assert.equal(groups[0].files[0].version, 3);
});

test('findVersionClusters: 单文件 → 不算组', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: 'T', date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00002v1', canonicalId: '2501.00002', version: 1, title: 'T', date: '', hasWiki: false },
  ];
  const groups = findVersionClusters(refs);
  assert.equal(groups.length, 0);
});

test('findVersionClusters: 不同 canonicalId 不聚类', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: 'T1', date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00002v1', canonicalId: '2501.00002', version: 1, title: 'T2', date: '', hasWiki: false },
  ];
  const groups = findVersionClusters(refs);
  assert.equal(groups.length, 0);
});

test('findVersionClusters: 空 canonicalId 跳过', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '', canonicalId: '', version: 1, title: 'T', date: '', hasWiki: false },
  ];
  const groups = findVersionClusters(refs);
  assert.equal(groups.length, 0);
});

test('findVersionClusters: 多组按文件数降序', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: 'T', date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00001v2', canonicalId: '2501.00001', version: 2, title: 'T', date: '', hasWiki: false },
    { relPath: 'c.md', arxivId: '2501.00001v3', canonicalId: '2501.00001', version: 3, title: 'T', date: '', hasWiki: false },
    { relPath: 'd.md', arxivId: '2501.00002v1', canonicalId: '2501.00002', version: 1, title: 'T', date: '', hasWiki: false },
    { relPath: 'e.md', arxivId: '2501.00002v2', canonicalId: '2501.00002', version: 2, title: 'T', date: '', hasWiki: false },
  ];
  const groups = findVersionClusters(refs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].files.length, 3); // 2501.00001
  assert.equal(groups[1].files.length, 2); // 2501.00002
});

test('findCrossIdTitleDupes: 不同 ID 同标题 → 1 组', () => {
  const longTitle = 'A long enough title that exceeds thirty characters for sure okay';
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: longTitle, date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00002v1', canonicalId: '2501.00002', version: 1, title: longTitle.toUpperCase(), date: '', hasWiki: false },
  ];
  const groups = findCrossIdTitleDupes(refs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'cross-id-similar-title');
  assert.equal(groups[0].files.length, 2);
});

test('findCrossIdTitleDupes: 同一 canonicalId 不算跨 ID', () => {
  const longTitle = 'A long enough title that exceeds thirty characters for sure okay';
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: longTitle, date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00001v2', canonicalId: '2501.00001', version: 2, title: longTitle, date: '', hasWiki: false },
  ];
  const groups = findCrossIdTitleDupes(refs);
  assert.equal(groups.length, 0);
});

test('findCrossIdTitleDupes: 标题 < 30 字符不参与', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: 'Short', date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00002v1', canonicalId: '2501.00002', version: 1, title: 'Short', date: '', hasWiki: false },
  ];
  const groups = findCrossIdTitleDupes(refs);
  assert.equal(groups.length, 0);
});

test('findCrossIdTitleDupes: 标点/空白归一化', () => {
  const refs = [
    { relPath: 'a.md', arxivId: '2501.00001v1', canonicalId: '2501.00001', version: 1, title: 'Hello,   World!  This is a long title test', date: '', hasWiki: false },
    { relPath: 'b.md', arxivId: '2501.00002v1', canonicalId: '2501.00002', version: 1, title: 'hello-world-this-is-a-long-title-test', date: '', hasWiki: false },
  ];
  const groups = findCrossIdTitleDupes(refs);
  assert.equal(groups.length, 1);
});

test('findDuplicateGroups: 合并版本簇 + 跨 ID', () => {
  const longTitle = 'A long enough title that exceeds thirty characters for sure okay';
  const papers = [
    paper({ id: 'papers/a.md', arxivId: '2501.00001v1', canonicalArxivId: '2501.00001', title_plain: longTitle }),
    paper({ id: 'papers/b.md', arxivId: '2501.00001v2', canonicalArxivId: '2501.00001', title_plain: longTitle }),
    paper({ id: 'papers/c.md', arxivId: '2501.00002v1', canonicalArxivId: '2501.00002', title_plain: longTitle }),
  ];
  const groups = findDuplicateGroups(papers);
  // 应该有 1 个版本簇 + 1 个跨 ID
  assert.ok(groups.length >= 2);
});

test('duplicateStats: 分类计数', () => {
  const groups = [
    { groupKey: 'a', reason: 'version-cluster', files: [] },
    { groupKey: 'b', reason: 'version-cluster', files: [] },
    { groupKey: 'c', reason: 'cross-id-similar-title', files: [] },
  ];
  const stats = duplicateStats(groups);
  assert.equal(stats.versionCluster, 2);
  assert.equal(stats.crossIdTitle, 1);
});

test('duplicateStats: 空数组 → 0/0', () => {
  const stats = duplicateStats([]);
  assert.equal(stats.versionCluster, 0);
  assert.equal(stats.crossIdTitle, 0);
});

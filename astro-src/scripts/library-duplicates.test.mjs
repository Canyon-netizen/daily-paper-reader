#!/usr/bin/env node
// astro-src/scripts/library-duplicates.test.mjs
//
// Tests for R7 polish: astro-src/lib/library-duplicates.ts.
// toFileRef (PaperListItem → PaperFileRef) +
// findVersionClusters (canonicalId 多版本分组) +
// findCrossIdTitleDupes (归一化标题跨 ID 重复) +
// findDuplicateGroups (综合检测) +
// duplicateStats (按 reason 计数)。

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

const mkPaper = (overrides = {}) => ({
  id: 'papers/x.md',
  arxivId: '2310.12345',
  canonicalArxivId: '2310.12345',
  title: 'Some Paper Title',
  title_plain: '',
  date: '2026-01-01',
  wikiContent: '',
  ...overrides,
});

const mkRef = (overrides = {}) => ({
  relPath: 'papers/x.md',
  arxivId: '2310.12345',
  canonicalId: '2310.12345',
  version: 1,
  title: 'Some Paper Title',
  date: '2026-01-01',
  hasWiki: false,
  ...overrides,
});

// ---------- toFileRef ---
test('toRef: 完整字段', () => {
  const p = mkPaper({
    id: 'papers/a.md',
    arxivId: '2310.12345v2',
    canonicalArxivId: '2310.12345',
    title_plain: 'Plain Title',
    wikiContent: 'wiki content',
  });
  const r = toFileRef(p);
  assert.equal(r.relPath, 'papers/a.md');
  assert.equal(r.arxivId, '2310.12345v2');
  assert.equal(r.canonicalId, '2310.12345');
  assert.equal(r.version, 2);
  assert.equal(r.title, 'Plain Title');
  assert.equal(r.hasWiki, true);
});

test('toRef: title_plain 缺 → fallback title', () => {
  const p = mkPaper({ title_plain: '', title: 'Title Only' });
  const r = toFileRef(p);
  assert.equal(r.title, 'Title Only');
});

test('toRef: title_plain 优先', () => {
  const p = mkPaper({ title_plain: 'Plain', title: 'Raw' });
  const r = toFileRef(p);
  assert.equal(r.title, 'Plain');
});

test('toRef: date 缺 → ""', () => {
  const p = mkPaper({ date: '' });
  const r = toFileRef(p);
  assert.equal(r.date, '');
});

test('toRef: wikiContent 缺 → hasWiki=false', () => {
  const p = mkPaper({ wikiContent: '' });
  const r = toFileRef(p);
  assert.equal(r.hasWiki, false);
});

test('toRef: wikiContent 非空 → hasWiki=true', () => {
  const p = mkPaper({ wikiContent: 'some wiki' });
  const r = toFileRef(p);
  assert.equal(r.hasWiki, true);
});

test('toRef: version 从 arxivId 派生', () => {
  const p = mkPaper({ arxivId: '2310.12345v3' });
  const r = toFileRef(p);
  assert.equal(r.version, 3);
});

// ---------- findVersionClusters ---
test('cluster: 单一文件 → 不算簇', () => {
  const r = findVersionClusters([mkRef()]);
  assert.equal(r.length, 0);
});

test('cluster: 同 canonicalId 2 文件 → 1 组', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: 'c1', arxivId: '2310.12345v1', version: 1 }),
    mkRef({ canonicalId: 'c1', arxivId: '2310.12345v2', version: 2 }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'version-cluster');
  assert.equal(r[0].groupKey, 'c1');
});

test('cluster: 不同 canonicalId → 2 组', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: 'c1', arxivId: 'a1v1', version: 1 }),
    mkRef({ canonicalId: 'c1', arxivId: 'a1v2', version: 2 }),
    mkRef({ canonicalId: 'c2', arxivId: 'a2v1', version: 1 }),
    mkRef({ canonicalId: 'c2', arxivId: 'a2v2', version: 2 }),
  ]);
  assert.equal(r.length, 2);
});

test('cluster: 按版本号降序排(最新在前)', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: 'c1', arxivId: 'c1v1', version: 1 }),
    mkRef({ canonicalId: 'c1', arxivId: 'c1v3', version: 3 }),
    mkRef({ canonicalId: 'c1', arxivId: 'c1v2', version: 2 }),
  ]);
  assert.equal(r[0].files[0].version, 3);
  assert.equal(r[0].files[1].version, 2);
  assert.equal(r[0].files[2].version, 1);
});

test('cluster: 按文件数降序排(多文件组在前)', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: 'c1', arxivId: 'c1v1', version: 1 }),
    mkRef({ canonicalId: 'c1', arxivId: 'c1v2', version: 2 }),
    mkRef({ canonicalId: 'c2', arxivId: 'c2v1', version: 1 }),
    mkRef({ canonicalId: 'c2', arxivId: 'c2v2', version: 2 }),
    mkRef({ canonicalId: 'c2', arxivId: 'c2v3', version: 3 }),
  ]);
  // c2 有 3 个 → 在前
  assert.equal(r[0].groupKey, 'c2');
  assert.equal(r[1].groupKey, 'c1');
});

test('cluster: canonicalId 空 → 跳过', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: '' }),
    mkRef({ canonicalId: '' }),
  ]);
  assert.equal(r.length, 0);
});

test('cluster: 混合(有+无)', () => {
  const r = findVersionClusters([
    mkRef({ canonicalId: 'c1', arxivId: 'c1v1', version: 1 }),
    mkRef({ canonicalId: 'c1', arxivId: 'c1v2', version: 2 }),
    mkRef({ canonicalId: '' }),
  ]);
  assert.equal(r.length, 1);
});

test('cluster: 空数组 → []', () => {
  assert.deepEqual(findVersionClusters([]), []);
});

// ---------- findCrossIdTitleDupes ---
test('cross: 不同 canonicalId 同标题 → 1 组', () => {
  const longTitle = 'A'.repeat(40);
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: longTitle }),
    mkRef({ canonicalId: 'c2', title: longTitle }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'cross-id-similar-title');
});

test('cross: 同 canonicalId → 不算重复', () => {
  const longTitle = 'B'.repeat(40);
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', arxivId: 'c1v1', version: 1, title: longTitle }),
    mkRef({ canonicalId: 'c1', arxivId: 'c1v2', version: 2, title: longTitle }),
  ]);
  assert.equal(r.length, 0);
});

test('cross: 归一化(小写 + 去标点)', () => {
  // 归一化后 ≥ 30 字
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: 'Attention IS All YOU NEED For Long Sequence Modeling' }),
    mkRef({ canonicalId: 'c2', title: 'attention is all you need for long sequence modeling' }),
  ]);
  assert.equal(r.length, 1);
});

test('cross: 归一化(去空白)', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: 'foo   bar  baz qux quux corge grault garply waldo fred' }),
    mkRef({ canonicalId: 'c2', title: 'foo bar baz qux quux corge grault garply waldo fred' }),
  ]);
  assert.equal(r.length, 1);
});

test('cross: 短标题 < 30 字 → 跳过', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: 'short' }),
    mkRef({ canonicalId: 'c2', title: 'short' }),
  ]);
  assert.equal(r.length, 0);
});

test('cross: 30 字刚好命中', () => {
  // 30 个 a → 归一化后长度 30,刚好 >= 30
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: 'a'.repeat(30) }),
    mkRef({ canonicalId: 'c2', title: 'a'.repeat(30) }),
  ]);
  assert.equal(r.length, 1);
});

test('cross: 29 字不命中', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: 'a'.repeat(29) }),
    mkRef({ canonicalId: 'c2', title: 'a'.repeat(29) }),
  ]);
  assert.equal(r.length, 0);
});

test('cross: groupKey = 归一化后标题', () => {
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: 'Attention IS All YOU NEED For Long Sequence Modeling' }),
    mkRef({ canonicalId: 'c2', title: 'attention is all you need for long sequence modeling' }),
  ]);
  assert.equal(r[0].groupKey, 'attentionisallyouneedforlongsequencemodeling');
});

test('cross: 按文件数降序排', () => {
  const t1 = 'a'.repeat(30);
  const t2 = 'b'.repeat(30);
  const r = findCrossIdTitleDupes([
    mkRef({ canonicalId: 'c1', title: t1 }),
    mkRef({ canonicalId: 'c2', title: t1 }),
    mkRef({ canonicalId: 'c3', title: t2 }),
    mkRef({ canonicalId: 'c4', title: t2 }),
    mkRef({ canonicalId: 'c5', title: t2 }),
  ]);
  // t2 有 3 个 → 在前
  assert.equal(r[0].files.length, 3);
  assert.equal(r[1].files.length, 2);
});

test('cross: 空数组 → []', () => {
  assert.deepEqual(findCrossIdTitleDupes([]), []);
});

// ---------- findDuplicateGroups ---
test('all: 合并 version+cross', () => {
  const longTitle = 'X'.repeat(40);
  const papers = [
    mkPaper({ id: 'p1', arxivId: 'a1v1', canonicalArxivId: 'a1', title: 't1' }),
    mkPaper({ id: 'p2', arxivId: 'a1v2', canonicalArxivId: 'a1', title: 't2' }),
    mkPaper({ id: 'p3', arxivId: 'b1', canonicalArxivId: 'b1', title: longTitle }),
    mkPaper({ id: 'p4', arxivId: 'c1', canonicalArxivId: 'c1', title: longTitle }),
  ];
  const r = findDuplicateGroups(papers);
  // 1 个 version cluster (2 个) + 1 个 cross-id (2 个)
  assert.equal(r.length, 2);
});

test('all: 按文件数降序排', () => {
  const longTitle = 'X'.repeat(40);
  const papers = [
    // version cluster: 2 文件
    mkPaper({ id: 'p1', arxivId: 'a1v1', canonicalArxivId: 'a1', title: 't1' }),
    mkPaper({ id: 'p2', arxivId: 'a1v2', canonicalArxivId: 'a1', title: 't2' }),
    // cross-id: 3 文件
    mkPaper({ id: 'p3', arxivId: 'b1', canonicalArxivId: 'b1', title: longTitle }),
    mkPaper({ id: 'p4', arxivId: 'c1', canonicalArxivId: 'c1', title: longTitle }),
    mkPaper({ id: 'p5', arxivId: 'd1', canonicalArxivId: 'd1', title: longTitle }),
  ];
  const r = findDuplicateGroups(papers);
  // cross-id 3 > version 2
  assert.equal(r[0].reason, 'cross-id-similar-title');
  assert.equal(r[0].files.length, 3);
  assert.equal(r[1].reason, 'version-cluster');
});

test('all: 空数组 → []', () => {
  assert.deepEqual(findDuplicateGroups([]), []);
});

test('all: 无重复 → []', () => {
  const papers = [
    mkPaper({ id: 'p1', arxivId: 'a1', canonicalArxivId: 'a1', title: 'T1' }),
    mkPaper({ id: 'p2', arxivId: 'b1', canonicalArxivId: 'b1', title: 'T2' }),
  ];
  assert.equal(findDuplicateGroups(papers).length, 0);
});

// ---------- duplicateStats ---
test('stats: 全 version-cluster', () => {
  const r = duplicateStats([
    { groupKey: 'a', reason: 'version-cluster', files: [] },
    { groupKey: 'b', reason: 'version-cluster', files: [] },
  ]);
  assert.equal(r.versionCluster, 2);
  assert.equal(r.crossIdTitle, 0);
});

test('stats: 全 cross-id', () => {
  const r = duplicateStats([
    { groupKey: 'a', reason: 'cross-id-similar-title', files: [] },
  ]);
  assert.equal(r.crossIdTitle, 1);
  assert.equal(r.versionCluster, 0);
});

test('stats: 混合', () => {
  const r = duplicateStats([
    { groupKey: 'a', reason: 'version-cluster', files: [] },
    { groupKey: 'b', reason: 'cross-id-similar-title', files: [] },
    { groupKey: 'c', reason: 'version-cluster', files: [] },
  ]);
  assert.equal(r.versionCluster, 2);
  assert.equal(r.crossIdTitle, 1);
});

test('stats: 空 → 0/0', () => {
  assert.deepEqual(duplicateStats([]), { versionCluster: 0, crossIdTitle: 0 });
});

// ---------- 集成 ---
test('集成: listPapers → findDuplicateGroups → duplicateStats', () => {
  const longTitle = 'Transformer Architecture Survey Long Title';
  const papers = [
    mkPaper({ id: 'p1', arxivId: '2310.11111v1', canonicalArxivId: '2310.11111', title: 'T1' }),
    mkPaper({ id: 'p2', arxivId: '2310.11111v2', canonicalArxivId: '2310.11111', title: 'T2' }),
    mkPaper({ id: 'p3', arxivId: '2310.22222', canonicalArxivId: '2310.22222', title: longTitle }),
    mkPaper({ id: 'p4', arxivId: '2310.33333', canonicalArxivId: '2310.33333', title: longTitle }),
  ];
  const groups = findDuplicateGroups(papers);
  const stats = duplicateStats(groups);
  assert.equal(stats.versionCluster, 1);
  assert.equal(stats.crossIdTitle, 1);
  assert.equal(groups.length, 2);
});
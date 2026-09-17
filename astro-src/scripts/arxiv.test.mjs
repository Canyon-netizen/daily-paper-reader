#!/usr/bin/env node
// astro-src/scripts/arxiv.test.mjs
//
// Tests for R7 polish: astro-src/lib/arxiv.ts.
// canonicalArxivId + getCanonicalArxivId + getArxivVersion + isArxivId + buildDedupKey
// + dedupByArxivVersion + dedupByCanonicalArxivId + compareArxivVersions
// + extractArxivIdFromPath + normalizeArxivId + extractArxivId + generateVersionComparison.

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

const mod = await loadTs('lib/arxiv.ts');
const {
  canonicalArxivId,
  getCanonicalArxivId,
  getArxivVersion,
  isArxivId,
  buildDedupKey,
  dedupByArxivVersion,
  dedupByCanonicalArxivId,
  compareArxivVersions,
  extractArxivIdFromPath,
  normalizeArxivId,
  extractArxivId,
  generateVersionComparison,
} = mod;

// ---------- canonicalArxivId ----------
test('canonicalArxivId: 剥 v 后缀', () => {
  assert.equal(canonicalArxivId('2607.00483v2'), '2607.00483');
});

test('canonicalArxivId: 本无版本号', () => {
  assert.equal(canonicalArxivId('2305.16291'), '2305.16291');
});

test('canonicalArxivId: 大写 V 也能剥 (case-insensitive)', () => {
  // /v\d+$/i → 大写 V 也匹配
  assert.equal(canonicalArxivId('2607.00483V2'), '2607.00483');
});

test('canonicalArxivId: trim', () => {
  assert.equal(canonicalArxivId('  2607.00483v1  '), '2607.00483');
});

test('canonicalArxivId: 空字符串 → 空', () => {
  assert.equal(canonicalArxivId(''), '');
});

test('canonicalArxivId: 非 arxiv id 原样保留', () => {
  assert.equal(canonicalArxivId('not-an-arxiv-id'), 'not-an-arxiv-id');
});

test('canonicalArxivId: 中间有 v 不剥 (只有尾部)', () => {
  // 'v' 不在尾部 → 不剥
  assert.equal(canonicalArxivId('visual.v2'), 'visual.');
});

test('canonicalArxivId: 嵌套 v 也只剥最后', () => {
  // 'v1v2' → 最后 v2 剥 → 'v1'
  assert.equal(canonicalArxivId('testv1v2'), 'testv1');
});

// ---------- getCanonicalArxivId ----------
test('getCanonicalArxivId: 标准格式剥版本', () => {
  assert.equal(getCanonicalArxivId('2607.00483v2'), '2607.00483');
});

test('getCanonicalArxivId: 无 v 后缀原样', () => {
  // '2305.16291' 不匹配 ARXIV_ID_RE → 原样
  assert.equal(getCanonicalArxivId('2305.16291'), '2305.16291');
});

test('getCanonicalArxivId: 不符合格式原样', () => {
  assert.equal(getCanonicalArxivId('foo'), 'foo');
});

test('getCanonicalArxivId: 4 位 + 4 位数字', () => {
  assert.equal(getCanonicalArxivId('1234.5678v1'), '1234.5678');
});

test('getCanonicalArxivId: 4 位 + 5 位数字', () => {
  assert.equal(getCanonicalArxivId('1234.56789v3'), '1234.56789');
});

test('getCanonicalArxivId: 大写 V 不匹配', () => {
  // ARXIV_ID_RE 是 case-sensitive → 'V2' 不匹配
  assert.equal(getCanonicalArxivId('2607.00483V2'), '2607.00483V2');
});

// ---------- getArxivVersion ----------
test('getArxivVersion: v2', () => {
  assert.equal(getArxivVersion('2607.00483v2'), 2);
});

test('getArxivVersion: 无 v → 0', () => {
  assert.equal(getArxivVersion('2607.00483'), 0);
});

test('getArxivVersion: 不符合格式 → 0', () => {
  assert.equal(getArxivVersion('foo'), 0);
});

test('getArxivVersion: 大写 V 不匹配 → 0', () => {
  assert.equal(getArxivVersion('2607.00483V2'), 0);
});

test('getArxivVersion: v100', () => {
  assert.equal(getArxivVersion('1234.5678v100'), 100);
});

// ---------- isArxivId ----------
test('isArxivId: 标准 → true', () => {
  assert.equal(isArxivId('2607.00483v1'), true);
});

test('isArxivId: 无 v → false', () => {
  assert.equal(isArxivId('2607.00483'), false);
});

test('isArxivId: 数字位不对 → false', () => {
  assert.equal(isArxivId('123.456v1'), false);
});

test('isArxivId: 空 → false', () => {
  assert.equal(isArxivId(''), false);
});

test('isArxivId: 大写 V → false', () => {
  assert.equal(isArxivId('2607.00483V1'), false);
});

// ---------- buildDedupKey ----------
test('buildDedupKey: 标准 arxiv', () => {
  assert.equal(buildDedupKey('2607.00483v2', 'fallback'), 'arxiv:2607.00483');
});

test('buildDedupKey: 非 arxiv', () => {
  assert.equal(buildDedupKey('not-arxiv', 'fb-1'), 'id:fb-1');
});

test('buildDedupKey: 空 → fallback', () => {
  assert.equal(buildDedupKey('', 'fb-1'), 'id:fb-1');
});

// ---------- dedupByArxivVersion ----------
test('dedupByArxivVersion: 同 arxiv 不同版本 → 保留高版本', () => {
  const r = dedupByArxivVersion([
    { id: 'a', arxivId: '2607.00483v1' },
    { id: 'b', arxivId: '2607.00483v2' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'b');
});

test('dedupByArxivVersion: 不同 arxiv 各自保留', () => {
  const r = dedupByArxivVersion([
    { id: 'a', arxivId: '2607.00483v1' },
    { id: 'b', arxivId: '2607.00484v1' },
  ]);
  assert.equal(r.length, 2);
});

test('dedupByArxivVersion: 无版本号 vs 有版本号 → 独立 key', () => {
  // buildDedupKey 用 isArxivId (严格带 v);'2607.00483' 不匹配 → key = 'id:a'
  // '2607.00483v1' → key = 'arxiv:2607.00483'
  // 两者 key 不同 → 2 条保留
  const r = dedupByArxivVersion([
    { id: 'a', arxivId: '2607.00483' },
    { id: 'b', arxivId: '2607.00483v1' },
  ]);
  assert.equal(r.length, 2);
});

test('dedupByArxivVersion: 空数组', () => {
  assert.deepEqual(dedupByArxivVersion([]), []);
});

test('dedupByArxivVersion: 自定义 getArxivId', () => {
  const items = [
    { id: 'a', customId: '2607.00483v1' },
    { id: 'b', customId: '2607.00483v2' },
  ];
  const r = dedupByArxivVersion(items, (it) => it.customId);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'b');
});

test('dedupByArxivVersion: 非 arxiv id 用 fallback id → 不同 id 各自保留', () => {
  // key = 'id:<item.id>',所以 id 不同 → 不同 key → 2 条
  const r = dedupByArxivVersion([
    { id: 'a', arxivId: 'foo' },
    { id: 'b', arxivId: 'foo' },
  ]);
  assert.equal(r.length, 2);
});

test('dedupByArxivVersion: 非 arxiv id 同 item.id → dedup 到 1', () => {
  const r = dedupByArxivVersion([
    { id: 'same', arxivId: 'foo' },
    { id: 'same', arxivId: 'foo' },
  ]);
  assert.equal(r.length, 1);
});

// ---------- compareArxivVersions ----------
test('compareArxivVersions: a<b → 负数', () => {
  assert.ok(compareArxivVersions('2607.00483v1', '2607.00483v2') < 0);
});

test('compareArxivVersions: a>b → 正数', () => {
  assert.ok(compareArxivVersions('2607.00483v3', '2607.00483v1') > 0);
});

test('compareArxivVersions: 同 → 0', () => {
  assert.equal(compareArxivVersions('2607.00483v2', '2607.00483v2'), 0);
});

test('compareArxivVersions: 非 arxiv (0) vs v1', () => {
  assert.ok(compareArxivVersions('2607.00483', '2607.00483v1') < 0);
});

// ---------- extractArxivIdFromPath ----------
test('extractArxivIdFromPath: 标准路径', () => {
  assert.equal(extractArxivIdFromPath('2026/07/2607.00483v2.md'), '2607.00483v2');
});

test('extractArxivIdFromPath: 无 arxiv id → null', () => {
  assert.equal(extractArxivIdFromPath('foo/bar.md'), null);
});

test('extractArxivIdFromPath: 空字符串 → null', () => {
  assert.equal(extractArxivIdFromPath(''), null);
});

test('extractArxivIdFromPath: 大写 V 不匹配', () => {
  assert.equal(extractArxivIdFromPath('2026/07/2607.00483V2.md'), null);
});

// ---------- normalizeArxivId ----------
test('normalizeArxivId: 大写 V → 小写 v', () => {
  assert.equal(normalizeArxivId('2607.00483V2'), '2607.00483v2');
});

test('normalizeArxivId: 小写 v 不变', () => {
  assert.equal(normalizeArxivId('2607.00483v2'), '2607.00483v2');
});

test('normalizeArxivId: 无 v 后缀 → 不变', () => {
  assert.equal(normalizeArxivId('2607.00483'), '2607.00483');
});

test('normalizeArxivId: 末尾非数字 V 不变', () => {
  assert.equal(normalizeArxivId('testVfoo'), 'testVfoo');
});

// ---------- extractArxivId ----------
test('extractArxivId: 有 arxivId', () => {
  assert.equal(extractArxivId({ arxivId: '2607.00483v1', id: 'fallback' }), '2607.00483v1');
});

test('extractArxivId: 无 arxivId → 空', () => {
  assert.equal(extractArxivId({ id: 'fallback' }), '');
});

// ---------- dedupByCanonicalArxivId ----------
test('dedupByCanonicalArxivId: 保留高版本', () => {
  const r = dedupByCanonicalArxivId([
    { id: 'a', arxivId: '2607.00483v1' },
    { id: 'b', arxivId: '2607.00483v3' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'b');
});

// ---------- generateVersionComparison ----------
test('generateVersionComparison: v2 tldr 更长 → hasMoreContent', () => {
  const r = generateVersionComparison(
    { tldr: 'short' },
    { tldr: 'much longer tldr content here' },
  );
  assert.equal(r.hasMoreContent, true);
  assert.equal(r.hasBetterEvidence, false);
  assert.equal(r.hasMoreTags, false);
  assert.match(r.summary, /v2/);
});

test('generateVersionComparison: v2 无 tldr → hasMoreContent=false', () => {
  const r = generateVersionComparison({ tldr: 'foo' }, {});
  assert.equal(r.hasMoreContent, false);
});

test('generateVersionComparison: v2 evidence 更多 → hasBetterEvidence', () => {
  const r = generateVersionComparison(
    { evidence: ['a'] },
    { evidence: ['a', 'b', 'c'] },
  );
  assert.equal(r.hasBetterEvidence, true);
});

test('generateVersionComparison: v2 categories.task 更多 → hasMoreTags', () => {
  const r = generateVersionComparison(
    { categories: { task: ['rl'], venue: [], method: [], type: [] } },
    { categories: { task: ['rl', 'reasoning'], venue: [], method: [], type: [] } },
  );
  assert.equal(r.hasMoreTags, true);
});

test('generateVersionComparison: v2 categories 但 v1 无 → hasMoreTags=false', () => {
  const r = generateVersionComparison(
    {},
    { categories: { task: ['rl'], venue: [], method: [], type: [] } },
  );
  // v1 无 categories → 不算 hasMoreTags (只比较 v2.categories && v1.categories)
  assert.equal(r.hasMoreTags, false);
});

test('generateVersionComparison: 都无 → 差异不大', () => {
  const r = generateVersionComparison({}, {});
  assert.equal(r.hasMoreContent, false);
  assert.equal(r.hasBetterEvidence, false);
  assert.equal(r.hasMoreTags, false);
  assert.equal(r.summary, 'v1 v2 差异不大');
});

test('generateVersionComparison: summary 文案', () => {
  const r = generateVersionComparison({ tldr: 'a' }, { tldr: 'aa' });
  assert.equal(r.summary, 'v2 有更多/更好的内容');
});
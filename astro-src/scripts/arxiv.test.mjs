#!/usr/bin/env node
// astro-src/scripts/arxiv.test.mjs
//
// Tests for R7 polish: astro-src/lib/arxiv.ts.
// getCanonicalArxivId + canonicalArxivId + getArxivVersion + isArxivId +
// extractArxivId + dedupByCanonicalArxivId + dedupByArxivVersion +
// compareArxivVersions + extractArxivIdFromPath + generateVersionComparison

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

const mod = await loadTs('lib/arxiv.ts');
const {
  getCanonicalArxivId,
  canonicalArxivId,
  getArxivVersion,
  isArxivId,
  extractArxivId,
  dedupByCanonicalArxivId,
  dedupByArxivVersion,
  compareArxivVersions,
  extractArxivIdFromPath,
  generateVersionComparison,
} = mod;

// ---------- getCanonicalArxivId ---
test('getCanonicalArxivId: 标准格式带版本 → 去掉版本', () => {
  assert.equal(getCanonicalArxivId('2607.00483v2'), '2607.00483');
});

test('getCanonicalArxivId: 无版本号 → 原样返回', () => {
  assert.equal(getCanonicalArxivId('2305.16291'), '2305.16291');
});

test('getCanonicalArxivId: v1 版本 → 去掉版本', () => {
  assert.equal(getCanonicalArxivId('2310.12345v1'), '2310.12345');
});

test('getCanonicalArxivId: 非标准格式 → 原样返回', () => {
  assert.equal(getCanonicalArxivId('abc'), 'abc');
});

test('getCanonicalArxivId: 空字符串 → 空字符串', () => {
  assert.equal(getCanonicalArxivId(''), '');
});

test('getCanonicalArxivId: 少于4位年份 → 原样返回', () => {
  assert.equal(getCanonicalArxivId('1234.56v1'), '1234.56v1');
});

test('getCanonicalArxivId: 5位数字部分 → 有效', () => {
  assert.equal(getCanonicalArxivId('2607.00483v2'), '2607.00483');
});

test('getCanonicalArxivId: 4位数字部分 → 有效', () => {
  assert.equal(getCanonicalArxivId('2607.0048v3'), '2607.0048');
});

// ---------- canonicalArxivId ---
test('canonicalArxivId: 带版本 → 去掉版本', () => {
  assert.equal(canonicalArxivId('2607.00483v2'), '2607.00483');
});

test('canonicalArxivId: 无版本号 → 原样返回', () => {
  assert.equal(canonicalArxivId('2305.16291'), '2305.16291');
});

test('canonicalArxivId: 大写V → 去掉版本', () => {
  assert.equal(canonicalArxivId('2607.00483V2'), '2607.00483');
});

test('canonicalArxivId: 前后空格 → trim后去版本', () => {
  assert.equal(canonicalArxivId('  2607.00483v1  '), '2607.00483');
});

test('canonicalArxivId: 空字符串 → 空字符串', () => {
  assert.equal(canonicalArxivId(''), '');
});

test('canonicalArxivId: undefined → 空字符串', () => {
  assert.equal(canonicalArxivId(undefined), '');
});

test('canonicalArxivId: 中间v不Strip → 原样', () => {
  assert.equal(canonicalArxivId('abcv2xyz'), 'abcv2xyz');
});

test('canonicalArxivId: 多个尾部vN → 只去最后一个', () => {
  assert.equal(canonicalArxivId('abcv2v3'), 'abcv2');
});

// ---------- getArxivVersion ---
test('getArxivVersion: 标准格式带版本 → 返回版本号', () => {
  assert.equal(getArxivVersion('2607.00483v2'), 2);
});

test('getArxivVersion: 大版本号 → 返回版本号', () => {
  assert.equal(getArxivVersion('2310.12345v15'), 15);
});

test('getArxivVersion: 大写V → 返回0 (regex case-sensitive)', () => {
  assert.equal(getArxivVersion('2607.00483V2'), 0);
});

test('getArxivVersion: 无版本号 → 返回0', () => {
  assert.equal(getArxivVersion('2310.12345'), 0);
});

test('getArxivVersion: 非标准格式 → 返回0', () => {
  assert.equal(getArxivVersion('abc'), 0);
});

test('getArxivVersion: 空字符串 → 返回0', () => {
  assert.equal(getArxivVersion(''), 0);
});

// ---------- isArxivId ---
test('isArxivId: 标准格式 → true', () => {
  assert.equal(isArxivId('2607.00483v2'), true);
});

test('isArxivId: 无版本 → false', () => {
  assert.equal(isArxivId('2305.16291'), false);
});

test('isArxivId: 非标准格式 → false', () => {
  assert.equal(isArxivId('abc'), false);
});

test('isArxivId: 空字符串 → false', () => {
  assert.equal(isArxivId(''), false);
});

test('isArxivId: 大写V → false (regex case-sensitive)', () => {
  assert.equal(isArxivId('2607.00483V2'), false);
});

test('isArxivId: 4位数字部分 → true', () => {
  assert.equal(isArxivId('2607.0048v3'), true);
});

test('isArxivId: 5位数字部分 → true', () => {
  assert.equal(isArxivId('2607.00483v1'), true);
});

// ---------- extractArxivId ---
test('extractArxivId: 有arxivId → 返回arxivId', () => {
  assert.equal(extractArxivId({ arxivId: '2607.00483v2', id: 'x' }), '2607.00483v2');
});

test('extractArxivId: 无arxivId → 返回空字符串', () => {
  assert.equal(extractArxivId({ id: 'x' }), '');
});

test('extractArxivId: arxivId为空字符串 → 返回空字符串', () => {
  assert.equal(extractArxivId({ arxivId: '', id: 'x' }), '');
});

// ---------- dedupByCanonicalArxivId ---
test('dedupByCanonicalArxivId: 同一canonical保留最高版本', () => {
  const items = [
    { arxivId: '2607.00483v1', id: 'a' },
    { arxivId: '2607.00483v2', id: 'b' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].arxivId, '2607.00483v2');
});

test('dedupByCanonicalArxivId: 不同canonical都保留', () => {
  const items = [
    { arxivId: '2607.00483v1', id: 'a' },
    { arxivId: '2305.16291v1', id: 'b' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.equal(result.length, 2);
});

test('dedupByCanonicalArxivId: 无arxivId用id去重', () => {
  const items = [
    { id: 'paper1' },
    { id: 'paper1' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.equal(result.length, 1);
});

test('dedupByCanonicalArxivId: 混合有/无arxivId', () => {
  const items = [
    { arxivId: '2607.00483v1', id: 'a' },
    { id: 'paper1' },
    { id: 'paper1' },
  ];
  const result = dedupByCanonicalArxivId(items);
  assert.equal(result.length, 2);
});

test('dedupByCanonicalArxivId: 空数组 → 空数组', () => {
  const result = dedupByCanonicalArxivId([]);
  assert.equal(result.length, 0);
});

// ---------- dedupByArxivVersion ---
test('dedupByArxivVersion: 默认使用item.arxivId', () => {
  const items = [
    { arxivId: '2607.00483v1', id: 'a' },
    { arxivId: '2607.00483v2', id: 'b' },
  ];
  const result = dedupByArxivVersion(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].arxivId, '2607.00483v2');
});

test('dedupByArxivVersion: 自定义getArxivId', () => {
  const items = [
    { customId: '2607.00483v1', id: 'a' },
    { customId: '2607.00483v2', id: 'b' },
  ];
  const result = dedupByArxivVersion(items, (item) => item.customId || '');
  assert.equal(result.length, 1);
  assert.equal(result[0].customId, '2607.00483v2');
});

test('dedupByArxivVersion: 不同key保留各自最高版本', () => {
  const items = [
    { arxivId: '2607.00483v1', id: 'a' },
    { arxivId: '2305.16291v3', id: 'b' },
    { arxivId: '2607.00483v2', id: 'c' },
  ];
  const result = dedupByArxivVersion(items);
  assert.equal(result.length, 2);
  const ids = result.map(r => r.arxivId).sort();
  assert.deepEqual(ids, ['2305.16291v3', '2607.00483v2']);
});

// ---------- compareArxivVersions ---
test('compareArxivVersions: v2 > v1 → 正数', () => {
  assert.ok(compareArxivVersions('2607.00483v2', '2607.00483v1') > 0);
});

test('compareArxivVersions: v1 < v2 → 负数', () => {
  assert.ok(compareArxivVersions('2607.00483v1', '2607.00483v2') < 0);
});

test('compareArxivVersions: 同版本 → 0', () => {
  assert.equal(compareArxivVersions('2607.00483v1', '2607.00483v1'), 0);
});

test('compareArxivVersions: 无版本vs有版本 → 负数', () => {
  assert.ok(compareArxivVersions('2607.00483', '2607.00483v1') < 0);
});

test('compareArxivVersions: 不同canonical只比版本', () => {
  // 虽然canonical不同，但version都是0，所以返回0
  assert.equal(compareArxivVersions('2607.00483', '2305.16291'), 0);
});

// ---------- extractArxivIdFromPath ---
test('extractArxivIdFromPath: 带版本号 → 提取完整ID', () => {
  assert.equal(extractArxivIdFromPath('/papers/2310.12345v1.md'), '2310.12345v1');
});

test('extractArxivIdFromPath: 标准路径带版本 → 提取ID', () => {
  assert.equal(extractArxivIdFromPath('/papers/2310.12345v1.md'), '2310.12345v1');
});

test('extractArxivIdFromPath: 深层路径带版本 → 提取ID', () => {
  assert.equal(extractArxivIdFromPath('2026/07/2607.00483v2'), '2607.00483v2');
});

test('extractArxivIdFromPath: 无匹配 → null', () => {
  assert.equal(extractArxivIdFromPath('/papers/abc.md'), null);
});

test('extractArxivIdFromPath: 空字符串 → null', () => {
  assert.equal(extractArxivIdFromPath(''), null);
});

test('extractArxivIdFromPath: 路径中有多个数字 → 匹配第一个', () => {
  assert.equal(extractArxivIdFromPath('/2026/07/2607.00483v2/paper.md'), '2607.00483v2');
});

// ---------- generateVersionComparison ---
test('generateVersionComparison: v2 tldr更长 → hasMoreContent', () => {
  const result = generateVersionComparison(
    { tldr: 'short' },
    { tldr: 'this is a much longer tldr' }
  );
  assert.equal(result.hasMoreContent, true);
  assert.equal(result.hasBetterEvidence, false);
  assert.equal(result.hasMoreTags, false);
});

test('generateVersionComparison: v1无tldr v2有 → hasMoreContent', () => {
  const result = generateVersionComparison(
    {},
    { tldr: 'some tldr' }
  );
  assert.equal(result.hasMoreContent, true);
});

test('generateVersionComparison: v2 evidence更长 → hasBetterEvidence', () => {
  const result = generateVersionComparison(
    { evidence: 'short' },
    { evidence: 'much longer evidence here' }
  );
  assert.equal(result.hasBetterEvidence, true);
});

test('generateVersionComparison: v2 tags更多 → hasMoreTags', () => {
  const result = generateVersionComparison(
    { categories: { task: ['a'] } },
    { categories: { task: ['a', 'b', 'c'] } }
  );
  assert.equal(result.hasMoreTags, true);
});

test('generateVersionComparison: v2无categories → hasMoreTags false', () => {
  const result = generateVersionComparison(
    { categories: { task: ['a', 'b'] } },
    {}
  );
  assert.equal(result.hasMoreTags, false);
});

test('generateVersionComparison: 都有更多内容 → summary包含v2', () => {
  const result = generateVersionComparison(
    { tldr: 'x' },
    { tldr: 'xy', evidence: 'ev', categories: { task: ['t'] } }
  );
  assert.match(result.summary, /v2/);
});

test('generateVersionComparison: 无差异 → summary为v1v2差异不大', () => {
  const result = generateVersionComparison(
    { tldr: 'same' },
    { tldr: 'same' }
  );
  assert.equal(result.summary, 'v1 v2 差异不大');
});

test('generateVersionComparison: v1有v2无 → hasMoreContent false', () => {
  const result = generateVersionComparison(
    { tldr: 'longer content here' },
    {}
  );
  assert.equal(result.hasMoreContent, false);
});

// ---------- 集成测试 ----------
test('集成: canonicalArxivId vs getCanonicalArxivId 区别', () => {
  // getCanonicalArxivId 严格匹配，非标准格式返回原值
  assert.equal(getCanonicalArxivId('abc'), 'abc');
  // canonicalArxivId 更宽松，只去掉尾部vN
  assert.equal(canonicalArxivId('abc'), 'abc');
  // 对于标准格式，两者结果相同
  assert.equal(getCanonicalArxivId('2607.00483v2'), '2607.00483');
  assert.equal(canonicalArxivId('2607.00483v2'), '2607.00483');
});

test('集成: dedupByArxivVersion 保持原数组顺序', () => {
  const items = [
    { arxivId: '2305.16291v1', id: 'a' },
    { arxivId: '2607.00483v1', id: 'b' },
    { arxivId: '2607.00483v2', id: 'c' },
  ];
  const result = dedupByArxivVersion(items);
  // 应该保留 2305.16291v1 和 2607.00483v2（最高版本）
  assert.equal(result.length, 2);
  // 顺序应该是 insertion order of keys: 2305 先, 2607 后
  assert.equal(result[0].arxivId, '2305.16291v1');
  assert.equal(result[1].arxivId, '2607.00483v2');
});

test('集成: 完整去重流程', () => {
  const items = [
    { arxivId: '2607.00483v1', id: 'p1' },
    { arxivId: '2607.00483v2', id: 'p2' },
    { arxivId: '2305.16291v1', id: 'p3' },
    { id: 'custom1' },
    { id: 'custom1' }, // 重复的非arxiv id
  ];
  const result = dedupByCanonicalArxivId(items);
  // 应该保留: 2607.00483v2, 2305.16291v1, custom1
  assert.equal(result.length, 3);
});

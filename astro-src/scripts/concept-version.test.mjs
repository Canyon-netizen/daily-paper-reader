#!/usr/bin/env node
// astro-src/scripts/concept-version.test.mjs
//
// Tests for R7 G.1.3 concept version snapshots + change detection.

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

const mod = await loadTs('lib/concepts/version.ts');
const {
  snapshotConceptState,
  detectChanges,
  historyChanges,
  recentSnapshots,
  sparklinePoints,
} = mod;

// ----- snapshotConceptState -----

test('snapshotConceptState: 拍基本字段 + 排序 paper_ids', () => {
  const s = snapshotConceptState({
    display_name: 'Transformer',
    category: 'method',
    paper_count: 3,
    novelty: 0.8,
    centrality: 0.5,
    paper_ids: ['papers/2026/09/b', 'papers/2026/09/a'],
  }, '2026-09-16');
  assert.equal(s.date, '2026-09-16');
  assert.equal(s.display_name, 'Transformer');
  assert.equal(s.paper_count, 3);
  assert.deepEqual(s.paper_ids, ['papers/2026/09/a', 'papers/2026/09/b']);
});

test('snapshotConceptState: 默认 date 是今天', () => {
  const s = snapshotConceptState({
    display_name: 'X', category: 'other', paper_count: 0,
    novelty: 0, centrality: 0, paper_ids: [],
  });
  assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
});

// ----- detectChanges -----

test('detectChanges: 完全相同 → 空数组', () => {
  const s = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  assert.deepEqual(detectChanges(s, s), []);
});

test('detectChanges: 重命名 → renamed', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  const b = snapshotConceptState({
    display_name: 'Transformer', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-16');
  const changes = detectChanges(a, b);
  assert.ok(changes.some((c) => c.type === 'renamed'));
});

test('detectChanges: category 切换 → category_changed', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  const b = snapshotConceptState({
    display_name: 'T', category: 'problem', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-16');
  const changes = detectChanges(a, b);
  assert.ok(changes.some((c) => c.type === 'category_changed'));
});

test('detectChanges: 新增 paper → paper_added', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  const b = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 2,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a', 'b'],
  }, '2026-09-16');
  const changes = detectChanges(a, b);
  const added = changes.find((c) => c.type === 'paper_added');
  assert.ok(added);
  assert.deepEqual(added.paper_ids, ['b']);
});

test('detectChanges: 移除 paper → paper_removed', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 2,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a', 'b'],
  }, '2026-09-15');
  const b = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-16');
  const changes = detectChanges(a, b);
  const removed = changes.find((c) => c.type === 'paper_removed');
  assert.ok(removed);
  assert.deepEqual(removed.paper_ids, ['b']);
});

test('detectChanges: novelty/centrality 变化', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.3, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  const b = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.8, centrality: 0.7, paper_ids: ['a'],
  }, '2026-09-16');
  const changes = detectChanges(a, b);
  assert.ok(changes.some((c) => c.type === 'novelty_changed'));
  assert.ok(changes.some((c) => c.type === 'centrality_changed'));
});

// ----- historyChanges -----

test('historyChanges: 多个 snapshot 串联', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.3, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  const b = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 2,
    novelty: 0.3, centrality: 0.5, paper_ids: ['a', 'b'],
  }, '2026-09-16');
  const c = snapshotConceptState({
    display_name: 'Transformer', category: 'method', paper_count: 3,
    novelty: 0.3, centrality: 0.5, paper_ids: ['a', 'b', 'c'],
  }, '2026-09-17');
  const changes = historyChanges([a, b, c]);
  // a→b: paper_added
  // b→c: paper_added + renamed
  assert.ok(changes.some((c) => c.type === 'paper_added'));
  assert.ok(changes.some((c) => c.type === 'renamed'));
});

test('historyChanges: 只有一条 → 空', () => {
  const a = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 1,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  });
  assert.deepEqual(historyChanges([a]), []);
});

// ----- recentSnapshots -----

test('recentSnapshots: 过滤 cutoff 日期', () => {
  const now = new Date('2026-09-16T00:00:00Z');
  const snaps = [
    snapshotConceptState({
      display_name: 'T', category: 'method', paper_count: 1,
      novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
    }, '2026-06-15'),  // > 90 天前
    snapshotConceptState({
      display_name: 'T', category: 'method', paper_count: 1,
      novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
    }, '2026-09-01'),  // 15 天前
  ];
  const recent = recentSnapshots(snaps, 90, now);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].date, '2026-09-01');
});

// ----- sparklinePoints -----

test('sparklinePoints: 空 history → 空字符串', () => {
  assert.equal(sparklinePoints([]), '');
});

test('sparklinePoints: 单点 → 单个 x,y', () => {
  const s = snapshotConceptState({
    display_name: 'T', category: 'method', paper_count: 5,
    novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
  }, '2026-09-15');
  const pts = sparklinePoints([s]);
  assert.match(pts, /^\d+\.\d+,\d+\.\d+$/);
});

test('sparklinePoints: 多点 → 用逗号分隔', () => {
  const snaps = [
    snapshotConceptState({
      display_name: 'T', category: 'method', paper_count: 1,
      novelty: 0.5, centrality: 0.5, paper_ids: ['a'],
    }, '2026-09-15'),
    snapshotConceptState({
      display_name: 'T', category: 'method', paper_count: 3,
      novelty: 0.5, centrality: 0.5, paper_ids: ['a', 'b', 'c'],
    }, '2026-09-16'),
  ];
  const pts = sparklinePoints(snaps);
  assert.equal(pts.split(' ').length, 2);
});
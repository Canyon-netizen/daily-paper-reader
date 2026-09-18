#!/usr/bin/env node
// astro-src/scripts/concepts-version.test.mjs
//
// Tests for R7 polish: astro-src/lib/concepts/version.ts.
// snapshotConceptState + detectChanges + historyChanges + recentSnapshots + sparklinePoints.

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

const mkEntry = (overrides = {}) => ({
  display_name: 'Test Concept',
  category: 'method',
  paper_count: 5,
  novelty: 0.8,
  centrality: 0.6,
  paper_ids: ['p1', 'p2', 'p3'],
  ...overrides,
});

const mkSnapshot = (overrides = {}) => ({
  date: '2026-09-01',
  display_name: 'Test',
  category: 'method',
  paper_count: 5,
  novelty: 0.8,
  centrality: 0.6,
  paper_ids: ['p1', 'p2'],
  ...overrides,
});

// ---------- snapshotConceptState ---
test('snapshot: 基本字段映射', () => {
  const entry = mkEntry({ display_name: 'Transformer', category: 'model' });
  const snap = snapshotConceptState(entry, '2026-09-15');
  assert.equal(snap.date, '2026-09-15');
  assert.equal(snap.display_name, 'Transformer');
  assert.equal(snap.category, 'model');
});

test('snapshot: paper_ids 排序', () => {
  const entry = mkEntry({ paper_ids: ['c', 'a', 'b'] });
  const snap = snapshotConceptState(entry);
  assert.deepEqual(snap.paper_ids, ['a', 'b', 'c']);
});

test('snapshot: 默认日期 todayISO', () => {
  const entry = mkEntry();
  const snap = snapshotConceptState(entry);
  assert.match(snap.date, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- detectChanges ---
test('detect: 无变化 → 空数组', () => {
  const prev = mkSnapshot({ date: '2026-09-01', paper_ids: ['p1'] });
  const next = mkSnapshot({ date: '2026-09-02', paper_ids: ['p1'] });
  const r = detectChanges(prev, next);
  assert.equal(r.length, 0);
});

test('detect: paper_added', () => {
  const prev = mkSnapshot({ paper_ids: ['p1'] });
  const next = mkSnapshot({ paper_ids: ['p1', 'p2'] });
  const r = detectChanges(prev, next);
  const added = r.find((c) => c.type === 'paper_added');
  assert.ok(added);
  assert.deepEqual(added.paper_ids, ['p2']);
});

test('detect: paper_removed', () => {
  const prev = mkSnapshot({ paper_ids: ['p1', 'p2'] });
  const next = mkSnapshot({ paper_ids: ['p1'] });
  const r = detectChanges(prev, next);
  const removed = r.find((c) => c.type === 'paper_removed');
  assert.ok(removed);
  assert.deepEqual(removed.paper_ids, ['p2']);
});

test('detect: renamed', () => {
  const prev = mkSnapshot({ display_name: 'Old' });
  const next = mkSnapshot({ display_name: 'New' });
  const r = detectChanges(prev, next);
  const renamed = r.find((c) => c.type === 'renamed');
  assert.ok(renamed);
  assert.match(renamed.detail, /Old.*New/);
});

test('detect: category_changed', () => {
  const prev = mkSnapshot({ category: 'method' });
  const next = mkSnapshot({ category: 'application' });
  const r = detectChanges(prev, next);
  const changed = r.find((c) => c.type === 'category_changed');
  assert.ok(changed);
});

test('detect: novelty_changed', () => {
  const prev = mkSnapshot({ novelty: 0.5 });
  const next = mkSnapshot({ novelty: 0.8 });
  const r = detectChanges(prev, next);
  const changed = r.find((c) => c.type === 'novelty_changed');
  assert.ok(changed);
});

test('detect: centrality_changed', () => {
  const prev = mkSnapshot({ centrality: 0.3 });
  const next = mkSnapshot({ centrality: 0.7 });
  const r = detectChanges(prev, next);
  const changed = r.find((c) => c.type === 'centrality_changed');
  assert.ok(changed);
});

test('detect: recreated (date 同 + 0→非0)', () => {
  const prev = mkSnapshot({ date: '2026-09-01', paper_count: 0, paper_ids: [] });
  const next = mkSnapshot({ date: '2026-09-01', paper_count: 3, paper_ids: ['a', 'b', 'c'] });
  const r = detectChanges(prev, next);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'recreated');
});

test('detect: 返回按 type 字母排序', () => {
  const prev = mkSnapshot({ display_name: 'A', category: 'x', novelty: 0.1 });
  const next = mkSnapshot({ display_name: 'B', category: 'y', novelty: 0.2 });
  const r = detectChanges(prev, next);
  const types = r.map((c) => c.type);
  assert.deepEqual(types, [...types].sort());
});

// ---------- historyChanges ---
test('history: <2 snapshots → []', () => {
  assert.deepEqual(historyChanges([mkSnapshot()]), []);
});

test('history: 2 snapshots → detectChanges', () => {
  const h = [mkSnapshot({ date: '2026-09-01' }), mkSnapshot({ date: '2026-09-02', display_name: 'X' })];
  const r = historyChanges(h);
  assert.ok(r.length > 0);
});

// ---------- recentSnapshots ---
test('recent: 默认 90 天', () => {
  const h = [
    mkSnapshot({ date: '2026-01-01' }),
    mkSnapshot({ date: '2026-09-01' }),
  ];
  const r = recentSnapshots(h, 90, new Date('2026-09-15'));
  assert.equal(r.length, 1);
  assert.equal(r[0].date, '2026-09-01');
});

test('recent: 自定义天数', () => {
  const h = [
    mkSnapshot({ date: '2026-09-01' }),
    mkSnapshot({ date: '2026-09-10' }),
  ];
  const r = recentSnapshots(h, 7, new Date('2026-09-15'));
  assert.equal(r.length, 1);
  assert.equal(r[0].date, '2026-09-10');
});

test('recent: 返回升序', () => {
  const h = [mkSnapshot({ date: '2026-09-05' }), mkSnapshot({ date: '2026-09-01' })];
  const r = recentSnapshots(h, 90, new Date('2026-09-15'));
  assert.equal(r[0].date, '2026-09-01');
});

// ---------- sparklinePoints ---
test('sparkline: 空 → ""', () => {
  assert.equal(sparklinePoints([]), '');
});

test('sparkline: 单点 → (0, near bottom)', () => {
  const h = [mkSnapshot({ paper_count: 10 })];
  const pts = sparklinePoints(h, 100, 50);
  // y = height - (pc/max)*(height-4) - 2 = 50 - 1*46 - 2 = 2
  assert.ok(pts.includes('0.0,2.0'));
});

test('sparkline: 多点 → points 数量 = length', () => {
  const h = [
    mkSnapshot({ paper_count: 5 }),
    mkSnapshot({ paper_count: 10 }),
    mkSnapshot({ paper_count: 3 }),
  ];
  const pts = sparklinePoints(h, 100, 50);
  const points = pts.split(' ').filter(Boolean);
  assert.equal(points.length, 3);
});

test('sparkline: width 影响 x 坐标', () => {
  const h = [mkSnapshot({ paper_count: 1 }), mkSnapshot({ paper_count: 1 })];
  const pts1 = sparklinePoints(h, 100, 50);
  const pts2 = sparklinePoints(h, 200, 50);
  // 第一点 x 总是 0, 第二点 x 不同
  const pts1Arr = pts1.split(' ')[1].split(',')[0];
  const pts2Arr = pts2.split(' ')[1].split(',')[0];
  assert.ok(parseFloat(pts2Arr) > parseFloat(pts1Arr));
});

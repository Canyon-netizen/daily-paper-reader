#!/usr/bin/env node
// astro-src/scripts/dashboard-time-to-paper.test.mjs
//
// Tests for R7 polish: astro-src/lib/dashboard/time-to-paper.ts.

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

const mod = await loadTs('lib/dashboard/time-to-paper.ts');
const { computeTimeToPaper, aggregateTimeToPaper, addStatusTransition, markPublished } = mod;

const DAY = 1000 * 60 * 60 * 24;

function mkTimeline(firstSeenAt = 0, transitions = [], publishedAt) {
  return {
    arxivId: 'p1',
    firstSeenAt,
    statusTransitions: transitions,
    publishedAt,
  };
}

test('computeTimeToPaper: 空 timeline → 0 days', () => {
  const t = mkTimeline(0);
  const r = computeTimeToPaper(t);
  // endTime = Date.now(),所以 daysFromFirstSeen > 0
  assert.ok(r.daysFromFirstSeen >= 0);
  assert.equal(r.daysPerPhase.literature, 0);
});

test('computeTimeToPaper: publishedAt 给定时精确计算 days', () => {
  const firstSeen = 0;
  const published = 5 * DAY;
  const t = mkTimeline(firstSeen, [], published);
  const r = computeTimeToPaper(t);
  assert.equal(r.daysFromFirstSeen, 5);
});

test('computeTimeToPaper: statusTransitions 按 ts 排序后算 phase duration', () => {
  const t = mkTimeline(0, [
    { phase: 'literature', ts: 0 },
    { phase: 'idea', ts: 2 * DAY },
    { phase: 'experiment', ts: 5 * DAY },
  ], 7 * DAY);
  const r = computeTimeToPaper(t);
  assert.equal(r.daysPerPhase.literature, 2);
  assert.equal(r.daysPerPhase.idea, 3);
  // experiment 到 publishedAt 7d,持续 2 天
  assert.equal(r.daysPerPhase.experiment, 2);
});

test('computeTimeToPaper: transitions 无序输入也能排序', () => {
  const t = mkTimeline(0, [
    { phase: 'experiment', ts: 5 * DAY },
    { phase: 'literature', ts: 0 },
    { phase: 'idea', ts: 2 * DAY },
  ], 7 * DAY);
  const r = computeTimeToPaper(t);
  assert.equal(r.daysPerPhase.literature, 2);
  assert.equal(r.daysPerPhase.idea, 3);
  assert.equal(r.daysPerPhase.experiment, 2);
});

test('computeTimeToPaper: bottlenecks 返回最长 phase', () => {
  const t = mkTimeline(0, [
    { phase: 'literature', ts: 0 },
    { phase: 'idea', ts: 1 * DAY },
    { phase: 'experiment', ts: 10 * DAY }, // idea→experiment 共 9d(最长)
  ], 12 * DAY);
  const r = computeTimeToPaper(t);
  // literature=1d, idea=9d, experiment=2d → idea 是瓶颈
  assert.ok(r.bottlenecks.includes('idea'));
});

test('computeTimeToPaper: published 不参与 bottleneck', () => {
  const t = mkTimeline(0, [
    { phase: 'literature', ts: 0 },
    { phase: 'published', ts: 50 * DAY }, // 如果 published 在 transitions 中(不寻常)
  ], 50 * DAY);
  const r = computeTimeToPaper(t);
  // published 持续 0 天,literature 持续 50 天
  assert.ok(!r.bottlenecks.includes('published'));
  assert.ok(r.bottlenecks.includes('literature'));
});

test('computeTimeToPaper: 多 phase 同 duration 都进 bottlenecks', () => {
  const t = mkTimeline(0, [
    { phase: 'literature', ts: 0 },
    { phase: 'idea', ts: 3 * DAY },
    { phase: 'experiment', ts: 6 * DAY },
  ], 6 * DAY);
  const r = computeTimeToPaper(t);
  // literature=3, idea=3, experiment=0 → literature 和 idea 都是瓶颈
  assert.ok(r.bottlenecks.includes('literature'));
  assert.ok(r.bottlenecks.includes('idea'));
});

test('aggregateTimeToPaper: 空数组 → 全 0', () => {
  const r = aggregateTimeToPaper([]);
  assert.equal(r.avgDaysFromFirstSeen, 0);
  assert.equal(r.medianDaysFromFirstSeen, 0);
  assert.equal(r.totalPapers, 0);
  assert.equal(r.completedPapers, 0);
});

test('aggregateTimeToPaper: avgDaysFromFirstSeen 平均', () => {
  const tl = [
    mkTimeline(0, [], 4 * DAY),
    mkTimeline(0, [], 8 * DAY),
  ];
  const r = aggregateTimeToPaper(tl);
  assert.equal(r.avgDaysFromFirstSeen, 6);
  assert.equal(r.medianDaysFromFirstSeen, 6);
  assert.equal(r.totalPapers, 2);
  assert.equal(r.completedPapers, 2);
});

test('aggregateTimeToPaper: 未发布的不计入 completed', () => {
  const tl = [
    { ...mkTimeline(0, [], 4 * DAY), arxivId: 'p1' }, // completed
    { ...mkTimeline(0, [], undefined), arxivId: 'p2' }, // not completed
  ];
  const r = aggregateTimeToPaper(tl);
  assert.equal(r.totalPapers, 2);
  assert.equal(r.completedPapers, 1);
  assert.equal(r.avgDaysFromFirstSeen, 4);
});

test('aggregateTimeToPaper: median 单数取中位', () => {
  const tl = [
    mkTimeline(0, [], 2 * DAY),
    mkTimeline(0, [], 4 * DAY),
    mkTimeline(0, [], 6 * DAY),
  ];
  const r = aggregateTimeToPaper(tl);
  assert.equal(r.medianDaysFromFirstSeen, 4);
});

test('aggregateTimeToPaper: median 双数取平均', () => {
  const tl = [
    mkTimeline(0, [], 2 * DAY),
    mkTimeline(0, [], 6 * DAY),
  ];
  const r = aggregateTimeToPaper(tl);
  assert.equal(r.medianDaysFromFirstSeen, 4);
});

test('aggregateTimeToPaper: avgDaysPerPhase 按 phase 平均', () => {
  const tl = [
    mkTimeline(0, [
      { phase: 'literature', ts: 0 },
      { phase: 'idea', ts: 2 * DAY },
    ], 4 * DAY),
    mkTimeline(0, [
      { phase: 'literature', ts: 0 },
      { phase: 'idea', ts: 4 * DAY },
    ], 8 * DAY),
  ];
  const r = aggregateTimeToPaper(tl);
  // literature: 2, 4 → avg 3
  assert.equal(r.avgDaysPerPhase.literature, 3);
  // idea: 2, 4 → avg 3
  assert.equal(r.avgDaysPerPhase.idea, 3);
});

test('aggregateTimeToPaper: avgDays 整数化(round)', () => {
  const tl = [
    mkTimeline(0, [], 4 * DAY),
    mkTimeline(0, [], 5 * DAY),
    mkTimeline(0, [], 7 * DAY),
  ];
  // avg = 16/3 = 5.33 → round 5
  const r = aggregateTimeToPaper(tl);
  assert.equal(r.avgDaysFromFirstSeen, 5);
});

test('addStatusTransition: append transition(用 Date.now)', () => {
  const t = mkTimeline(0);
  const t2 = addStatusTransition(t, 'literature');
  assert.equal(t2.statusTransitions.length, 1);
  assert.equal(t2.statusTransitions[0].phase, 'literature');
  assert.equal(typeof t2.statusTransitions[0].ts, 'number');
});

test('addStatusTransition: 显式 ts', () => {
  const t = mkTimeline(0);
  const t2 = addStatusTransition(t, 'idea', 1000);
  assert.equal(t2.statusTransitions[0].ts, 1000);
});

test('addStatusTransition: 不修改原 timeline(不可变)', () => {
  const t = mkTimeline(0);
  const t2 = addStatusTransition(t, 'literature');
  assert.equal(t.statusTransitions.length, 0);
  assert.equal(t2.statusTransitions.length, 1);
});

test('markPublished: 设 publishedAt', () => {
  const t = mkTimeline(0);
  const t2 = markPublished(t, 5000);
  assert.equal(t2.publishedAt, 5000);
});

test('markPublished: 缺省 → Date.now()', () => {
  const t = mkTimeline(0);
  const t2 = markPublished(t);
  assert.equal(typeof t2.publishedAt, 'number');
});

test('markPublished: 不修改原 timeline', () => {
  const t = mkTimeline(0);
  const t2 = markPublished(t, 1000);
  assert.equal(t.publishedAt, undefined);
  assert.equal(t2.publishedAt, 1000);
});
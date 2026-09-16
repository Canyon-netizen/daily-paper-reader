#!/usr/bin/env node
// astro-src/scripts/dashboard-aggregate.test.mjs
//
// Tests for R7 polish: astro-src/lib/dashboard/aggregate.ts.

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

const mod = await loadTs('lib/dashboard/aggregate.ts');
const { aggregateDashboard, formatDashboardSummary } = mod;

test('aggregateDashboard: 空 activity/phase/timeToPaper', () => {
  const r = aggregateDashboard([], {}, []);
  assert.deepEqual(r.activity, []);
  assert.deepEqual(r.phaseDistribution, {});
  assert.equal(r.avgDaysToPublish, 0);
});

test('aggregateDashboard: 聚合 activity by kind', () => {
  const r = aggregateDashboard(
    [{ kind: 'fetch' }, { kind: 'fetch' }, { kind: 'analyze' }],
    {},
    []
  );
  // 顺序按首次出现
  assert.deepEqual(r.activity, [
    { kind: 'fetch', count: 2 },
    { kind: 'analyze', count: 1 },
  ]);
});

test('aggregateDashboard: phase 分布直接传递', () => {
  const r = aggregateDashboard([], { intake: 5, review: 3 }, []);
  assert.deepEqual(r.phaseDistribution, { intake: 5, review: 3 });
});

test('aggregateDashboard: timeToPaper 平均', () => {
  const r = aggregateDashboard([], {}, [2, 4, 6]);
  assert.equal(r.avgDaysToPublish, 4);
});

test('aggregateDashboard: timeToPaper 浮点保留 2 位', () => {
  const r = aggregateDashboard([], {}, [1, 2]);
  assert.equal(r.avgDaysToPublish, 1.5);
});

test('aggregateDashboard: timeToPaper [1,2,3,4,5] → 3', () => {
  const r = aggregateDashboard([], {}, [1, 2, 3, 4, 5]);
  assert.equal(r.avgDaysToPublish, 3);
});

test('aggregateDashboard: timeToPaper 浮点截断到 2 位小数', () => {
  const r = aggregateDashboard([], {}, [1, 2, 3]);
  // 1+2+3=6,平均=2.0
  assert.equal(r.avgDaysToPublish, 2);
});

test('aggregateDashboard: phaseStats 浅拷贝(修改不影响输入)', () => {
  const src = { a: 1 };
  const r = aggregateDashboard([], src, []);
  r.phaseDistribution.b = 2;
  assert.equal(src.b, undefined);
});

test('aggregateDashboard: 综合场景', () => {
  const r = aggregateDashboard(
    [
      { kind: 'fetch' },
      { kind: 'fetch' },
      { kind: 'review' },
      { kind: 'publish' },
    ],
    { intake: 4, review: 4, publish: 1 },
    [3, 5, 7]
  );
  assert.equal(r.activity.length, 3);
  assert.equal(r.phaseDistribution.intake, 4);
  assert.equal(r.avgDaysToPublish, 5);
});

test('formatDashboardSummary: 0 活动 + 0 phase + 0 days', () => {
  const s = formatDashboardSummary({
    activity: [],
    phaseDistribution: {},
    avgDaysToPublish: 0,
  });
  assert.equal(s, '0 activities');
});

test('formatDashboardSummary: 含 phase 数', () => {
  const s = formatDashboardSummary({
    activity: [{ kind: 'a', count: 1 }],
    phaseDistribution: { p1: 1, p2: 2 },
    avgDaysToPublish: 0,
  });
  assert.equal(s, '1 activities, 2 phases');
});

test('formatDashboardSummary: 含 days avg', () => {
  const s = formatDashboardSummary({
    activity: [{ kind: 'a', count: 2 }, { kind: 'b', count: 3 }],
    phaseDistribution: { p1: 1 },
    avgDaysToPublish: 7.456,
  });
  assert.ok(s.includes('5 activities'));
  assert.ok(s.includes('1 phases'));
  assert.ok(s.includes('7.5 days avg'));
});

test('formatDashboardSummary: days=0 时不显示 days avg', () => {
  const s = formatDashboardSummary({
    activity: [],
    phaseDistribution: {},
    avgDaysToPublish: 0,
  });
  assert.ok(!s.includes('days avg'));
});

test('formatDashboardSummary: 综合', () => {
  const s = formatDashboardSummary({
    activity: [{ kind: 'fetch', count: 5 }],
    phaseDistribution: { intake: 5 },
    avgDaysToPublish: 3.2,
  });
  assert.equal(s, '5 activities, 1 phases, 3.2 days avg');
});
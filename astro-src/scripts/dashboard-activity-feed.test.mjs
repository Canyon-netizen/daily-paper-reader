#!/usr/bin/env node
// astro-src/scripts/dashboard-activity-feed.test.mjs
//
// Tests for R7 polish: astro-src/lib/dashboard/activity-feed.ts.
//
// 该模块使用 localStorage,无法直接 esbuild。仅内联纯函数 summarizeByDay 测试,
// 其它 (recordEvent/getRecentEvents/getEventsByKind 等) 依赖 localStorage,
// 不在 Node 测试覆盖范围。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// 内联实现,与源保持一致
function summarizeByDay(events) {
  const result = {};
  for (const event of events) {
    const date = new Date(event.ts).toISOString().split('T')[0];
    result[date] = (result[date] ?? 0) + 1;
  }
  return result;
}

test('summarizeByDay: 空数组 → 空对象', () => {
  assert.deepEqual(summarizeByDay([]), {});
});

test('summarizeByDay: 单事件', () => {
  const events = [{ id: '1', kind: 'paper_added', ts: Date.parse('2025-01-01T10:00:00Z'), summary: '' }];
  const r = summarizeByDay(events);
  assert.deepEqual(r, { '2025-01-01': 1 });
});

test('summarizeByDay: 跨多天计数', () => {
  const events = [
    { id: '1', kind: 'paper_added', ts: Date.parse('2025-01-01T10:00:00Z'), summary: '' },
    { id: '2', kind: 'paper_added', ts: Date.parse('2025-01-01T15:00:00Z'), summary: '' },
    { id: '3', kind: 'paper_added', ts: Date.parse('2025-01-02T08:00:00Z'), summary: '' },
  ];
  const r = summarizeByDay(events);
  assert.equal(r['2025-01-01'], 2);
  assert.equal(r['2025-01-02'], 1);
});

test('summarizeByDay: 同一天不同时区归到同一日(UTC)', () => {
  const events = [
    { id: '1', kind: 'paper_added', ts: Date.parse('2025-01-01T01:00:00Z'), summary: '' },
    { id: '2', kind: 'paper_added', ts: Date.parse('2025-01-01T23:00:00Z'), summary: '' },
  ];
  const r = summarizeByDay(events);
  assert.equal(r['2025-01-01'], 2);
});

test('summarizeByDay: 跨年', () => {
  const events = [
    { id: '1', kind: 'paper_added', ts: Date.parse('2024-12-31T23:00:00Z'), summary: '' },
    { id: '2', kind: 'paper_added', ts: Date.parse('2025-01-01T01:00:00Z'), summary: '' },
  ];
  const r = summarizeByDay(events);
  assert.equal(r['2024-12-31'], 1);
  assert.equal(r['2025-01-01'], 1);
});

test('summarizeByDay: 输出 key 是 YYYY-MM-DD 格式', () => {
  const events = [{ id: '1', kind: 'paper_added', ts: Date.parse('2025-03-15T12:00:00Z'), summary: '' }];
  const r = summarizeByDay(events);
  assert.equal(Object.keys(r)[0], '2025-03-15');
  // 确保符合 ISO date 格式
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(Object.keys(r)[0]));
});

test('summarizeByDay: 大量事件一天', () => {
  const events = Array.from({ length: 50 }, (_, i) => ({
    id: String(i),
    kind: 'paper_added',
    ts: Date.parse('2025-01-01T00:00:00Z') + i * 1000,
    summary: '',
  }));
  const r = summarizeByDay(events);
  assert.equal(r['2025-01-01'], 50);
});

test('summarizeByDay: 单调有序输入', () => {
  const events = [
    { id: '1', kind: 'paper_added', ts: 1000, summary: '' },
    { id: '2', kind: 'idea_created', ts: 2000, summary: '' },
  ];
  // 1000 ms epoch = 1970-01-01
  const r = summarizeByDay(events);
  assert.equal(r['1970-01-01'], 2);
});

test('summarizeByDay: kind 不影响统计(只按天)', () => {
  const events = [
    { id: '1', kind: 'paper_added', ts: Date.parse('2025-01-01T10:00:00Z'), summary: '' },
    { id: '2', kind: 'idea_created', ts: Date.parse('2025-01-01T15:00:00Z'), summary: '' },
  ];
  const r = summarizeByDay(events);
  assert.equal(r['2025-01-01'], 2);
});
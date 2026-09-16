#!/usr/bin/env node
// astro-src/scripts/activity-feed.test.mjs
//
// Tests for R7 E.4.1: dashboard activity feed.

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
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// Mock localStorage for Node environment
const mockStorage = new Map();
const mockLocalStorage = {
  getItem: (key) => mockStorage.get(key) ?? null,
  setItem: (key, value) => mockStorage.set(key, value),
  removeItem: (key) => mockStorage.delete(key),
};
globalThis.localStorage = mockLocalStorage;

const mod = await loadTs('lib/dashboard/activity-feed.ts');
const {
  recordEvent,
  getRecentEvents,
  getEventsByKind,
  summarizeByDay,
  clearActivityFeed,
  getAllEvents,
  deleteEvent,
} = mod;

test('recordEvent: 记录事件', () => {
  clearActivityFeed();
  const ev = recordEvent({ kind: 'paper_added', summary: 'Added paper 2506.12345', refId: '2506.12345' });
  assert.ok(ev.id);
  assert.equal(ev.kind, 'paper_added');
  assert.equal(ev.summary, 'Added paper 2506.12345');
  assert.equal(ev.refId, '2506.12345');
  assert.ok(ev.ts > 0);
});

test('getRecentEvents: 默认返回 20 条', () => {
  clearActivityFeed();
  for (let i = 0; i < 25; i++) {
    recordEvent({ kind: 'paper_added', summary: `Event ${i}` });
  }
  const recent = getRecentEvents();
  assert.equal(recent.length, 20);
});

test('getRecentEvents: 支持自定义 limit', () => {
  clearActivityFeed();
  for (let i = 0; i < 10; i++) {
    recordEvent({ kind: 'paper_added', summary: `Event ${i}` });
  }
  const recent = getRecentEvents(5);
  assert.equal(recent.length, 5);
});

test('getEventsByKind: 按类型过滤', () => {
  clearActivityFeed();
  recordEvent({ kind: 'paper_added', summary: 'Paper added' });
  recordEvent({ kind: 'idea_created', summary: 'Idea created' });
  recordEvent({ kind: 'paper_added', summary: 'Another paper' });

  const papers = getEventsByKind('paper_added');
  assert.equal(papers.length, 2);
  const ideas = getEventsByKind('idea_created');
  assert.equal(ideas.length, 1);
});

test('summarizeByDay: 按天统计', () => {
  clearActivityFeed();
  // 手动插入不同时刻的事件
  const now = Date.now();
  const day1 = now - 1 * 24 * 60 * 60 * 1000;
  const day2 = now - 2 * 24 * 60 * 60 * 1000;

  const storage = { events: [] };
  mockStorage.set('dpr_activity_feed_v1', JSON.stringify(storage));

  // 直接操作存储插入历史事件
  storage.events = [
    { id: '1', kind: 'paper_added', ts: day1, summary: 'Day 1 event 1' },
    { id: '2', kind: 'paper_added', ts: day1, summary: 'Day 1 event 2' },
    { id: '3', kind: 'idea_created', ts: day2, summary: 'Day 2 event' },
  ];
  mockStorage.set('dpr_activity_feed_v1', JSON.stringify(storage));

  const summary = summarizeByDay(getAllEvents());
  const dates = Object.keys(summary);
  assert.ok(dates.length >= 1);
});

test('deleteEvent: 删除指定事件', () => {
  clearActivityFeed();
  const ev = recordEvent({ kind: 'paper_added', summary: 'To delete' });
  const deleted = deleteEvent(ev.id);
  assert.equal(deleted, true);
  const recent = getRecentEvents();
  assert.equal(recent.find((e) => e.id === ev.id), undefined);
});

test('deleteEvent: 删除不存在的事件返回 false', () => {
  clearActivityFeed();
  const deleted = deleteEvent('nonexistent-id');
  assert.equal(deleted, false);
});

test('clearActivityFeed: 清空所有事件', () => {
  clearActivityFeed();
  recordEvent({ kind: 'paper_added', summary: 'Test' });
  clearActivityFeed();
  const events = getAllEvents();
  assert.equal(events.length, 0);
});

test('recordEvent: LRU 淘汰超过 500 条', () => {
  clearActivityFeed();
  // 插入 505 条
  for (let i = 0; i < 505; i++) {
    recordEvent({ kind: 'paper_added', summary: `Event ${i}` });
  }
  const events = getAllEvents();
  assert.equal(events.length, 500);
});

test('getEventsByKind: limit 参数', () => {
  clearActivityFeed();
  for (let i = 0; i < 10; i++) {
    recordEvent({ kind: 'paper_added', summary: `Paper ${i}` });
  }
  const papers = getEventsByKind('paper_added', 3);
  assert.equal(papers.length, 3);
});

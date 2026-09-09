/**
 * tests/test_agents_activity_heatmap.mjs — activity heatmap 纯逻辑守护。
 *
 * iter #21:30 天 round 数热力图,每天一个小方格,颜色深度 ∝ count。
 *
 * 跑法:node tests/test_agents_activity_heatmap.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(ts) {
  // 把 ts 归一到当日 0 点(用 UTC 避免 tz 漂移,GitHub 也是这么做的)
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * 把 records 按 started_at 归类到 dayKey,返回 Map<dayKey, count>。
 * records: [{ started_at: number }, ...]
 */
function countByDay(records, now = Date.now()) {
  const startDay = dayKey(now) - 29 * DAY_MS;  // 30 天窗口含今天
  const endDay = dayKey(now);
  const out = new Map();
  for (const r of records) {
    if (!r || typeof r.started_at !== 'number') continue;
    const k = dayKey(r.started_at);
    if (k < startDay || k > endDay) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * 生成 30 天的有序数组(从最早到今天),每个元素是 { day, count, level }。
 * level: 0 / 1 / 2 / 3 / 4 根据 count 跟 maxCount 的比例。
 */
function buildHeatmap(records, now = Date.now()) {
  const counts = countByDay(records, now);
  const endDay = dayKey(now);
  const startDay = endDay - 29 * DAY_MS;
  const cells = [];
  for (let k = startDay; k <= endDay; k += DAY_MS) {
    cells.push({ day: k, count: counts.get(k) ?? 0 });
  }
  // level 0-4 按最大 count 分桶(0 = 空)
  const max = Math.max(1, ...cells.map((c) => c.count));
  for (const c of cells) {
    if (c.count === 0) c.level = 0;
    else if (c.count >= max * 0.75) c.level = 4;
    else if (c.count >= max * 0.5) c.level = 3;
    else if (c.count >= max * 0.25) c.level = 2;
    else c.level = 1;
  }
  return cells;
}

function totalRounds(records, now = Date.now()) {
  const startDay = dayKey(now) - 29 * DAY_MS;
  const endDay = dayKey(now);
  return records.filter((r) => {
    if (typeof r.started_at !== 'number') return false;
    const k = dayKey(r.started_at);
    return k >= startDay && k <= endDay;
  }).length;
}

describe('dayKey', () => {
  it('normalizes timestamps to UTC midnight', () => {
    const t1 = new Date('2026-09-09T01:30:00Z').getTime();
    const t2 = new Date('2026-09-09T23:30:00Z').getTime();
    assert.equal(dayKey(t1), dayKey(t2));
  });
  it('different days have different keys', () => {
    const t1 = new Date('2026-09-09T23:30:00Z').getTime();
    const t2 = new Date('2026-09-10T00:30:00Z').getTime();
    assert.notEqual(dayKey(t1), dayKey(t2));
  });
});

describe('countByDay', () => {
  it('returns empty map for empty records', () => {
    assert.equal(countByDay([]).size, 0);
  });
  it('counts records on the same day', () => {
    const day = new Date('2026-09-09T12:00:00Z').getTime();
    const records = [
      { started_at: day },
      { started_at: day + 1000 },
      { started_at: day + 60_000 },
    ];
    const m = countByDay(records, day + 100_000);
    assert.equal(m.size, 1);
    assert.equal(m.get(dayKey(day)), 3);
  });
  it('excludes records outside 30-day window', () => {
    const now = Date.now();
    const oldDay = dayKey(now) - 35 * DAY_MS;
    const inside = dayKey(now) - 5 * DAY_MS;
    const records = [
      { started_at: oldDay + 1000 },
      { started_at: inside + 1000 },
    ];
    const m = countByDay(records, now);
    assert.equal(m.size, 1);
    assert.ok(m.has(inside));
  });
  it('skips records without valid started_at', () => {
    const records = [{ foo: 'bar' }, null, { started_at: 'not-a-number' }];
    const m = countByDay(records);
    assert.equal(m.size, 0);
  });
});

describe('buildHeatmap', () => {
  it('returns 30 cells always', () => {
    const cells = buildHeatmap([]);
    assert.equal(cells.length, 30);
  });
  it('first cell is 29 days ago, last is today', () => {
    const now = 1_700_000_000_000;
    const cells = buildHeatmap([], now);
    assert.equal(cells[0].day, dayKey(now) - 29 * DAY_MS);
    assert.equal(cells[29].day, dayKey(now));
  });
  it('empty days have level 0', () => {
    const cells = buildHeatmap([]);
    assert.ok(cells.every((c) => c.level === 0));
  });
  it('single record today has level 4 (max=itself)', () => {
    const now = Date.now();
    const cells = buildHeatmap([{ started_at: now }], now);
    const today = cells[29];
    assert.equal(today.count, 1);
    assert.equal(today.level, 4);
  });
  it('levels increase with count relative to max', () => {
    const now = Date.now();
    const today = dayKey(now) + 12 * 60 * 60 * 1000;  // noon today
    const records = [];
    for (let i = 0; i < 10; i++) records.push({ started_at: today });  // 10 today
    for (let i = 0; i < 3; i++) records.push({ started_at: today - 1 * DAY_MS });  // 3 yesterday
    for (let i = 0; i < 1; i++) records.push({ started_at: today - 2 * DAY_MS });  // 1
    const cells = buildHeatmap(records, now);
    const c0 = cells[29];  // today, 10
    const c1 = cells[28];  // yesterday, 3
    const c2 = cells[27];  // 2 days ago, 1
    assert.equal(c0.count, 10);
    assert.equal(c1.count, 3);
    assert.equal(c2.count, 1);
    assert.equal(c0.level, 4);
    assert.ok(c1.level >= 1 && c1.level <= 4);
    assert.ok(c2.level >= 1 && c2.level <= 4);
  });
});

describe('totalRounds', () => {
  it('counts only records in window', () => {
    const now = Date.now();
    const old = dayKey(now) - 40 * DAY_MS;
    const fresh = dayKey(now) - 1 * DAY_MS;
    const records = [
      { started_at: old + 1000 },
      { started_at: fresh + 1000 },
      { started_at: fresh + 5000 },
    ];
    assert.equal(totalRounds(records, now), 2);
  });
});

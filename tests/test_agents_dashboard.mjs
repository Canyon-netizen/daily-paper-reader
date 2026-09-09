/**
 * tests/test_agents_dashboard.mjs — iter #29 dashboard 摘要面板
 *
 * 给 /agents/ 顶部加一块"看一眼能开干"的 dashboard:
 *   - last activity:最近一次 round 的 sid + 时间(相对 / 绝对)
 *   - best round:全 session 范围内 avg score 最高的 round
 *   - top tags:出现频率最高的前 N 个 tag
 *   - quick actions 数据(面板上按钮的 enabled 状态)
 *
 * 纯函数:
 *   - pickBestRound(allRounds):{ sid, round, avg }|null
 *   - pickLastActivity(sessions, allRounds):{ sid, round, ts, iso }|null
 *   - topTags(sessions, n):[{ tag, count }]
 *   - relativeTime(ts, now):"刚刚 / N 分钟前 / N 小时前 / N 天前"
 *   - dashboardSummary(...):一次性算完上面所有
 *
 * 跑法:node tests/test_agents_dashboard.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function pickBestRound(allRounds) {
  // allRounds: [{ sid, round, rec }]
  let best = null;
  for (const r of allRounds) {
    const cs = r.rec?.feedback?.critiques;
    if (!Array.isArray(cs) || cs.length === 0) continue;
    const avg = cs.reduce((a, c) => a + (Number(c.total) || 0), 0) / cs.length;
    if (best === null || avg > best.avg) {
      best = { sid: r.sid, round: r.round, avg };
    }
  }
  return best;
}

function pickLastActivity(allRounds) {
  if (!Array.isArray(allRounds) || allRounds.length === 0) return null;
  let latest = null;
  for (const r of allRounds) {
    const ts = r.rec?.finished_at ?? r.rec?.started_at;
    if (typeof ts !== 'number') continue;
    if (latest === null || ts > latest.ts) {
      latest = { sid: r.sid, round: r.round, ts, iso: new Date(ts).toISOString() };
    }
  }
  return latest;
}

function topTags(sessions, n = 3) {
  const counts = new Map();
  for (const s of sessions) {
    const tags = Array.isArray(s?.meta?.tags) ? s.meta.tags : [];
    for (const t of tags) {
      const k = String(t).toLowerCase().trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, n);
}

function relativeTime(ts, now = Date.now()) {
  if (typeof ts !== 'number' || !isFinite(ts)) return '';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} 个月前`;
  const yr = Math.floor(day / 365);
  return `${yr} 年前`;
}

function dashboardSummary({ allRounds, sessions, now = Date.now() }) {
  return {
    best: pickBestRound(allRounds || []),
    last: pickLastActivity(allRounds || []),
    lastRelative: pickLastActivity(allRounds || [])
      ? relativeTime(pickLastActivity(allRounds || []).ts, now)
      : '从未跑过',
    topTags: topTags(sessions || [], 3),
    totalSessions: (sessions || []).length,
    totalRounds: (allRounds || []).length,
  };
}

describe('pickBestRound', () => {
  it('finds round with highest avg score', () => {
    const all = [
      { sid: 'a', round: 1, rec: { feedback: { critiques: [{ total: 5 }, { total: 6 }] } } },  // 5.5
      { sid: 'b', round: 2, rec: { feedback: { critiques: [{ total: 8 }] } } },                  // 8
      { sid: 'a', round: 2, rec: { feedback: { critiques: [{ total: 7 }, { total: 7 }] } } },  // 7
    ];
    const b = pickBestRound(all);
    assert.equal(b.sid, 'b');
    assert.equal(b.round, 2);
    assert.equal(b.avg, 8);
  });
  it('skips rounds with no critiques', () => {
    const all = [
      { sid: 'a', round: 1, rec: { feedback: { critiques: [] } } },
      { sid: 'b', round: 1, rec: { feedback: { critiques: [{ total: 6 }] } } },
    ];
    const b = pickBestRound(all);
    assert.equal(b.sid, 'b');
  });
  it('returns null when no valid rounds', () => {
    assert.equal(pickBestRound([]), null);
    assert.equal(pickBestRound([{ sid: 'x', round: 1, rec: { feedback: { critiques: [] } } }]), null);
  });
});

describe('pickLastActivity', () => {
  it('picks latest finished_at', () => {
    const all = [
      { sid: 'a', round: 1, rec: { started_at: 100, finished_at: 200 } },
      { sid: 'b', round: 2, rec: { started_at: 300, finished_at: 500 } },
      { sid: 'c', round: 1, rec: { started_at: 400, finished_at: 450 } },
    ];
    const l = pickLastActivity(all);
    assert.equal(l.sid, 'b');
    assert.equal(l.round, 2);
    assert.equal(l.ts, 500);
  });
  it('falls back to started_at when finished_at missing', () => {
    const all = [
      { sid: 'a', round: 1, rec: { started_at: 100 } },  // no finished_at
    ];
    const l = pickLastActivity(all);
    assert.equal(l.ts, 100);
  });
  it('returns null for empty', () => {
    assert.equal(pickLastActivity([]), null);
  });
});

describe('topTags', () => {
  it('counts tags and sorts by frequency desc, alphabetical tie-break', () => {
    const sessions = [
      { meta: { tags: ['methodology', 'acl'] } },
      { meta: { tags: ['methodology', 'writing'] } },
      { meta: { tags: ['acl'] } },
    ];
    const t = topTags(sessions, 3);
    // counts:acl=2, methodology=2, writing=1
    // 字母序:acl < methodology → acl 在前
    assert.equal(t[0].tag, 'acl');
    assert.equal(t[0].count, 2);
    assert.equal(t[1].tag, 'methodology');
    assert.equal(t[1].count, 2);
    assert.equal(t[2].tag, 'writing');
    assert.equal(t[2].count, 1);
  });
  it('lowercases and trims', () => {
    const sessions = [{ meta: { tags: ['  Methodology  ', 'METHODOLOGY'] } }];
    const t = topTags(sessions, 3);
    assert.equal(t.length, 1);
    assert.equal(t[0].tag, 'methodology');
    assert.equal(t[0].count, 2);
  });
  it('handles missing tags', () => {
    assert.deepEqual(topTags([], 3), []);
    assert.deepEqual(topTags([{ meta: {} }], 3), []);
    assert.deepEqual(topTags([{}], 3), []);
  });
  it('respects n limit', () => {
    const sessions = [
      { meta: { tags: ['a', 'b', 'c', 'd'] } },
    ];
    const t = topTags(sessions, 2);
    assert.equal(t.length, 2);
  });
  it('breaks ties by alphabetical order', () => {
    const sessions = [
      { meta: { tags: ['zebra', 'apple'] } },
    ];
    const t = topTags(sessions, 2);
    assert.equal(t[0].tag, 'apple');
    assert.equal(t[1].tag, 'zebra');
  });
});

describe('relativeTime', () => {
  it('"刚刚" for <30s', () => {
    const now = 1_000_000;
    assert.equal(relativeTime(now - 1000, now), '刚刚');
  });
  it('seconds for <60s', () => {
    assert.equal(relativeTime(1_000_000 - 45_000, 1_000_000), '45 秒前');
  });
  it('minutes for <60min', () => {
    assert.equal(relativeTime(1_000_000 - 5 * 60_000, 1_000_000), '5 分钟前');
  });
  it('hours for <24h', () => {
    assert.equal(relativeTime(1_000_000 - 3 * 3600_000, 1_000_000), '3 小时前');
  });
  it('days for <30d', () => {
    assert.equal(relativeTime(1_000_000 - 2 * 86400_000, 1_000_000), '2 天前');
  });
  it('months for <12mo', () => {
    assert.equal(relativeTime(1_000_000 - 60 * 86400_000, 1_000_000), '2 个月前');
  });
  it('years for ≥12mo', () => {
    assert.equal(relativeTime(1_000_000 - 400 * 86400_000, 1_000_000), '1 年前');
  });
  it('empty for invalid', () => {
    assert.equal(relativeTime(NaN), '');
    assert.equal(relativeTime(undefined), '');
  });
});

describe('dashboardSummary', () => {
  it('aggregates everything', () => {
    const summary = dashboardSummary({
      allRounds: [
        { sid: 'a', round: 1, rec: { started_at: 100, finished_at: 200, feedback: { critiques: [{ total: 5 }] } } },
        { sid: 'a', round: 2, rec: { started_at: 300, finished_at: 400, feedback: { critiques: [{ total: 8 }] } } },
        { sid: 'b', round: 1, rec: { started_at: 500, finished_at: 600, feedback: { critiques: [{ total: 6 }] } } },
      ],
      sessions: [
        { meta: { tags: ['methodology', 'acl'] } },
        { meta: { tags: ['methodology'] } },
      ],
      now: 1_000_000,
    });
    assert.equal(summary.best.sid, 'a');
    assert.equal(summary.best.avg, 8);
    assert.equal(summary.last.sid, 'b');
    assert.equal(summary.totalRounds, 3);
    assert.equal(summary.totalSessions, 2);
    assert.equal(summary.topTags[0].tag, 'methodology');
  });
  it('handles empty state', () => {
    const s = dashboardSummary({ allRounds: [], sessions: [] });
    assert.equal(s.best, null);
    assert.equal(s.last, null);
    assert.equal(s.lastRelative, '从未跑过');
    assert.equal(s.totalRounds, 0);
    assert.deepEqual(s.topTags, []);
  });
});

describe('end-to-end', () => {
  it('user has 5 sessions, 12 rounds, just ran one', () => {
    const now = Date.now();
    const all = [];
    const sessions = [];
    for (let s = 0; s < 5; s++) {
      const sid = `session-${s}`;
      sessions.push({ meta: { tags: ['methodology', s % 2 ? 'acl' : 'emnlp'] } });
      for (let r = 1; r <= 3; r++) {
        // 时间倒序:r=1 最早(15 分钟前),r=3 最新(5 分钟前)
        const minutesAgo = 5 + (3 - r) * 5 + s * 1;
        all.push({
          sid,
          round: r,
          rec: {
            started_at: now - minutesAgo * 60_000,
            finished_at: now - minutesAgo * 60_000 + 30_000,
            feedback: { critiques: [{ total: 4 + s + r * 0.3 }] },
          },
        });
      }
    }
    const sum = dashboardSummary({ allRounds: all, sessions, now });
    assert.ok(sum.best.avg > 4);
    assert.ok(sum.last.ts <= now, `last.ts ${sum.last.ts} should be <= now ${now}`);
    assert.equal(sum.totalRounds, 15);
    assert.equal(sum.totalSessions, 5);
    assert.ok(sum.topTags.length > 0);
  });
});
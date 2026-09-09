/**
 * tests/test_agents_trash.mjs — session 删除/回收站 纯逻辑守护。
 *
 * iter #19:用户跑了几十个 session,picker 会变得拥挤。加软删除:
 *   - "删除" → 把 rounds + meta 搬到 dpr_agents_trash_<sid>_<deletedAt>
 *     + 写 dpr_agents_trash_index 数组记 trash 列表
 *   - "回收站" section 显示所有 trash,带剩余天数(30 天软删)
 *   - "恢复" → 把 rounds + meta 写回原 sid
 *   - "永久删除" → 直接 drop
 *   - "清空过期(>30 天)" → 批量 drop
 *
 * 纯函数测,跟 DOM 解耦。
 *
 * 跑法:node tests/test_agents_trash.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const META_KEY = (sid) => `dpr_agents_meta_${sid}`;
const ROUNDS_KEY = (sid) => `dpr_agents_rounds_${sid}`;
const TRASH_INDEX_KEY = 'dpr_agents_trash_index';
const TRASH_RECORD_KEY = (sid, deletedAt) => `dpr_agents_trash_${sid}_${deletedAt}`;

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 天

function listTrash(store) {
  const raw = store[TRASH_INDEX_KEY];
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function writeTrash(store, items) {
  store[TRASH_INDEX_KEY] = JSON.stringify(items);
}

function softDelete(store, sid, now = Date.now()) {
  if (!sid) throw new Error('sid required');
  if (store[ROUNDS_KEY(sid)] === undefined && store[META_KEY(sid)] === undefined) {
    throw new Error(`session "${sid}" not found`);
  }
  // session 存在只要 rounds 或 meta 至少一个
  // 把当前 rounds + meta 搬到 trash record
  const roundsRaw = store[ROUNDS_KEY(sid)];
  const metaRaw = store[META_KEY(sid)];
  const trashKey = TRASH_RECORD_KEY(sid, now);
  store[trashKey] = JSON.stringify({ sid, deletedAt: now, roundsRaw, metaRaw });
  // 从 active storage 删除
  delete store[ROUNDS_KEY(sid)];
  delete store[META_KEY(sid)];
  // 更新 index
  const index = listTrash(store);
  index.push({ sid, deletedAt: now, key: trashKey });
  writeTrash(store, index);
  return { sid, deletedAt: now };
}

function restoreFromTrash(store, sid, deletedAt, now = Date.now()) {
  const index = listTrash(store);
  const entry = index.find((e) => e.sid === sid && e.deletedAt === deletedAt);
  if (!entry) throw new Error(`trash entry for "${sid}" @ ${deletedAt} not found`);
  if (store[ROUNDS_KEY(sid)] !== undefined) {
    throw new Error(`active session "${sid}" already exists; cannot restore`);
  }
  const raw = store[entry.key];
  if (!raw) throw new Error('trash record payload missing');
  const record = JSON.parse(raw);
  if (record.roundsRaw !== undefined) store[ROUNDS_KEY(sid)] = record.roundsRaw;
  if (record.metaRaw !== undefined) store[META_KEY(sid)] = record.metaRaw;
  // 从 index 移除
  const next = index.filter((e) => !(e.sid === sid && e.deletedAt === deletedAt));
  writeTrash(store, next);
  delete store[entry.key];
  return { sid };
}

function permanentlyDelete(store, sid, deletedAt) {
  const index = listTrash(store);
  const entry = index.find((e) => e.sid === sid && e.deletedAt === deletedAt);
  if (!entry) throw new Error(`trash entry for "${sid}" @ ${deletedAt} not found`);
  delete store[entry.key];
  const next = index.filter((e) => !(e.sid === sid && e.deletedAt === deletedAt));
  writeTrash(store, next);
  return { sid };
}

function purgeExpired(store, now = Date.now(), ttlMs = TRASH_TTL_MS) {
  const index = listTrash(store);
  const expired = index.filter((e) => now - e.deletedAt > ttlMs);
  for (const e of expired) delete store[e.key];
  const remaining = index.filter((e) => now - e.deletedAt <= ttlMs);
  writeTrash(store, remaining);
  return { purged: expired.length, remaining: remaining.length };
}

function daysUntilExpiry(deletedAt, now = Date.now(), ttlMs = TRASH_TTL_MS) {
  const remaining = ttlMs - (now - deletedAt);
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

describe('softDelete', () => {
  it('throws on empty sid', () => {
    assert.throws(() => softDelete({}, ''), /sid required/);
  });
  it('throws when session does not exist', () => {
    assert.throws(() => softDelete({}, 'ghost'), /not found/);
  });
  it('moves rounds + meta to trash and removes from active', () => {
    const store = {
      [ROUNDS_KEY('s1')]: JSON.stringify([{ round: 1 }]),
      [META_KEY('s1')]: JSON.stringify({ title: 'T' }),
    };
    softDelete(store, 's1', 1000);
    assert.equal(store[ROUNDS_KEY('s1')], undefined);
    assert.equal(store[META_KEY('s1')], undefined);
    assert.ok(store[TRASH_RECORD_KEY('s1', 1000)]);
    const idx = listTrash(store);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].sid, 's1');
    assert.equal(idx[0].deletedAt, 1000);
  });
  it('preserves round + meta content in trash record', () => {
    const store = {
      [ROUNDS_KEY('s')]: JSON.stringify([{ round: 1, meta: { session_id: 's' } }]),
      [META_KEY('s')]: JSON.stringify({ title: 'My', notes: 'hi' }),
    };
    softDelete(store, 's', 5000);
    const trashRaw = store[TRASH_RECORD_KEY('s', 5000)];
    const rec = JSON.parse(trashRaw);
    assert.equal(rec.roundsRaw, JSON.stringify([{ round: 1, meta: { session_id: 's' } }]));
    assert.equal(rec.metaRaw, JSON.stringify({ title: 'My', notes: 'hi' }));
  });
  it('handles session with only meta (no rounds)', () => {
    const store = { [META_KEY('s')]: JSON.stringify({ title: 'empty' }) };
    softDelete(store, 's', 1);
    assert.equal(listTrash(store).length, 1);
  });
});

describe('restoreFromTrash', () => {
  it('throws when no matching trash entry', () => {
    assert.throws(() => restoreFromTrash({}, 's', 1), /not found/);
  });
  it('throws when target sid already exists', () => {
    const store = { [ROUNDS_KEY('s')]: '[]', [META_KEY('s')]: '{}' };
    const r = softDelete(store, 's', 100);
    restoreFromTrash(store, 's', 100);
    softDelete(store, 's', 200);  // delete again with different timestamp
    store[ROUNDS_KEY('s')] = '[]';  // someone recreated active
    assert.throws(() => restoreFromTrash(store, 's', 200), /already exists/);
  });
  it('writes rounds + meta back to active keys', () => {
    const store = {
      [ROUNDS_KEY('s')]: JSON.stringify([{ round: 1 }]),
      [META_KEY('s')]: JSON.stringify({ title: 'T' }),
    };
    softDelete(store, 's', 1000);
    restoreFromTrash(store, 's', 1000);
    assert.equal(store[ROUNDS_KEY('s')], JSON.stringify([{ round: 1 }]));
    assert.equal(store[META_KEY('s')], JSON.stringify({ title: 'T' }));
    assert.equal(listTrash(store).length, 0);
    assert.equal(store[TRASH_RECORD_KEY('s', 1000)], undefined);
  });
  it('only removes the matching entry, keeps others', () => {
    const store = {
      [ROUNDS_KEY('a')]: '[]',
      [ROUNDS_KEY('b')]: '[]',
    };
    softDelete(store, 'a', 100);
    softDelete(store, 'b', 200);
    assert.equal(listTrash(store).length, 2);
    restoreFromTrash(store, 'a', 100);
    assert.equal(listTrash(store).length, 1);
    assert.equal(listTrash(store)[0].sid, 'b');
  });
});

describe('permanentlyDelete', () => {
  it('drops the trash entry and record', () => {
    const store = { [ROUNDS_KEY('s')]: '[]' };
    softDelete(store, 's', 1000);
    permanentlyDelete(store, 's', 1000);
    assert.equal(listTrash(store).length, 0);
    assert.equal(store[TRASH_RECORD_KEY('s', 1000)], undefined);
  });
  it('throws when entry missing', () => {
    assert.throws(() => permanentlyDelete({}, 's', 1), /not found/);
  });
});

describe('purgeExpired', () => {
  it('removes entries older than TTL', () => {
    const store = {};
    const t0 = 1_000_000_000_000;
    // 先 seed active sessions
    for (const sid of ['old', 'mid', 'new']) {
      store[ROUNDS_KEY(sid)] = '[]';
      store[META_KEY(sid)] = '{}';
    }
    softDelete(store, 'old', t0 - TRASH_TTL_MS - 5000);
    softDelete(store, 'mid', t0 - 5000);
    softDelete(store, 'new', t0);
    const r = purgeExpired(store, t0);
    assert.equal(r.purged, 1);  // only 'old'
    assert.equal(r.remaining, 2);
    assert.deepEqual(listTrash(store).map((e) => e.sid).sort(), ['mid', 'new']);
  });
  it('returns 0 purged when nothing is expired', () => {
    const store = { [ROUNDS_KEY('s')]: '[]', [META_KEY('s')]: '{}' };
    const t0 = 1_000_000_000_000;
    softDelete(store, 's', t0);
    const r = purgeExpired(store, t0);
    assert.equal(r.purged, 0);
    assert.equal(r.remaining, 1);
  });
});

describe('daysUntilExpiry', () => {
  it('returns positive days when within TTL', () => {
    const deletedAt = Date.now() - 5 * 24 * 60 * 60 * 1000;  // 5 days ago
    const days = daysUntilExpiry(deletedAt);
    assert.equal(days, 25);  // 30 - 5
  });
  it('returns 0 when expired', () => {
    const deletedAt = Date.now() - 40 * 24 * 60 * 60 * 1000;  // 40 days ago
    assert.equal(daysUntilExpiry(deletedAt), 0);
  });
  it('returns 30 when just deleted', () => {
    const now = 1000;
    const days = daysUntilExpiry(now - 1, now);
    assert.equal(days, 30);
  });
});

describe('end-to-end', () => {
  it('full lifecycle: create → delete → restore → re-delete → permanent', () => {
    const store = {
      [ROUNDS_KEY('proj')]: JSON.stringify([{ round: 1 }]),
      [META_KEY('proj')]: JSON.stringify({ title: 'P' }),
    };
    softDelete(store, 'proj', 1000);
    assert.equal(listTrash(store).length, 1);
    restoreFromTrash(store, 'proj', 1000);
    assert.equal(listTrash(store).length, 0);
    softDelete(store, 'proj', 2000);
    assert.equal(listTrash(store).length, 1);
    permanentlyDelete(store, 'proj', 2000);
    assert.equal(listTrash(store).length, 0);
  });

  it('multiple sessions in trash — selective restore works', () => {
    const store = {
      [ROUNDS_KEY('a')]: '[]',
      [META_KEY('a')]: '{}',
      [ROUNDS_KEY('b')]: '[]',
      [META_KEY('b')]: '{}',
      [ROUNDS_KEY('c')]: '[]',
      [META_KEY('c')]: '{}',
    };
    const t0 = 1_000_000_000_000;
    softDelete(store, 'a', t0 - 5 * 24 * 60 * 60 * 1000);  // 5 days ago
    softDelete(store, 'b', t0 - 2000);
    softDelete(store, 'c', t0 - 3000);
    restoreFromTrash(store, 'b', t0 - 2000);
    const remaining = listTrash(store).map((e) => e.sid).sort();
    assert.deepEqual(remaining, ['a', 'c']);
    assert.equal(daysUntilExpiry(t0 - 5 * 24 * 60 * 60 * 1000, t0), 25);
  });
});

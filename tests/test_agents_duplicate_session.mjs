/**
 * tests/test_agents_duplicate_session.mjs — session 复制(分支实验)的纯逻辑守护。
 *
 * iter #15:让用户一键复制现有 session 到新 sid,以便尝试不同 gate preset /
 * max_rounds / candidates 但保留基线作为对照。
 *
 * 复制内容:
 *   1. 所有 rounds (deep copy JSON)
 *   2. 调整 meta.session_id 字段(每个 RoundRecord 里的 meta.session_id)
 *   3. 把新 session 的 meta.notes 设为
 *      "Branched from <oldSid> at <ISO date>"  + 原 notes(若存在)
 *   4. 把新 session 的 meta.title 设为
 *      "<原 title> (copy)" 或 fallback "Copy of <oldSid>"
 *
 * 不复制的内容:
 *   - 不会被自动选择为 currentSessionId(由调用方决定)
 *
 * 跑法:node tests/test_agents_duplicate_session.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const META_KEY = (sid) => `dpr_agents_meta_${sid}`;
const ROUNDS_KEY = (sid) => `dpr_agents_rounds_${sid}`;

function loadMeta(store, sid, now = Date.now()) {
  const raw = store[META_KEY(sid)];
  if (!raw) return { sid, title: '', notes: '', createdAt: now, updatedAt: now };
  try {
    const obj = JSON.parse(raw);
    return {
      sid,
      title: typeof obj.title === 'string' ? obj.title : '',
      notes: typeof obj.notes === 'string' ? obj.notes : '',
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now,
    };
  } catch {
    return { sid, title: '', notes: '', createdAt: now, updatedAt: now };
  }
}

function saveMeta(store, sid, patch, now = Date.now()) {
  const prev = loadMeta(store, sid, now);
  const next = {
    ...prev,
    ...(patch.title !== undefined ? { title: String(patch.title) } : {}),
    ...(patch.notes !== undefined ? { notes: String(patch.notes) } : {}),
    updatedAt: now,
  };
  store[META_KEY(sid)] = JSON.stringify(next);
  return next;
}

function loadRounds(store, sid) {
  const raw = store[ROUNDS_KEY(sid)];
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function saveRounds(store, sid, records) {
  store[ROUNDS_KEY(sid)] = JSON.stringify(records);
}

// 选一个新 sid,确保不跟已有冲突
function pickNewSid(store, base) {
  let candidate = base;
  let n = 2;
  while (store[ROUNDS_KEY(candidate)] !== undefined || store[META_KEY(candidate)] !== undefined) {
    candidate = `${base}-${n}`;
    n++;
  }
  return candidate;
}

// 调整每条 round 的 meta.session_id 字段(指向新 sid)
function retagRounds(records, newSid) {
  return records.map((r) => ({
    ...r,
    meta: { ...(r.meta ?? {}), session_id: newSid },
  }));
}

function duplicateSession(store, oldSid, newBaseSid, now = Date.now()) {
  if (!oldSid) throw new Error('oldSid required');
  const base = newBaseSid || `${oldSid}-copy`;
  const newSid = pickNewSid(store, base);

  // 1. 复制 rounds(深拷贝 + retag session_id)
  const oldRecords = loadRounds(store, oldSid);
  const newRecords = retagRounds(oldRecords, newSid);
  if (newRecords.length > 0) saveRounds(store, newSid, newRecords);

  // 2. 派生 meta.title / .notes
  const oldMeta = loadMeta(store, oldSid, now);
  const title = oldMeta.title
    ? `${oldMeta.title} (copy)`
    : `Copy of ${oldSid}`;
  const branchNote = `Branched from ${oldSid} at ${new Date(now).toISOString()}`;
  const notes = oldMeta.notes
    ? `${branchNote}\n\n${oldMeta.notes}`
    : branchNote;
  saveMeta(store, newSid, { title, notes }, now);

  return { newSid, title, notes, roundCount: newRecords.length };
}

describe('pickNewSid', () => {
  it('returns base when free', () => {
    const store = {};
    assert.equal(pickNewSid(store, 'foo'), 'foo');
  });
  it('appends -2 when base exists', () => {
    const store = { [ROUNDS_KEY('foo')]: '[]' };
    assert.equal(pickNewSid(store, 'foo'), 'foo-2');
  });
  it('keeps incrementing until free', () => {
    const store = {
      [ROUNDS_KEY('foo')]: '[]',
      [ROUNDS_KEY('foo-2')]: '[]',
      [ROUNDS_KEY('foo-3')]: '[]',
    };
    assert.equal(pickNewSid(store, 'foo'), 'foo-4');
  });
  it('also checks meta keys for collision', () => {
    const store = { [META_KEY('foo')]: '{}' };  // 只有 meta,没 rounds
    assert.equal(pickNewSid(store, 'foo'), 'foo-2');
  });
});

describe('retagRounds', () => {
  it('updates meta.session_id on every round', () => {
    const records = [
      { round: 1, meta: { session_id: 'old', dry_run: true } },
      { round: 2, meta: { session_id: 'old', dry_run: false } },
    ];
    const out = retagRounds(records, 'new');
    assert.equal(out[0].meta.session_id, 'new');
    assert.equal(out[1].meta.session_id, 'new');
    // 保留其他字段
    assert.equal(out[1].meta.dry_run, false);
  });
  it('handles missing meta gracefully', () => {
    const records = [{ round: 1 }];
    const out = retagRounds(records, 'new');
    assert.equal(out[0].meta.session_id, 'new');
  });
  it('does not mutate the input', () => {
    const records = [{ round: 1, meta: { session_id: 'old' } }];
    retagRounds(records, 'new');
    assert.equal(records[0].meta.session_id, 'old');
  });
});

describe('duplicateSession', () => {
  it('copies rounds to new sid', () => {
    const store = {};
    const rounds = [
      { round: 1, meta: { session_id: 'old' }, designer: { proposals: [{ id: 'p1' }] } },
      { round: 2, meta: { session_id: 'old' }, designer: { proposals: [{ id: 'p2' }] } },
    ];
    saveRounds(store, 'old', rounds);
    const result = duplicateSession(store, 'old', '', 1000);
    assert.equal(result.newSid, 'old-copy');
    assert.equal(result.roundCount, 2);
    const copied = loadRounds(store, 'old-copy');
    assert.equal(copied.length, 2);
  });

  it('retags session_id in copied rounds', () => {
    const store = {};
    saveRounds(store, 'old', [{ round: 1, meta: { session_id: 'old' } }]);
    duplicateSession(store, 'old', '', 1000);
    const copied = loadRounds(store, 'old-copy');
    assert.equal(copied[0].meta.session_id, 'old-copy');
    // 原 session 的 records 不动
    const orig = loadRounds(store, 'old');
    assert.equal(orig[0].meta.session_id, 'old');
  });

  it('creates meta with branch note when source has no notes', () => {
    const store = {};
    saveRounds(store, 'old', [{ round: 1, meta: { session_id: 'old' } }]);
    const r = duplicateSession(store, 'old', '', 1700000000000);
    const meta = loadMeta(store, 'old-copy', 1700000000000);
    assert.ok(meta.notes.startsWith('Branched from old at '), `notes="${meta.notes}"`);
    assert.ok(meta.notes.includes('2023-11-14'), 'should include ISO date');
    assert.equal(meta.title, 'Copy of old');
  });

  it('appends branch note to existing notes', () => {
    const store = {};
    saveRounds(store, 'old', [{ round: 1 }]);
    saveMeta(store, 'old', { title: 'My paper', notes: 'tried conservative preset' }, 100);
    const r = duplicateSession(store, 'old', '', 200);
    const meta = loadMeta(store, r.newSid, 200);
    assert.equal(meta.title, 'My paper (copy)');
    assert.ok(meta.notes.startsWith('Branched from old at '));
    assert.ok(meta.notes.endsWith('tried conservative preset'));
    assert.ok(meta.notes.includes('\n\n'));
  });

  it('uses provided newBaseSid as the basis', () => {
    const store = {};
    saveRounds(store, 'old', []);
    const r = duplicateSession(store, 'old', 'experiment-A', 1000);
    assert.equal(r.newSid, 'experiment-A');
  });

  it('throws on empty oldSid', () => {
    const store = {};
    assert.throws(() => duplicateSession(store, '', '', 1000), /oldSid required/);
  });

  it('duplicates a session that has only meta but no rounds', () => {
    const store = {};
    saveMeta(store, 'old', { title: 'Empty session', notes: 'just planning' }, 100);
    const r = duplicateSession(store, 'old', '', 200);
    assert.equal(r.roundCount, 0);
    const meta = loadMeta(store, r.newSid, 200);
    assert.equal(meta.title, 'Empty session (copy)');
    assert.ok(meta.notes.includes('just planning'));
  });

  it('does not touch source session — old data intact', () => {
    const store = {};
    saveRounds(store, 'old', [{ round: 1, meta: { session_id: 'old' } }]);
    saveMeta(store, 'old', { title: 'Orig', notes: 'orig notes' }, 100);
    duplicateSession(store, 'old', '', 200);
    const origMeta = loadMeta(store, 'old', 999);
    assert.equal(origMeta.title, 'Orig');
    assert.equal(origMeta.notes, 'orig notes');
    assert.equal(origMeta.createdAt, 100);
    assert.equal(origMeta.updatedAt, 100);  // 没动
  });
});

/**
 * tests/test_agents_session_export.mjs — session 导出/导入 JSON 的纯逻辑守护。
 *
 * iter #17:让用户把浏览器 localStorage 里的 session 整体导出成一个 JSON
 * 文件(下载),也能从一个 JSON 文件导入到 localStorage。
 *
 * 文件格式:
 * {
 *   kind: 'dpr-agents-session',
 *   version: 1,
 *   exportedAt: <ms>,
 *   session: {
 *     sid: <string>,
 *     meta: { title, notes, createdAt, updatedAt },
 *     rounds: RoundRecord[]
 *   }
 * }
 *
 * 纯函数测,跟 DOM / fetch / Blob 解耦。
 *
 * 跑法:node tests/test_agents_session_export.mjs
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

function loadRounds(store, sid) {
  const raw = store[ROUNDS_KEY(sid)];
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// ---- 导出 ----

function exportSession(store, sid, now = Date.now()) {
  if (!sid) throw new Error('sid required');
  const rounds = loadRounds(store, sid);
  const meta = loadMeta(store, sid, now);
  return {
    kind: 'dpr-agents-session',
    version: 1,
    exportedAt: now,
    session: { sid, meta, rounds },
  };
}

function toExportJson(store, sid, now = Date.now()) {
  return JSON.stringify(exportSession(store, sid, now), null, 2);
}

// ---- 导入 ----

/**
 * 把 export 包写入 store(覆盖目标 sid)。
 * options.targetSid 可指定新 sid(默认用 export 自带的 sid)。
 * options.overwrite=false 时如果目标已有 rounds,抛错。
 */
function importSession(store, exportObj, options = {}, now = Date.now()) {
  if (!exportObj || exportObj.kind !== 'dpr-agents-session') {
    throw new Error('not a dpr-agents-session export');
  }
  if (exportObj.version !== 1) {
    throw new Error(`unsupported version ${exportObj.version}`);
  }
  const sess = exportObj.session;
  if (!sess || !sess.sid) throw new Error('export missing session.sid');
  const targetSid = options.targetSid ?? sess.sid;
  if (!options.overwrite && loadRounds(store, targetSid).length > 0) {
    throw new Error(`target "${targetSid}" already has rounds; pass overwrite=true to replace`);
  }
  // 写 rounds
  store[ROUNDS_KEY(targetSid)] = JSON.stringify(sess.rounds ?? []);
  // 写 meta,retag session_id
  const meta = sess.meta ?? {};
  store[META_KEY(targetSid)] = JSON.stringify({
    ...meta,
    sid: targetSid,
    updatedAt: now,
  });
  return { sid: targetSid, roundsImported: (sess.rounds ?? []).length };
}

// ---- 校验 helpers ----

function assertValidExportShape(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (obj.kind !== 'dpr-agents-session') throw new Error(`bad kind: ${obj.kind}`);
  if (obj.version !== 1) throw new Error(`bad version: ${obj.version}`);
  if (!obj.session || typeof obj.session !== 'object') throw new Error('missing session');
  if (typeof obj.session.sid !== 'string' || !obj.session.sid) throw new Error('missing sid');
  if (!Array.isArray(obj.session.rounds)) throw new Error('rounds not array');
}

describe('exportSession', () => {
  it('throws on empty sid', () => {
    assert.throws(() => exportSession({}, ''), /sid required/);
  });
  it('produces canonical shape with all fields', () => {
    const store = {
      [ROUNDS_KEY('s1')]: JSON.stringify([{ round: 1, meta: { session_id: 's1' } }]),
      [META_KEY('s1')]: JSON.stringify({ title: 'T', notes: 'N', createdAt: 100, updatedAt: 200 }),
    };
    const exp = exportSession(store, 's1', 999);
    assert.equal(exp.kind, 'dpr-agents-session');
    assert.equal(exp.version, 1);
    assert.equal(exp.exportedAt, 999);
    assert.equal(exp.session.sid, 's1');
    assert.equal(exp.session.meta.title, 'T');
    assert.equal(exp.session.rounds.length, 1);
  });
  it('empty session yields empty rounds array', () => {
    const exp = exportSession({}, 'new', 100);
    assert.equal(exp.session.rounds.length, 0);
    assert.equal(exp.session.meta.title, '');
  });
});

describe('toExportJson', () => {
  it('roundtrips through JSON.parse', () => {
    const store = { [ROUNDS_KEY('s')]: JSON.stringify([{ round: 1 }]) };
    const json = toExportJson(store, 's', 1000);
    const obj = JSON.parse(json);
    assert.equal(obj.kind, 'dpr-agents-session');
    assert.ok(obj.session.rounds[0].round === 1);
  });
  it('is pretty-printed (contains newlines)', () => {
    const json = toExportJson({}, 's', 100);
    assert.ok(json.includes('\n'), 'expected pretty-print');
  });
});

describe('importSession', () => {
  function makeExport(sid = 'exp1', rounds = [], meta = {}) {
    return {
      kind: 'dpr-agents-session',
      version: 1,
      exportedAt: 1000,
      session: { sid, meta: { title: '', notes: '', createdAt: 1000, updatedAt: 1000, ...meta }, rounds },
    };
  }

  it('rejects non-export objects', () => {
    assert.throws(() => importSession({}, { foo: 'bar' }, {}, 2000), /not a dpr-agents-session/);
  });
  it('rejects bad version', () => {
    const exp = makeExport();
    exp.version = 99;
    assert.throws(() => importSession({}, exp, {}, 2000), /unsupported version/);
  });
  it('rejects missing sid', () => {
    assert.throws(() => importSession({}, { kind: 'dpr-agents-session', version: 1, session: {} }, {}, 2000), /missing session\.sid/);
  });
  it('writes rounds and meta to target sid', () => {
    const exp = makeExport('src', [{ round: 1 }, { round: 2 }], { title: 'Imported' });
    const store = {};
    const r = importSession(store, exp, {}, 2000);
    assert.equal(r.sid, 'src');
    assert.equal(r.roundsImported, 2);
    assert.equal(loadRounds(store, 'src').length, 2);
    assert.equal(loadMeta(store, 'src', 2000).title, 'Imported');
  });
  it('refuses to overwrite existing rounds without flag', () => {
    const store = { [ROUNDS_KEY('x')]: JSON.stringify([{ round: 1 }]) };
    const exp = makeExport('x');
    assert.throws(() => importSession(store, exp, {}, 2000), /already has rounds/);
  });
  it('overwrites when flag set', () => {
    const store = { [ROUNDS_KEY('x')]: JSON.stringify([{ round: 1 }]) };
    const exp = makeExport('x', [{ round: 2 }, { round: 3 }]);
    const r = importSession(store, exp, { overwrite: true }, 2000);
    assert.equal(loadRounds(store, 'x').length, 2);
    assert.equal(r.roundsImported, 2);
  });
  it('targetSid redirects import to different sid', () => {
    const exp = makeExport('orig', [{ round: 1 }]);
    const store = {};
    const r = importSession(store, exp, { targetSid: 'renamed' }, 2000);
    assert.equal(r.sid, 'renamed');
    assert.equal(loadRounds(store, 'renamed').length, 1);
    assert.equal(loadRounds(store, 'orig').length, 0);
    // meta's sid 字段也 retag
    assert.equal(loadMeta(store, 'renamed', 2000).sid, 'renamed');
  });
  it('bumps updatedAt to import time', () => {
    const exp = makeExport('s', [], { updatedAt: 100 });
    const store = {};
    importSession(store, exp, {}, 5000);
    assert.equal(loadMeta(store, 's', 5000).updatedAt, 5000);
  });
  it('preserves createdAt', () => {
    const exp = makeExport('s', [], { createdAt: 100, updatedAt: 200 });
    const store = {};
    importSession(store, exp, {}, 5000);
    const m = loadMeta(store, 's', 5000);
    assert.equal(m.createdAt, 100);
    assert.equal(m.updatedAt, 5000);
  });
});

describe('roundtrip: export → import', () => {
  it('produces an equivalent session', () => {
    const store = {
      [ROUNDS_KEY('my')]: JSON.stringify([
        { round: 1, designer: { proposals: [{ id: 'p1', title: 'A' }] } },
        { round: 2, designer: { proposals: [{ id: 'p2', title: 'B' }] } },
      ]),
      [META_KEY('my')]: JSON.stringify({ title: 'My', notes: 'hi', createdAt: 100, updatedAt: 200 }),
    };
    const exp = exportSession(store, 'my', 999);
    const json = toExportJson(store, 'my', 999);
    const before = JSON.parse(json);

    // 验证 shape
    assertValidExportShape(before);

    // 倒到新 store
    const store2 = {};
    importSession(store2, before, {}, 2000);
    assert.deepEqual(loadRounds(store2, 'my'), loadRounds(store, 'my'));
    const m1 = loadMeta(store, 'my', 1);
    const m2 = loadMeta(store2, 'my', 1);
    assert.equal(m1.title, m2.title);
    assert.equal(m1.notes, m2.notes);
    assert.equal(m1.createdAt, m2.createdAt);
    // updatedAt 不同(import 推到了 2000)
    assert.equal(m2.updatedAt, 2000);
    void exp;  // silence lint
  });
});

/**
 * tests/test_agents_bulk_import.mjs — 批量导入逻辑测试。
 *
 * iter #23:把多 JSON 一次性拖入,逐个 importSessionFromFile
 * 然后汇总 ✅/❌ 计数。
 *
 * 跑法:node tests/test_agents_bulk_import.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reuse importSession from earlier suite (mirror logic)
const META_KEY = (sid) => `dpr_agents_meta_${sid}`;
const ROUNDS_KEY = (sid) => `dpr_agents_rounds_${sid}`;

function loadRounds(store, sid) {
  const raw = store[ROUNDS_KEY(sid)];
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

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
  store[ROUNDS_KEY(targetSid)] = JSON.stringify(sess.rounds ?? []);
  const meta = sess.meta ?? {};
  store[META_KEY(targetSid)] = JSON.stringify({ ...meta, sid: targetSid, updatedAt: now });
  return { sid: targetSid, roundsImported: (sess.rounds ?? []).length };
}

function bulkImport(store, exports, overwrite = false) {
  const results = [];
  let lastSid = '';
  for (const e of exports) {
    try {
      const r = importSession(store, e.exportObj, { overwrite }, 2000);
      results.push({ ok: true, name: e.name, sid: r.sid, rounds: r.roundsImported });
      lastSid = r.sid;
    } catch (err) {
      results.push({ ok: false, name: e.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, lastSid };
}

function mkExport(sid, n = 2) {
  return {
    kind: 'dpr-agents-session',
    version: 1,
    exportedAt: 1000,
    session: {
      sid,
      meta: { title: sid, notes: '', createdAt: 1000, updatedAt: 1000, tags: [] },
      rounds: Array.from({ length: n }, (_, i) => ({ round: i + 1 })),
    },
  };
}

describe('bulkImport', () => {
  it('imports multiple files in order', () => {
    const store = {};
    const { results, lastSid } = bulkImport(store, [
      { name: 'a.json', exportObj: mkExport('alpha', 3) },
      { name: 'b.json', exportObj: mkExport('beta', 2) },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results.filter((r) => r.ok).length, 2);
    assert.equal(results[0].sid, 'alpha');
    assert.equal(results[0].rounds, 3);
    assert.equal(lastSid, 'beta');  // last success
    assert.equal(loadRounds(store, 'alpha').length, 3);
    assert.equal(loadRounds(store, 'beta').length, 2);
  });

  it('continues on individual failures', () => {
    const store = {};
    const { results } = bulkImport(store, [
      { name: 'good.json', exportObj: mkExport('good') },
      { name: 'bad.json', exportObj: { kind: 'wrong' } },
      { name: 'also-good.json', exportObj: mkExport('also-good') },
    ]);
    assert.equal(results.length, 3);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.ok(results[1].error.includes('not a dpr-agents-session'));
    assert.equal(results[2].ok, true);
  });

  it('skips duplicates unless overwrite', () => {
    const store = {};
    bulkImport(store, [{ name: 'a.json', exportObj: mkExport('dup', 2) }]);
    const { results } = bulkImport(store, [
      { name: 'a-again.json', exportObj: mkExport('dup', 5) },
    ], /* overwrite */ false);
    assert.equal(results[0].ok, false);
    assert.ok(results[0].error.includes('already has rounds'));
    // rounds count unchanged
    assert.equal(loadRounds(store, 'dup').length, 2);
  });

  it('overwrites when flag set', () => {
    const store = {};
    bulkImport(store, [{ name: 'a.json', exportObj: mkExport('dup', 2) }]);
    const { results } = bulkImport(store, [
      { name: 'a-again.json', exportObj: mkExport('dup', 5) },
    ], /* overwrite */ true);
    assert.equal(results[0].ok, true);
    assert.equal(loadRounds(store, 'dup').length, 5);
  });

  it('empty list → empty results', () => {
    const { results, lastSid } = bulkImport({}, []);
    assert.equal(results.length, 0);
    assert.equal(lastSid, '');
  });
});

/**
 * tests/test_agents_manifest.mjs — archive manifest 守护。
 *
 * 镜像 astro-src/scripts/build-archive-manifest.mjs 的核心聚合逻辑,
 * 在临时目录里构造若干 round_NNN.json,跑一遍,确认 schema 与算法。
 *
 * 跑法:node tests/test_agents_manifest.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 直接复刻 build-archive-manifest.mjs 的循环(测试用)
function buildManifest(archiveRoot) {
  if (!existsSync(archiveRoot)) return { generated_at: Date.now(), sessions: [] };
  const sessions = [];
  for (const sid of readdirSync(archiveRoot)) {
    const sdir = join(archiveRoot, sid);
    if (!statSync(sdir).isDirectory()) continue;
    const roundsDir = join(sdir, 'rounds');
    if (!existsSync(roundsDir)) continue;
    const files = readdirSync(roundsDir).filter((f) => /^round_\d+\.json$/.test(f)).sort();
    if (files.length === 0) continue;
    let rounds = 0, proposals = 0, critiques = 0, applied = 0;
    let totalScore = 0, totalElo = 0;
    let firstAt = Infinity, lastAt = -Infinity;
    const topTitles = [];
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(roundsDir, f), 'utf8'));
      rounds += 1;
      proposals += (rec.designer?.proposals ?? []).length;
      const cs = rec.feedback?.critiques ?? [];
      critiques += cs.length;
      for (const c of cs) { totalScore += c.total; totalElo += c.elo; }
      applied += (rec.modifier?.applied ?? []).length;
      if (rec.started_at) firstAt = Math.min(firstAt, rec.started_at);
      if (rec.finished_at) lastAt = Math.max(lastAt, rec.finished_at);
      const byId = new Map((rec.designer?.proposals ?? []).map((p) => [p.id, p.title]));
      for (const a of rec.modifier?.applied ?? []) {
        if (topTitles.length >= 5) break;
        const title = byId.get(a.proposal_id) ?? a.proposal_id;
        if (title && !topTitles.includes(title)) topTitles.push(title);
      }
    }
    sessions.push({
      sid, rounds, proposals, critiques, applied,
      avgScore: critiques ? +(totalScore / critiques).toFixed(2) : 0,
      avgElo: critiques ? Math.round(totalElo / critiques) : 0,
      firstAt: firstAt === Infinity ? 0 : firstAt,
      lastAt: lastAt === -Infinity ? 0 : lastAt,
      topAppliedTitles: topTitles.slice(0, 3),
    });
  }
  sessions.sort((a, b) => b.lastAt - a.lastAt);
  return { generated_at: Date.now(), sessions };
}

describe('build-archive-manifest (re-implemented)', () => {
  const tmp = join(tmpdir(), `dpr-archive-manifest-test-${Date.now()}`);

  before(() => {
    // 构造虚拟 archive 目录
    mkdirSync(join(tmp, '20260101', 'rounds'), { recursive: true });
    mkdirSync(join(tmp, '20260102', 'rounds'), { recursive: true });
    mkdirSync(join(tmp, 'no-rounds-dir'), { recursive: true });
    writeFileSync(join(tmp, 'carryover.json'), '{}');  // 应该被忽略

    writeFileSync(join(tmp, '20260101', 'rounds', 'round_001.json'), JSON.stringify({
      schema_version: 1, round: 1, project_id: '20260101',
      started_at: 1000, finished_at: 1500,
      designer: {
        proposals: [{ id: 'p1', title: 'Paper Alpha' }, { id: 'p2', title: 'Paper Beta' }],
        prompt_summary: '', model: 'stub',
      },
      feedback: {
        critiques: [
          { proposal_id: 'p1', total: 8, elo: 1280, scores: {}, critique: '', matches: 0, wins: 0, persona_attribution: {} },
          { proposal_id: 'p2', total: 6, elo: 1240, scores: {}, critique: '', matches: 0, wins: 0, persona_attribution: {} },
        ],
        judge_calls: 1, total_tokens: 100,
      },
      gate: { verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [] },
      modifier: {
        applied: [
          { id: 'a1', kind: 'create_draft_outline', proposal_id: 'p1', payload: {}, applied_at: 1400 },
          { id: 'a2', kind: 'add_paper_to_stage', proposal_id: 'p2', payload: {}, applied_at: 1450 },
        ],
        skipped: [],
      },
      meta: { session_id: '20260101', dry_run: false },
    }));
    writeFileSync(join(tmp, '20260101', 'rounds', 'round_002.json'), JSON.stringify({
      schema_version: 1, round: 2, project_id: '20260101',
      started_at: 2000, finished_at: 2500,
      designer: { proposals: [{ id: 'p3', title: 'Paper Gamma' }], prompt_summary: '', model: 'stub' },
      feedback: { critiques: [{ proposal_id: 'p3', total: 10, elo: 1300, scores: {}, critique: '', matches: 0, wins: 0, persona_attribution: {} }], judge_calls: 1, total_tokens: 50 },
      gate: { verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [] },
      modifier: { applied: [], skipped: [] },
      meta: { session_id: '20260101', dry_run: false },
    }));

    writeFileSync(join(tmp, '20260102', 'rounds', 'round_001.json'), JSON.stringify({
      schema_version: 1, round: 1, project_id: '20260102',
      started_at: 3000, finished_at: 3500,
      designer: { proposals: [{ id: 'q1', title: 'Other Session' }], prompt_summary: '', model: 'stub' },
      feedback: { critiques: [], judge_calls: 0, total_tokens: 0 },
      gate: { verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [] },
      modifier: { applied: [], skipped: [] },
      meta: { session_id: '20260102', dry_run: false },
    }));
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('skips non-directory entries (carryover.json)', () => {
    const out = buildManifest(tmp);
    assert.equal(out.sessions.length, 2, 'should have 2 sessions');
    assert.ok(out.sessions.every((s) => s.sid !== 'carryover.json'));
  });

  it('skips sessions with no rounds/ dir', () => {
    const out = buildManifest(tmp);
    assert.ok(!out.sessions.some((s) => s.sid === 'no-rounds-dir'));
  });

  it('aggregates rounds + proposals + applied across rounds', () => {
    const out = buildManifest(tmp);
    const s1 = out.sessions.find((s) => s.sid === '20260101');
    assert.equal(s1.rounds, 2);
    assert.equal(s1.proposals, 3);   // 2 + 1
    assert.equal(s1.applied, 2);     // 2 in round 1, 0 in round 2
  });

  it('averages score + elo across all critiques in session', () => {
    const out = buildManifest(tmp);
    const s1 = out.sessions.find((s) => s.sid === '20260101');
    // scores 8,6,10 → avg 8; elo 1280,1240,1300 → avg 1273
    assert.equal(s1.avgScore, 8);
    assert.equal(s1.avgElo, 1273);
  });

  it('returns 0 for avg when there are no critiques', () => {
    const out = buildManifest(tmp);
    const s2 = out.sessions.find((s) => s.sid === '20260102');
    assert.equal(s2.critiques, 0);
    assert.equal(s2.avgScore, 0);
    assert.equal(s2.avgElo, 0);
  });

  it('captures lastAt from the latest finished_at', () => {
    const out = buildManifest(tmp);
    const s1 = out.sessions.find((s) => s.sid === '20260101');
    assert.equal(s1.firstAt, 1000);
    assert.equal(s1.lastAt, 2500);
  });

  it('extracts topAppliedTitles from modifier.applied → designer.proposals', () => {
    const out = buildManifest(tmp);
    const s1 = out.sessions.find((s) => s.sid === '20260101');
    assert.deepEqual(s1.topAppliedTitles, ['Paper Alpha', 'Paper Beta']);
  });

  it('sorts sessions by lastAt desc (newest first)', () => {
    const out = buildManifest(tmp);
    // 20260102 lastAt=3500 > 20260101 lastAt=2500 → 20260102 排第一
    const sids = out.sessions.map((s) => s.sid);
    assert.equal(sids[0], '20260102');
    assert.equal(sids[1], '20260101');
  });

  it('returns empty array when archive dir does not exist', () => {
    const out = buildManifest('/tmp/this-does-not-exist-xyz-99999');
    assert.equal(out.sessions.length, 0);
    assert.equal(typeof out.generated_at, 'number');
  });
});

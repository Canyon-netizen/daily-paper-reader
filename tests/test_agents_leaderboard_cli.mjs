/**
 * tests/test_agents_leaderboard_cli.mjs — `--leaderboard` 跨 session 聚合
 *
 * 覆盖:
 *   aggregateLeaderboard:
 *    1. 空 sessions → totals 全 0,byType/topElo/topSessions 都空
 *    2. 单 session 单 round → byType 含 type,topSessions 含 1
 *    3. 多 session → totals.sessions 正确,topSessions 按 applied 倒序
 *    4. typeFilter 只统计匹配 type 的 proposals
 *    5. avgScore 按 type 加权平均,NaN-safe
 *    6. applyRate = applied/count(0/0 兜底为 0)
 *    7. topElo 过滤初始 1200 + 按 elo 倒序 + 限制 topN
 *    8. byType 按 count 倒序
 *
 *   formatLeaderboardText:
 *    9. 含 🏆 标题 + totals 行 + 各 section header
 *   10. typeFilter 时 header 含 (filtered: type = X)
 *   11. 空 sessions → (no proposals match)
 *
 *   CLI surface (regex):
 *   12. --leaderboard flag + --top N + --type X 都存在
 *   13. --leaderboard 在 --help 描述
 *   14. export aggregateLeaderboard + formatLeaderboardText
 *   15. main() 分支读取 args.leaderboard + args.top + args.type
 *
 * 跑法:node --test tests/test_agents_leaderboard_cli.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliSrc = await readFile(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')),
  'utf8',
);

process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')).href
);
const { aggregateLeaderboard, formatLeaderboardText } = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRec(round, proposalDefs) {
  const proposals = proposalDefs.map((p, i) => ({
    id: p.id ?? `p_${round}_${i}`,
    round,
    type: p.type ?? 'add_paper',
    title: p.title ?? `Round ${round} proposal ${i}`,
    rationale: '',
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'medium',
    risk: '',
    created_at: 1700000000000 + round * 1000 + i,
  }));
  const critiques = proposals.map((p, i) => {
    const def = proposalDefs[i] ?? {};
    return {
      proposal_id: p.id,
      scores: { methodologist: 7, engineer: 7, skeptic: 7 },
      total: def.score ?? 5,
      elo: def.elo ?? 1200,
      matches: def.matches ?? 0,
      wins: def.wins ?? 0,
      persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
    };
  });
  const verdicts = proposals.map((p, i) => {
    const def = proposalDefs[i] ?? {};
    return { proposal_id: p.id, decision: def.decision ?? 'sketch', reasons: [] };
  });
  const buckets = { promoted: [], candidate: [], sketch: [], rejected: [] };
  for (const v of verdicts) buckets[v.decision].push(v.proposal_id);
  return {
    schema_version: 1,
    round,
    project_id: 'leader-test',
    started_at: 1700000000000 + round * 60000,
    finished_at: 1700000000000 + round * 60000 + 30000,
    designer: { proposals, prompt_summary: '', model: 'stub' },
    feedback: { critiques, judge_calls: 0, total_tokens: 0 },
    gate: { verdicts, ...buckets },
    modifier: {
      applied: proposalDefs.filter((p) => p.applied).map((p, i) => ({
        id: `m_${i}`,
        kind: 'archive_round_summary',
        proposal_id: p.id ?? `p_${round}_${i}`,
        payload: {},
        applied_at: 0,
      })),
      skipped: [],
    },
    meta: { session_id: 'leader-test', dry_run: true },
  };
}

// ---------------------------------------------------------------------------
// aggregateLeaderboard
// ---------------------------------------------------------------------------

describe('aggregateLeaderboard', () => {
  it('empty sessions → zero totals + empty arrays', () => {
    const r = aggregateLeaderboard([]);
    assert.deepEqual(r.totals, { sessions: 0, rounds: 0, proposals: 0, applied: 0, skipped: 0 });
    assert.deepEqual(r.byType, []);
    assert.deepEqual(r.topElo, []);
    assert.deepEqual(r.topSessions, []);
  });

  it('single session single round → byType populated', () => {
    const records = [makeRec(1, [
      { id: 'a', type: 'add_paper', score: 8, decision: 'promoted', applied: true },
      { id: 'b', type: 'create_draft', score: 5, decision: 'sketch' },
    ])];
    const r = aggregateLeaderboard([{ sessionId: 's1', records }]);
    assert.equal(r.totals.sessions, 1);
    assert.equal(r.totals.rounds, 1);
    assert.equal(r.totals.proposals, 2);
    assert.equal(r.totals.applied, 1);
    assert.equal(r.byType.length, 2);
    const addPaper = r.byType.find((t) => t.type === 'add_paper');
    assert.equal(addPaper.count, 1);
    assert.equal(addPaper.avgScore, 8);
    assert.equal(addPaper.applyRate, 1);
    assert.equal(addPaper.promoted, 1);
  });

  it('multi-session → totals.sessions + topSessions sorted by applied', () => {
    const recordsA = [
      makeRec(1, [
        { id: 'a1', type: 'add_paper', score: 8, decision: 'promoted', applied: true },
        { id: 'a2', type: 'add_paper', score: 8, decision: 'promoted', applied: true },
      ]),
    ];
    const recordsB = [
      makeRec(1, [
        { id: 'b1', type: 'add_paper', score: 7, decision: 'candidate' },
      ]),
    ];
    const r = aggregateLeaderboard([
      { sessionId: 'A', records: recordsA },
      { sessionId: 'B', records: recordsB },
    ]);
    assert.equal(r.totals.sessions, 2);
    assert.equal(r.topSessions[0].sessionId, 'A'); // applied=2 > applied=0
    assert.equal(r.topSessions[0].applied, 2);
    assert.equal(r.topSessions[1].sessionId, 'B');
    assert.equal(r.topSessions[1].applied, 0);
  });

  it('typeFilter restricts counting to matching type', () => {
    const records = [makeRec(1, [
      { id: 'a', type: 'add_paper', score: 8 },
      { id: 'b', type: 'create_draft', score: 7 },
      { id: 'c', type: 'add_paper', score: 6 },
    ])];
    const r = aggregateLeaderboard(
      [{ sessionId: 's1', records }],
      { typeFilter: 'add_paper' },
    );
    assert.equal(r.totals.proposals, 2); // 只数 add_paper
    assert.equal(r.byType.length, 1);
    assert.equal(r.byType[0].type, 'add_paper');
    assert.equal(r.byType[0].count, 2);
    assert.equal(r.byType[0].avgScore, 7); // (8+6)/2
  });

  it('avgScore is weighted mean of all critiques for that type', () => {
    const records = [
      makeRec(1, [
        { id: 'a', type: 'add_paper', score: 6 },
        { id: 'b', type: 'add_paper', score: 9 },
        { id: 'c', type: 'create_draft', score: 5 },
      ]),
    ];
    const r = aggregateLeaderboard([{ sessionId: 's1', records }]);
    const addPaper = r.byType.find((t) => t.type === 'add_paper');
    assert.equal(addPaper.avgScore, 7.5); // (6+9)/2
    const createDraft = r.byType.find((t) => t.type === 'create_draft');
    assert.equal(createDraft.avgScore, 5);
  });

  it('applyRate = applied/count, zero-guards', () => {
    const records = [makeRec(1, [
      { id: 'a', type: 'add_paper', score: 5, applied: true },
      { id: 'b', type: 'add_paper', score: 5 }, // not applied
      { id: 'c', type: 'add_paper', score: 5 }, // not applied
    ])];
    const r = aggregateLeaderboard([{ sessionId: 's1', records }]);
    const addPaper = r.byType.find((t) => t.type === 'add_paper');
    assert.equal(addPaper.applyRate, Math.round((1 / 3) * 1000) / 1000);
  });

  it('topElo skips initial 1200, sorted desc, limited to topN', () => {
    const records = [
      makeRec(1, [
        { id: 'p1', type: 'add_paper', score: 5, elo: 1300, matches: 5 },
        { id: 'p2', type: 'add_paper', score: 5, elo: 1200, matches: 0 }, // skip
        { id: 'p3', type: 'add_paper', score: 5, elo: 1450, matches: 5 },
        { id: 'p4', type: 'add_paper', score: 5, elo: 1280, matches: 5 },
      ]),
    ];
    const r = aggregateLeaderboard([{ sessionId: 's1', records }], { topN: 2 });
    assert.equal(r.topElo.length, 2);
    assert.equal(r.topElo[0].elo, 1450);
    assert.equal(r.topElo[1].elo, 1300);
    // p4 1280 + p2 1200 都被过滤掉
  });

  it('byType sorted by count desc', () => {
    const records = [makeRec(1, [
      { id: 'a1', type: 'rare' },
      { id: 'a2', type: 'common' },
      { id: 'a3', type: 'common' },
      { id: 'a4', type: 'common' },
      { id: 'a5', type: 'medium' },
      { id: 'a6', type: 'medium' },
    ])];
    const r = aggregateLeaderboard([{ sessionId: 's1', records }]);
    assert.equal(r.byType[0].type, 'common'); // 3
    assert.equal(r.byType[1].type, 'medium'); // 2
    assert.equal(r.byType[2].type, 'rare'); // 1
  });
});

// ---------------------------------------------------------------------------
// formatLeaderboardText
// ---------------------------------------------------------------------------

describe('formatLeaderboardText', () => {
  it('includes 🏆 title + totals line + section headers', () => {
    const records = [makeRec(1, [
      { id: 'a', type: 'add_paper', score: 8, decision: 'promoted', applied: true, elo: 1300, matches: 5 },
    ])];
    const report = aggregateLeaderboard([{ sessionId: 's1', records }]);
    const text = formatLeaderboardText(report);
    assert.match(text, /🏆 Cross-session Leaderboard/);
    assert.match(text, /Totals:/);
    assert.match(text, /📊 By Proposal Type/);
    assert.match(text, /🥇 Top Elo Proposals/);
    assert.match(text, /📂 Most Active Sessions/);
  });

  it('shows typeFilter in header when set', () => {
    const records = [makeRec(1, [{ id: 'a', type: 'add_paper', score: 8 }])];
    const report = aggregateLeaderboard([{ sessionId: 's1', records }], { typeFilter: 'add_paper' });
    const text = formatLeaderboardText(report, { typeFilter: 'add_paper' });
    assert.match(text, /filtered: type = add_paper/);
  });

  it('empty sessions → (no proposals match)', () => {
    const report = aggregateLeaderboard([]);
    const text = formatLeaderboardText(report);
    assert.match(text, /\(no proposals match\)/);
  });
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI surface (--leaderboard)', () => {
  it('exposes --leaderboard / --top / --type flags', () => {
    assert.match(cliSrc, /--leaderboard/);
    assert.match(cliSrc, /--top/);
    assert.match(cliSrc, /--type/);
  });

  it('describes --leaderboard in help text', () => {
    const helpMatch = cliSrc.match(/console\.log\(`Usage:[^`]*`\)/);
    assert.ok(helpMatch);
    assert.match(helpMatch[0], /--leaderboard/);
  });

  it('exports aggregateLeaderboard + formatLeaderboardText', () => {
    assert.match(cliSrc, /export function aggregateLeaderboard/);
    assert.match(cliSrc, /export function formatLeaderboardText/);
  });

  it('main() branches on args.leaderboard + reads args.top + args.type', () => {
    assert.match(cliSrc, /args\.leaderboard/);
    assert.match(cliSrc, /args\.top/);
    assert.match(cliSrc, /args\.type/);
    const lbBlock = cliSrc.slice(cliSrc.indexOf('if (args.leaderboard)'));
    assert.match(lbBlock, /loadLeaderboard\(\{ topN, typeFilter \}\)/);
  });
});

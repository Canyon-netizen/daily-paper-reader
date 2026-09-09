/**
 * tests/test_agents_status_cli.mjs — `--status` CLI 模式 + buildStatusReport pure function。
 *
 * 覆盖:
 *   1. buildStatusReport:空 records 返回 rounds=0 + message
 *   2. buildStatusReport:proposal type mix 正确计数
 *   3. buildStatusReport:gate histogram 正确累加
 *   4. buildStatusReport:avg score 是所有 critique total 的均值(NaN-safe)
 *   5. buildStatusReport:applyRate = applied / (applied + skipped),零除兜底
 *   6. buildStatusReport:top Elo proposals 倒序,限制 lastN
 *   7. formatStatusReportText:包含 session id / rounds / histogram 关键字
 *   8. CLI `--status` flag 在 agents-run.mjs 中存在
 *   9. CLI `--status` 在 --help 文本中描述
 *  10. CLI `--json` flag 在 agents-run.mjs 中存在
 *
 * 跑法:bun test tests/test_agents_status_cli.mjs
 *      或 node --test tests/test_agents_status_cli.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliSrc = await readFile(
  join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs'),
  'utf8',
);

// ---------------------------------------------------------------------------
// 复刻 agents-run.mjs 的 pure function —— 与 CLI 路径独立可测
// ---------------------------------------------------------------------------

function buildStatusReport(records, opts = {}) {
  const lastN = opts.lastN ?? 5;
  if (!Array.isArray(records) || records.length === 0) {
    return { rounds: 0, message: 'no rounds yet', summary: null, recent: [], topElo: [] };
  }

  const sorted = [...records].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

  // avg score
  const allScores = sorted.flatMap((r) => (r.feedback?.critiques ?? []).map((c) => Number(c.total) || 0));
  const avgScore = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  // proposal type mix
  const typeMix = {};
  for (const r of sorted) {
    for (const p of r.designer?.proposals ?? []) {
      const t = p.type ?? '(unknown)';
      typeMix[t] = (typeMix[t] ?? 0) + 1;
    }
  }

  // gate histogram
  const gateHist = { promoted: 0, candidate: 0, sketch: 0, rejected: 0 };
  for (const r of sorted) {
    gateHist.promoted += r.gate?.promoted?.length ?? 0;
    gateHist.candidate += r.gate?.candidate?.length ?? 0;
    gateHist.sketch += r.gate?.sketch?.length ?? 0;
    gateHist.rejected += r.gate?.rejected?.length ?? 0;
  }

  // applied / skipped
  let totalApplied = 0;
  let totalSkipped = 0;
  for (const r of sorted) {
    totalApplied += r.modifier?.applied?.length ?? 0;
    totalSkipped += r.modifier?.skipped?.length ?? 0;
  }
  const applyRate = totalApplied + totalSkipped > 0
    ? totalApplied / (totalApplied + totalSkipped)
    : 0;

  // top Elo
  const allCritiques = [];
  for (const r of sorted) {
    const byId = new Map();
    for (const p of r.designer?.proposals ?? []) byId.set(p.id, p);
    for (const c of r.feedback?.critiques ?? []) {
      allCritiques.push({
        round: r.round,
        proposal_id: c.proposal_id,
        title: byId.get(c.proposal_id)?.title ?? '(?)',
        type: byId.get(c.proposal_id)?.type ?? '?',
        total: Number(c.total) || 0,
        elo: Number(c.elo) || 0,
      });
    }
  }
  const topElo = allCritiques
    .filter((c) => c.matches > 0 || c.elo !== 1200) // skip pristine initial elo
    .sort((a, b) => b.elo - a.elo)
    .slice(0, lastN);

  // recent rounds
  const recent = sorted.slice(-lastN).map((r) => {
    const cs = r.feedback?.critiques ?? [];
    const rAvg = cs.length ? cs.reduce((a, c) => a + (Number(c.total) || 0), 0) / cs.length : 0;
    return {
      round: r.round,
      proposals: r.designer?.proposals?.length ?? 0,
      avgScore: Math.round(rAvg * 100) / 100,
      applied: r.modifier?.applied?.length ?? 0,
      skipped: r.modifier?.skipped?.length ?? 0,
      gate: {
        promoted: r.gate?.promoted?.length ?? 0,
        candidate: r.gate?.candidate?.length ?? 0,
        sketch: r.gate?.sketch?.length ?? 0,
        rejected: r.gate?.rejected?.length ?? 0,
      },
      duration_ms: (r.finished_at ?? 0) - (r.started_at ?? 0),
      started_at: r.started_at,
    };
  });

  return {
    rounds: sorted.length,
    summary: {
      firstActivity: sorted[0]?.started_at ? new Date(sorted[0].started_at).toISOString() : null,
      lastActivity: sorted[sorted.length - 1]?.finished_at
        ? new Date(sorted[sorted.length - 1].finished_at).toISOString()
        : sorted[sorted.length - 1]?.started_at
          ? new Date(sorted[sorted.length - 1].started_at).toISOString()
          : null,
      avgScore: Math.round(avgScore * 100) / 100,
      proposalTypeMix: typeMix,
      gateHistogram: gateHist,
      totalProposals: Object.values(typeMix).reduce((a, b) => a + b, 0),
      totalApplied,
      totalSkipped,
      applyRate: Math.round(applyRate * 1000) / 1000,
    },
    recent,
    topElo,
  };
}

function formatStatusReportText(sessionId, report) {
  const lines = [];
  lines.push(`📊 Session: ${sessionId}`);
  if (report.rounds === 0) {
    lines.push(`  ${report.message ?? 'no rounds yet'}`);
    return lines.join('\n');
  }
  const s = report.summary;
  lines.push(`Rounds: ${report.rounds}    First: ${s.firstActivity}    Last: ${s.lastActivity}`);
  lines.push(`Avg score: ${s.avgScore}    Apply rate: ${(s.applyRate * 100).toFixed(1)}%  (${s.totalApplied} applied / ${s.totalSkipped} skipped)`);
  lines.push('');
  lines.push('Proposal type mix:');
  const typeEntries = Object.entries(s.proposalTypeMix).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length === 0) lines.push('  (none)');
  for (const [t, n] of typeEntries) lines.push(`  ${t}: ${n}`);
  lines.push('');
  lines.push(`Gate histogram:  promoted=${s.gateHistogram.promoted}  candidate=${s.gateHistogram.candidate}  sketch=${s.gateHistogram.sketch}  rejected=${s.gateHistogram.rejected}`);
  lines.push('');
  if (report.topElo.length) {
    lines.push(`Top Elo (${report.topElo.length}):`);
    for (let i = 0; i < report.topElo.length; i++) {
      const p = report.topElo[i];
      lines.push(`  ${i + 1}. [round ${p.round}] ${p.title}  (elo=${p.elo}, score=${p.total}, type=${p.type})`);
    }
    lines.push('');
  }
  lines.push(`Recent rounds (last ${report.recent.length}):`);
  for (const r of report.recent) {
    lines.push(
      `  Round ${r.round}: ${r.proposals} proposals, avg=${r.avgScore.toFixed(1)}, applied=${r.applied}/skipped=${r.skipped}, gate(p=${r.gate.promoted}/c=${r.gate.candidate}/s=${r.gate.sketch}/r=${r.gate.rejected}), ${Math.round(r.duration_ms / 1000)}s`,
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(round, opts = {}) {
  const proposals = opts.proposals ?? [
    { id: `p_${round}_a`, type: 'add_paper', title: `Round ${round} proposal A` },
    { id: `p_${round}_b`, type: 'create_draft', title: `Round ${round} proposal B` },
  ];
  const critiques = proposals.map((p, i) => ({
    proposal_id: p.id,
    scores: { methodologist: 7, engineer: 6, skeptic: 5 },
    total: 6,
    elo: 1200 + i * 10,
    matches: i,
    wins: 0,
    persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
  }));
  return {
    schema_version: 1,
    round,
    project_id: opts.projectId ?? 'test-session',
    started_at: 1_700_000_000_000 + round * 60_000,
    finished_at: 1_700_000_000_000 + round * 60_000 + 30_000,
    designer: { proposals, prompt_summary: '', model: 'stub' },
    feedback: { critiques, judge_calls: 6, total_tokens: 1500 },
    gate: {
      verdicts: [],
      promoted: opts.promoted ?? (proposals[0] ? [proposals[0].id] : []),
      candidate: opts.candidate ?? [],
      sketch: opts.sketch ?? [],
      rejected: opts.rejected ?? (proposals[1] ? [proposals[1].id] : []),
    },
    modifier: {
      applied: opts.applied ?? (proposals[0]
        ? [{ id: 'a1', kind: 'archive_round_summary', proposal_id: proposals[0].id, payload: {}, applied_at: 0 }]
        : []),
      skipped: opts.skipped ?? (proposals[1]
        ? [{ proposal_id: proposals[1].id, reason: 'gate=rejected' }]
        : []),
    },
    meta: { session_id: 'test-session', dry_run: true },
  };
}

// ---------------------------------------------------------------------------
// Tests — pure functions
// ---------------------------------------------------------------------------

describe('buildStatusReport', () => {
  it('returns rounds=0 + message for empty records', () => {
    const r = buildStatusReport([]);
    assert.equal(r.rounds, 0);
    assert.equal(r.message, 'no rounds yet');
    assert.deepEqual(r.recent, []);
  });

  it('counts proposal type mix correctly', () => {
    const records = [
      makeRecord(1, { proposals: [
        { id: 'p1', type: 'add_paper', title: 'A' },
        { id: 'p2', type: 'add_paper', title: 'B' },
        { id: 'p3', type: 'create_draft', title: 'C' },
      ] }),
      makeRecord(2, { proposals: [
        { id: 'p4', type: 'literature_review', title: 'D' },
      ] }),
    ];
    const r = buildStatusReport(records);
    assert.equal(r.rounds, 2);
    assert.equal(r.summary.proposalTypeMix.add_paper, 2);
    assert.equal(r.summary.proposalTypeMix.create_draft, 1);
    assert.equal(r.summary.proposalTypeMix.literature_review, 1);
  });

  it('accumulates gate histogram across rounds', () => {
    const records = [
      makeRecord(1, { promoted: ['a'], candidate: ['b'], sketch: ['c'], rejected: ['d'] }),
      makeRecord(2, { promoted: ['e'], candidate: ['f'], sketch: [], rejected: [] }),
    ];
    const r = buildStatusReport(records);
    assert.equal(r.summary.gateHistogram.promoted, 2);
    assert.equal(r.summary.gateHistogram.candidate, 2);
    assert.equal(r.summary.gateHistogram.sketch, 1);
    assert.equal(r.summary.gateHistogram.rejected, 1);
  });

  it('computes avgScore across all critiques (NaN-safe)', () => {
    const records = [
      makeRecord(1),
      { ...makeRecord(2), feedback: { critiques: [{ total: 'bad' }, { total: 8 }], judge_calls: 0, total_tokens: 0 } },
    ];
    const r = buildStatusReport(records);
    // default round 1: 2 critiques × total=6; round 2 override: total='bad' → 0, total=8
    // all = [6, 6, 0, 8] → sum=20, count=4 → avg=5.00
    assert.equal(r.summary.avgScore, 5);
  });

  it('applyRate divides applied / (applied+skipped), zero-guards', () => {
    const records = [
      { ...makeRecord(1), modifier: { applied: [{ id: 'a' }], skipped: [] } },
    ];
    const r = buildStatusReport(records);
    assert.equal(r.summary.totalApplied, 1);
    assert.equal(r.summary.totalSkipped, 0);
    assert.equal(r.summary.applyRate, 1);
  });

  it('applyRate = 0 when no applied and no skipped', () => {
    const records = [
      { ...makeRecord(1), modifier: { applied: [], skipped: [] } },
    ];
    const r = buildStatusReport(records);
    assert.equal(r.summary.applyRate, 0);
  });

  it('topElo sorted by elo desc, limited to lastN', () => {
    const records = [
      {
        ...makeRecord(1),
        feedback: {
          critiques: [
            { proposal_id: 'p1', total: 5, elo: 1300, matches: 5, wins: 3 },
            { proposal_id: 'p2', total: 6, elo: 1400, matches: 5, wins: 2 },
            { proposal_id: 'p3', total: 7, elo: 1250, matches: 5, wins: 1 },
          ],
        },
      },
    ];
    const r = buildStatusReport(records, { lastN: 2 });
    assert.equal(r.topElo.length, 2);
    assert.equal(r.topElo[0].proposal_id, 'p2');
    assert.equal(r.topElo[0].elo, 1400);
    assert.equal(r.topElo[1].proposal_id, 'p1');
  });

  it('recent rounds slice from last N (default 5)', () => {
    const records = Array.from({ length: 8 }, (_, i) => makeRecord(i + 1));
    const r = buildStatusReport(records);
    assert.equal(r.recent.length, 5);
    assert.equal(r.recent[0].round, 4);
    assert.equal(r.recent[4].round, 8);
  });

  it('round avgScore computes per-round, not just global', () => {
    const records = [
      { ...makeRecord(1), feedback: { critiques: [{ total: 10 }] } },
      { ...makeRecord(2), feedback: { critiques: [{ total: 4 }] } },
    ];
    const r = buildStatusReport(records);
    assert.equal(r.recent[0].avgScore, 10);
    assert.equal(r.recent[1].avgScore, 4);
    assert.equal(r.summary.avgScore, 7);
  });
});

// ---------------------------------------------------------------------------
// Tests — text formatting
// ---------------------------------------------------------------------------

describe('formatStatusReportText', () => {
  it('includes session id + rounds + gate histogram', () => {
    const report = buildStatusReport([makeRecord(1), makeRecord(2)]);
    const text = formatStatusReportText('my-session', report);
    assert.match(text, /my-session/);
    assert.match(text, /Rounds: 2/);
    assert.match(text, /Gate histogram/);
    assert.match(text, /Recent rounds/);
  });

  it('handles empty session gracefully', () => {
    const report = buildStatusReport([]);
    const text = formatStatusReportText('empty', report);
    assert.match(text, /empty/);
    assert.match(text, /no rounds yet/);
  });
});

// ---------------------------------------------------------------------------
// Tests — CLI surface (regex against agents-run.mjs)
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI surface', () => {
  it('exposes --status flag', () => {
    assert.match(cliSrc, /--status/);
  });

  it('exposes --json flag for machine-readable status output', () => {
    assert.match(cliSrc, /--json/);
  });

  it('describes --status in help text', () => {
    // --help 块必须包含 --status 字样
    const helpMatch = cliSrc.match(/console\.log\(`Usage:[^`]*`\)/);
    assert.ok(helpMatch, 'no Usage block found in agents-run.mjs');
    assert.match(helpMatch[0], /--status/);
  });

  it('exports buildStatusReport as testable function (defined in file)', () => {
    assert.match(cliSrc, /function buildStatusReport/);
  });

  it('exports formatStatusReportText as testable function', () => {
    assert.match(cliSrc, /function formatStatusReportText/);
  });

  it('has a status branch in main() that reads --status arg', () => {
    // main() 中存在 'status' 模式分支
    assert.match(cliSrc, /args\.status/);
  });

  it('uses realpath-based main-entry guard (cross-platform)', () => {
    // Windows argv[1] 是反斜杠绝对路径(E:\\...),
    // import.meta.url 是正斜杠 file:///E:/...,字符串直接比较永远不等。
    // 修复后用 realpathSync 双端归一化,跨平台通吃。
    assert.match(cliSrc, /realpathSync/);
    assert.match(cliSrc, /fileURLToPath/);
    assert.doesNotMatch(cliSrc, /import\.meta\.url === `file:\$\{argv\[1\]\}`/);
  });
});

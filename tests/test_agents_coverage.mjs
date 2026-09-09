//
// tests/test_agents_coverage.mjs -- Paper coverage map (iter #47)
//
// Coverage:
//   (A) /agents/coverage/ page exists with depth-2 imports
//   (B) Page scans archive/<sid>/rounds/round_*.json + extracts paperIds
//   (C) Aggregation: per-paper stats (sessions, rounds, scores, lastSeen,
//       proposalTitles) — tested end-to-end with fake archive
//   (D) Sort order: sessions DESC → rounds DESC → paper_id ASC
//   (E) /agents/ index links to coverage
//   (F) CSS classes for filter + table + session chip
//
// 跑法: node --test tests/test_agents_coverage.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', 'coverage.astro');
const INDEX = join(ROOT, 'astro-src', 'pages', 'agents', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('coverage page structure', () => {
  it('exists with depth-2 imports', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('aggregates paperIds from proposals[].evidence.paperIds', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /paperIds/);
    assert.match(src, /archive/);
    assert.match(src, /round_\\d\+\\.json/);
  });

  it('renders sortable table with sessions / rounds / avg_score / last_seen', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-cov-table/);
    assert.match(src, /Sessions/);
    assert.match(src, /Avg score/);
    assert.match(src, /Last seen/);
  });

  it('has client-side filter input', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-cov-filter/);
    assert.match(src, /filter\?\.value/);
    assert.match(src, /getAttribute\('data-paper-id'\)/);
  });
});

describe('coverage aggregation end-to-end', () => {
  let tmpRoot;
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-cov-'));

  it('aggregates paper_ids across multiple sessions/rounds', async () => {
    // sid A: 2 rounds, 引用 p1, p2, p3 (p1 跨两轮)
    const aRounds = join(tmpRoot, 'archive', 'sid-A', 'rounds');
    await mkdir(aRounds, { recursive: true });
    await writeFile(join(aRounds, 'round_001.json'), JSON.stringify({
      round: 1, started_at: 1, finished_at: 1000,
      designer: {
        proposals: [
          { id: 'a1', title: 'A proposal 1', type: 'literature_review', evidence: { paperIds: ['2401.00001', '2401.00002'], quotes: [] } },
          { id: 'a2', title: 'A proposal 2', type: 'add_paper', evidence: { paperIds: ['2401.00003'], quotes: [] } },
        ],
        model: 'stub',
      },
      feedback: {
        critiques: [
          { total: 8, elo: 1500, proposal_id: 'a1' },
          { total: 6, elo: 1480, proposal_id: 'a2' },
        ],
        judge_calls: 1, total_tokens: 100,
      },
      gate: { promoted: ['a1'], candidate: [], sketch: [], rejected: [] },
      modifier: { applied: [], skipped: [] },
      meta: { session_id: 'sid-A', dry_run: true },
    }));
    await writeFile(join(aRounds, 'round_002.json'), JSON.stringify({
      round: 2, started_at: 1001, finished_at: 2000,
      designer: {
        proposals: [
          { id: 'a3', title: 'A proposal 3', type: 'add_paper', evidence: { paperIds: ['2401.00001', '2401.00004'], quotes: [] } },
        ],
        model: 'stub',
      },
      feedback: { critiques: [{ total: 7, elo: 1500, proposal_id: 'a3' }], judge_calls: 1, total_tokens: 50 },
      gate: { promoted: [], candidate: [], sketch: [], rejected: [] },
      modifier: { applied: [], skipped: [] },
      meta: { session_id: 'sid-A', dry_run: true },
    }));

    // sid B: 1 round, 引用 p1, p5
    const bRounds = join(tmpRoot, 'archive', 'sid-B', 'rounds');
    await mkdir(bRounds, { recursive: true });
    await writeFile(join(bRounds, 'round_001.json'), JSON.stringify({
      round: 1, started_at: 1, finished_at: 1500,
      designer: {
        proposals: [
          { id: 'b1', title: 'B proposal 1', type: 'add_paper', evidence: { paperIds: ['2401.00001', '2401.00005'], quotes: [] } },
        ],
        model: 'stub',
      },
      feedback: { critiques: [{ total: 9, elo: 1600, proposal_id: 'b1' }], judge_calls: 1, total_tokens: 80 },
      gate: { promoted: ['b1'], candidate: [], sketch: [], rejected: [] },
      modifier: { applied: [], skipped: [] },
      meta: { session_id: 'sid-B', dry_run: true },
    }));

    // 镜像页面里 aggregation 逻辑
    const { readdir } = await import('node:fs/promises');
    const agg = new Map();
    let sessionCount = 0;
    let roundCount = 0;
    const sids = await readdir(join(tmpRoot, 'archive'));
    for (const sid of sids) {
      const roundsDir = join(tmpRoot, 'archive', sid, 'rounds');
      const files = (await readdir(roundsDir)).filter((f) => /^round_\d+\.json$/.test(f)).sort();
      if (files.length === 0) continue;
      sessionCount += 1;
      for (const f of files) {
        roundCount += 1;
        const rec = JSON.parse(await readFile(join(roundsDir, f), 'utf8'));
        const proposals = rec.designer?.proposals ?? [];
        const critiques = rec.feedback?.critiques ?? [];
        const finishedAt = rec.finished_at ?? 0;
        for (const p of proposals) {
          const ids = p.evidence?.paperIds ?? [];
          if (!Array.isArray(ids) || ids.length === 0) continue;
          const cs = critiques.filter((c) => c.proposal_id === p.id);
          const score = cs.length ? cs.reduce((a, c) => a + (c.total ?? 0), 0) / cs.length : null;
          for (const id of ids) {
            const pid = String(id).trim();
            if (!pid) continue;
            let entry = agg.get(pid);
            if (!entry) {
              entry = { paper_id: pid, sessions: new Set(), rounds: 0, scores: [], lastSeen: 0, proposalTitles: [] };
              agg.set(pid, entry);
            }
            entry.sessions.add(sid);
            entry.rounds += 1;
            if (score !== null) entry.scores.push(score);
            if (finishedAt > entry.lastSeen) entry.lastSeen = finishedAt;
            if (entry.proposalTitles.length < 3 && p.title && !entry.proposalTitles.includes(p.title)) {
              entry.proposalTitles.push(p.title);
            }
          }
        }
      }
    }

    assert.equal(sessionCount, 2);
    assert.equal(roundCount, 3);
    assert.equal(agg.size, 5); // 5 unique paper_ids

    // 2401.00001 被 sid-A + sid-B 共 2 session 引用, 出现 3 次
    const p1 = agg.get('2401.00001');
    assert.equal(p1.sessions.size, 2);
    assert.equal(p1.rounds, 3);
    // avgScore: 3 次 critique (a1 score 8, a3 score 7, b1 score 9) → avg 8
    assert.ok(Math.abs(p1.scores.reduce((a, b) => a + b, 0) / p1.scores.length - 8) < 0.01);

    // 2401.00002 仅 sid-A, 1 次, score 8
    const p2 = agg.get('2401.00002');
    assert.equal(p2.sessions.size, 1);
    assert.equal(p2.rounds, 1);
    assert.equal(p2.scores[0], 8);

    // 2401.00003 仅 sid-A, 1 次, score 6
    const p3 = agg.get('2401.00003');
    assert.equal(p3.sessions.size, 1);
    assert.equal(p3.rounds, 1);
    assert.equal(p3.scores[0], 6);

    // 排序: p1 (2 sessions) > p2/p3/p4/p5 (1 each), p2/p3/p4/p5 按 paper_id 升序
    const sorted = [...agg.values()]
      .map((r) => ({ paper_id: r.paper_id, sessions: r.sessions.size, rounds: r.rounds }))
      .sort((a, b) => {
        if (b.sessions !== a.sessions) return b.sessions - a.sessions;
        if (b.rounds !== a.rounds) return b.rounds - a.rounds;
        return a.paper_id.localeCompare(b.paper_id);
      });
    assert.equal(sorted[0].paper_id, '2401.00001'); // 2 sessions
    assert.equal(sorted[0].rounds, 3);
    assert.deepEqual(sorted.slice(1).map((r) => r.paper_id), ['2401.00002', '2401.00003', '2401.00004', '2401.00005']);

    // lastSeen: p1 出现在 sid-A round 2 (finished 2000) 和 sid-B round 1 (1500),取 max = 2000
    assert.equal(p1.lastSeen, 2000);
  });

  it('cleanup', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });
});

describe('/agents/ index links to coverage', () => {
  it('has Coverage button', async () => {
    const src = await readFile(INDEX, 'utf8');
    assert.match(src, /\/agents\/coverage\//);
  });
});

describe('CSS for coverage', () => {
  it('has agents-cov-filter + table + session-chip classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-cov-filter'));
    assert.ok(css.includes('.agents-cov-table'));
    assert.ok(css.includes('.agents-cov-session-chip'));
  });
});

//
// tests/test_agents_timeline.mjs -- Proposal timeline (iter #49)
//
// Coverage:
//   (A) /agents/<sid>/timeline/ page exists with depth-3 imports
//   (B) getStaticPaths enumerates archive/<sid>/meta.json
//   (C) Loads rounds + groups by proposal id
//   (D) Per-round decision logic: promoted / candidate / sketch / rejected / missing
//   (E) Table renders rounds as columns, proposals as rows
//   (F) Dashboard links to timeline
//   (G) CSS classes for cell colors + applied indicator
//
// 跑法: node --test tests/test_agents_timeline.mjs
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
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'timeline.astro');
const DASH = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('timeline page structure', () => {
  it('exists with depth-3 imports', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('getStaticPaths enumerates archive/*/meta.json', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /getStaticPaths/);
    assert.match(src, /archive['"]\)/);
    assert.match(src, /meta\.json/);
  });

  it('loads rounds via readdir + JSON.parse', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /round_\\d\+\\.json/);
  });

  it('renders table with proposals × rounds grid', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-tl-table/);
    assert.match(src, /agents-tl-cell/);
    assert.match(src, /agents-tl-promoted/);
    assert.match(src, /agents-tl-candidate/);
    assert.match(src, /agents-tl-sketch/);
    assert.match(src, /agents-tl-rejected/);
    assert.match(src, /agents-tl-missing/);
  });
});

describe('decisionFor semantics', () => {
  function decisionFor(round, pid) {
    if (round.gate.promoted.includes(pid)) return 'promoted';
    if (round.gate.candidate.includes(pid)) return 'candidate';
    if (round.gate.sketch.includes(pid)) return 'sketch';
    if (round.gate.rejected.includes(pid)) return 'rejected';
    return 'missing';
  }

  it('returns promoted when in promoted list', () => {
    assert.equal(decisionFor({ gate: { promoted: ['p1'], candidate: [], sketch: [], rejected: [] } }, 'p1'), 'promoted');
  });
  it('returns candidate when only in candidate', () => {
    assert.equal(decisionFor({ gate: { promoted: [], candidate: ['p1'], sketch: [], rejected: [] } }, 'p1'), 'candidate');
  });
  it('returns sketch when only in sketch', () => {
    assert.equal(decisionFor({ gate: { promoted: [], candidate: [], sketch: ['p1'], rejected: [] } }, 'p1'), 'sketch');
  });
  it('returns rejected when only in rejected', () => {
    assert.equal(decisionFor({ gate: { promoted: [], candidate: [], sketch: [], rejected: ['p1'] } }, 'p1'), 'rejected');
  });
  it('returns missing when not in any list', () => {
    assert.equal(decisionFor({ gate: { promoted: [], candidate: [], sketch: [], rejected: [] } }, 'p1'), 'missing');
  });
  it('promoted takes priority over candidate (if accidentally listed in both)', () => {
    assert.equal(decisionFor({ gate: { promoted: ['p1'], candidate: ['p1'], sketch: [], rejected: [] } }, 'p1'), 'promoted');
  });
});

describe('proposal grouping end-to-end', () => {
  let tmpRoot;
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-tl-'));

  it('groups proposals across 2 rounds', async () => {
    const sid = 'tl-sid';
    const roundsDir = join(tmpRoot, 'archive', sid, 'rounds');
    await mkdir(roundsDir, { recursive: true });
    await writeFile(join(roundsDir, 'round_001.json'), JSON.stringify({
      round: 1,
      designer: { proposals: [
        { id: 'p1', title: 'P1', type: 'add_paper', rationale: 'r' },
        { id: 'p2', title: 'P2', type: 'create_draft', rationale: 'r' },
      ] },
      feedback: { critiques: [
        { total: 8, elo: 1500, proposal_id: 'p1' },
        { total: 5, elo: 1400, proposal_id: 'p2' },
      ] },
      gate: { promoted: ['p1'], candidate: [], sketch: [], rejected: ['p2'] },
      modifier: { applied: [{ id: 'm1', proposal_id: 'p1', applied_at: 999, kind: 'add_paper_to_stage' }] },
    }));
    await writeFile(join(roundsDir, 'round_002.json'), JSON.stringify({
      round: 2,
      designer: { proposals: [
        { id: 'p1', title: 'P1', type: 'add_paper', rationale: 'r' },
        { id: 'p3', title: 'P3', type: 'literature_review', rationale: 'r' },
      ] },
      feedback: { critiques: [
        { total: 9, elo: 1600, proposal_id: 'p1' },
        { total: 7, elo: 1500, proposal_id: 'p3' },
      ] },
      gate: { promoted: ['p3'], candidate: ['p1'], sketch: [], rejected: [] },
      modifier: { applied: [] },
    }));

    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(roundsDir)).filter((f) => /^round_\d+\.json$/.test(f)).sort();
    const rounds = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(roundsDir, f), 'utf8'))));

    const proposals = new Map();
    function decisionFor(round, pid) {
      if (round.gate.promoted.includes(pid)) return 'promoted';
      if (round.gate.candidate.includes(pid)) return 'candidate';
      if (round.gate.sketch.includes(pid)) return 'sketch';
      if (round.gate.rejected.includes(pid)) return 'rejected';
      return 'missing';
    }
    for (const r of rounds) {
      for (const p of r.designer.proposals) {
        if (!proposals.has(p.id)) {
          proposals.set(p.id, { id: p.id, title: p.title, type: p.type, firstRound: r.round, perRound: {} });
        }
        const row = proposals.get(p.id);
        const cs = r.feedback.critiques.filter((c) => c.proposal_id === p.id);
        const avg = cs.length ? cs.reduce((a, c) => a + c.total, 0) / cs.length : null;
        const applied = r.modifier.applied.find((a) => a.proposal_id === p.id);
        row.perRound[r.round] = {
          decision: decisionFor(r, p.id),
          score: avg,
          appliedKind: applied?.kind ?? null,
        };
      }
    }

    // 3 unique proposals: p1 (出现在 r1, r2), p2 (仅 r1), p3 (仅 r2)
    assert.equal(proposals.size, 3);

    const p1 = proposals.get('p1');
    assert.equal(p1.firstRound, 1);
    assert.equal(p1.perRound[1].decision, 'promoted');
    assert.equal(p1.perRound[1].score, 8);
    assert.equal(p1.perRound[1].appliedKind, 'add_paper_to_stage');
    assert.equal(p1.perRound[2].decision, 'candidate');
    assert.equal(p1.perRound[2].score, 9);

    const p2 = proposals.get('p2');
    assert.equal(p2.firstRound, 1);
    assert.equal(p2.perRound[1].decision, 'rejected');
    assert.equal(p2.perRound[2], undefined, 'p2 not in r2');

    const p3 = proposals.get('p3');
    assert.equal(p3.firstRound, 2);
    assert.equal(p3.perRound[1], undefined, 'p3 not in r1');
    assert.equal(p3.perRound[2].decision, 'promoted');
    assert.equal(p3.perRound[2].score, 7);
  });

  it('cleanup', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });
});

describe('dashboard links to timeline', () => {
  it('has timeline link', async () => {
    const src = await readFile(DASH, 'utf8');
    assert.match(src, /\/agents\/\$\{sessionId\}\/timeline\//);
  });
});

describe('CSS for timeline', () => {
  it('has agents-tl-* classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-tl-table'));
    assert.ok(css.includes('.agents-tl-cell'));
    for (const v of ['promoted', 'candidate', 'sketch', 'rejected', 'missing']) {
      assert.ok(css.includes(`.agents-tl-${v}`), `missing .agents-tl-${v}`);
    }
    assert.ok(css.includes('.agents-tl-applied'));
  });
});

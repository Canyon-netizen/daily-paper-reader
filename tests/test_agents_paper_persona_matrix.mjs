//
// tests/test_agents_paper_persona_matrix.mjs -- Paper × persona matrix (iter #53)
//
// Coverage:
//   (A) Session dashboard renders Paper × Persona section
//   (B) Aggregates paper_ids across rounds correctly
//   (C) Evidence-only papers (no critiques) flagged correctly
//   (D) Per-persona mean computation
//   (E) Sort order: total avg desc, evidence-only at bottom
//   (F) Score class mapping (high/mid/low/na)
//   (G) Top-picked / top-skeptical buckets
//   (H) CSS for paper-persona table
//
// 跑法: node --test tests/test_agents_paper_persona_matrix.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SESSION_DASH = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('session dashboard renders paper-persona section', () => {
  it('contains Paper × Persona Matrix header', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /Paper × Persona Matrix \(iter #53\)/);
  });

  it('contains paper-persona table markup', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /agents-paper-persona-table/);
    assert.match(src, /agents-paper-persona-id/);
    assert.match(src, /agents-paper-persona-evidence-only/);
    assert.match(src, /agents-paper-persona-summary/);
  });

  it('links paper IDs to /papers/<id>/', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /\/papers\/\$\{r\.paperId\}\//);
  });

  it('has top-picked / top-skeptical summary lines', async () => {
    const src = await readFile(SESSION_DASH, 'utf8');
    assert.match(src, /最看好/);
    assert.match(src, /最看空/);
  });
});

describe('paper aggregation across rounds', () => {
  // 镜像页面里的聚合逻辑
  function aggregatePapers(rounds) {
    const map = new Map();
    for (const r of rounds) {
      for (const p of r.designer.proposals) {
        for (const pid of p.evidence.paperIds) {
          let agg = map.get(pid);
          if (!agg) {
            agg = { paperId: pid, rounds: new Set(), proposalIds: new Set(), critiqueIds: new Set() };
            map.set(pid, agg);
          }
          agg.rounds.add(r.round);
          agg.proposalIds.add(p.id);
          const cr = r.feedback.critiques.find((c) => c.proposal_id === p.id);
          if (cr) agg.critiqueIds.add(cr.proposal_id);
        }
      }
    }
    return map;
  }

  it('collects unique papers across rounds', () => {
    const rounds = [
      { round: 1, designer: { proposals: [
        { id: 'p1', evidence: { paperIds: ['paper-A', 'paper-B'] } },
      ] }, feedback: { critiques: [] } },
      { round: 2, designer: { proposals: [
        { id: 'p2', evidence: { paperIds: ['paper-B', 'paper-C'] } },
      ] }, feedback: { critiques: [] } },
    ];
    const map = aggregatePapers(rounds);
    assert.equal(map.size, 3);
    assert.equal(map.get('paper-A').proposalIds.size, 1);
    assert.equal(map.get('paper-B').proposalIds.size, 2);
    assert.equal(map.get('paper-C').proposalIds.size, 1);
  });

  it('records which rounds each paper appeared in', () => {
    const rounds = [
      { round: 1, designer: { proposals: [{ id: 'p1', evidence: { paperIds: ['X'] } }] }, feedback: { critiques: [] } },
      { round: 3, designer: { proposals: [{ id: 'p2', evidence: { paperIds: ['X'] } }] }, feedback: { critiques: [] } },
    ];
    const map = aggregatePapers(rounds);
    assert.deepEqual([...map.get('X').rounds].sort(), [1, 3]);
  });
});

describe('evidence-only detection', () => {
  function isEvidenceOnly(agg) {
    return agg.critiqueIds.size === 0;
  }
  it('no critiques → evidence-only', () => {
    assert.equal(isEvidenceOnly({ proposalIds: new Set(['p1']), critiqueIds: new Set() }), true);
  });
  it('has critique → not evidence-only', () => {
    assert.equal(isEvidenceOnly({ proposalIds: new Set(['p1']), critiqueIds: new Set(['p1']) }), false);
  });
});

describe('per-persona mean', () => {
  function personaScores(rows, persona) {
    let sum = 0, n = 0;
    for (const r of rows) {
      if (r.critique) {
        if (r.critique.scores[persona] != null) {
          sum += r.critique.scores[persona];
          n++;
        }
      }
    }
    return n === 0 ? null : sum / n;
  }

  it('averages methodologist scores', () => {
    const rows = [
      { critique: { scores: { methodologist: 6, engineer: 7, skeptic: 5 } } },
      { critique: { scores: { methodologist: 8, engineer: 7, skeptic: 5 } } },
    ];
    assert.equal(personaScores(rows, 'methodologist'), 7);
  });

  it('returns null when no scores', () => {
    assert.equal(personaScores([], 'engineer'), null);
  });

  it('skips null scores', () => {
    const rows = [
      { critique: { scores: { methodologist: null, engineer: 6, skeptic: 5 } } },
      { critique: { scores: { methodologist: 8, engineer: 6, skeptic: 5 } } },
    ];
    // methodologist: 8 / 1 = 8 (skips null)
    assert.equal(personaScores(rows, 'methodologist'), 8);
  });
});

describe('sort order', () => {
  function sortRows(rows) {
    return rows.slice().sort((a, b) => {
      if (a.totalAvg === null && b.totalAvg === null) return a.paperId.localeCompare(b.paperId);
      if (a.totalAvg === null) return 1;
      if (b.totalAvg === null) return -1;
      return b.totalAvg - a.totalAvg;
    });
  }
  it('total avg desc, null at bottom', () => {
    const out = sortRows([
      { paperId: 'A', totalAvg: 5.0 },
      { paperId: 'B', totalAvg: 9.0 },
      { paperId: 'C', totalAvg: null },
      { paperId: 'D', totalAvg: 7.0 },
    ]);
    assert.deepEqual(out.map((r) => r.paperId), ['B', 'D', 'A', 'C']);
  });
});

describe('score class mapping', () => {
  function scoreCls(n) {
    if (n === null) return 'agents-matrix-na';
    if (n >= 8) return 'agents-matrix-cell-high';
    if (n >= 6) return 'agents-matrix-cell-mid';
    return 'agents-matrix-cell-low';
  }
  it('null → na', () => {
    assert.equal(scoreCls(null), 'agents-matrix-na');
  });
  it('8.0 → high', () => {
    assert.equal(scoreCls(8.0), 'agents-matrix-cell-high');
  });
  it('6.0 → mid', () => {
    assert.equal(scoreCls(6.0), 'agents-matrix-cell-mid');
  });
  it('5.99 → low', () => {
    assert.equal(scoreCls(5.99), 'agents-matrix-cell-low');
  });
  it('9.99 → high', () => {
    assert.equal(scoreCls(9.99), 'agents-matrix-cell-high');
  });
});

describe('top-picked / top-skeptical buckets', () => {
  function bucket(rows, threshold) {
    return rows.filter((r) => r.totalAvg !== null && r.totalAvg >= threshold);
  }
  function antiBucket(rows, threshold) {
    return rows.filter((r) => r.totalAvg !== null && r.totalAvg < threshold);
  }
  const rows = [
    { paperId: 'A', totalAvg: 8.5 },
    { paperId: 'B', totalAvg: 7.0 },
    { paperId: 'C', totalAvg: 4.9 },
    { paperId: 'D', totalAvg: 3.0 },
    { paperId: 'E', totalAvg: null },        // evidence-only
  ];
  it('top-picked (≥7)', () => {
    assert.deepEqual(bucket(rows, 7).map((r) => r.paperId), ['A', 'B']);
  });
  it('top-skeptical (<5)', () => {
    assert.deepEqual(antiBucket(rows, 5).map((r) => r.paperId), ['C', 'D']);
  });
  it('null not counted', () => {
    assert.equal(bucket(rows, 7).length, 2);
  });
});

describe('CSS for paper-persona', () => {
  it('has paper-persona selectors', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-paper-persona-table'));
    assert.ok(css.includes('.agents-paper-persona-id'));
    assert.ok(css.includes('.agents-paper-persona-evidence-only'));
    assert.ok(css.includes('.agents-paper-persona-summary'));
    assert.ok(css.includes('.agents-paper-link'));
  });

  it('has dark-mode variants', async () => {
    const css = await readFile(CSS, 'utf8');
    const idx = css.indexOf('iter #53');
    assert.ok(idx > 0);
    const darkIdx = css.indexOf('@media (prefers-color-scheme: dark)', idx);
    assert.ok(darkIdx > 0);
    const darkEnd = css.indexOf('\n}\n', darkIdx);
    const block = css.slice(darkIdx, darkEnd > 0 ? darkEnd : css.length);
    assert.ok(block.includes('.agents-paper-persona-table'));
  });
});
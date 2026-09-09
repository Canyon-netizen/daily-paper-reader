//
// tests/test_agents_bulk.mjs -- Bulk operations page (iter #50)
//
// Coverage:
//   (A) /agents/bulk/ page exists with depth-2 imports
//   (B) Loads /data/agents-archive-manifest.json
//   (C) Renders selectable session list with checkboxes
//   (D) Provides 3 actions: export bundle, markdown report, pairwise diff
//   (E) Markdown report generator: produces valid table with selected sids
//   (F) Pairwise diff generator: produces N*(N-1)/2 commands for N sids
//   (G) Verdict class mapping (high / mid / low / muted)
//   (H) /agents/ index links to bulk
//   (I) CSS classes for bulk-list / bulk-row
//
// 跑法: node --test tests/test_agents_bulk.mjs
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', 'bulk.astro');
const INDEX = join(ROOT, 'astro-src', 'pages', 'agents', 'index.astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('bulk page structure', () => {
  it('exists with depth-2 imports', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /from\s+['"]\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /(from\s+['"]\.\.\/\.\.\/styles\/agents\.css['"]|import\s+['"]\.\.\/\.\.\/styles\/agents\.css['"])/);
  });

  it('loads /data/agents-archive-manifest.json', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-archive-manifest\.json/);
  });

  it('renders checkboxes for each session + select all/none/converged', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-bulk-list/);
    assert.match(src, /type="checkbox"/);
    assert.match(src, /agents-bulk-select-all/);
    assert.match(src, /agents-bulk-select-none/);
    assert.match(src, /agents-bulk-select-converged/);
  });

  it('provides 3 actions: export / report / diff', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-bulk-export/);
    assert.match(src, /agents-bulk-report/);
    assert.match(src, /agents-bulk-diff/);
  });
});

describe('markdown report generator', () => {
  // 镜像页面里的 generator 逻辑
  function generateReport(sessions) {
    const lines = [];
    lines.push(`# Bulk session report`);
    lines.push(``);
    lines.push(`Generated at ${new Date().toISOString()} · ${sessions.length} sessions`);
    lines.push(``);
    lines.push(`| sid | rounds | proposals | avg score | avg elo | applied | skipped | verdict | last activity |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const s of sessions) {
      const lastAt = s.lastAt ? new Date(s.lastAt).toLocaleString() : '—';
      lines.push(`| \`${s.sid}\` | ${s.rounds} | ${s.proposals} | ${s.avgScore} | ${s.avgElo} | ${s.applied} | ${s.skipped} | ${s.verdict} | ${lastAt} |`);
    }
    return lines.join('\n');
  }

  it('produces markdown with header + table rows', () => {
    const md = generateReport([
      { sid: 'a', rounds: 2, proposals: 5, avgScore: 7.5, avgElo: 1500, applied: 3, skipped: 1, verdict: '收敛中', lastAt: 1700000000000 },
      { sid: 'b', rounds: 3, proposals: 8, avgScore: 8.2, avgElo: 1600, applied: 5, skipped: 0, verdict: '已收敛', lastAt: 1700000010000 },
    ]);
    assert.match(md, /^# Bulk session report/);
    assert.match(md, /\| sid \| rounds \|/);
    assert.match(md, /\| `a` \| 2 \| 5 \| 7.5 \| 1500 \| 3 \| 1 \| 收敛中 \|/);
    assert.match(md, /\| `b` \| 3 \| 8 \| 8.2 \| 1600 \| 5 \| 0 \| 已收敛 \|/);
  });

  it('handles zero sessions', () => {
    const md = generateReport([]);
    assert.match(md, /0 sessions/);
    assert.ok(!md.includes('| `'));
  });
});

describe('pairwise diff command generator', () => {
  function pairwiseDiffCmds(sids) {
    const lines = [];
    lines.push(`# pairwise diff commands for ${sids.length} sessions`);
    for (let i = 0; i < sids.length; i++) {
      for (let j = i + 1; j < sids.length; j++) {
        lines.push(`# ${sids[i]} ↔ ${sids[j]}`);
        lines.push(`node astro-src/scripts/agents-run.mjs --compare-sessions --a ${sids[i]} --b ${sids[j]}`);
        lines.push(``);
      }
    }
    return { text: lines.join('\n'), count: sids.length * (sids.length - 1) / 2 };
  }

  it('produces N*(N-1)/2 commands', () => {
    const r = pairwiseDiffCmds(['a', 'b', 'c', 'd']);
    assert.equal(r.count, 6);
    // 不重复 (a,b) 和 (b,a)
    assert.equal((r.text.match(/--compare-sessions/g) ?? []).length, 6);
    // a↔d 与 d↔a 不会出现两次
    assert.equal((r.text.match(/a ↔ d/g) ?? []).length, 1);
  });

  it('handles 2 sessions (1 pair)', () => {
    const r = pairwiseDiffCmds(['a', 'b']);
    assert.equal(r.count, 1);
  });

  it('handles 1 session (0 pairs)', () => {
    const r = pairwiseDiffCmds(['a']);
    assert.equal(r.count, 0);
  });
});

describe('verdict class mapping', () => {
  function verdictClass(v) {
    if (v === '已收敛' || v === '收敛中') return 'agents-verdict-high';
    if (v === '部分收敛' || v === '起步') return 'agents-verdict-mid';
    if (v === '停滞') return 'agents-verdict-low';
    return 'agents-verdict-muted';
  }
  it('已收敛 → high', () => {
    assert.equal(verdictClass('已收敛'), 'agents-verdict-high');
  });
  it('收敛中 → high', () => {
    assert.equal(verdictClass('收敛中'), 'agents-verdict-high');
  });
  it('部分收敛 → mid', () => {
    assert.equal(verdictClass('部分收敛'), 'agents-verdict-mid');
  });
  it('停滞 → low', () => {
    assert.equal(verdictClass('停滞'), 'agents-verdict-low');
  });
  it('unknown → muted', () => {
    assert.equal(verdictClass('???'), 'agents-verdict-muted');
  });
});

describe('/agents/ index links to bulk', () => {
  it('has Bulk button', async () => {
    const src = await readFile(INDEX, 'utf8');
    assert.match(src, /\/agents\/bulk\//);
  });
});

describe('CSS for bulk', () => {
  it('has agents-bulk-list + bulk-row classes', async () => {
    const css = await readFile(CSS, 'utf8');
    assert.ok(css.includes('.agents-bulk-list'));
    assert.ok(css.includes('.agents-bulk-row'));
    assert.ok(css.includes('.agents-bulk-list-inner'));
  });
});

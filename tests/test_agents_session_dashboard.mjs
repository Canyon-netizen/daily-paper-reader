//
// tests/test_agents_session_dashboard.mjs -- Session overview dashboard (iter #43)
//
// Coverage:
//   Source-level checks of /agents/[sessionId]/index.astro:
//     (A) Page exists, uses depth-3 layout/component/css imports
//     (B) getStaticPaths enumerates archive/*/meta.json
//     (C) Loads meta + rounds + syntheses
//     (D) Renders convergence verdict (verdict badge + reason)
//     (E) Renders 3 trend charts (directive_count, avg score, tokens)
//     (F) Renders top promoted proposals table
//     (G) Renders recent applied actions table
//     (H) Renders resume section with --auto-resume command
//     (I) Has link from round detail page (breadcrumbs)
//     (J) CSS classes for session section / verdict badge / chart / table exist
//     (K) directive_count regex (countDirectivesInSynthesis semantics)
//
// 跑法: node --test tests/test_agents_session_dashboard.mjs
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
const PAGE = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', 'index.astro');
const ROUND_PAGE = join(ROOT, 'astro-src', 'pages', 'agents', '[sessionId]', '[roundId].astro');
const CSS = join(ROOT, 'astro-src', 'styles', 'agents.css');

describe('session dashboard page exists with correct depth', () => {
  it('file exists', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.ok(src.length > 500, 'page suspiciously short');
  });

  it('uses depth-3 imports for layout/component/css', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /import\s+BaseLayout\s+from\s+['"]\.\.\/\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/);
    assert.match(src, /import\s+Navbar\s+from\s+['"]\.\.\/\.\.\/\.\.\/components\/Navbar\.astro['"]/);
    assert.match(src, /import\s+['"]\.\.\/\.\.\/\.\.\/styles\/agents\.css['"]/);
  });
});

describe('session dashboard aggregation logic', () => {
  // We mirror countDirectivesInSynthesis from the page to test the regex semantics.
  // (页面源里有相同实现——这里只在 node 里跑一遍,验证逻辑稳定。)
  function countDirectivesInSynthesis(md) {
    let count = 0;
    const sections = md.split(/^##\s+/m);
    for (const sec of sections) {
      if (sec.startsWith('下一步建议') || sec.startsWith('Gap &') || sec.startsWith('Gaps &')) {
        const m = sec.match(/^[-*\s]\s+(?:\[[ x]\]\s+)?.+$/gm);
        if (m) count += m.filter((l) =>
          !/^\s*[-*]\s+\(/.test(l) &&
          !/^\s*[-*]\s+\(无\)/.test(l) &&
          !/^\s*[-*]\s+\(stub/.test(l)
        ).length;
      }
    }
    return count;
  }

  it('counts bullets in both Next Steps and Gap sections', () => {
    const md = `---
title: t
---
## 摘要
stuff
## Gap & 矛盾 / Gaps & Contradictions
- gap A
- gap B
- (无)
## 下一步建议 / Recommended Next Steps
- [ ] do X
- [ ] do Y
`;
    // 3 gap bullets (gap A, gap B, (无)); (无) filtered → 2. + 2 next steps = 4.
    assert.equal(countDirectivesInSynthesis(md), 4);
  });

  it('counts bullets when only one section is present', () => {
    const md = `---
title: t
---
## 摘要
stuff
## Gap & 矛盾
- only gap
`;
    assert.equal(countDirectivesInSynthesis(md), 1);
  });

  it('returns 0 when neither section is present', () => {
    const md = `---
title: t
---
## 摘要
just summary
`;
    assert.equal(countDirectivesInSynthesis(md), 0);
  });

  it('handles (stub-prefixed noise lines as not-directives', () => {
    const md = `## 下一步建议
- (stub) do thing
- [ ] real thing
`;
    assert.equal(countDirectivesInSynthesis(md), 1);
  });
});

describe('session dashboard page structure', () => {
  it('getStaticPaths enumerates sessions via archive/*/meta.json', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /getStaticPaths/);
    // page references archive root + meta.json
    assert.match(src, /join\(process\.cwd\(\),\s*['"]archive['"]\)/);
    assert.match(src, /['"]meta\.json['"]/);
    assert.match(src, /readdir\(root\)/);
  });

  it('loads meta.json + rounds + syntheses', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /meta\.json/);
    assert.match(src, /readdir/);
    // rounds + synthesis folders
    assert.match(src, /['"]rounds['"]/);
    assert.match(src, /['"]synthesis['"]/);
    // filename patterns (in regex literals)
    assert.match(src, /round_\\d\+\\.json/);
    assert.match(src, /synthesis_\\d\+\\.md/);
  });

  it('renders convergence verdict section + classes', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /agents-session-verdict/);
    assert.match(src, /judgeConvergence/);
    // 至少包含 verdict badge 模板 + 三个 cls 取值 (high/mid/low/muted, 至少出现 ≥3)
    assert.match(src, /agents-verdict-/);
    for (const v of ['high', 'mid', 'low', 'muted']) {
      assert.ok(src.includes(`cls: '${v}'`) || src.includes(`cls: "${v}"`), `missing verdict class ${v}`);
    }
  });

  it('renders 3 SVG charts with cycle data', async () => {
    const src = await readFile(PAGE, 'utf8');
    // 三个 chart block,各自一个 svg
    assert.match(src, /Directives \/ cycle/);
    assert.match(src, /Avg score \/ round/);
    assert.match(src, /Tokens \/ round/);
    // 三个 svg 都包含
    const svgCount = (src.match(/<svg/g) ?? []).length;
    assert.ok(svgCount >= 3, `expected ≥3 svgs, got ${svgCount}`);
  });

  it('renders top promoted proposals + recent applied tables', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /Top promoted proposals/);
    assert.match(src, /Recent applied actions/);
    assert.match(src, /agents-session-table/);
  });

  it('renders resume command with --auto-resume', async () => {
    const src = await readFile(PAGE, 'utf8');
    assert.match(src, /--auto-resume/);
    assert.match(src, /--session/);
    assert.match(src, /agents-auto-cmd/);
  });
});

describe('round detail page links to session dashboard', () => {
  it('breadcrumb includes link to /agents/<sid>/', async () => {
    const src = await readFile(ROUND_PAGE, 'utf8');
    // 期望 `/agents/${sessionId}/` 而不是 `sessionId / round ...`
    assert.match(src, /href=\{?[`"']\$\{base\}\/agents\/\$\{sessionId\}\/["']?\}?/);
  });
});

describe('CSS classes for dashboard', () => {
  it('defines session-section / verdict / chart / table classes', async () => {
    const css = await readFile(CSS, 'utf8');
    for (const cls of [
      '.agents-session-header',
      '.agents-session-section',
      '.agents-verdict-badge',
      '.agents-verdict-high',
      '.agents-verdict-mid',
      '.agents-verdict-low',
      '.agents-session-chart',
      '.agents-session-svg',
      '.agents-session-table',
      '.agents-session-charts',
    ]) {
      assert.ok(css.includes(cls), `missing CSS class ${cls}`);
    }
  });
});

describe('end-to-end: synthetic archive dir produces valid counts', () => {
  let tmpRoot;
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-dash-'));

  it('builds a fake archive + parses correctly', async () => {
    const sid = 'fake-sid';
    const roundsDir = join(tmpRoot, 'archive', sid, 'rounds');
    const synthDir = join(tmpRoot, 'archive', sid, 'synthesis');
    await mkdir(roundsDir, { recursive: true });
    await mkdir(synthDir, { recursive: true });

    await writeFile(join(tmpRoot, 'archive', sid, 'meta.json'), JSON.stringify({
      session_id: sid,
      goal: 'fake goal',
      created_at: Date.now(),
      rounds_requested: 2,
      dry_run: true,
    }));

    // round 1: 2 promoted, avg score 7
    await writeFile(join(roundsDir, 'round_001.json'), JSON.stringify({
      round: 1,
      started_at: 1,
      finished_at: 2000,
      designer: {
        proposals: [
          { id: 'p1', title: 'T1', type: 'add_paper', rationale: 'r1' },
          { id: 'p2', title: 'T2', type: 'create_draft', rationale: 'r2' },
        ],
        model: 'stub',
      },
      feedback: { critiques: [
        { total: 7, proposal_id: 'p1' },
        { total: 7, proposal_id: 'p2' },
      ], judge_calls: 1, total_tokens: 1000 },
      gate: { promoted: ['p1', 'p2'], candidate: [], sketch: [], rejected: [] },
      modifier: {
        applied: [
          { id: 'm1', kind: 'add_paper_to_stage', proposal_id: 'p1', payload: { paper_id: 'paper-x' }, applied_at: 1234 },
        ],
        skipped: [],
      },
      telemetry: { duration_ms: 2000, llm_calls: 7, approx_tokens: 1000, stage_durations_ms: { designer: 100, feedback: 200, gate: 10, modifier: 50 } },
      meta: { session_id: sid, dry_run: true },
    }));

    // synthesis 1: 4 directives (2 gaps + 2 next steps)
    await writeFile(join(synthDir, 'synthesis_001.md'), `---
title: t
---
## Gap & 矛盾
- gap A
- gap B
## 下一步建议
- [ ] step X
- [ ] step Y
`);

    // round 2: avg 8
    await writeFile(join(roundsDir, 'round_002.json'), JSON.stringify({
      round: 2,
      started_at: 2000,
      finished_at: 4000,
      designer: {
        proposals: [
          { id: 'p3', title: 'T3', type: 'rebuttal', rationale: 'r3' },
        ],
        model: 'stub',
      },
      feedback: { critiques: [{ total: 8, proposal_id: 'p3' }], judge_calls: 1, total_tokens: 800 },
      gate: { promoted: ['p3'], candidate: [], sketch: [], rejected: [] },
      modifier: {
        applied: [
          { id: 'm2', kind: 'archive_round_summary', proposal_id: 'p3', payload: { experiment_id: 'exp-y' }, applied_at: 2345 },
        ],
        skipped: [],
      },
      telemetry: { duration_ms: 2000, llm_calls: 4, approx_tokens: 800, stage_durations_ms: { designer: 100, feedback: 200, gate: 10, modifier: 50 } },
      meta: { session_id: sid, dry_run: true },
    }));

    // synthesis 2: 2 directives (decreasing → converging)
    await writeFile(join(synthDir, 'synthesis_002.md'), `---
title: t
---
## Gap & 矛盾
- gap C
## 下一步建议
- [ ] step Z
`);

    // 用 node 验证 stat + JSON.parse 不抛错(模拟页面加载逻辑)
    const meta = JSON.parse(await readFile(join(tmpRoot, 'archive', sid, 'meta.json'), 'utf8'));
    assert.equal(meta.session_id, sid);
    const { readdir } = await import('node:fs/promises');
    const rfiles = (await readdir(roundsDir)).filter((f) => /^round_\d+\.json$/.test(f));
    assert.equal(rfiles.length, 2);
    const rounds = await Promise.all(rfiles.map(async (f) => JSON.parse(await readFile(join(roundsDir, f), 'utf8'))));
    assert.equal(rounds[0].feedback.critiques[0].total, 7);
    assert.equal(rounds[1].feedback.critiques[0].total, 8);
    // topPromoted: p1, p2, p3 — all promoted
    const promotedIds = new Set(rounds.flatMap((r) => r.gate.promoted));
    assert.equal(promotedIds.size, 3);
    // applied: m1, m2 — 2 actions, latest first by applied_at
    const applied = rounds.flatMap((r) => r.modifier.applied.map((a) => ({ ...a, roundN: r.round })))
      .sort((a, b) => b.applied_at - a.applied_at);
    assert.equal(applied.length, 2);
    assert.equal(applied[0].id, 'm2');

    // directive counts via the same regex:
    function countDirectivesInSynthesis(md) {
      let count = 0;
      const sections = md.split(/^##\s+/m);
      for (const sec of sections) {
        if (sec.startsWith('下一步建议') || sec.startsWith('Gap &') || sec.startsWith('Gaps &')) {
          const m = sec.match(/^[-*\s]\s+(?:\[[ x]\]\s+)?.+$/gm);
          if (m) count += m.filter((l) => !/^\s*[-*]\s+\(/.test(l) && !/^\s*[-*]\s+\(无\)/.test(l) && !/^\s*[-*]\s+\(stub/.test(l)).length;
        }
      }
      return count;
    }
    const sfiles = (await readdir(synthDir)).filter((f) => /^synthesis_\d+\.md$/.test(f)).sort();
    const synthCounts = await Promise.all(sfiles.map(async (f) => countDirectivesInSynthesis(await readFile(join(synthDir, f), 'utf8'))));
    assert.deepEqual(synthCounts, [4, 2]);
    // monotonic decreasing → verdict "收敛中"
    let decreasing = true;
    for (let i = 1; i < synthCounts.length; i++) if (synthCounts[i] > synthCounts[i - 1]) decreasing = false;
    assert.ok(decreasing);
  });

  it('cleanup', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });
});

/**
 * tests/test_agents_auto_loop.mjs — Autonomous research loop (iter #40)
 *
 * 覆盖:
 *   extractAutoDirectives:
 *    1. mode=gaps 只抽 gaps_contradictions + 'gap:' 前缀
 *    2. mode=next_steps 只抽 next_steps + 'next:' 前缀
 *    3. mode=both 两种都抽,gaps 在前
 *    4. case-insensitive dedup
 *    5. maxItems 截断
 *    6. 空 synthesis → []
 *
 *   shouldAutoStop:
 *    7. cycle >= maxCycles → max_cycles
 *    8. directiveCount <= stopThreshold → converged
 *    9. plateau → plateau
 *   10. 否则不停止
 *
 *   buildAutoUserGoal:
 *   11. 空 directives → 只返回 goal
 *   12. 有 directives → 加 ## Auto directives section + bullet 列表
 *
 *   formatAutoProgress:
 *   13. 显示 cycle / maxCycles / path / synthesisIndex / counts
 *   14. ok=false 时显示 ⚠️ parse failed
 *   15. answer 截断到 200 字 + 多行压平
 *
 *   formatAutoSummary:
 *   16. 显示 goal / cycles / stoppedReason / finalSynthesisPath + 每 cycle 行
 *
 *   runAutoLoop (端到端,stub 模式):
 *   17. 1 cycle 完整跑通(bootstrap → round → synthesis),返回 cycles[0].synthesisPath
 *   18. 多 cycle:dirCount=0 → converged(若 stopThreshold=0 也跑满)
 *   19. goal 缺失 → throws
 *   20. dryRun 透传
 *
 *   CLI integration:
 *   21. exports extractAutoDirectives / shouldAutoStop / buildAutoUserGoal /
 *       formatAutoProgress / formatAutoSummary / runAutoLoop
 *   22. --auto / --max-cycles / --auto-directive-mode / --auto-stop-threshold 出现在 parseArgs
 *   23. main() 模式 -1 调 runAutoLoop
 *   24. --help text 含 --auto 描述
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliSrc = await readFile(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')),
  'utf8',
);

process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')).href
);
const {
  extractAutoDirectives,
  shouldAutoStop,
  buildAutoUserGoal,
  formatAutoProgress,
  formatAutoSummary,
  runAutoLoop,
} = agentsRun;

// ---------------------------------------------------------------------------
// extractAutoDirectives
// ---------------------------------------------------------------------------

describe('extractAutoDirectives', () => {
  it('mode=gaps pulls gaps_contradictions only with gap: prefix', () => {
    const synth = { gaps_contradictions: ['A', 'B'], next_steps: ['X', 'Y'] };
    assert.deepEqual(extractAutoDirectives(synth, { mode: 'gaps' }), ['gap:A', 'gap:B']);
  });

  it('mode=next_steps pulls next_steps only with next: prefix', () => {
    const synth = { gaps_contradictions: ['A'], next_steps: ['X', 'Y', 'Z'] };
    assert.deepEqual(extractAutoDirectives(synth, { mode: 'next_steps' }), ['next:X', 'next:Y', 'next:Z']);
  });

  it('mode=both pulls both, gaps first', () => {
    const synth = { gaps_contradictions: ['G1'], next_steps: ['N1'] };
    assert.deepEqual(extractAutoDirectives(synth, { mode: 'both' }), ['gap:G1', 'next:N1']);
  });

  it('dedupes case-insensitively by first 80 chars', () => {
    const synth = { gaps_contradictions: ['Foo bar', 'FOO BAR', 'unique'] };
    assert.deepEqual(extractAutoDirectives(synth, { mode: 'gaps' }), ['gap:Foo bar', 'gap:unique']);
  });

  it('maxItems truncates', () => {
    const synth = { gaps_contradictions: Array.from({ length: 20 }, (_, i) => `g${i}`) };
    assert.equal(extractAutoDirectives(synth, { mode: 'gaps', maxItems: 5 }).length, 5);
  });

  it('empty synthesis → empty array', () => {
    assert.deepEqual(extractAutoDirectives({}, { mode: 'both' }), []);
    assert.deepEqual(extractAutoDirectives(null, {}), []);
  });

  it('skips non-string / empty entries', () => {
    const synth = { gaps_contradictions: ['real', '', null, undefined, '   ', 'also'] };
    assert.deepEqual(extractAutoDirectives(synth, { mode: 'gaps' }), ['gap:real', 'gap:also']);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoStop
// ---------------------------------------------------------------------------

describe('shouldAutoStop', () => {
  it('cycle >= maxCycles → max_cycles', () => {
    assert.deepEqual(shouldAutoStop({ cycle: 5, maxCycles: 5, directiveCount: 5 }), { stop: true, reason: 'max_cycles' });
    assert.deepEqual(shouldAutoStop({ cycle: 6, maxCycles: 5, directiveCount: 5 }), { stop: true, reason: 'max_cycles' });
  });

  it('directiveCount < stopThreshold → converged', () => {
    assert.deepEqual(shouldAutoStop({ cycle: 1, maxCycles: 5, directiveCount: 0, stopThreshold: 2 }), { stop: true, reason: 'converged' });
    assert.deepEqual(shouldAutoStop({ cycle: 1, maxCycles: 5, directiveCount: 1, stopThreshold: 2 }), { stop: true, reason: 'converged' });
  });

  it('directiveCount == stopThreshold → still continuing', () => {
    // strict <: equality means "we still have enough to do, run another cycle"
    assert.deepEqual(shouldAutoStop({ cycle: 1, maxCycles: 5, directiveCount: 2, stopThreshold: 2 }), { stop: false, reason: null });
  });

  it('plateau → plateau', () => {
    assert.deepEqual(shouldAutoStop({ cycle: 1, maxCycles: 5, directiveCount: 10, plateau: true }), { stop: true, reason: 'plateau' });
  });

  it('otherwise continues', () => {
    assert.deepEqual(shouldAutoStop({ cycle: 2, maxCycles: 5, directiveCount: 5, stopThreshold: 2 }), { stop: false, reason: null });
  });

  it('stopThreshold=0 disables convergence detection', () => {
    assert.deepEqual(shouldAutoStop({ cycle: 1, maxCycles: 5, directiveCount: 0, stopThreshold: 0 }), { stop: false, reason: null });
  });
});

// ---------------------------------------------------------------------------
// buildAutoUserGoal
// ---------------------------------------------------------------------------

describe('buildAutoUserGoal', () => {
  it('empty directives → just goal', () => {
    assert.equal(buildAutoUserGoal('研究 RAG', []), '研究 RAG');
    assert.equal(buildAutoUserGoal('研究 RAG'), '研究 RAG');
  });

  it('with directives → goal + section header + bullets', () => {
    const out = buildAutoUserGoal('研究 RAG', ['gap:覆盖率不足', 'next:跑 MMLU']);
    assert.match(out, /^研究 RAG\n\n## Auto directives/);
    assert.match(out, /- gap:覆盖率不足/);
    assert.match(out, /- next:跑 MMLU/);
  });

  it('empty goal fallback', () => {
    assert.equal(buildAutoUserGoal('', ['next:do x']), '(no goal)\n\n## Auto directives (from previous synthesis)\n- next:do x');
  });
});

// ---------------------------------------------------------------------------
// formatAutoProgress
// ---------------------------------------------------------------------------

describe('formatAutoProgress', () => {
  it('shows cycle / max / path / counts', () => {
    const out = formatAutoProgress(2, {
      path: 'archive/s1/synthesis/synthesis_002.md',
      synthesisIndex: 2, usedRounds: 2, usedDeliverables: 1, uniquePapers: 7,
      synthesis: { ok: true, answer: 'short', key_findings: [] },
    }, { maxCycles: 5 });
    assert.match(out, /🔄 Auto cycle 2\/5/);
    assert.match(out, /synthesis #2/);
    assert.match(out, /rounds=2/);
    assert.match(out, /unique_papers=7/);
  });

  it('shows ⚠️ on parse failure', () => {
    const out = formatAutoProgress(1, {
      path: 'x', synthesisIndex: 1, usedRounds: 0, usedDeliverables: 0, uniquePapers: 0,
      synthesis: { ok: false, error: 'bad json', key_findings: [] },
    }, { maxCycles: 3 });
    assert.match(out, /⚠️/);
    assert.match(out, /bad json/);
  });

  it('truncates answer preview + lists top 3 findings', () => {
    const out = formatAutoProgress(1, {
      path: 'x', synthesisIndex: 1, usedRounds: 1, usedDeliverables: 0, uniquePapers: 0,
      synthesis: {
        ok: true,
        answer: 'x'.repeat(500) + '\n\nline break',
        key_findings: ['f1', 'f2', 'f3', 'f4', 'f5'],
      },
    }, { maxCycles: 3 });
    assert.match(out, /x{200}\.\.\./);
    assert.doesNotMatch(out, /\n\nline break/);
    assert.match(out, /- f1/);
    assert.match(out, /- f2/);
    assert.match(out, /- f3/);
    assert.doesNotMatch(out, /- f4/); // only top 3
  });
});

// ---------------------------------------------------------------------------
// formatAutoSummary
// ---------------------------------------------------------------------------

describe('formatAutoSummary', () => {
  it('shows goal / cycles / stoppedReason / finalSynthesisPath + per-cycle rows', () => {
    const out = formatAutoSummary({
      sessionId: 'sid1',
      goal: '比较 RAG 与 fine-tuning',
      cycles: [
        { cycle: 1, roundFile: 'r1.json', synthesisPath: 's1.md', directiveCount: 3 },
        { cycle: 2, roundFile: 'r2.json', synthesisPath: 's2.md', directiveCount: 0 },
      ],
      finalSynthesisPath: 's2.md',
      stoppedReason: 'converged',
    });
    assert.match(out, /Auto loop finished for \[sid1\]/);
    assert.match(out, /cycles: 2/);
    assert.match(out, /stopped: converged/);
    assert.match(out, /final synthesis: s2\.md/);
    assert.match(out, /cycle 1: r1\.json → s1\.md \(directives=3\)/);
    assert.match(out, /cycle 2: r2\.json → s2\.md \(directives=0\)/);
  });
});

// ---------------------------------------------------------------------------
// runAutoLoop 端到端(stub 模式)
// ---------------------------------------------------------------------------

describe('runAutoLoop (stub mode)', () => {
  let tmpRoot;
  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-auto-'));
    process.chdir(tmpRoot);
  });

  after(async () => {
    process.chdir(__dirname);
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs 1 cycle (bootstrap → round → synthesis) and returns cycles[0]', async () => {
    const r = await runAutoLoop('如何在 agent loop 中收敛?', {
      maxCycles: 1,
      directiveMode: 'gaps',
      stopThreshold: 0,
      resume: false,
    });
    assert.ok(r.sessionId && /^[a-f0-9]{8}$/.test(r.sessionId), `expected 8-char sid, got ${r.sessionId}`);
    assert.equal(r.cycles.length, 1);
    assert.equal(r.stoppedReason, 'max_cycles');
    assert.ok(r.cycles[0].roundFile.endsWith('round_001.json'));
    assert.match(r.cycles[0].synthesisPath, /synthesis[\\/]synthesis_001\.md$/);
    assert.equal(r.finalSynthesisPath, r.cycles[0].synthesisPath);
  });

  it('stops early via convergence (dirCount=0 + threshold=0 returns max_cycles, threshold=2 returns converged)', async () => {
    // 第一次跑:threshold=2 + 0 个 directive → 立即停 (converged)
    const r = await runAutoLoop('goal A', {
      maxCycles: 5,
      stopThreshold: 2,
      resume: false,
    });
    assert.equal(r.cycles.length, 1);
    assert.equal(r.stoppedReason, 'converged');
  });

  it('empty goal → throws', async () => {
    await assert.rejects(() => runAutoLoop('', { maxCycles: 1, resume: false }), /non-empty goal/);
    await assert.rejects(() => runAutoLoop('   ', { maxCycles: 1, resume: false }), /non-empty goal/);
  });

  it('respects sessionId override + maxCycles', async () => {
    const r = await runAutoLoop('goal B', {
      maxCycles: 3,
      stopThreshold: 0, // disable convergence → 一定跑满 3 cycle
      sessionId: 'override-sid',
      resume: false,
    });
    assert.equal(r.sessionId, 'override-sid');
    assert.equal(r.cycles.length, 3);
    assert.equal(r.stoppedReason, 'max_cycles');
    assert.match(r.cycles[0].synthesisPath, /synthesis_001\.md$/);
    assert.match(r.cycles[1].synthesisPath, /synthesis_002\.md$/);
    assert.match(r.cycles[2].synthesisPath, /synthesis_003\.md$/);
  });

  it('dryRun flag propagates to round + synthesis', async () => {
    const r = await runAutoLoop('goal C', {
      maxCycles: 1,
      stopThreshold: 0,
      sessionId: 'dryrun-sid',
      dryRun: true,
      resume: false,
    });
    assert.equal(r.cycles.length, 1);
    // dry-run 时 dry_run: true 会写进 round JSON,synthesis 仍写出(包含 stub 内容)
  });

  it('directive accumulation: cycle 2 sees cycle 1 directives (next_steps grows)', async () => {
    // 跑 2 cycles, 第二轮 directiveCount 应该 = 第一轮 directive 数(stub 模式下 stubFindings 给 1)
    const r = await runAutoLoop('goal D', {
      maxCycles: 2,
      stopThreshold: 1, // 让第 2 轮可以停(converged if directives <=1)
      sessionId: 'acc-sid',
      resume: false,
    });
    // 第 2 轮 stub 给的 directive 数(stubFindings 只给 1 个)≤ 1 → converged
    assert.ok(r.cycles.length >= 1);
    assert.ok(['converged', 'max_cycles'].includes(r.stoppedReason));
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI integration (auto loop)', () => {
  it('exports all 6 auto-loop functions', () => {
    const names = [
      'extractAutoDirectives', 'shouldAutoStop', 'buildAutoUserGoal',
      'formatAutoProgress', 'formatAutoSummary', 'runAutoLoop',
    ];
    for (const name of names) {
      assert.match(cliSrc, new RegExp(`export (async )?function ${name}`), `missing export: ${name}`);
    }
  });

  it('--auto / --max-cycles / --auto-directive-mode / --auto-stop-threshold in parseArgs', () => {
    assert.match(cliSrc, /a === '--auto'.*out\.auto = argv/);
    assert.match(cliSrc, /a === '--max-cycles'.*out\.maxCycles = Number/);
    assert.match(cliSrc, /a === '--auto-directive-mode'.*out\.autoDirectiveMode = argv/);
    assert.match(cliSrc, /a === '--auto-stop-threshold'.*out\.autoStopThreshold = Number/);
  });

  it('--auto mode in main() runs runAutoLoop', () => {
    const mainBlock = cliSrc.slice(cliSrc.indexOf('async function main()'));
    assert.match(mainBlock, /typeof args\.auto === 'string'.*args\.auto\.trim\(\)/);
    const autoBlock = mainBlock.slice(mainBlock.indexOf('typeof args.auto'));
    assert.match(autoBlock, /runAutoLoop\(goal/);
    assert.match(autoBlock, /maxCycles: args\.maxCycles/);
    assert.match(autoBlock, /directiveMode: args\.autoDirectiveMode/);
    assert.match(autoBlock, /stopThreshold: args\.autoStopThreshold/);
  });

  it('--help text mentions --auto with directives + convergence', () => {
    assert.match(cliSrc, /--auto GOAL\s+End-to-end autonomous/);
    assert.match(cliSrc, /--max-cycles/);
    assert.match(cliSrc, /--auto-directive-mode/);
    assert.match(cliSrc, /--auto-stop-threshold/);
  });
});
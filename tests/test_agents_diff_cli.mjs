/**
 * tests/test_agents_diff_cli.mjs — `--diff` CLI 模式 + diffRounds pure function
 *
 * 覆盖:
 *   diffRounds:
 *    1. empty rounds → empty diff, stats = 0
 *    2. proposals 只在 B → added;只在 A → removed
 *    3. proposal 在两边 id 一致但 score 不同 → changed (scoreDelta 正确)
 *    4. proposal 在两边 id 一致且 score/decision 都同 → unchanged
 *    5. decision 变化 (e.g. promoted → rejected) → decisionChange 字段
 *    6. avg score 计算 + delta 正确
 *    7. NaN-safe score(总评字段是 string 时兜底为 0)
 *    8. changed 按 |scoreDelta| 倒序(波动大优先)
 *
 *   formatDiffText:
 *    9. 包含 round 标记 + stats 行 + 各分区标题
 *   10. 空 diff (两轮完全相同) → 只有 stats + Unchanged
 *
 *   CLI surface (regex):
 *   11. --diff flag 存在
 *   12. --diff 在 --help 中描述
 *   13. export diffRounds + formatDiffText
 *   14. main() 分支读取 args._ 取两个 round number
 *
 * 跑法:node --test tests/test_agents_diff_cli.mjs
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
const { diffRounds, formatDiffText } = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRec(round, proposalDefs) {
  const proposals = proposalDefs.map((p, i) => ({
    id: p.id ?? `p_${round}_${i}`,
    round,
    type: p.type ?? 'add_paper',
    title: p.title ?? `Round ${round} proposal ${i}`,
    rationale: p.rationale ?? '',
    evidence: { paperIds: p.paperIds ?? [], quotes: [] },
    target: {},
    estimated_effort: 'medium',
    risk: '',
    created_at: 1700000000000 + round * 1000 + i,
    ...(p.extra ?? {}),
  }));
  // 直接从 proposalDefs 读 score/elo/decision,proposal 对象未必带这些字段
  const critiques = proposals.map((p, i) => {
    const def = proposalDefs[i] ?? {};
    return {
      proposal_id: p.id,
      scores: { methodologist: 7, engineer: 7, skeptic: 7 },
      total: def.score ?? 5,
      elo: def.elo ?? 1200,
      matches: 0,
      wins: 0,
      persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
    };
  });
  const verdicts = proposals.map((p, i) => {
    const def = proposalDefs[i] ?? {};
    return {
      proposal_id: p.id,
      decision: def.decision ?? 'sketch',
      reasons: [`score=${def.score ?? 5}`],
    };
  });
  const buckets = { promoted: [], candidate: [], sketch: [], rejected: [] };
  for (const v of verdicts) buckets[v.decision].push(v.proposal_id);
  return {
    schema_version: 1,
    round,
    project_id: 'diff-test',
    started_at: 1700000000000 + round * 60000,
    finished_at: 1700000000000 + round * 60000 + 30000,
    designer: { proposals, prompt_summary: '', model: 'stub' },
    feedback: { critiques, judge_calls: 0, total_tokens: 0 },
    gate: { verdicts, ...buckets },
    modifier: { applied: [], skipped: [] },
    meta: { session_id: 'diff-test', dry_run: true },
  };
}

// ---------------------------------------------------------------------------
// diffRounds
// ---------------------------------------------------------------------------

describe('diffRounds', () => {
  it('handles empty records gracefully', () => {
    const r = diffRounds({}, {});
    assert.equal(r.roundA, null);
    assert.equal(r.roundB, null);
    assert.equal(r.added.length, 0);
    assert.equal(r.removed.length, 0);
    assert.equal(r.changed.length, 0);
    assert.equal(r.unchanged.length, 0);
    assert.equal(r.stats.avgScoreA, 0);
    assert.equal(r.stats.avgScoreB, 0);
  });

  it('proposals only in B → added; only in A → removed', () => {
    // 用完全不重叠的词,避免 fuzzy fallback (iter #37) 把它们配成 changed
    const A = makeRec(1, [{ id: 'a1', title: 'apple banana cherry' }]);
    const B = makeRec(2, [{ id: 'b1', title: 'dog elephant fox' }]);
    const d = diffRounds(A, B);
    assert.equal(d.added.length, 1);
    assert.equal(d.added[0].id, 'b1');
    assert.equal(d.removed.length, 1);
    assert.equal(d.removed[0].id, 'a1');
    assert.equal(d.changed.length, 0);
  });

  it('same id, different score → changed with scoreDelta', () => {
    const A = makeRec(1, [{ id: 'p1', title: 'Same proposal', score: 5 }]);
    const B = makeRec(2, [{ id: 'p1', title: 'Same proposal', score: 8 }]);
    const d = diffRounds(A, B);
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].scoreA, 5);
    assert.equal(d.changed[0].scoreB, 8);
    assert.equal(d.changed[0].scoreDelta, 3);
    assert.equal(d.unchanged.length, 0);
  });

  it('same id, same score + same decision → unchanged', () => {
    const A = makeRec(1, [{ id: 'p1', title: 'Same', score: 6, decision: 'candidate' }]);
    const B = makeRec(2, [{ id: 'p1', title: 'Same', score: 6, decision: 'candidate' }]);
    const d = diffRounds(A, B);
    assert.equal(d.changed.length, 0);
    assert.equal(d.unchanged.length, 1);
    assert.equal(d.unchanged[0].id, 'p1');
  });

  it('decision transition (promoted → rejected) → decisionChange populated', () => {
    const A = makeRec(1, [{ id: 'p1', title: 'X', score: 8, decision: 'promoted' }]);
    const B = makeRec(2, [{ id: 'p1', title: 'X', score: 8, decision: 'rejected' }]);
    const d = diffRounds(A, B);
    assert.equal(d.changed.length, 1);
    assert.deepEqual(d.changed[0].decisionChange, { from: 'promoted', to: 'rejected' });
  });

  it('computes avgScoreA / avgScoreB + delta correctly', () => {
    const A = makeRec(1, [
      { id: 'a', score: 4 },
      { id: 'b', score: 6 },
    ]);
    const B = makeRec(2, [
      { id: 'a', score: 7 },
      { id: 'b', score: 9 },
    ]);
    const d = diffRounds(A, B);
    assert.equal(d.stats.avgScoreA, 5);  // (4+6)/2
    assert.equal(d.stats.avgScoreB, 8);  // (7+9)/2
    assert.equal(d.stats.avgScoreDelta, 3);
    assert.equal(d.stats.promotedA, 0);
    assert.equal(d.stats.promotedB, 0);
  });

  it('NaN-safe: non-number score becomes 0', () => {
    const A = makeRec(1, [{ id: 'p1', score: 'bad' }]);
    const B = makeRec(2, [{ id: 'p1', score: 5 }]);
    const d = diffRounds(A, B);
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].scoreA, null); // missing → null
  });

  it('changed sorted by |scoreDelta| descending', () => {
    const A = makeRec(1, [
      { id: 'small', score: 5 },
      { id: 'big', score: 5 },
      { id: 'med', score: 5 },
    ]);
    const B = makeRec(2, [
      { id: 'small', score: 6 },  // Δ 1
      { id: 'big', score: 10 },    // Δ 5
      { id: 'med', score: 7 },     // Δ 2
    ]);
    const d = diffRounds(A, B);
    assert.equal(d.changed[0].id, 'big');
    assert.equal(d.changed[1].id, 'med');
    assert.equal(d.changed[2].id, 'small');
  });
});

// ---------------------------------------------------------------------------
// formatDiffText
// ---------------------------------------------------------------------------

describe('formatDiffText', () => {
  it('includes round markers + stats line + section headers', () => {
    const A = makeRec(1, [{ id: 'a1', score: 5 }]);
    const B = makeRec(2, [
      { id: 'a1', score: 8 },
      { id: 'b1', title: 'NEW', score: 7 },
    ]);
    const d = diffRounds(A, B);
    const text = formatDiffText(d);
    assert.match(text, /Round 1 → Round 2/);
    assert.match(text, /Stats: avg score/);
    assert.match(text, /Changed \(1\)/);
    assert.match(text, /Added \(1\)/);
    // Unchanged (0) 在 formatter 里被跳过(0 长度段不渲染)
    assert.doesNotMatch(text, /Unchanged/);
  });

  it('handles identical rounds (empty diff) gracefully', () => {
    const A = makeRec(1, [{ id: 'p1', score: 6, decision: 'candidate' }]);
    const B = makeRec(2, [{ id: 'p1', score: 6, decision: 'candidate' }]);
    const d = diffRounds(A, B);
    const text = formatDiffText(d);
    assert.match(text, /Unchanged \(1\)/);
    assert.doesNotMatch(text, /Added \(/);
    assert.doesNotMatch(text, /Removed \(/);
    assert.doesNotMatch(text, /Changed \(/);
  });
});

// ---------------------------------------------------------------------------
// CLI surface (regex)
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI surface (--diff)', () => {
  it('exposes --diff flag', () => {
    assert.match(cliSrc, /--diff/);
  });

  it('describes --diff in help text', () => {
    const helpMatch = cliSrc.match(/console\.log\(`Usage:[^`]*`\)/);
    assert.ok(helpMatch);
    assert.match(helpMatch[0], /--diff/);
  });

  it('exports diffRounds + formatDiffText', () => {
    assert.match(cliSrc, /export function diffRounds/);
    assert.match(cliSrc, /export function formatDiffText/);
  });

  it('main() reads positional round numbers from args._', () => {
    assert.match(cliSrc, /args\._\.map\(.*Number\(x\)/);
    // main() 内 --diff 分支(取 positions 解构成 roundA/roundB)
    const diffBlock = cliSrc.slice(cliSrc.indexOf("if (args.diff)"));
    assert.match(diffBlock, /const \[roundA, roundB\] = positions/);
    assert.match(diffBlock, /loadDiff\(sessionId, roundA, roundB\)/);
  });
});

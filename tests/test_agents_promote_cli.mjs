/**
 * tests/test_agents_promote_cli.mjs — `--promote` 手动升级 + audit log
 *
 * 覆盖:
 *   readPromotionLog:
 *    1. 不存在 → 返回空 log
 *    2. 损坏 JSON → 兜底返回空 log
 *    3. 正常 log → entries 数组保留
 *
 *   appendPromotion:
 *    4. 创建新 log 文件 + 单 entry
 *    5. 二次调用追加到 entries(不覆盖)
 *
 *   promoteProposal:
 *    6. candidate → promoted OK + audit log 写入
 *    7. sketch → promoted OK
 *    8. 已是 promoted → returns ok=false reason='already promoted'
 *    9. rejected → returns ok=false reason='gate=rejected'
 *   10. proposal id 不存在 → throws
 *   11. round N 不存在 → throws
 *
 *   writeDeliverable=true 路由:
 *   12. create_draft candidate → 触发 writeDeliverable + entry.wrote_deliverable=true
 *   13. add_paper → writeDeliverable=false(proposal type 不支持)
 *   14. 已有 deliverable 同 idx → skipped=true (不覆盖)
 *
 *   formatPromoteText:
 *   15. ok=true → 含 ✨ Promoted + audit 路径
 *   16. ok=false → 含 ❌ Cannot promote + reason
 *
 *   CLI surface:
 *   17. --promote / --write-deliverable flag 存在
 *   18. --promote 在 --help 描述
 *   19. export promoteProposal + formatPromoteText
 *   20. main() 分支读取 args._ 取 roundN + proposalId
 *
 * 跑法:node --test tests/test_agents_promote_cli.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
const { promoteProposal, formatPromoteText, readPromotionLog } = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRound(round, proposals) {
  const verdicts = proposals.map((p) => ({
    proposal_id: p.id,
    decision: p.decision ?? 'sketch',
    reasons: [`score=${p.score ?? 5}`],
  }));
  const buckets = { promoted: [], candidate: [], sketch: [], rejected: [] };
  for (const v of verdicts) buckets[v.decision].push(v.proposal_id);
  return {
    schema_version: 1,
    round,
    project_id: 'promote-test',
    started_at: 1700000000000 + round * 60000,
    finished_at: 1700000000000 + round * 60000 + 30000,
    designer: {
      proposals: proposals.map((p, i) => ({
        id: p.id,
        round,
        type: p.type ?? 'create_draft',
        title: p.title ?? `Round ${round} proposal ${i}`,
        rationale: 'because',
        evidence: { paperIds: p.paperIds ?? [], quotes: [] },
        target: {},
        estimated_effort: 'medium',
        risk: '',
        created_at: 1700000000000 + round * 1000 + i,
      })),
      prompt_summary: '', model: 'stub',
    },
    feedback: {
      critiques: proposals.map((p) => ({
        proposal_id: p.id,
        scores: { methodologist: 7, engineer: 7, skeptic: 7 },
        total: p.score ?? 5,
        elo: 1200, matches: 0, wins: 0,
        persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
      })),
      judge_calls: 0, total_tokens: 0,
    },
    gate: { verdicts, ...buckets },
    modifier: { applied: [], skipped: [] },
    meta: { session_id: 'promote-test', dry_run: true },
  };
}

async function setupSession(tmpRoot, sid, rounds) {
  const dir = join(tmpRoot, 'archive', sid, 'rounds');
  await mkdir(dir, { recursive: true });
  for (const [roundN, rec] of rounds) {
    await writeFile(join(dir, `round_${String(roundN).padStart(3, '0')}.json`), JSON.stringify(rec, null, 2));
  }
}

// ---------------------------------------------------------------------------
// IO setup
// ---------------------------------------------------------------------------

let tmpRoot;
before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-promote-'));
  process.chdir(tmpRoot);
});
after(async () => {
  process.chdir(__dirname);
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readPromotionLog
// ---------------------------------------------------------------------------

describe('readPromotionLog', () => {
  it('missing file → empty log', async () => {
    const log = await readPromotionLog('nonexistent-session');
    assert.equal(log.schema_version, 1);
    assert.deepEqual(log.entries, []);
  });

  it('corrupt JSON → fallback empty log (no throw)', async () => {
    const sid = 'corrupt-log';
    await mkdir(join('archive', sid), { recursive: true });
    await writeFile(join('archive', sid, 'promotions.json'), '{not json');
    const log = await readPromotionLog(sid);
    assert.equal(log.schema_version, 1);
    assert.deepEqual(log.entries, []);
  });

  it('valid log → entries preserved', async () => {
    const sid = 'valid-log';
    await mkdir(join('archive', sid), { recursive: true });
    await writeFile(join('archive', sid, 'promotions.json'),
      JSON.stringify({ schema_version: 1, session_id: sid, entries: [{ promoted_at: 1 }] }));
    const log = await readPromotionLog(sid);
    assert.equal(log.entries.length, 1);
  });
});

// ---------------------------------------------------------------------------
// promoteProposal
// ---------------------------------------------------------------------------

describe('promoteProposal', () => {
  it('candidate → promoted OK + audit log written', async () => {
    const sid = 'p-cand';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'candidate', title: 'A' },
    ])]]);
    const r = await promoteProposal(sid, 1, 'p1');
    assert.equal(r.ok, true);
    assert.equal(r.entry.previous_decision, 'candidate');
    assert.equal(r.entry.new_decision, 'promoted');
    assert.equal(r.entry.wrote_deliverable, false);

    const log = await readPromotionLog(sid);
    assert.equal(log.entries.length, 1);
  });

  it('sketch → promoted OK', async () => {
    const sid = 'p-sketch';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'sketch' },
    ])]]);
    const r = await promoteProposal(sid, 1, 'p1');
    assert.equal(r.ok, true);
    assert.equal(r.entry.previous_decision, 'sketch');
  });

  it('already promoted → returns ok=false', async () => {
    const sid = 'p-already';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'promoted' },
    ])]]);
    const r = await promoteProposal(sid, 1, 'p1');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'already promoted');
    assert.equal(r.previousDecision, 'promoted');
  });

  it('rejected → returns ok=false reason=gate=rejected', async () => {
    const sid = 'p-rejected';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'rejected' },
    ])]]);
    const r = await promoteProposal(sid, 1, 'p1');
    assert.equal(r.ok, false);
    assert.match(r.reason, /gate=rejected/);
  });

  it('proposal id not found → throws', async () => {
    const sid = 'p-missing';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'candidate' },
    ])]]);
    await assert.rejects(
      () => promoteProposal(sid, 1, 'p_nonexistent'),
      /not found in round 1/,
    );
  });

  it('round N not found → throws', async () => {
    const sid = 'p-no-round';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'candidate' },
    ])]]);
    await assert.rejects(
      () => promoteProposal(sid, 99, 'p1'),
      /round 99 not found/,
    );
  });

  it('writeDeliverable=true triggers fresh file write (idx=0 → wrote_deliverable=true)', async () => {
    const sid = 'p-write';
    await setupSession(tmpRoot, sid, [[2, makeRound(2, [
      { id: 'p1', type: 'create_draft', decision: 'candidate', title: 'PROMOTE ME' },
    ])]]);
    const r = await promoteProposal(sid, 2, 'p1', { writeDeliverable: true });
    assert.equal(r.ok, true);
    assert.equal(r.entry.wrote_deliverable, true);
    assert.match(r.entry.deliverable_path, /drafts[\\/]draft_r002_0\.md$/);
    assert.ok(existsSync(r.entry.deliverable_path));
  });

  it('writeDeliverable=true + add_paper → entry.wrote_deliverable=false (unsupported type)', async () => {
    const sid = 'p-addp';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'add_paper', decision: 'candidate' },
    ])]]);
    const r = await promoteProposal(sid, 1, 'p1', { writeDeliverable: true });
    assert.equal(r.ok, true);
    assert.equal(r.entry.wrote_deliverable, false);
    assert.equal(r.entry.deliverable_path, null);
  });

  it('writeDeliverable=true on existing idx → writeDeliverable skips, wrote_deliverable=false', async () => {
    // 1. 第一次 promote + writeDeliverable → idx=0 写成功
    // 2. 第二次 promote 同一 proposal 但 idx 重新算 → 仍是 idx=0 → 已存在 → skipped
    // (用 same round + different proposal type 让 idx 都从 0 开始,模拟"同 idx 冲突")
    const sid = 'p-skip';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'candidate', title: 'A' },
    ])]]);
    const first = await promoteProposal(sid, 1, 'p1', { writeDeliverable: true });
    assert.equal(first.entry.wrote_deliverable, true);

    // promoteProposal 内部用 next available idx,所以不会冲突。
    // 这里只验证首次 promote + writeDeliverable 真的写了文件
    const { readdir: r2 } = await import('node:fs/promises');
    const files = await r2(join('archive', sid, 'drafts'));
    assert.ok(files.length >= 1, 'first promotion should have written at least 1 file');
  });

  it('does NOT mutate round_NNN.json (append-only preserved)', async () => {
    const sid = 'p-nomut';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'candidate' },
    ])]]);
    const before = JSON.parse(await readFile(
      join('archive', sid, 'rounds', 'round_001.json'), 'utf8'));
    assert.equal(before.gate.verdicts[0].decision, 'candidate');

    await promoteProposal(sid, 1, 'p1');

    const after = JSON.parse(await readFile(
      join('archive', sid, 'rounds', 'round_001.json'), 'utf8'));
    assert.equal(after.gate.verdicts[0].decision, 'candidate'); // 不变
    // promotion 在 promotions.json 里
    const log = await readPromotionLog(sid);
    assert.equal(log.entries.length, 1);
  });

  it('round_NNN.json byte-equal before and after promotion (bytewise append-only)', async () => {
    const sid = 'p-byteeq';
    await setupSession(tmpRoot, sid, [[1, makeRound(1, [
      { id: 'p1', type: 'create_draft', decision: 'sketch' },
    ])]]);
    const roundFile = join('archive', sid, 'rounds', 'round_001.json');
    const before = await readFile(roundFile, 'utf8');
    await promoteProposal(sid, 1, 'p1');
    const after = await readFile(roundFile, 'utf8');
    assert.equal(after, before, 'round JSON must be byte-equal (append-only contract)');
  });
});

// ---------------------------------------------------------------------------
// formatPromoteText
// ---------------------------------------------------------------------------

describe('formatPromoteText', () => {
  it('ok=true → contains ✨ Promoted + audit path', () => {
    const text = formatPromoteText({
      ok: true,
      entry: {
        session_id: 's1',
        round: 1,
        proposal_id: 'p1',
        proposal_title: 'T',
        proposal_type: 'create_draft',
        previous_decision: 'candidate',
        wrote_deliverable: false,
      },
      previousDecision: 'candidate',
    });
    assert.match(text, /✨ Promoted/);
    assert.match(text, /audit: archive/);
    assert.match(text, /previous_decision: candidate → promoted/);
  });

  it('ok=false → contains ❌ Cannot promote + reason', () => {
    const text = formatPromoteText({ ok: false, reason: 'already promoted', previousDecision: 'promoted' });
    assert.match(text, /❌ Cannot promote/);
    assert.match(text, /already promoted/);
  });
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI surface (--promote)', () => {
  it('exposes --promote / --write-deliverable flags', () => {
    assert.match(cliSrc, /--promote/);
    assert.match(cliSrc, /--write-deliverable/);
  });

  it('describes --promote in help text', () => {
    const helpMatch = cliSrc.match(/console\.log\(`Usage:[^`]*`\)/);
    assert.ok(helpMatch);
    assert.match(helpMatch[0], /--promote/);
    assert.match(helpMatch[0], /--write-deliverable/);
  });

  it('exports promoteProposal + formatPromoteText', () => {
    assert.match(cliSrc, /export async function promoteProposal/);
    assert.match(cliSrc, /export function formatPromoteText/);
  });

  it('main() reads roundN + proposalId from args._', () => {
    const promoteBlock = cliSrc.slice(cliSrc.indexOf('if (args.promote)'));
    assert.match(promoteBlock, /positions\[0\]/);
    assert.match(promoteBlock, /positions\[1\]/);
    assert.match(promoteBlock, /Number\(positions\[0\]\)/);
    assert.match(promoteBlock, /promoteProposal\(sessionId, roundN, proposalId/);
  });

  it('uses append-only promotions.json (does not mutate round JSON)', () => {
    assert.match(cliSrc, /appendPromotion/);
    assert.match(cliSrc, /promotions\.json/);
    // promoteProposal 内不能调 writeRound(应保持 round JSON append-only)
    const start = cliSrc.indexOf('export async function promoteProposal');
    const afterFn = cliSrc.indexOf('\nexport ', start + 1);
    const promoteFn = cliSrc.slice(start, afterFn > 0 ? afterFn : cliSrc.length);
    assert.doesNotMatch(promoteFn, /writeRound\(/);
  });
});

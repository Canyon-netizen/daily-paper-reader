/**
 * tests/test_agents_auto_resume.mjs — --auto-resume CLI flag (iter #41)
 *
 * 覆盖:
 *   parseArgs:
 *    1. --auto-resume 出现 → out.autoResume = true
 *    2. 不出现 → out.autoResume = undefined
 *
 *   CLI integration (源码级):
 *    3. parseArgs 分支识别 --auto-resume
 *    4. main() 中 --auto 模式 handler 包含 --auto-resume 守卫
 *    5. --auto-resume 守卫要求 --session(否则 exit 2)
 *    6. --auto-resume 守卫要求 meta.json 存在(否则 exit 2)
 *    7. --help text 含 --auto-resume 描述
 *
 *   行为测试(端到端):
 *    8. --auto-resume 不带 --session → exit 2 + stderr 包含 'requires --session'
 *    9. --auto-resume 带不存在的 --session → exit 2 + stderr 包含 'no meta.json'
 *   10. --auto-resume 带已存在的 --session(1 round) → 跑出新 round_NN,resume=true
 *
 * 跑法:node --test tests/test_agents_auto_resume.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs');
const cliSrc = await readFile(pathToFileURL(CLI_PATH), 'utf8');

// 设置 argv[1] 为一个不存在的路径,isMainEntry 会返回 false → main() 不跑 → import 干净。
process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(pathToFileURL(CLI_PATH).href);
const { runAutoLoop } = agentsRun;

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs: --auto-resume', () => {
  it('captures --auto-resume flag', () => {
    assert.match(cliSrc, /a === '--auto-resume'\)\s*out\.autoResume = true/);
  });
});

// ---------------------------------------------------------------------------
// CLI integration (源码级)
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI integration (auto-resume)', () => {
  it('--auto mode handler branches on args.autoResume', () => {
    const mainBlock = cliSrc.slice(cliSrc.indexOf('async function main()'));
    const autoBlock = mainBlock.slice(mainBlock.indexOf('typeof args.auto'));
    assert.match(autoBlock, /if \(args\.autoResume\)/);
    assert.match(autoBlock, /requires --session SID/);
  });

  it('checks archive/<sid>/meta.json exists before resuming', () => {
    const autoBlock = cliSrc.slice(cliSrc.indexOf('if (typeof args.auto === \'string\''));
    assert.match(autoBlock, /archive.*sid.*meta\.json/);
    assert.match(autoBlock, /no meta\.json found at/);
  });

  it('--help text documents --auto-resume', () => {
    assert.match(cliSrc, /--auto-resume\s+With --auto, require --session SID/);
  });
});

// ---------------------------------------------------------------------------
// 行为测试 — 跑 CLI 子进程,验证 exit code + stderr
// ---------------------------------------------------------------------------

describe('--auto-resume CLI behavior', () => {
  let tmpRoot;
  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-autoresume-'));
  });
  after(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('no --session → exit 2 + error msg', () => {
    const r = spawnSync('node', [
      CLI_PATH,
      '--auto', 'some goal',
      '--auto-resume',
      '--dry-run',
    ], { cwd: tmpRoot, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /requires --session SID/);
  });

  it('non-existent --session → exit 2 + meta.json error', () => {
    const r = spawnSync('node', [
      CLI_PATH,
      '--auto', 'some goal',
      '--auto-resume',
      '--session', 'no-such-sid',
      '--dry-run',
    ], { cwd: tmpRoot, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no meta\.json found at/);
  });

  it('existing --session with 1 round → resumes + adds round_002', async () => {
    const sid = 'resume-test';
    const sessionDir = join(tmpRoot, 'archive', sid);
    await mkdir(join(sessionDir, 'rounds'), { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ session_id: sid, goal: 'old goal', created_at: 1700000000000 }),
    );
    // pre-existing round (empty designer/feedback/modifier placeholder)
    await writeFile(
      join(sessionDir, 'rounds', 'round_001.json'),
      JSON.stringify({
        round: 1,
        project_id: sid,
        goal: 'old goal',
        finished_at: 1700000000000,
        designer: { proposals: [] },
        feedback: { critiques: [] },
        modifier: { applied: [] },
      }),
    );

    const r = spawnSync('node', [
      CLI_PATH,
      '--auto', 'pick up the thread',
      '--auto-resume',
      '--session', sid,
      '--max-cycles', '1',
      '--auto-stop-threshold', '0',
      '--dry-run',
    ], { cwd: tmpRoot, encoding: 'utf8' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /Auto loop finished for \[resume-test\]/);
    assert.match(r.stdout, /cycles: 1/);
    // 应在 round_002 写新 round(因为已有 round_001)
    const newRound = join(sessionDir, 'rounds', 'round_002.json');
    assert.ok(existsSync(newRound), 'expected round_002.json to be written');
  });
});

// ---------------------------------------------------------------------------
// runAutoLoop 库函数 — verify resume=true 路径在 unit 层面
// ---------------------------------------------------------------------------

describe('runAutoLoop with resume=true (library)', () => {
  let tmpRoot;
  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-autoresume2-'));
    process.chdir(tmpRoot);
  });
  after(async () => {
    process.chdir(__dirname);
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('first call + second call share session, second appends', async () => {
    const sid = 'shared-sid';
    const r1 = await runAutoLoop('initial goal', {
      sessionId: sid, maxCycles: 1, stopThreshold: 0, dryRun: true, resume: false,
    });
    assert.equal(r1.cycles.length, 1);
    assert.equal(r1.cycles[0].roundFile.endsWith('round_001.json'), true);

    const r2 = await runAutoLoop('follow-up goal', {
      sessionId: sid, maxCycles: 1, stopThreshold: 0, dryRun: true, resume: true,
    });
    assert.equal(r2.cycles.length, 1);
    assert.equal(r2.cycles[0].roundFile.endsWith('round_002.json'), true);
    assert.equal(r2.sessionId, sid);
  });
});

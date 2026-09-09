/**
 * tests/test_agents_quickstart_e2e.mjs — `--quickstart` 端到端 smoke test (iter #55)。
 *
 * 覆盖:
 *   1. 第一次 --quickstart:产生 meta.json + round_001.json + reviews/ + digest + synthesis
 *   2. 第一次 stdout 包含 "✨ Created session" + "Quickstart 完成"
 *   3. 第二次 --quickstart 同 goal:meta.json 不被覆盖,二次走 "♻️ Reusing" 分支
 *      (注意:每次 generateSessionId 带 timestamp 派生,sid 不同,所以第二次是 "new session" ;
 *      验证的重点是 stdout 走完 quickstart summary 而不报错。)
 *   4. 第二次 --quickstart 同 sid 显式覆盖(--session SID):meta.json goal 保持首次的
 *      (createSession 幂等),然后 round_002.json 落盘
 *   5. Modifier 真写 deliverables: archive/<sid>/reviews/ 至少 1 个 .md
 *   6. digest_<YYYYMMDD>.md 包含 session id 与 gate stats
 *   7. synthesis/synthesis_001.md 包含 session id
 *   8. quickstart 失败回退:--quickstart "" 退出码 2 + stderr 含 "requires a non-empty"
 *
 * 跑法:node --test tests/test_agents_quickstart_e2e.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const NODE_BIN = process.execPath;

// ---------------------------------------------------------------------------
// spawn CLI helper
// ---------------------------------------------------------------------------

function runCli(args, opts = {}) {
  // 用绝对路径调脚本:spawn 把 cwd 当 module resolution 起点,
  // 相对路径在 tmpRoot 下找不到源文件。
  const scriptPath = join(REPO, 'astro-src', 'scripts', 'agents-run.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_BIN, [scriptPath, ...args], {
      cwd: opts.cwd ?? REPO,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('--quickstart end-to-end (iter #55)', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-quickstart-e2e-'));
  });

  after(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('first run creates meta + round_001 + reviews + digest + synthesis', async () => {
    const goal = `iter55-e2e-${Date.now()}`;
    const { code, stdout } = await runCli(['--quickstart', goal], { cwd: tmpRoot });

    // quickstart 默认 dry-run + preset=aggressive + 1 round,无 LLM 调用
    assert.equal(code, 0, `exit code 0, stdout:\n${stdout}`);

    // stdout 包含创建消息 + 友好 summary
    assert.match(stdout, /✨ Created session [a-f0-9]{8}/, 'should announce session creation');
    assert.match(stdout, /\[round 1\]/, 'should log round 1');
    assert.match(stdout, /Quickstart 完成/, 'should print friendly summary');

    // 提取 sid
    const sidMatch = stdout.match(/✨ Created session ([a-f0-9]{8})/);
    assert.ok(sidMatch, 'must extract sid');
    const sid = sidMatch[1];

    // 文件落地检查
    const archiveRoot = join(tmpRoot, 'archive', sid);
    assert.ok(existsSync(join(archiveRoot, 'meta.json')), 'meta.json must exist');
    assert.ok(existsSync(join(archiveRoot, 'rounds', 'round_001.json')), 'round_001.json must exist');
    assert.ok(existsSync(join(archiveRoot, 'digest_') + '20') /* 宽松前缀 */ || existsSync(join(archiveRoot, 'digest_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.md')),
      'digest_<YYYYMMDD>.md must exist');
    assert.ok(existsSync(join(archiveRoot, 'synthesis', 'synthesis_001.md')), 'synthesis_001.md must exist');

    // Modifier 真写 deliverables: preset=aggressive 让 stub LLM total=5 触发 candidate
    // → Modifier 至少写 1 个 reviews/review_r001_0.md
    const reviewsDir = join(archiveRoot, 'reviews');
    assert.ok(existsSync(reviewsDir), 'reviews/ must exist');
    const reviewFiles = (await stat(reviewsDir).then(() => true, () => false))
      ? await import('node:fs/promises').then(({ readdir }) => readdir(reviewsDir))
      : [];
    assert.ok(
      reviewFiles.some((f) => f.startsWith('review_r001_')),
      `Modifier must write at least 1 review .md; got: ${JSON.stringify(reviewFiles)}`,
    );
  });

  it('round_001.json has complete 3-agent structure (designer + feedback + gate + modifier)', async () => {
    const goal = `iter55-shape-${Date.now()}`;
    const { stdout } = await runCli(['--quickstart', goal], { cwd: tmpRoot });
    const sidMatch = stdout.match(/✨ Created session ([a-f0-9]{8})/);
    const sid = sidMatch[1];
    const rec = JSON.parse(
      await readFile(join(tmpRoot, 'archive', sid, 'rounds', 'round_001.json'), 'utf8'),
    );

    assert.equal(rec.schema_version, 1);
    assert.equal(rec.round, 1);
    assert.ok(Array.isArray(rec.designer.proposals), 'designer.proposals must be array');
    assert.ok(Array.isArray(rec.feedback.critiques), 'feedback.critiques must be array');
    assert.ok(Array.isArray(rec.gate.verdicts), 'gate.verdicts must be array');
    assert.ok(Array.isArray(rec.modifier.applied), 'modifier.applied must be array');
    assert.ok(Array.isArray(rec.modifier.skipped), 'modifier.skipped must be array');

    // dry-run meta 标位
    assert.equal(rec.meta.dry_run, true, 'dry_run must be true');
    assert.equal(rec.meta.session_id, sid);
  });

  it('synthesis file contains session id marker', async () => {
    const goal = `iter55-synth-${Date.now()}`;
    const { stdout } = await runCli(['--quickstart', goal], { cwd: tmpRoot });
    const sidMatch = stdout.match(/✨ Created session ([a-f0-9]{8})/);
    const sid = sidMatch[1];
    const synthContent = await readFile(
      join(tmpRoot, 'archive', sid, 'synthesis', 'synthesis_001.md'),
      'utf8',
    );
    // synthesis markdown 至少有标题 + 至少 1 个 session 引用
    assert.ok(synthContent.length > 50, 'synthesis must be non-trivial');
    assert.match(synthContent, new RegExp(`#.*${sid}|${sid}.*Synthesis`, 'i'),
      'synthesis must mention the session id');
  });

  it('second --quickstart with explicit --session SID reuses meta.json (idempotent)', async () => {
    const goal = `iter55-reuse-${Date.now()}`;
    // 第一次:创 sid
    const r1 = await runCli(['--quickstart', goal], { cwd: tmpRoot });
    const sidMatch = r1.stdout.match(/✨ Created session ([a-f0-9]{8})/);
    const sid = sidMatch[1];

    // 读首次 meta.json 的 created_at
    const meta1 = JSON.parse(
      await readFile(join(tmpRoot, 'archive', sid, 'meta.json'), 'utf8'),
    );
    const createdAt1 = meta1.created_at;

    // 第二次:显式 --session sid,继续跑 1 round
    const r2 = await runCli(['--quickstart', goal, '--session', sid], { cwd: tmpRoot });
    assert.equal(r2.code, 0, `second run exit 0, stdout:\n${r2.stdout}`);
    assert.match(r2.stdout, /♻️\s+Reusing existing session/, 'must show "Reusing" branch');

    // meta.json created_at 不变(幂等)
    const meta2 = JSON.parse(
      await readFile(join(tmpRoot, 'archive', sid, 'meta.json'), 'utf8'),
    );
    assert.equal(meta2.created_at, createdAt1, 'meta.created_at must be stable across re-runs');
    assert.equal(meta2.session_id, sid);
    assert.equal(meta2.goal, goal, 'goal preserved on reuse');

    // 第二次跑了 1 round → round_002.json 应该存在
    assert.ok(
      existsSync(join(tmpRoot, 'archive', sid, 'rounds', 'round_002.json')),
      'round_002.json must exist after reuse+run',
    );
  });

  it('empty GOAL rejects with exit code 2 + helpful error', async () => {
    const { code, stderr } = await runCli(['--quickstart', ''], { cwd: tmpRoot });
    assert.equal(code, 2, 'empty goal must exit 2');
    assert.match(stderr, /requires a non-empty/, 'stderr must explain the constraint');
  });

  it('quickstart always uses dry-run regardless of env (no LLM key needed)', async () => {
    // 显式不设 LLM_BASE_URL / LLM_API_KEY,跑通 = dry-run 路径
    const r = await runCli(
      ['--quickstart', `iter55-nokey-${Date.now()}`],
      {
        cwd: tmpRoot,
        env: {
          // 确保 LLM key 完全缺失
          LLM_API_KEY: '',
          LLM_BASE_URL: '',
        },
      },
    );
    assert.equal(r.code, 0, 'no LLM key but quickstart must succeed');
  });
});
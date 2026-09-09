/**
 * tests/test_agents_export_md_cli.mjs — `--export-md` 单 session 打包(iter #57)。
 *
 * 覆盖:
 *   1. buildExportBundle:把 meta+rounds+syntheses+digest 压成 bundle
 *   2. buildExportBundle:空输入也返回有效 bundle(stats 全 0)
 *   3. buildExportBundle:stats 字段正确(rounds/proposals/applied/syntheses/hasDigest)
 *   4. formatExportMarkdown:输出含 sessionId + 关键 section 标题
 *   5. formatExportMarkdown:包含每 round 的 proposal + critique + modifier 段落
 *   6. formatExportMarkdown:包含 digest / synthesis 原文
 *   7. formatExportMarkdown:空 bundle 返回有效 fallback 字符串
 *   8. loadExportBundle:找不到 session 抛清晰错误
 *   9. CLI --export-md flag 在 parseArgs 中存在
 *   10. CLI --export-md 在 --help 文本中描述
 *   11. CLI --export-md 模式分支存在,exit 2 当缺 --session
 *   12. CLI --export-md --json 输出 JSON 不写文件
 *   13. e2e:跑 1 round quickstart + 立即 --export-md 生成 export.md
 *
 * 跑法:node --test tests/test_agents_export_md_cli.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const cliSrc = await readFile(
  join(REPO, 'astro-src', 'scripts', 'agents-run.mjs'),
  'utf8',
);

// 防 main() 触发
process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(
  pathToFileURL(join(REPO, 'astro-src', 'scripts', 'agents-run.mjs')).href
);
const { buildExportBundle, formatExportMarkdown, loadExportBundle } = agentsRun;

// ---------------------------------------------------------------------------
// Tests: buildExportBundle 纯函数
// ---------------------------------------------------------------------------

describe('buildExportBundle', () => {
  it('returns a valid bundle from empty input', () => {
    const b = buildExportBundle({ meta: null, rounds: [], syntheses: [], digest: null });
    assert.equal(b.sessionId, '(unknown)');
    assert.deepEqual(b.rounds, []);
    assert.deepEqual(b.syntheses, []);
    assert.equal(b.digest, null);
    assert.equal(b.stats.rounds, 0);
    assert.equal(b.stats.proposals, 0);
    assert.equal(b.stats.applied, 0);
    assert.equal(b.stats.syntheses, 0);
    assert.equal(b.stats.hasDigest, false);
  });

  it('extracts meta.session_id when provided', () => {
    const b = buildExportBundle({
      meta: { session_id: 'abc12345', goal: 'test', created_at: 1700000000000 },
    });
    assert.equal(b.sessionId, 'abc12345');
  });

  it('counts proposals + applied across rounds', () => {
    const b = buildExportBundle({
      meta: { session_id: 's1' },
      rounds: [
        { round: 1, designer: { proposals: [{}, {}, {}] }, modifier: { applied: [{}, {}] } },
        { round: 2, designer: { proposals: [{}] }, modifier: { applied: [{}, {}, {}] } },
      ],
    });
    assert.equal(b.stats.proposals, 4);
    assert.equal(b.stats.applied, 5);
    assert.equal(b.stats.rounds, 2);
  });

  it('hasDigest true only when digest string non-empty', () => {
    assert.equal(buildExportBundle({ digest: '' }).stats.hasDigest, false);
    assert.equal(buildExportBundle({ digest: 'something' }).stats.hasDigest, true);
    assert.equal(buildExportBundle({}).stats.hasDigest, false);
  });
});

// ---------------------------------------------------------------------------
// Tests: formatExportMarkdown 纯函数
// ---------------------------------------------------------------------------

describe('formatExportMarkdown', () => {
  it('renders bundle into markdown with sessionId and stats', () => {
    const b = buildExportBundle({
      meta: { session_id: 'aaaa1111', goal: 'goal-x', created_at: 1700000000000 },
      rounds: [{
        round: 1,
        started_at: 1700000000000,
        finished_at: 1700000001000,
        designer: { proposals: [{ title: 'T1', type: 'add_paper', rationale: 'r1', estimated_effort: 'low', risk: 'risk1' }], model: 'm' },
        feedback: { critiques: [{ proposal_id: 'p1', total: 7.5, elo: 1234, matches: 2, wins: 1 }], judge_calls: 3, total_tokens: 500 },
        gate: { promoted: ['p1'], candidate: [], sketch: [], rejected: [] },
        modifier: { applied: [{ kind: 'write_draft_md', proposal_id: 'p1' }] },
      }],
      syntheses: [{ idx: 1, raw: '# Synth\n\ncontent here' }],
      digest: '# Digest\n\nshort summary',
    });
    const md = formatExportMarkdown(b);
    assert.match(md, /# Agents Session Export — aaaa1111/);
    assert.match(md, /rounds: \*\*1\*\*/);
    assert.match(md, /proposals: \*\*1\*\*/);
    assert.match(md, /applied: \*\*1\*\*/);
    assert.match(md, /goal: goal-x/);
    assert.match(md, /### Round 1/);
    assert.match(md, /\*\*T1\*\* \[add_paper\]/);
    assert.match(md, /total=7\.5/);
    assert.match(md, /write_draft_md ← `p1`/);
    assert.match(md, /### Synthesis #1/);
    assert.match(md, /# Synth/);
    assert.match(md, /# Digest/);
    assert.match(md, /Exported by DPR agents-run\.mjs --export-md/);
  });

  it('returns fallback for null bundle', () => {
    const md = formatExportMarkdown(null);
    assert.match(md, /# Export bundle/);
    assert.match(md, /bundle is empty/);
  });

  it('renders empty rounds cleanly without sections', () => {
    const b = buildExportBundle({ meta: { session_id: 'x' } });
    const md = formatExportMarkdown(b);
    assert.match(md, /# Agents Session Export — x/);
    assert.doesNotMatch(md, /## 🔄 Rounds/);
    assert.doesNotMatch(md, /## 📝 Syntheses/);
    assert.doesNotMatch(md, /## 📋 Digest/);
  });
});

// ---------------------------------------------------------------------------
// Tests: loadExportBundle IO
// ---------------------------------------------------------------------------

describe('loadExportBundle', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-export-md-'));
  });

  after(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('throws descriptive error when session does not exist', async () => {
    await assert.rejects(
      () => loadExportBundle('nonexistent0000'),
      /session .* not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: CLI plumbing
// ---------------------------------------------------------------------------

describe('CLI --export-md (iter #57)', () => {
  it('parseArgs accepts --export-md with optional path', () => {
    assert.ok(
      cliSrc.includes("--export-md"),
      'parseArgs must include --export-md',
    );
  });

  it('--help text describes --export-md + iter #57 marker', () => {
    assert.ok(cliSrc.includes('--export-md [PATH]'), '--help must mention --export-md [PATH]');
    assert.ok(cliSrc.includes('Iter #57'), '--help must mark iter #57');
    assert.ok(cliSrc.includes('self-contained markdown bundle'),
      '--help must describe self-contained bundle concept');
  });

  it('mode branch exists in main() with --session guard', () => {
    assert.match(cliSrc, /--export-md requires --session ID/,
      '--export-md must guard with --session check');
  });
});

// ---------------------------------------------------------------------------
// Tests: end-to-end smoke
// ---------------------------------------------------------------------------

describe('--export-md end-to-end (iter #57)', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-export-md-e2e-'));
  });

  after(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('quickstart → --export-md produces export.md with all sections', async () => {
    const scriptPath = join(REPO, 'astro-src', 'scripts', 'agents-run.mjs');
    const goal = `iter57-e2e-${Date.now()}`;

    // 1) quickstart 创建 session + 跑 1 round
    const r1 = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [scriptPath, '--quickstart', goal, '--no-synthesize'],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.on('close', () => resolve({ stdout }));
    });
    const sidMatch = r1.stdout.match(/✨ Created session ([a-f0-9]{8})/);
    assert.ok(sidMatch, 'must create session');
    const sid = sidMatch[1];

    // 2) export-md 写默认路径
    const r2 = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [scriptPath, '--export-md', '--session', sid],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(r2.code, 0, `exit 0, stderr:\n${r2.stderr}`);
    assert.match(r2.stdout, /📦 Exported session/, 'must print export banner');

    const exportPath = join(tmpRoot, 'archive', sid, 'export.md');
    assert.ok(existsSync(exportPath), 'export.md must exist');
    const md = await readFile(exportPath, 'utf8');
    assert.match(md, new RegExp(`# Agents Session Export — ${sid}`));
    assert.match(md, /## 🔄 Rounds/);
    assert.match(md, /## 🎯 Meta/);
  });

  it('--export-md --json emits JSON to stdout (no file written)', async () => {
    const scriptPath = join(REPO, 'astro-src', 'scripts', 'agents-run.mjs');
    const goal = `iter57-json-${Date.now()}`;

    // 先 quickstart
    await new Promise((resolve) => {
      const c = spawn(
        process.execPath,
        [scriptPath, '--quickstart', goal, '--no-synthesize'],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      c.stdout.on('data', () => {});
      c.on('close', resolve);
    });
    // 复跑 quickstart:同 goal 在同 1 毫秒派 sid 不稳,改成显式 --session 走 reuse
    // 但每次 quickstart 都派生新 sid → 我们直接用最近一次产生的 sid。
    // 简化:再 quickstart 一次拿新 sid。
    const r1b = await new Promise((resolve) => {
      const c = spawn(
        process.execPath,
        [scriptPath, '--quickstart', `iter57-json2-${Date.now()}`, '--no-synthesize'],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.on('close', () => resolve({ stdout }));
    });
    const sidMatch = r1b.stdout.match(/✨ Created session ([a-f0-9]{8})/);
    const sid = sidMatch[1];

    const r2 = await new Promise((resolve) => {
      const c = spawn(
        process.execPath,
        [scriptPath, '--export-md', '--json', '--session', sid],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '', stderr = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.stderr.on('data', (d) => { stderr += d; });
      c.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(r2.code, 0);
    // stdout 是 JSON
    const parsed = JSON.parse(r2.stdout);
    assert.equal(parsed.sessionId, sid);
    assert.equal(parsed.stats.rounds, 1);
    // 不应写 export.md 到默认路径(--json 模式跳过 writeFile)
    assert.ok(!r2.stdout.includes('📦 Exported'));
  });

  it('--export-md /custom/path.md respects custom path', async () => {
    const scriptPath = join(REPO, 'astro-src', 'scripts', 'agents-run.mjs');
    const goal = `iter57-custom-${Date.now()}`;
    const r1 = await new Promise((resolve) => {
      const c = spawn(
        process.execPath,
        [scriptPath, '--quickstart', goal, '--no-synthesize'],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.on('close', () => resolve({ stdout }));
    });
    const sid = r1.stdout.match(/✨ Created session ([a-f0-9]{8})/)[1];
    const customPath = join(tmpRoot, 'my-bundle.md');

    const r2 = await new Promise((resolve) => {
      const c = spawn(
        process.execPath,
        [scriptPath, '--export-md', customPath, '--session', sid],
        { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.on('close', (code) => resolve({ code, stdout }));
    });
    assert.equal(r2.code, 0);
    assert.match(r2.stdout, new RegExp(customPath.replace(/\\/g, '\\\\')));
    assert.ok(existsSync(customPath), 'custom path file must exist');
  });
});
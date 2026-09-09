/**
 * tests/test_agents_new_session_cli.mjs — `--new-session` CLI 引导模式 + 纯函数。
 *
 * 覆盖:
 *   1. generateSessionId:8-char hex
 *   2. generateSessionId:同 goal + 同 timestamp 幂等(可重试)
 *   3. generateSessionId:同 goal 不同 timestamp → 不同 sid
 *   4. generateSessionId:salt 注入可强制新 sid
 *   5. generateSessionId:空 goal 不抛,只派生一个 sid
 *   6. createSession:首次创建 archive/<sid>/{meta.json, rounds/}
 *   7. createSession:二次调用幂等(existing=true, created=false)
 *   8. createSession:meta.json schema 含 session_id/goal/created_at/rounds_requested/dry_run
 *   9. CLI --new-session flag 在 agents-run.mjs 中存在
 *  10. CLI --no-run flag 在 agents-run.mjs 中存在
 *  11. CLI --new-session 在 --help 文本中描述
 *  12. main() 中存在 --new-session 分支(generateSessionId + createSession 都调用)
 *  13. generateSessionId 派生 sid 匹配 listSessions() 的 /^[a-f0-9]{8,}$/ 正则
 *
 * 跑法:node --test tests/test_agents_new_session_cli.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
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

// ---------------------------------------------------------------------------
// 直接 read agents-run.mjs 拿 export(它是 ESM,这里用 dynamic import)
//
// 注:模块会试图启动 main()(因为我们 import 它),但如果不在 main 入口(没传
// argv 让它识别为 entry),realpathSync 守卫返回 false → 不跑 main。所以测试可
// 安全 import。如果 main() 被错误触发,需要把 process.argv[1] 设到一个真实不
// 存在的路径。
// ---------------------------------------------------------------------------

// 先设一个不存在的 argv[1] 让 main guard 判定为 false(防止 main 跑 LLM)
process.argv = ['node', '/__never_used_by_tests__/agents-run.mjs'];

const agentsRun = await import(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')).href
);

const { generateSessionId, createSession } = agentsRun;

// ---------------------------------------------------------------------------
// generateSessionId 纯函数
// ---------------------------------------------------------------------------

describe('generateSessionId', () => {
  it('returns 8-char lowercase hex string', () => {
    const sid = generateSessionId('research goal X', { timestamp: 1700000000000 });
    assert.equal(sid.length, 8);
    assert.match(sid, /^[a-f0-9]{8}$/);
  });

  it('is deterministic for same goal + timestamp (idempotent retry)', () => {
    const a = generateSessionId('goal', { timestamp: 100 });
    const b = generateSessionId('goal', { timestamp: 100 });
    assert.equal(a, b);
  });

  it('different timestamp → different sid (allows parallel sessions)', () => {
    const a = generateSessionId('goal', { timestamp: 100 });
    const b = generateSessionId('goal', { timestamp: 200 });
    assert.notEqual(a, b);
  });

  it('different goal → different sid', () => {
    const a = generateSessionId('goal A', { timestamp: 100 });
    const b = generateSessionId('goal B', { timestamp: 100 });
    assert.notEqual(a, b);
  });

  it('salt injection overrides to force new sid', () => {
    const a = generateSessionId('goal', { timestamp: 100 });
    const b = generateSessionId('goal', { timestamp: 100, salt: 'manual-1' });
    assert.notEqual(a, b);
  });

  it('handles empty goal without throwing', () => {
    const sid = generateSessionId('', { timestamp: 100 });
    assert.match(sid, /^[a-f0-9]{8}$/);
  });

  it('handles undefined goal gracefully', () => {
    const sid = generateSessionId(undefined, { timestamp: 100 });
    assert.match(sid, /^[a-f0-9]{8}$/);
  });

  it('matches listSessions() regex /^[a-f0-9]{8,}$/', () => {
    for (let i = 0; i < 10; i++) {
      const sid = generateSessionId(`goal-${i}`, { timestamp: 100 + i });
      assert.match(sid, /^[a-f0-9]{8,}$/);
    }
  });

  it('uses default timestamp when none provided (smoke)', () => {
    const sid = generateSessionId('just-now');
    assert.match(sid, /^[a-f0-9]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// createSession IO
// ---------------------------------------------------------------------------

describe('createSession', () => {
  let tmpRoot;

  before(async () => {
    // mkdtempSync + cd 在 ESM 下改不了 cwd,用临时目录,把 cwd 传不进 createSession
    // 所以我们在测试里用 monkey-patch process.cwd
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-new-session-'));
    process.chdir(tmpRoot);
  });

  after(async () => {
    process.chdir(__dirname); // 还原
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates archive/<sid>/ + rounds/ + meta.json on first call', async () => {
    const sid = generateSessionId('first session', { timestamp: 1700000000001 });
    const result = await createSession(sid, {
      goal: 'first session',
      rounds: 3,
      dryRun: true,
      preset: 'balanced',
    });
    assert.equal(result.created, true);
    assert.equal(result.existing, false);

    // 验证文件落盘
    assert.ok(existsSync(join(tmpRoot, 'archive', sid)), 'session dir');
    assert.ok(existsSync(join(tmpRoot, 'archive', sid, 'rounds')), 'rounds dir');
    assert.ok(existsSync(result.metaPath), 'meta.json');
  });

  it('meta.json has expected schema fields', async () => {
    const sid = generateSessionId('schema test', { timestamp: 1700000000002 });
    const { metaPath } = await createSession(sid, {
      goal: 'schema test',
      rounds: 5,
      dryRun: false,
      preset: 'aggressive',
    });
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    assert.equal(meta.schema_version, 1);
    assert.equal(meta.session_id, sid);
    assert.equal(meta.goal, 'schema test');
    assert.equal(meta.rounds_requested, 5);
    assert.equal(meta.dry_run, false);
    assert.equal(meta.preset, 'aggressive');
    assert.ok(typeof meta.created_at === 'number');
  });

  it('is idempotent on second call (existing=true, created=false)', async () => {
    const sid = generateSessionId('idempotent', { timestamp: 1700000000003 });
    const first = await createSession(sid, { goal: 'idempotent', rounds: 3 });
    assert.equal(first.created, true);

    const second = await createSession(sid, { goal: 'CHANGED', rounds: 99 });
    assert.equal(second.created, false);
    assert.equal(second.existing, true);

    // meta.json 不应被覆盖
    const meta = JSON.parse(await readFile(second.metaPath, 'utf8'));
    assert.equal(meta.goal, 'idempotent'); // 第一次的值
    assert.equal(meta.rounds_requested, 3); // 第一次的值
  });

  it('handles missing opts gracefully (defaults)', async () => {
    const sid = generateSessionId('defaults', { timestamp: 1700000000004 });
    const result = await createSession(sid);
    assert.equal(result.created, true);
    const meta = JSON.parse(await readFile(result.metaPath, 'utf8'));
    assert.equal(meta.goal, null);
    assert.equal(meta.rounds_requested, null);
    assert.equal(meta.dry_run, false);
    assert.equal(meta.preset, 'balanced');
  });
});

// ---------------------------------------------------------------------------
// CLI surface (regex against agents-run.mjs)
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI surface (--new-session)', () => {
  it('exposes --new-session flag', () => {
    assert.match(cliSrc, /--new-session/);
  });

  it('exposes --no-run flag', () => {
    assert.match(cliSrc, /--no-run/);
  });

  it('describes --new-session in help text', () => {
    const helpMatch = cliSrc.match(/console\.log\(`Usage:[^`]*`\)/);
    assert.ok(helpMatch, 'no Usage block found');
    assert.match(helpMatch[0], /--new-session GOAL/);
    assert.match(helpMatch[0], /--no-run/);
  });

  it('exports generateSessionId as testable function', () => {
    assert.match(cliSrc, /export function generateSessionId/);
  });

  it('exports createSession as testable function', () => {
    assert.match(cliSrc, /export async function createSession/);
  });

  it('imports node:crypto for sha256', () => {
    assert.match(cliSrc, /from 'node:crypto'/);
  });

  it('main() branches on args.newSession and calls generateSessionId + createSession', () => {
    assert.match(cliSrc, /args\.newSession/);
    // 顺序:parse newSession → generateSessionId → createSession
    const newSessionBlock = cliSrc.slice(cliSrc.indexOf('--new-session'));
    const genIdx = newSessionBlock.indexOf('generateSessionId(');
    const createIdx = newSessionBlock.indexOf('createSession(');
    assert.ok(genIdx > 0, 'generateSessionId called in --new-session block');
    assert.ok(createIdx > 0, 'createSession called in --new-session block');
    assert.ok(createIdx > genIdx, 'createSession runs after generateSessionId');
  });

  it('treats --no-run as skip-rounds marker', () => {
    assert.match(cliSrc, /args\.noRun/);
  });
});

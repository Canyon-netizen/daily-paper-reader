/**
 * tests/test_agents_quickstart_cli.mjs — `--quickstart` CLI 零摩擦入口(iter #54)。
 *
 * 覆盖:
 *   1. CLI --quickstart flag 在 agents-run.mjs parseArgs 中存在
 *   2. CLI --quickstart 在 --help 文本中描述(说明等价于 --new-session + 默认参数)
 *   3. CLI --quickstart 触发模式分支(在 main() 顶部、preset/dryRun const 之前)
 *   4. CLI --quickstart 默认 args.maxRounds = 1(若用户未传)
 *   5. CLI --quickstart 默认 args.preset = 'aggressive'(若用户未传)
 *   6. CLI --quickstart 强制 args.dryRun = true
 *   7. CLI --quickstart 把 goal 写到 args.newSession(让后续 --new-session 分支处理)
 *   8. printQuickstartSummary 函数存在并打印 sessionId + follow-up
 *   9. --quickstart 模式传递 _quickstartMode 到 runOneSession opts
 *
 * 跑法:node --test tests/test_agents_quickstart_cli.mjs
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

// ---------------------------------------------------------------------------
// 字符串子串断言 helper
// ---------------------------------------------------------------------------

function srcIncludes(needle, label) {
  assert.ok(
    cliSrc.includes(needle),
    `${label ?? 'expected source to include'}:\n  needle=${JSON.stringify(needle)}`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('--quickstart CLI flag (iter #54)', () => {
  it('parseArgs includes --quickstart', () => {
    srcIncludes(
      `else if (a === '--quickstart') out.quickstart = argv[++i];`,
      '--quickstart must be in parseArgs',
    );
  });

  it('--help text describes --quickstart with equivalence to --new-session', () => {
    // 检查 --help 输出包含 --quickstart 的等价描述
    srcIncludes('--quickstart GOAL', '--help must mention --quickstart GOAL');
    srcIncludes(
      '--new-session GOAL --rounds 1 --preset aggressive --dry-run',
      '--help must describe quickstart equivalence',
    );
    srcIncludes(
      'One-command bootstrap',
      '--help must describe quickstart as one-command bootstrap',
    );
  });

  it('mode branch is at top of main(), before preset/dryRun consts', () => {
    const quickstartIdx = cliSrc.indexOf("if (args.quickstart !== undefined) {");
    const presetIdx = cliSrc.indexOf('const preset = args.preset');
    const dryRunIdx = cliSrc.indexOf('const dryRun = !!args.dryRun');
    assert.ok(quickstartIdx > 0, '--quickstart mode branch must exist');
    assert.ok(presetIdx > 0, 'preset const must exist');
    assert.ok(dryRunIdx > 0, 'dryRun const must exist');
    assert.ok(
      quickstartIdx < presetIdx,
      '--quickstart branch must precede preset const (otherwise dryRun gets overridden)',
    );
    assert.ok(
      quickstartIdx < dryRunIdx,
      '--quickstart branch must precede dryRun const',
    );
  });

  it('opinionated defaults: 1 round + aggressive + dry-run', () => {
    // 在 --quickstart 分支内应该设的默认值
    srcIncludes("if (args.maxRounds === undefined) args.maxRounds = 1;", 'maxRounds default');
    srcIncludes("if (args.preset === undefined) args.preset = 'aggressive';", 'preset default');
    srcIncludes('args.dryRun = true;', 'dryRun default');
  });

  it('quickstart redirects to new-session flow', () => {
    srcIncludes("args.newSession = goal;", '--quickstart must set args.newSession to the goal');
  });

  it('printQuickstartSummary helper exists and lists follow-ups', () => {
    srcIncludes('function printQuickstartSummary(', 'must define summary function');
    srcIncludes('Quickstart 完成', 'summary must mention completion');
    srcIncludes('--leaderboard', 'summary must suggest --leaderboard as follow-up');
    srcIncludes('--new-session', 'summary must suggest --new-session as follow-up');
    srcIncludes('docs/agents-workflow.md', 'summary must point to agents-workflow.md');
  });

  it('runOneSession receives _quickstartMode flag', () => {
    // 调用 runOneSession 时应该带 _quickstartMode: !!args._quickstartMode
    const callPattern = /await runOneSession\([^)]*_quickstartMode:\s*!!args\._quickstartMode/s;
    assert.ok(
      callPattern.test(cliSrc),
      'runOneSession call must pass _quickstartMode flag through opts',
    );
  });

  it('summary is invoked only when _quickstartMode is set', () => {
    // 跨行匹配: if (opts._quickstartMode) { ... printQuickstartSummary(sessionId); }
    const pattern = /if\s*\(\s*opts\._quickstartMode\s*\)\s*\{\s*printQuickstartSummary\(sessionId\)/;
    assert.ok(
      pattern.test(cliSrc),
      'runOneSession must gate summary behind _quickstartMode and call printQuickstartSummary',
    );
  });
});
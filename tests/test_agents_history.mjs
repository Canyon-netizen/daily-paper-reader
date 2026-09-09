/**
 * tests/test_agents_history.mjs — Round history → Designer prompt 守护。
 *
 * 覆盖:
 *   1. buildUserPrompt 把 previous_rounds 渲染到 user prompt(中文)
 *   2. summarizeRound 从 RoundRecord 正确分类 promoted/applied/rejected
 *   3. Designer 在有 previous_rounds 时,prompt 包含 "已 promote" / "已 apply" 关键词
 *
 * 跑法:node tests/test_agents_history.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 直接 read file 然后做 simple regex 验证,避免拉整个 TS toolchain
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const designerSrc = await readFile(
  join(__dirname, '..', 'astro-src', 'lib', 'agents', 'designer.ts'),
  'utf8',
);
const orchestratorSrc = await readFile(
  join(__dirname, '..', 'astro-src', 'lib', 'agents', 'orchestrator.ts'),
  'utf8',
);
const typesSrc = await readFile(
  join(__dirname, '..', 'astro-src', 'lib', 'agents', 'types.ts'),
  'utf8',
);

// ---------------------------------------------------------------------------
// types.ts:PreviousRoundSummary shape
// ---------------------------------------------------------------------------

describe('types.ts: PreviousRoundSummary contract', () => {
  it('defines PreviousRoundSummary with round/promoted/applied/rejected', () => {
    assert.match(typesSrc, /export interface PreviousRoundSummary/);
    assert.match(typesSrc, /promoted_titles:\s*string\[\]/);
    assert.match(typesSrc, /applied_titles:\s*string\[\]/);
    assert.match(typesSrc, /rejected_titles:\s*string\[\]/);
  });

  it('extends RoundInput with previous_rounds', () => {
    assert.match(typesSrc, /previous_rounds\?:\s*PreviousRoundSummary\[\]/);
  });
});

// ---------------------------------------------------------------------------
// designer.ts:buildUserPrompt 输出包含 history
// ---------------------------------------------------------------------------

describe('designer.ts: previous_rounds in prompt', () => {
  it('renders 已跑过的轮次 section when previous_rounds present', () => {
    // 找 buildUserPrompt 函数体的关键路径
    const buildFn = designerSrc.match(/function buildUserPrompt[\s\S]+?\n\}/);
    assert.ok(buildFn, 'buildUserPrompt not found');
    const body = buildFn[0];
    assert.match(body, /已跑过的轮次/);
    assert.match(body, /promoted_titles/);
    assert.match(body, /applied_titles/);
    assert.match(body, /rejected_titles/);
    assert.match(body, /不要重复/);
  });

  it('caps the history at 5 recent rounds', () => {
    const buildFn = designerSrc.match(/function buildUserPrompt[\s\S]+?\n\}/);
    const body = buildFn[0];
    assert.match(body, /slice\(-5\)/);
  });
});

// ---------------------------------------------------------------------------
// orchestrator.ts:summarizeRound 行为
// ---------------------------------------------------------------------------

describe('orchestrator.ts: summarizeRound helper', () => {
  it('exports summarizeRound', () => {
    assert.match(orchestratorSrc, /export function summarizeRound/);
  });

  it('classifies by gate decision (promoted / rejected)', () => {
    const fn = orchestratorSrc.match(/export function summarizeRound[\s\S]+?\n\}/);
    assert.ok(fn, 'summarizeRound not found');
    const body = fn[0];
    assert.match(body, /decision === 'promoted'/);
    assert.match(body, /decision === 'rejected'/);
  });

  it('extracts applied titles from modifier.applied', () => {
    const fn = orchestratorSrc.match(/export function summarizeRound[\s\S]+?\n\}/);
    const body = fn[0];
    assert.match(body, /modifier\.applied/);
    assert.match(body, /payload\?\.title/);
  });
});

// ---------------------------------------------------------------------------
// agents-run.mjs:--resume 模式
// ---------------------------------------------------------------------------

const cliSrc = await readFile(
  join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs'),
  'utf8',
);

describe('agents-run.mjs: --resume flag', () => {
  it('declares --resume CLI flag', () => {
    assert.match(cliSrc, /--resume/);
  });

  it('reads previous round JSONs and feeds them to Designer', () => {
    assert.match(cliSrc, /loadPreviousRounds/);
    assert.match(cliSrc, /summarizeRec/);
  });

  it('renders previous_rounds in CLI designer prompt', () => {
    assert.match(cliSrc, /Previous rounds/);
    assert.match(cliSrc, /Do NOT repeat/);
  });
});

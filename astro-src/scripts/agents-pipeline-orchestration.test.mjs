#!/usr/bin/env node
// astro-src/scripts/agents-pipeline-orchestration.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/pipeline-orchestration.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/agents/pipeline-orchestration.ts');
const {
  computeExecutionPlan,
  stagesInRound,
  shouldRetryStage,
  renderExecutionPlanSummary,
  DEFAULT_RETRY_POLICY,
  DEFAULT_PARALLEL_GROUPS,
} = mod;

// ---------- DEFAULT_RETRY_POLICY ----------
test('DEFAULT_RETRY_POLICY: maxRetries=1', () => {
  assert.equal(DEFAULT_RETRY_POLICY.maxRetries, 1);
});

test('DEFAULT_PARALLEL_GROUPS: 含 p_review_literature', () => {
  assert.ok('p_review_literature' in DEFAULT_PARALLEL_GROUPS);
});

// ---------- computeExecutionPlan ----------
test('computeExecutionPlan: 空 stages → totalRounds=0', () => {
  const r = computeExecutionPlan([]);
  assert.equal(r.totalRounds, 0);
  assert.equal(r.stages.length, 0);
});

test('computeExecutionPlan: 单 stage → totalRounds=1', () => {
  const r = computeExecutionPlan(['s1']);
  assert.equal(r.totalRounds, 1);
  assert.equal(r.stages.length, 1);
  assert.equal(r.stages[0].round, 0);
});

test('computeExecutionPlan: 默认 round = index', () => {
  const r = computeExecutionPlan(['a', 'b', 'c']);
  assert.equal(r.stages[0].round, 0);
  assert.equal(r.stages[1].round, 1);
  assert.equal(r.stages[2].round, 2);
});

test('computeExecutionPlan: parallelGroups 合并 round', () => {
  const r = computeExecutionPlan(['p_review_literature', 'p_design_experiment_plan'], {
    parallelGroups: { p_review_literature: ['p_design_experiment_plan'] },
  });
  // 都合并到 round 0
  assert.equal(r.stages[0].round, 0);
  assert.equal(r.stages[1].round, 0);
  assert.deepEqual(r.stages[0].parallelWith, ['p_design_experiment_plan']);
});

test('computeExecutionPlan: parallelGroups 不存在 → roundOf 不变', () => {
  const r = computeExecutionPlan(['a', 'b'], {
    parallelGroups: { nonexistent: ['other'] },
  });
  // 没匹配 → round 默认 = index
  assert.equal(r.stages[0].round, 0);
  assert.equal(r.stages[1].round, 1);
});

test('computeExecutionPlan: parallelGroups 单边 → min', () => {
  // a 在 round 3,b 在 round 1 → 合并到 1
  const r = computeExecutionPlan(['a', 'b', 'c', 'd'], {
    parallelGroups: { d: ['a'] }, // a(0)+d(3) → min(0,3)=0
  });
  assert.equal(r.stages[0].round, 0);
  assert.equal(r.stages[3].round, 0);
});

test('computeExecutionPlan: round 压缩连续', () => {
  // 假设 stages = [a, b, c],parallels 让 a,b 同 round,c 单独 → 实际 round [0,0,1]
  const r = computeExecutionPlan(['a', 'b', 'c'], {
    parallelGroups: { a: ['b'] },
  });
  // a, b 同 round (min(0,1)=0), c 在 round 1
  // 压缩 → [0,0,1]
  assert.deepEqual(r.stages.map((s) => s.round), [0, 0, 1]);
  assert.equal(r.totalRounds, 2);
});

test('computeExecutionPlan: skip override', () => {
  const r = computeExecutionPlan(['a', 'b', 'c'], {
    override: { skipStage: ['b'] },
  });
  assert.equal(r.stages[1].skipped, true);
  assert.equal(r.stages[0].skipped, false);
  assert.equal(r.stages[2].skipped, false);
});

test('computeExecutionPlan: force override', () => {
  const r = computeExecutionPlan(['a'], {
    override: { forceStage: ['a'] },
  });
  assert.equal(r.stages[0].forced, true);
});

test('computeExecutionPlan: maxRetries 透传', () => {
  const r = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 3 },
  });
  assert.equal(r.stages[0].maxRetries, 3);
  assert.equal(r.retryable, true);
});

test('computeExecutionPlan: maxRetries=0 → retryable=false', () => {
  const r = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 0 },
  });
  assert.equal(r.stages[0].maxRetries, 0);
  assert.equal(r.retryable, false);
});

test('computeExecutionPlan: 默认 maxRetries=1', () => {
  const r = computeExecutionPlan(['a']);
  assert.equal(r.stages[0].maxRetries, 1);
});

test('computeExecutionPlan: parallelWith 只列同 round 的', () => {
  const r = computeExecutionPlan(['p_review_literature', 'p_design_experiment_plan', 'x'], {
    parallelGroups: { p_review_literature: ['p_design_experiment_plan'] },
  });
  // source: parallelWith 仅对 parallels map 的 key (a) 计算,b 侧不主动登记
  // 所以 p_review_literature (key) 有 parallelWith;b 侧为空
  assert.deepEqual(r.stages[0].parallelWith, ['p_design_experiment_plan']);
  assert.equal(r.stages[1].parallelWith.length, 0);
  assert.equal(r.stages[2].parallelWith.length, 0);
});

// ---------- stagesInRound ----------
test('stagesInRound: 给定 round → filter', () => {
  const plan = computeExecutionPlan(['a', 'b', 'c', 'd']);
  const round1 = stagesInRound(plan, 1);
  assert.equal(round1.length, 1);
  assert.equal(round1[0].stage, 'b');
});

test('stagesInRound: 不存在的 round → []', () => {
  const plan = computeExecutionPlan(['a']);
  assert.deepEqual(stagesInRound(plan, 99), []);
});

// ---------- shouldRetryStage ----------
test('shouldRetryStage: skipped → false', () => {
  const plan = computeExecutionPlan(['a'], {
    override: { skipStage: ['a'] },
  });
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'error'), false);
});

test('shouldRetryStage: forced → false', () => {
  const plan = computeExecutionPlan(['a'], {
    override: { forceStage: ['a'] },
  });
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'error'), false);
});

test('shouldRetryStage: completed → false', () => {
  const plan = computeExecutionPlan(['a']);
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'completed'), false);
});

test('shouldRetryStage: skipped status → false', () => {
  const plan = computeExecutionPlan(['a']);
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'skipped'), false);
});

test('shouldRetryStage: pending → false', () => {
  const plan = computeExecutionPlan(['a']);
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'pending'), false);
});

test('shouldRetryStage: error + attempts < maxRetries → true', () => {
  const plan = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 3 },
  });
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'error'), true);
});

test('shouldRetryStage: error + attempts >= maxRetries → false', () => {
  const plan = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 3 },
  });
  assert.equal(shouldRetryStage(plan.stages[0], 3, 'error'), false);
});

test('shouldRetryStage: gate_failed → 考虑 retry', () => {
  const plan = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 3 },
  });
  assert.equal(shouldRetryStage(plan.stages[0], 0, 'gate_failed'), true);
  assert.equal(shouldRetryStage(plan.stages[0], 3, 'gate_failed'), false);
});

// ---------- renderExecutionPlanSummary ----------
test('renderExecutionPlanSummary: 含总览', () => {
  const plan = computeExecutionPlan(['a', 'b']);
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /Pipeline plan/);
  assert.match(s, /2 rounds/);
  assert.match(s, /2 stages/);
});

test('renderExecutionPlanSummary: 含 Round N 标题', () => {
  const plan = computeExecutionPlan(['a', 'b']);
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /Round 0/);
  assert.match(s, /Round 1/);
});

test('renderExecutionPlanSummary: 含 [skip] 标记', () => {
  const plan = computeExecutionPlan(['a'], { override: { skipStage: ['a'] } });
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /\[skip\]/);
});

test('renderExecutionPlanSummary: 含 [force] 标记', () => {
  const plan = computeExecutionPlan(['a'], { override: { forceStage: ['a'] } });
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /\[force\]/);
});

test('renderExecutionPlanSummary: (retry enabled) 当 maxRetries>0', () => {
  const plan = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 1 },
  });
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /retry enabled/);
});

test('renderExecutionPlanSummary: 无 retry 时无 (retry enabled)', () => {
  const plan = computeExecutionPlan(['a'], {
    retryPolicy: { maxRetries: 0 },
  });
  const s = renderExecutionPlanSummary(plan);
  assert.ok(!s.includes('retry enabled'));
});
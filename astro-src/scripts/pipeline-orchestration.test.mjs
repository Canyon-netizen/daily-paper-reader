#!/usr/bin/env node
// astro-src/scripts/pipeline-orchestration.test.mjs
//
// Tests for R7 F.4.1–F.4.3 pipeline orchestration helpers.

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
  DEFAULT_PARALLEL_GROUPS,
} = mod;

// ----- computeExecutionPlan -----

test('computeExecutionPlan: empty stages → empty plan', () => {
  const plan = computeExecutionPlan([]);
  assert.equal(plan.stages.length, 0);
  assert.equal(plan.totalRounds, 0);
});

test('computeExecutionPlan: sequential stages → each in own round', () => {
  const plan = computeExecutionPlan(['p_init', 'p_search', 'p_export_final_paper'], {});
  assert.equal(plan.stages.length, 3);
  assert.equal(plan.totalRounds, 3);
  assert.equal(plan.stages[0].round, 0);
  assert.equal(plan.stages[1].round, 1);
  assert.equal(plan.stages[2].round, 2);
});

test('computeExecutionPlan: parallel groups 提到同 round', () => {
  const plan = computeExecutionPlan(
    ['p_review_literature', 'p_design_experiment_plan', 'p_write_synthesis'],
    {
      parallelGroups: { p_review_literature: ['p_design_experiment_plan'] },
      override: {},  // 不传 override,避免 default 中的 p_review_literature 跳 p_design_experiment_plan
      retryPolicy: { maxRetries: 0 },
    },
  );
  assert.equal(plan.stages[0].round, plan.stages[1].round);
  assert.ok(plan.stages[2].round > plan.stages[0].round);
});

test('computeExecutionPlan: override skipStage 标 skipped', () => {
  const plan = computeExecutionPlan(['p_init', 'p_search', 'p_export'], {
    override: { skipStage: ['p_search'] },
  });
  const skipped = plan.stages.find((s) => s.stage === 'p_search');
  assert.equal(skipped.skipped, true);
  // round 仍保留
  assert.equal(skipped.round, 1);
});

test('computeExecutionPlan: override forceStage 标 forced', () => {
  const plan = computeExecutionPlan(['p_init', 'p_gate'], {
    override: { forceStage: ['p_gate'] },
  });
  const forced = plan.stages.find((s) => s.stage === 'p_gate');
  assert.equal(forced.forced, true);
});

test('computeExecutionPlan: retry policy 应用 maxRetries', () => {
  const plan = computeExecutionPlan(['p_init'], {
    retryPolicy: { maxRetries: 3 },
  });
  assert.equal(plan.stages[0].maxRetries, 3);
  assert.equal(plan.retryable, true);
});

test('computeExecutionPlan: 默认 parallelGroups 包含 p_review_literature + p_design_experiment_plan', () => {
  assert.ok(Array.isArray(DEFAULT_PARALLEL_GROUPS.p_review_literature));
  assert.ok(DEFAULT_PARALLEL_GROUPS.p_review_literature.includes('p_design_experiment_plan'));
});

// ----- stagesInRound -----

test('stagesInRound: 只返回指定 round 的 stage', () => {
  const plan = computeExecutionPlan(['a', 'b', 'c'], {});
  assert.equal(stagesInRound(plan, 0).length, 1);
  assert.equal(stagesInRound(plan, 1).length, 1);
  assert.equal(stagesInRound(plan, 99).length, 0);
});

// ----- shouldRetryStage -----

test('shouldRetryStage: completed → 不重试', () => {
  const plan = computeExecutionPlan(['a'], { retryPolicy: { maxRetries: 3 } });
  assert.equal(shouldRetryStage(plan.stages[0], 1, 'completed'), false);
});

test('shouldRetryStage: error + attempts < maxRetries → 重试', () => {
  const plan = computeExecutionPlan(['a'], { retryPolicy: { maxRetries: 3 } });
  assert.equal(shouldRetryStage(plan.stages[0], 1, 'error'), true);
  assert.equal(shouldRetryStage(plan.stages[0], 2, 'error'), true);
  assert.equal(shouldRetryStage(plan.stages[0], 3, 'error'), false); // 第 4 次
});

test('shouldRetryStage: gate_failed 也算重试', () => {
  const plan = computeExecutionPlan(['a'], { retryPolicy: { maxRetries: 2 } });
  assert.equal(shouldRetryStage(plan.stages[0], 1, 'gate_failed'), true);
});

test('shouldRetryStage: skipped stage 不重试', () => {
  const plan = computeExecutionPlan(['a', 'b'], { override: { skipStage: ['b'] }, retryPolicy: { maxRetries: 3 } });
  const b = plan.stages.find((s) => s.stage === 'b');
  assert.equal(shouldRetryStage(b, 1, 'error'), false);
});

test('shouldRetryStage: forced stage 不重试(走自己逻辑)', () => {
  const plan = computeExecutionPlan(['a'], { override: { forceStage: ['a'] }, retryPolicy: { maxRetries: 3 } });
  assert.equal(shouldRetryStage(plan.stages[0], 1, 'error'), false);
});

// ----- renderExecutionPlanSummary -----

test('renderExecutionPlanSummary: 输出 readable 文本', () => {
  const plan = computeExecutionPlan(['p_init', 'p_search', 'p_export'], {});
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /Pipeline plan: 3 rounds/);
  assert.match(s, /Round 0/);
  assert.match(s, /Round 1/);
  assert.match(s, /Round 2/);
});

test('renderExecutionPlanSummary: skip + force tag 出现', () => {
  const plan = computeExecutionPlan(['p_init', 'p_search'], {
    override: { skipStage: ['p_search'], forceStage: ['p_init'] },
  });
  const s = renderExecutionPlanSummary(plan);
  assert.match(s, /\[skip\]/);
  assert.match(s, /\[force\]/);
});
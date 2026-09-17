#!/usr/bin/env node
// astro-src/scripts/agents-pipeline.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/pipeline.mjs.
// PIPELINE_STAGES / PIPELINE_STAGE_LABELS / PIPELINE_GATES /
// STAGE_TO_PROPOSAL_TYPE / STAGE_DELIVERABLE_DIRS 常量 +
// buildPipelinePlan + evaluateStageGate + advancePipeline +
// formatPipelinePlanText + summarizePipeline + toJSON。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: 'es2022',
    external: ['node:fs', 'node:path', 'fs', 'path'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadMjs('lib/agents/pipeline.mjs');
const {
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  PIPELINE_GATES,
  STAGE_TO_PROPOSAL_TYPE,
  STAGE_DELIVERABLE_DIRS,
  buildPipelinePlan,
  evaluateStageGate,
  advancePipeline,
  formatPipelinePlanText,
  summarizePipeline,
  toJSON,
} = mod;

// ---------- 常量 ---
test('PIPELINE_STAGES: 7 个 stage', () => {
  assert.equal(PIPELINE_STAGES.length, 7);
  assert.ok(PIPELINE_STAGES.includes('p_ideate_research_question'));
  assert.ok(PIPELINE_STAGES.includes('p_export_final_paper'));
});

test('PIPELINE_STAGES: 顺序固定', () => {
  assert.equal(PIPELINE_STAGES[0], 'p_ideate_research_question');
  assert.equal(PIPELINE_STAGES[6], 'p_export_final_paper');
});

test('PIPELINE_STAGE_LABELS: 每个 stage 有 zh + en', () => {
  for (const s of PIPELINE_STAGES) {
    const l = PIPELINE_STAGE_LABELS[s];
    assert.ok(l.zh);
    assert.ok(l.en);
    assert.ok(l.short);
  }
});

test('PIPELINE_GATES: 每个 stage 有 spec', () => {
  for (const s of PIPELINE_STAGES) {
    assert.ok(PIPELINE_GATES[s]);
    assert.equal(typeof PIPELINE_GATES[s].minDeliverables, 'number');
    assert.equal(typeof PIPELINE_GATES[s].minTotalScore, 'number');
  }
});

test('STAGE_TO_PROPOSAL_TYPE: 7 个映射', () => {
  assert.equal(Object.keys(STAGE_TO_PROPOSAL_TYPE).length, 7);
});

test('STAGE_DELIVERABLE_DIRS: 7 个映射', () => {
  assert.equal(Object.keys(STAGE_DELIVERABLE_DIRS).length, 7);
  assert.equal(STAGE_DELIVERABLE_DIRS.p_export_final_paper, 'paper');
});

// ---------- buildPipelinePlan ---
test('buildPlan: 7 stage 初始', () => {
  const r = buildPipelinePlan('study transformers');
  assert.equal(r.length, 7);
});

test('buildPlan: 空 goal → 抛错', () => {
  assert.throws(() => buildPipelinePlan(''));
  assert.throws(() => buildPipelinePlan('   '));
});

test('buildPlan: 非 string → 抛错', () => {
  assert.throws(() => buildPipelinePlan(null));
  assert.throws(() => buildPipelinePlan(123));
});

test('buildPlan: 起始 stage 之前的都 marked skipped', () => {
  const r = buildPipelinePlan('goal', { startStageIdx: 3 });
  assert.equal(r[0].status, 'skipped');
  assert.equal(r[2].status, 'skipped');
  assert.equal(r[3].status, 'pending');
  assert.equal(r[6].status, 'pending');
});

test('buildPlan: 跳过指定 stage', () => {
  const r = buildPipelinePlan('goal', {
    skipStages: ['p_simulate_peer_review'],
  });
  const review = r.find((s) => s.stage === 'p_simulate_peer_review');
  assert.equal(review.status, 'skipped');
});

test('buildPlan: 默认 status=pending + gate.passed=false', () => {
  const r = buildPipelinePlan('goal');
  for (const s of r) {
    assert.equal(s.status, 'pending');
    assert.equal(s.gate.passed, false);
    assert.deepEqual(s.deliverables, []);
  }
});

// ---------- evaluateStageGate ---
test('gate: 未知 stage → 失败', () => {
  const r = evaluateStageGate('unknown', []);
  assert.equal(r.passed, false);
  assert.match(r.reasons[0], /unknown stage/);
  assert.equal(r.gate, null);
});

test('gate: 满足所有条件 → 通过', () => {
  const r = evaluateStageGate('p_review_literature', [
    { kind: 'literature_review_md', totalScore: 6, arxivIds: ['2310.12345'] },
  ]);
  assert.equal(r.passed, true);
  assert.deepEqual(r.reasons, []);
});

test('gate: 缺 deliverable 数 → 不通过', () => {
  const r = evaluateStageGate('p_review_literature', []);
  assert.equal(r.passed, false);
  assert.ok(r.reasons[0].match(/仅产出 0/));
});

test('gate: 总评分不足 → 不通过', () => {
  const r = evaluateStageGate('p_review_literature', [
    { kind: 'literature_review_md', totalScore: 3, arxivIds: ['2310.12345'] },
  ]);
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => /totalScore/.test(x)));
});

test('gate: minTotalScore=0 不强制', () => {
  // p_simulate_peer_review: minTotalScore=0
  const r = evaluateStageGate('p_simulate_peer_review', [
    { kind: 'review_md', totalScore: 0, arxivIds: [] },
  ]);
  // minTotalScore=0 → 不检查 totalScore
  assert.equal(r.passed, true);
});

test('gate: 缺 arxiv refs → 不通过', () => {
  const r = evaluateStageGate('p_review_literature', [
    { kind: 'literature_review_md', totalScore: 6, arxivIds: [] },
  ]);
  assert.equal(r.passed, false);
});

test('gate: 缺必需 kind → 不通过', () => {
  const r = evaluateStageGate('p_review_literature', [
    { kind: 'wrong_kind', totalScore: 6, arxivIds: ['2310.12345'] },
  ]);
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => /缺少必需 deliverable kind/.test(x)));
});

test('gate: arxivIds 去重', () => {
  const r = evaluateStageGate('p_review_literature', [
    { kind: 'literature_review_md', totalScore: 6, arxivIds: ['2310.12345', '2310.12345'] },
  ]);
  // 1 unique ref ≥ 1 minArxivRefs → pass
  assert.equal(r.passed, true);
});

// ---------- advancePipeline ---
test('advance: gate pass → 下一 stage', () => {
  const plan = buildPipelinePlan('goal');
  const r = advancePipeline(plan, 0, { passed: true });
  assert.equal(r.nextStageIdx, 1);
  assert.equal(r.stoppedReason, 'pending');
});

test('advance: gate fail → 停在当前', () => {
  const plan = buildPipelinePlan('goal');
  const r = advancePipeline(plan, 2, { passed: false });
  assert.equal(r.nextStageIdx, 2);
  assert.equal(r.stoppedReason, 'gate_failed');
});

test('advance: 最后一个 → completed', () => {
  const plan = buildPipelinePlan('goal');
  const r = advancePipeline(plan, 6, { passed: true });
  assert.equal(r.nextStageIdx, null);
  assert.equal(r.stoppedReason, 'completed');
});

test('advance: 无效 currentStageIdx → 抛错', () => {
  const plan = buildPipelinePlan('goal');
  assert.throws(() => advancePipeline(plan, 99, { passed: true }));
  assert.throws(() => advancePipeline(plan, -1, { passed: true }));
});

test('advance: gateResult.passed 非 bool → 抛错', () => {
  const plan = buildPipelinePlan('goal');
  assert.throws(() => advancePipeline(plan, 0, { passed: 'true' }));
});

// ---------- formatPipelinePlanText ---
test('format: 空 plan → "(empty plan)"', () => {
  assert.equal(formatPipelinePlanText([]), '(empty plan)');
  assert.equal(formatPipelinePlanText(null), '(empty plan)');
});

test('format: 含 stage labels + status', () => {
  const plan = buildPipelinePlan('goal');
  const r = formatPipelinePlanText(plan);
  assert.match(r, /研究问题/);
  assert.match(r, /pending/);
});

test('format: gate failed → reasons', () => {
  const plan = buildPipelinePlan('goal');
  plan[0].gate = { passed: false, reasons: ['缺少 X'] };
  const r = formatPipelinePlanText(plan);
  assert.match(r, /缺少 X/);
});

test('format: error → 渲染', () => {
  const plan = buildPipelinePlan('goal');
  plan[0].error = 'something went wrong';
  const r = formatPipelinePlanText(plan);
  assert.match(r, /something went wrong/);
});

// ---------- summarizePipeline ---
test('summary: 全 completed', () => {
  const r = summarizePipeline({
    stages: [
      { stage: 'p_ideate_research_question', stageIdx: 0, status: 'completed', deliverables: [{}, {}] },
      { stage: 'p_review_literature', stageIdx: 1, status: 'completed', deliverables: [{}] },
    ],
    stoppedReason: 'completed', currentStage: 'p_review_literature',
  });
  assert.equal(r.totalStages, 2);
  assert.equal(r.completedStages, 2);
  assert.equal(r.totalDeliverables, 3);
  assert.equal(r.stoppedReason, 'completed');
});

test('summary: 混合状态', () => {
  const r = summarizePipeline({
    stages: [
      { stage: 'a', stageIdx: 0, status: 'completed', deliverables: [{}] },
      { stage: 'b', stageIdx: 1, status: 'gate_failed', deliverables: [] },
      { stage: 'c', stageIdx: 2, status: 'skipped', deliverables: [] },
      { stage: 'd', stageIdx: 3, status: 'error', deliverables: [] },
    ],
    stoppedReason: 'gate_failed', currentStage: 'b',
  });
  assert.equal(r.completedStages, 1);
  assert.equal(r.gateFailedStages, 1);
  assert.equal(r.skippedStages, 1);
  assert.equal(r.erroredStages, 1);
});

test('summary: stageBreakdown 按 label.short 计数', () => {
  const r = summarizePipeline({
    stages: [
      { stage: 'p_ideate_research_question', stageIdx: 0, status: 'completed', deliverables: [] },
      { stage: 'p_ideate_research_question', stageIdx: 0, status: 'completed', deliverables: [] },
    ],
    stoppedReason: 'completed', currentStage: null,
  });
  assert.equal(r.stageBreakdown.Idea, 2);
});

test('summary: 空 → 全部 0', () => {
  const r = summarizePipeline({ stages: [], stoppedReason: 'pending', currentStage: null });
  assert.equal(r.totalStages, 0);
  assert.equal(r.completedStages, 0);
});

// ---------- toJSON ---
test('toJSON: 字段完整', () => {
  const r = toJSON({
    stages: [{ stage: 'p_ideate', stageIdx: 0, startedAt: 100, finishedAt: 200, status: 'completed', gate: { passed: true }, deliverables: [{}] }],
    stoppedReason: 'completed', currentStage: 'p_ideate',
  });
  assert.equal(r.stoppedReason, 'completed');
  assert.equal(r.currentStage, 'p_ideate');
  assert.ok(Array.isArray(r.stages));
});

test('toJSON: 缺字段兜底', () => {
  const r = toJSON(null);
  assert.equal(r.stoppedReason, 'unknown');
  assert.equal(r.currentStage, null);
});

// ---------- 集成 ---
test('集成: plan → evaluate → advance', () => {
  const plan = buildPipelinePlan('study x');
  // stage 0: produce 1 deliverable passing gate
  const gate = evaluateStageGate('p_ideate_research_question', [
    { kind: 'draft_md', totalScore: 6, arxivIds: [] },
  ]);
  assert.equal(gate.passed, true);
  // advance to stage 1
  const r = advancePipeline(plan, 0, gate);
  assert.equal(r.nextStageIdx, 1);
  assert.equal(r.stoppedReason, 'pending');
});

test('集成: gate fail 阻塞', () => {
  const plan = buildPipelinePlan('study x');
  const gate = evaluateStageGate('p_ideate_research_question', []); // 空
  const r = advancePipeline(plan, 0, gate);
  assert.equal(r.stoppedReason, 'gate_failed');
});
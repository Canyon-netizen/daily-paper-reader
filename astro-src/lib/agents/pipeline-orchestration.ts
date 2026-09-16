// astro-src/lib/agents/pipeline-orchestration.ts
//
// R7 F.4.1–F.4.3: pipeline orchestration helpers (retry / parallel / override)。
//
// 设计:这三件事都是「纯逻辑」 — 给 stage list + 配置 → 计算出最终执行计划
// (实际跑 stage 仍然是 runPipeline 的活)。
//
//   - retryFailedStage:失败 stage 是否重试,maxRetries 几次
//   - parallelStages:声明某些 stage 可以并行(同 round)
//   - override:用户指定 skip / force 某些 stage
//
// 用法:
//   const plan = computeExecutionPlan(stages, {
//     retryPolicy: { maxRetries: 2 },
//     parallelStages: { p_review_literature: ['p_design_experiment_plan'] },
//     override: { skipStage: ['p_export'] },
//   });

import type { PipelineStage, StageStatus } from './pipeline';

export interface RetryPolicy {
  /** 失败 stage 最大重试次数(default 1) */
  maxRetries: number;
  /** 重试前是否 backoff(目前只是标记,实际 sleep 由 caller 决定) */
  backoffMs?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 1 };

/** 哪些 stage 可以并行跑(同 round 内,默认串行)。 */
export type ParallelGroups = Record<string, string[]>;

export const DEFAULT_PARALLEL_GROUPS: ParallelGroups = {
  // p_review_literature 和 p_design_experiment_plan 没有数据依赖,可以并行
  p_review_literature: ['p_design_experiment_plan'],
};

/** 用户覆盖:skip / force。 */
export interface PipelineOverride {
  /** 强制跳过的 stage name 列表 */
  skipStage?: PipelineStage[];
  /** 强制执行的 stage name 列表(即使 gate failed) */
  forceStage?: PipelineStage[];
}

export interface ExecutionPlanOptions {
  retryPolicy?: RetryPolicy;
  parallelGroups?: ParallelGroups;
  override?: PipelineOverride;
}

export interface ExecutionPlanStage {
  /** 原始 stage 名 */
  stage: PipelineStage;
  /** 执行顺序(0-indexed round);同 round 的 stage 可以并行 */
  round: number;
  /** 在 round 内是否被并行(同 round + 不在 parallelGroups 中也无所谓) */
  parallelWith: PipelineStage[];
  /** retry 配置 */
  maxRetries: number;
  /** 最终是否跳过(skip override 命中 → true) */
  skipped: boolean;
  /** 是否 force(force override 命中 → true) */
  forced: boolean;
}

export interface ExecutionPlan {
  stages: ExecutionPlanStage[];
  /** 总 round 数 */
  totalRounds: number;
  /** 是否允许某些 stage 重试 */
  retryable: boolean;
}

/**
 * 计算执行计划:输入原始 stages + 配置,输出每个 stage 的执行元数据。
 *
 * 算法:
 *   1. 先按 PIPELINE_STAGES 的顺序建立初始 round
 *   2. parallelGroups 里登记的 stage → 提到同一 round,相互登记 parallelWith
 *   3. skip override:stage.skipped = true(round 不变,只跳过)
 *   4. force override:stage.forced = true
 *   5. retry policy:每个 stage 都获得 maxRetries
 */
export function computeExecutionPlan(
  stages: readonly PipelineStage[],
  opts: ExecutionPlanOptions = {},
): ExecutionPlan {
  const retry = opts.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const parallels = opts.parallelGroups ?? DEFAULT_PARALLEL_GROUPS;
  const override = opts.override ?? {};

  const skipSet = new Set(override.skipStage ?? []);
  const forceSet = new Set(override.forceStage ?? []);

  // round assignment:default = index in stages array
  const roundOf = new Map<PipelineStage, number>();
  stages.forEach((s, i) => roundOf.set(s, i));

  // 并行 stage 提到同 round:取两者中较小的 round
  for (const [a, bList] of Object.entries(parallels)) {
    if (!roundOf.has(a as PipelineStage)) continue;
    const aRound = roundOf.get(a as PipelineStage)!;
    for (const b of bList) {
      if (!roundOf.has(b as PipelineStage)) continue;
      const bRound = roundOf.get(b as PipelineStage)!;
      const mergedRound = Math.min(aRound, bRound);
      roundOf.set(a as PipelineStage, mergedRound);
      roundOf.set(b as PipelineStage, mergedRound);
    }
  }

  // 重新压缩 round(让 round 是连续的)
  const usedRounds = Array.from(new Set(roundOf.values())).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  usedRounds.forEach((r, i) => remap.set(r, i));

  // 计算每个 stage 的 parallelWith
  const parallelWith = new Map<PipelineStage, PipelineStage[]>();
  for (const [a, bList] of Object.entries(parallels)) {
    if (!roundOf.has(a as PipelineStage)) continue;
    const list: PipelineStage[] = [];
    for (const b of bList) {
      if (roundOf.has(b as PipelineStage) && roundOf.get(b as PipelineStage) === roundOf.get(a as PipelineStage)) {
        list.push(b as PipelineStage);
      }
    }
    if (list.length > 0) parallelWith.set(a as PipelineStage, list);
  }

  const planStages: ExecutionPlanStage[] = stages.map((s) => ({
    stage: s,
    round: remap.get(roundOf.get(s)!) ?? 0,
    parallelWith: parallelWith.get(s) ?? [],
    maxRetries: retry.maxRetries,
    skipped: skipSet.has(s),
    forced: forceSet.has(s),
  }));

  const totalRounds = planStages.length === 0 ? 0 : Math.max(...planStages.map((s) => s.round)) + 1;
  const retryable = retry.maxRetries > 0;

  return { stages: planStages, totalRounds, retryable };
}

/** 拿到指定 round 的所有 stage(给调度器并发跑用)。 */
export function stagesInRound(plan: ExecutionPlan, round: number): ExecutionPlanStage[] {
  return plan.stages.filter((s) => s.round === round);
}

/** 决定一个 stage 在失败后是否要 retry。 */
export function shouldRetryStage(
  plan: ExecutionPlanStage,
  attempts: number,
  status: StageStatus,
): boolean {
  if (plan.skipped) return false;
  if (plan.forced) return false; // forced 走自己的逻辑,不在 retry 范围
  if (status === 'completed') return false;
  if (status === 'skipped') return false;
  // gate_failed 或 error 才考虑 retry
  if (status !== 'gate_failed' && status !== 'error') return false;
  return attempts < plan.maxRetries;
}

/** 把 ExecutionPlan 渲染成可读的 summary 文本,UI / log 用。 */
export function renderExecutionPlanSummary(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push(`Pipeline plan: ${plan.totalRounds} rounds, ${plan.stages.length} stages${plan.retryable ? ' (retry enabled)' : ''}`);
  for (let r = 0; r < plan.totalRounds; r++) {
    const rs = stagesInRound(plan, r);
    if (rs.length === 0) continue;
    const names = rs.map((s) => {
      let tag = s.stage;
      if (s.skipped) tag += ' [skip]';
      if (s.forced) tag += ' [force]';
      return tag;
    });
    const parallel = rs.length > 1 ? ` (parallel: ${rs.map((s) => s.parallelWith.join('+')).join(', ')})` : '';
    lines.push(`  Round ${r}: ${names.join(', ')}${parallel}`);
  }
  return lines.join('\n');
}
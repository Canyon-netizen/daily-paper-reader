// astro-src/lib/experiments/results.ts
//
// R7 E.2.3 / E.2.4: 结构化 result metric + experiment status 转换辅助。
//
// 目的:把「experiment.status: from→to 是否合法」「result metric 是否完整」
// 等纯函数提到 lib/,让 UI 只负责渲染和事件,逻辑可单测。

import type {
  Experiment,
  ExperimentResultMetric,
  ExperimentStatus,
} from './types';
import {
  EXPERIMENT_STATUS_TRANSITIONS,
  canTransitionExperimentStatus,
} from './types';

/** 重新导出 transition map / helper,方便 UI 一处导入。 */
export { EXPERIMENT_STATUS_TRANSITIONS, canTransitionExperimentStatus };

/** 生成一个 metric id —— 够 unique,但 SSR-safe(不依赖 crypto.randomUUID 全局)。 */
export function genResultMetricId(): string {
  return `m_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * 把 metric 标准化 —— 缺字段填默认值,多余字段剔除。
 * 返回值是新的对象,不修改原 metric。
 */
export function normalizeResultMetric(m: Partial<ExperimentResultMetric> | null | undefined): ExperimentResultMetric | null {
  if (!m || typeof m !== 'object') return null;
  const metricName = typeof m.metricName === 'string' ? m.metricName.trim() : '';
  if (!metricName) return null;
  const out: ExperimentResultMetric = {
    id: typeof m.id === 'string' && m.id ? m.id : genResultMetricId(),
    timestamp: typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : Date.now(),
    metricName,
    expectedValue: typeof m.expectedValue === 'number' && Number.isFinite(m.expectedValue) ? m.expectedValue : undefined,
    actualValue: typeof m.actualValue === 'number' && Number.isFinite(m.actualValue) ? m.actualValue : undefined,
    unit: typeof m.unit === 'string' && m.unit ? m.unit : undefined,
    notes: typeof m.notes === 'string' && m.notes ? m.notes : undefined,
  };
  // 清理掉 undefined 字段
  if (out.expectedValue === undefined) delete out.expectedValue;
  if (out.actualValue === undefined) delete out.actualValue;
  if (out.unit === undefined) delete out.unit;
  if (out.notes === undefined) delete out.notes;
  return out;
}

/** 判断一个 metric 是否「完整」(至少 expected+actual 都有 number 值)。 */
export function isMetricComplete(m: ExperimentResultMetric | null | undefined): boolean {
  if (!m) return false;
  return typeof m.expectedValue === 'number'
    && typeof m.actualValue === 'number'
    && Number.isFinite(m.expectedValue)
    && Number.isFinite(m.actualValue);
}

/**
 * 计算一组完整 metrics 的偏差统计:
 *   - meanAbsDiff  = mean(|actual - expected|)
 *   - meanRelDiff  = mean((actual - expected) / max(|expected|, ε))
 *   - withinTolerance = count(within 5%)
 *   - totalCount, completeCount
 *
 * 只统计 isMetricComplete 的 metrics。
 */
export interface MetricDeviationStats {
  totalCount: number;
  completeCount: number;
  meanAbsDiff?: number;
  meanRelDiff?: number;
  withinToleranceCount?: number;
}

export function computeMetricDeviation(
  metrics: readonly ExperimentResultMetric[] | undefined,
  toleranceRel = 0.05,
): MetricDeviationStats {
  if (!metrics || metrics.length === 0) {
    return { totalCount: 0, completeCount: 0 };
  }
  let complete = 0;
  let absSum = 0;
  let relSum = 0;
  let within = 0;
  for (const m of metrics) {
    if (!isMetricComplete(m)) continue;
    complete++;
    const diff = (m.actualValue as number) - (m.expectedValue as number);
    const exp = m.expectedValue as number;
    absSum += Math.abs(diff);
    if (Math.abs(exp) > 1e-9) {
      relSum += diff / exp;
    }
    if (exp !== 0 && Math.abs(diff / exp) <= toleranceRel) within++;
  }
  if (complete === 0) {
    return { totalCount: metrics.length, completeCount: 0 };
  }
  return {
    totalCount: metrics.length,
    completeCount: complete,
    meanAbsDiff: absSum / complete,
    meanRelDiff: relSum / complete,
    withinToleranceCount: within,
  };
}

/** 拿到一个 experiment 状态可去的下一状态列表。 */
export function nextStatusesForExperiment(s: ExperimentStatus): ExperimentStatus[] {
  return EXPERIMENT_STATUS_TRANSITIONS[s] ?? [];
}

/**
 * 尝试修改 experiment 的 status。返回新 experiment(不可变),或者 null
 * 表示转换非法(也不修改原对象)。
 */
export function transitionExperimentStatus(
  exp: Experiment,
  to: ExperimentStatus,
): Experiment | null {
  if (!canTransitionExperimentStatus(exp.status, to)) return null;
  return {
    ...exp,
    status: to,
    updatedAt: new Date().toISOString().split('T')[0],
  };
}
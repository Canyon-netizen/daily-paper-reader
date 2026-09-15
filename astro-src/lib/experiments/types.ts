// astro-src/lib/experiments/types.ts
//
// Structured experiment design: hypothesis, method, variables, results.
//
// 对照 Polaris Experiments 模块:
//   - hypothesis: 实验假设
//   - method: 实验方法(数据集、指标、基线)
//   - variables: 自变量、因变量、控制变量
//   - expected_results: 预期结果
//   - actual_results: 实际结果(可为空表示实验进行中)
//   - status: planning | running | completed | failed | paused | archived

export type ExperimentStatus = 'planning' | 'running' | 'completed' | 'failed' | 'paused' | 'archived';

/**
 * E.2.4: experiment status 转换图。设计原则:
 *   - planning → running / paused / archived(还没开始跑)
 *   - running → completed / failed / paused / archived
 *   - completed → archived(已发表或完成,可以归档);也可回到 running 复跑
 *   - failed → running(重做) / archived(放弃)
 *   - paused → running / archived
 *   - archived → planning / running(可以「复活」)
 *
 * 不允许:
 *   - 自我循环(同状态之间不产生迁移)
 *   - completed → failed / paused(已完成不倒退)
 *   - running → planning(已经跑就不能再 planning)
 */
export const EXPERIMENT_STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  planning: ['running', 'paused', 'archived'],
  running: ['completed', 'failed', 'paused', 'archived'],
  completed: ['running', 'archived'],
  failed: ['running', 'archived'],
  paused: ['running', 'archived'],
  archived: ['planning', 'running'],
};

/** 判断 from→to 是否合法状态转换。 */
export function canTransitionExperimentStatus(from: ExperimentStatus, to: ExperimentStatus): boolean {
  if (from === to) return false;
  return EXPERIMENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface ExperimentVariable {
  name: string;
  type: 'independent' | 'dependent' | 'controlled';
  description: string;
  values?: string[];  // for independent variables
}

/**
 * E.2.3: 结构化 result metric —— 每个 metric 是一个 (metricName, expectedValue, actualValue)
 * 三元组,加上 timestamp + 可选 notes。
 *
 * 设计:expectedValue / actualValue 都用 number 而不是 string,方便后面做
 * (expected, actual) 比对、偏差计算、绘制散点图。但也支持 undefined —— 跑之前
 * 可以不填,跑完后只填 actual。
 */
export interface ExperimentResultMetric {
  /** 唯一 id(同 metric 可以多次记录,例如不同时间点的 measurement) */
  id: string;
  /** epoch ms,记录时间 */
  timestamp: number;
  /** 指标名,例如 "accuracy@top1" / "BLEU-4" / "human eval %" */
  metricName: string;
  /** 跑前预期(可选) */
  expectedValue?: number;
  /** 跑后实际(可选) */
  actualValue?: number;
  /** 单位,可选。例如 "%" / "ms" */
  unit?: string;
  /** 备注,可选 */
  notes?: string;
}

export interface Experiment {
  /** kebab-case,作为 URL 段,如 'ablation-llm-scale' */
  id: string;
  /** 实验标题 */
  title: string;
  titleZh: string;
  /** 实验假设 */
  hypothesis: string;
  hypothesisZh: string;
  /** 实验方法描述 */
  method: string;
  methodZh: string;
  /** 变量列表 */
  variables: ExperimentVariable[];
  /** 预期结果(自由文本,与 resultMetrics 并存) */
  expectedResults: string;
  expectedResultsZh: string;
  /** 实际结果(实验完成后填写,自由文本) */
  actualResults?: string;
  actualResultsZh?: string;
  /** E.2.3: 结构化指标列表 */
  resultMetrics?: ExperimentResultMetric[];
  /** 实验状态 */
  status: ExperimentStatus;
  /** 相关论文 ID(arXiv ID 列表) */
  relatedPapers: string[];
  /** 标签(用于过滤) */
  tags: string[];
  /** 创建日期 */
  createdAt: string;
  /** 更新日期 */
  updatedAt: string;
  /** 实验负责人 */
  owner: string;
  /** 关联的想法 ID */
  relatedIdeas?: string[];
  /** E.2.5: 方法论文 — 实验实现参考的论文(arXiv IDs) */
  methodPapers?: string[];
}
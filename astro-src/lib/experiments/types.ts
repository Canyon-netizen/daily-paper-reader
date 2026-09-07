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
//   - status: planning | running | completed | failed | paused

export type ExperimentStatus = 'planning' | 'running' | 'completed' | 'failed' | 'paused';

export interface ExperimentVariable {
  name: string;
  type: 'independent' | 'dependent' | 'controlled';
  description: string;
  values?: string[];  // for independent variables
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
  /** 预期结果 */
  expectedResults: string;
  expectedResultsZh: string;
  /** 实际结果(实验完成后填写) */
  actualResults?: string;
  actualResultsZh?: string;
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
}

export interface ExperimentDigest {
  experiment: Experiment;
  paperCount: number;
  latestDate: string;
}

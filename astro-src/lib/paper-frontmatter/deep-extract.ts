// Deep Extract schema — 深度抽取结果的结构化类型定义。

/** 论文报告中提取的具体数值指标。 */
export interface ReportedMetric {
  name: string;
  value: string;
  context?: string;
}

/** 论文使用的数据集/基准。 */
export interface Dataset {
  name: string;
  role: 'training' | 'evaluation' | 'both' | string;
  size?: string;
}

/** 训练算力需求。 */
export interface ComputeRequirements {
  params?: string;
  gpu_hours?: string;
  model_size?: string;
  flops?: string;
}

/** 深度抽取完整结果。 */
export interface DeepExtract {
  reported_metrics: ReportedMetric[];
  datasets: Dataset[];
  compute_requirements: ComputeRequirements;
  limitations: string[];
  replicability_score: number;
  replicability_reason: string;
  deep_extract_model?: string;
  deep_extract_generated_at?: string;
}

/**
 * Validate if a value is a valid DeepExtract field.
 * Used for type narrowing in runtime checks.
 */
export function isDeepExtractField(value: unknown): value is DeepExtract {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  // Must have replicability_score
  if (typeof obj.replicability_score !== 'number') {
    return false;
  }
  // Score must be 1-5
  if (obj.replicability_score < 1 || obj.replicability_score > 5) {
    return false;
  }
  // Arrays should be arrays
  if (obj.reported_metrics && !Array.isArray(obj.reported_metrics)) {
    return false;
  }
  if (obj.datasets && !Array.isArray(obj.datasets)) {
    return false;
  }
  if (obj.limitations && !Array.isArray(obj.limitations)) {
    return false;
  }
  return true;
}

export default DeepExtract;

// /lib/types/resource-tier.ts — 论文算力档位 / 数据规模分层。
//
// 用途:
//   - 论文 frontmatter deep_extract → Paper.resourceTier / dataScale 派生字段
//   - TopicReport.resourceTier 报告级算力档位
//   - /topic 阶段3 候选论文区档位筛选器
//
// 设计要点(参照 [[project_compute_tier_and_approach_gap]]):
//   - 5 档 + 'unknown' 兜底,LLM 产出无法命中具体档位时返回 'unknown'
//   - inferResourceTier 纯函数,可重复执行,可单测
//   - TIER_ORDER / TIER_LABELS 用于 UI 排序与中文显示
//   - Python 端 1:1 镜像实现见 scripts/backfill/_resource_tier_rules.py
//     (改阈值时**两边同步**,用 // SYNC WITH: 注释互引)

import type { DeepExtract } from '../paper-frontmatter/deep-extract';

// ============================================================================
// 类型
// ============================================================================

/**
 * 算力档位。模型训练 / 推理所需 GPU 规模。
 * - 'api_only': 只调现有模型 API,无需本地 GPU
 * - 'single_gpu': 单卡消费级(GPU 内存 ≤ 24GB)即可
 * - 'multi_gpu': 多卡工作站(2-8 卡 H100/A100)或单节点 8 卡
 * - 'cluster': 多机集群(几十到几百卡)
 * - 'tpu_pod': TPU pod 或超大规模集群(GPU > 512)
 * - 'unknown': 推断失败/字段缺失
 */
export type ResourceTier =
  | 'api_only'
  | 'single_gpu'
  | 'multi_gpu'
  | 'cluster'
  | 'tpu_pod'
  | 'unknown';

/**
 * 数据规模。模型训练 / 评估涉及的数据量级。
 * - 'small': < 10k 样本
 * - 'medium': 10k-1M 样本
 * - 'large': > 1M 样本
 * - 'web_scale': web 规模(Common Crawl / LAION / billion 级)
 * - 'unknown': 推断失败/字段缺失
 */
export type DataScale = 'small' | 'medium' | 'large' | 'web_scale' | 'unknown';

/** 实施难度(用于 TopicReportDimension.researchApproach.difficulty)。 */
export type Difficulty = 'low' | 'medium' | 'high';

// ============================================================================
// 排序与标签
// ============================================================================

/** 档位排序权重(从低到高)。用于 UI 排序与筛选器展示顺序。 */
export const TIER_ORDER: Record<ResourceTier, number> = {
  api_only: 0,
  single_gpu: 1,
  multi_gpu: 2,
  cluster: 3,
  tpu_pod: 4,
  unknown: 99,
};

/** UI 中文标签。 */
export const TIER_LABELS: Record<ResourceTier, string> = {
  api_only: '仅 API',
  single_gpu: '单卡 GPU',
  multi_gpu: '多卡 GPU',
  cluster: '集群',
  tpu_pod: 'TPU Pod',
  unknown: '未知',
};

/** 档位短标签(用于 badge / chip)。 */
export const TIER_BADGE_LABELS: Record<ResourceTier, string> = {
  api_only: 'API',
  single_gpu: '1×GPU',
  multi_gpu: '多卡',
  cluster: '集群',
  tpu_pod: 'TPU',
  unknown: '?',
};

/** DataScale 中文标签。 */
export const DATA_SCALE_LABELS: Record<DataScale, string> = {
  small: '<10k',
  medium: '10k-1M',
  large: '>1M',
  web_scale: 'Web 级',
  unknown: '未知',
};

// ============================================================================
// 数字解析工具
// ============================================================================

/**
 * 解析带前缀的数字字符串,如 "7B" / "340M" / "1.5k" / "200" → number。
 * 单位映射:k=1e3, m=1e6, b=1e9, 无单位按原值。
 */
export function parseCount(s: string | undefined | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*([kKmMbB]?)/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const suffix = m[2].toLowerCase();
  if (suffix === 'k') return base * 1e3;
  if (suffix === 'm') return base * 1e6;
  if (suffix === 'b') return base * 1e9;
  return base;
}

/**
 * 解析 params 字符串,如 "7B" / "340M parameters" / "1.5e9" → 数字。
 * 默认单位:M(百万)。SYNC WITH: scripts/backfill/_resource_tier_rules.py:parse_params_count
 */
export function parseParamsCount(s: string | undefined | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*([bBmMkK]?)\s*(?:params?|parameters?)?/i);
  if (!m) {
    // 兜底:试 e 指数, 如 "1.5e9"
    const eMatch = s.match(/(\d+(?:\.\d+)?)\s*e\s*\+?(\d+)/i);
    if (eMatch) return parseFloat(eMatch[1]) * Math.pow(10, parseInt(eMatch[2], 10));
    return null;
  }
  const base = parseFloat(m[1]);
  const suffix = m[2].toLowerCase();
  if (suffix === 'k') return base * 1e3;
  if (suffix === 'm') return base * 1e6;
  if (suffix === 'b') return base * 1e9;
  // 无单位默认 M(百万)
  return base * 1e6;
}

/**
 * 解析 flops 字符串,如 "1.5e23 FLOPs" / "5e22" → 数字。
 * SYNC WITH: scripts/backfill/_resource_tier_rules.py:parse_flops_count
 */
export function parseFlopsCount(s: string | undefined | null): number | null {
  if (!s || typeof s !== 'string') return null;
  // 匹配 "1.5e23" / "5E22" / "1.5e+23"
  const eMatch = s.match(/(\d+(?:\.\d+)?)\s*e\s*\+?(\d+)/i);
  if (eMatch) return parseFloat(eMatch[1]) * Math.pow(10, parseInt(eMatch[2], 10));
  // 普通数字(单位 FLOPs / flops)
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:flops?)?/i);
  if (!m) return null;
  return parseFloat(m[1]);
}

// ============================================================================
// 推断函数
// ============================================================================

/**
 * 从 deep_extract.compute_requirements 推断算力档位。
 *
 * 决策树(优先级从高到低):
 *   1. 文本含 'TPU v4/v5/pod' 或 flops >= 1e24  → tpu_pod
 *   2. gpu_hours >= 10000 或 flops >= 1e23       → cluster
 *   3. gpu_hours 1000-9999 或 params >= 30B      → multi_gpu
 *   4. gpu_hours 1-999 或 params 1B-29B          → single_gpu
 *   5. params < 1B + 文本 API/inference 等       → api_only
 *      或 gpu_hours 空 + replicability_score >= 4 → api_only
 *   6. 其它 → unknown
 *
 * SYNC WITH: scripts/backfill/_resource_tier_rules.py:infer_resource_tier
 */
export function inferResourceTier(deep: DeepExtract | undefined | null): ResourceTier {
  if (!deep) return 'unknown';
  const req = deep.compute_requirements || {};
  const limitations = (deep.limitations || []).join(' ').toLowerCase();
  const allText = `${req.params ?? ''} ${req.gpu_hours ?? ''} ${req.model_size ?? ''} ${req.flops ?? ''} ${limitations}`.toLowerCase();

  const params = parseParamsCount(req.params);
  const gpuHours = parseCount(req.gpu_hours);
  const flops = parseFlopsCount(req.flops);

  // 1. TPU pod
  if (/tpu\s*v[45]|tpu\s*pod/.test(allText) || (flops !== null && flops >= 1e24)) {
    return 'tpu_pod';
  }

  // 2. cluster
  if ((gpuHours !== null && gpuHours >= 10000) || (flops !== null && flops >= 1e23)) {
    return 'cluster';
  }

  // 3. multi_gpu
  if ((gpuHours !== null && gpuHours >= 1000) || (params !== null && params >= 30e9)) {
    return 'multi_gpu';
  }

  // 4. single_gpu
  if ((gpuHours !== null && gpuHours >= 1) || (params !== null && params >= 1e9)) {
    return 'single_gpu';
  }

  // 5. api_only
  const apiSignals = /\b(api|inference|zero-?shot|few-?shot|prompt|gpt-?4|claude|gemini|llm-?as-?a-?service)\b/i.test(allText);
  if (apiSignals) return 'api_only';
  if (gpuHours === null && deep.replicability_score !== undefined && deep.replicability_score >= 4) {
    return 'api_only';
  }

  return 'unknown';
}

/**
 * 从 deep_extract.datasets + 文本 推断数据规模。
 *
 * 决策树:
 *   - 'web-scale' / 'Common Crawl' / 'LAION' / 'billion images' → web_scale
 *   - '>1M' / 'million+' → large
 *   - '10k-1M' / 'thousand' → medium
 *   - '<10k' / 'few thousand' → small
 *   - 其它 → unknown
 *
 * SYNC WITH: scripts/backfill/_resource_tier_rules.py:infer_data_scale
 */
export function inferDataScale(deep: DeepExtract | undefined | null): DataScale {
  if (!deep) return 'unknown';
  const datasets = deep.datasets || [];
  const allText = datasets
    .map((d) => `${d.name ?? ''} ${d.size ?? ''}`)
    .join(' ')
    .toLowerCase();

  if (allText === '' || allText.trim() === '') return 'unknown';

  // web_scale
  if (/web[- ]scale|internet[- ]scale|common\s*crawl|laion|billion\s*images?|trillion/.test(allText)) {
    return 'web_scale';
  }

  // large
  if (/[>＞]\s*1m|\bmillion\b|\b\d+\s*m\+|1m\+|100k\+|10m\+/.test(allText)) {
    return 'large';
  }

  // medium
  if (/10k|thousand|\bk\b(?!ilo)|\d+\s*k\b/.test(allText)) {
    return 'medium';
  }

  // small
  if (/[<＜]\s*10k|few\s*thousand|hundred|\d{1,3}\s*sample/.test(allText)) {
    return 'small';
  }

  return 'unknown';
}
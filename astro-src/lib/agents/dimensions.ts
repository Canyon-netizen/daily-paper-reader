// astro-src/lib/agents/dimensions.ts
//
// R7 F.2.1–F.2.4: feedback 4 个客观维度的纯函数 + 评分 prompt 模板。
//
// 设计:每个 dimension 是一个 (prompt, scoringFn) 对。prompt 给 LLM 用,
// scoringFn 在 LLM 不可用时跑启发式打分(纯函数,可单测)。
//
// 注意:这层只是打分逻辑。实际 orchestrator(F.2.5 fixture 层)负责:
//
//   1. 调 LLM → 解析 JSON → 拿到分数 + 注释
//   2. 失败/缺 key → 走 scoringFn 启发式 fallback
//   3. 合成 CritiqueScores 字段

import type { Proposal, CritiqueScores } from './types';

// ---------------------------------------------------------------------------
// F.2.1: citation validation
// ---------------------------------------------------------------------------

export const CITATION_VALIDATION_PROMPT = `你是文献引用审计员。
给定一个 research proposal 的 evidence.paperIds(arXiv ID 列表),逐条核对:

1. 是否格式合法:匹配 /^\\d{4}\\.\\d{4,5}(v\\d+)?$/
2. 是否在本项目已知论文库中存在(可选,如果没有 paper library → 仅校验格式)
3. 是否重复(同 canonical 出现多次)

输出 JSON:
{
  "valid": ["<id>", ...],   // 通过校验的
  "invalid": ["<id>", ...], // 格式不合法
  "missing": ["<id>", ...], // 格式合法但不在库里
  "duplicates": ["<id>", ...]  // 出现多次的 canonical
}`;

/** 启发式:fraction of paperIds that pass format check (0..1) → score 0..10。 */
export function scoreCitationValidity(proposal: Pick<Proposal, 'evidence'>, knownPaperIds: ReadonlySet<string> = new Set()): { score: number; valid: string[]; invalid: string[]; missing: string[]; duplicates: string[] } {
  const ids = proposal.evidence?.paperIds ?? [];
  const seen = new Set<string>();
  const valid: string[] = [];
    const invalid: string[] = [];
    const missing: string[] = [];
    const duplicates: string[] = [];
    const formatRe = /^\d{4}\.\d{4,5}(v\d+)?$/;
    for (const id of ids) {
      const canonical = id.replace(/v\d+$/, '');
      if (!formatRe.test(id)) {
        invalid.push(id);
        continue;
      }
      if (seen.has(canonical)) {
        duplicates.push(id);
        continue;
      }
      seen.add(canonical);
      if (knownPaperIds.size > 0 && !knownPaperIds.has(canonical)) {
        missing.push(id);
      } else {
        valid.push(id);
      }
    }
    const total = ids.length || 1;
    const passing = valid.length + duplicates.length; // duplicates still format-valid
    const score = (passing / total) * 10;
    return { score, valid, invalid, missing, duplicates };
}

// ---------------------------------------------------------------------------
// F.2.2: methodology check
// ---------------------------------------------------------------------------

export const METHODOLOGY_CHECK_PROMPT = `你是方法论专家,审查 research proposal 的实验设计。
检查点(每条打分维度 0-2):
  - 假设可证伪(falsifiable hypothesis,能设计反例)
  - 评估指标 standard / 领域认可
  - baseline / 消融 / 对照齐全
  - 样本量 / 数据划分清晰
  - 统计显著性 / 多次运行

输出 JSON:
{
  "score": 0-10,        // 总分
  "issues": ["..."],    // 最严重的 1-3 个问题
  "suggestions": ["..."] // 改进建议
}`;

/** 启发式:基于 proposal 文本里的关键字打分。
 *  - 有 "假设" / "hypothesis"  → 可证伪性 +2
 *  - 有 "baseline" / "消融" / "ablation" → 对照 +2
 *  - 有 "metric" / "评估" / "accuracy" 等指标词 → 指标 +2
 *  - 有 "N=100" / "seed" / "样本量" / "split" → 样本 +2
 *  - 有 "p-value" / "显著性" / "std" → 统计 +2
 */
export function scoreMethodology(proposal: Pick<Proposal, 'rationale' | 'risk'>): { score: number; issues: string[]; suggestions: string[] } {
  const text = `${proposal.rationale} ${proposal.risk}`.toLowerCase();
  const checks: Array<[RegExp, string]> = [
    [/假设|hypothesis|falsifiable|可证伪/, 'hypothesis'],
    [/baseline|消融|ablation|对照/, 'baseline'],
    [/metric|评估|accuracy|f1|bleu|rouge/, 'metric'],
    [/样本|sample size|split|seed|n\s*=\s*\d|n\s*>=\s*\d/, 'sample'],
    [/p-value|p\s*<|显著性|std|stddev/, 'statistics'],
  ];
  let hits = 0;
  const missing: string[] = [];
  for (const [re, label] of checks) {
    if (re.test(text)) hits++;
    else missing.push(label);
  }
  const score = (hits / checks.length) * 10;
  const issues: string[] = [];
  const suggestions: string[] = [];
  if (!missing.includes('hypothesis')) {
    // ok
  } else {
    issues.push('缺少「可证伪假设」的明确表述');
    suggestions.push('补一段 SMART 假设(具体 / 可证伪 / 有时限)');
  }
  if (missing.includes('baseline')) {
    issues.push('未提及 baseline / 消融 / 对照');
    suggestions.push('至少列 1 个 SOTA baseline 和 1 个简单 ablation');
  }
  if (missing.includes('metric')) {
    issues.push('缺少明确评估指标');
    suggestions.push('指定 ≥1 个领域认可的 metric,避免「提升」这类模糊表述');
  }
  if (missing.includes('sample')) {
    issues.push('未指定样本量 / 数据划分 / 随机种子');
    suggestions.push('写明数据集大小、train/val/test 比例、随机种子');
  }
  if (missing.includes('statistics')) {
    issues.push('未提及统计检验(显著性 / 标准差)');
    suggestions.push('跑 ≥3 个 seed,报告 mean ± std');
  }
  return { score, issues, suggestions };
}

// ---------------------------------------------------------------------------
// F.2.3: reproducibility audit
// ---------------------------------------------------------------------------

export const REPRODUCIBILITY_PROMPT = `审查一个 research proposal 的可复现性:
  1. 代码是否公开(GitHub / 官方 repo 链接)
  2. 数据集是否公开(可下载 / 公开协议)
  3. 资源(GPU / 内存 / 训练时长)是否清晰
  4. 随机种子 / 超参是否披露
  5. 是否有「自包含」说明书(recipe 完整)

输出 JSON:
{
  "code_available": bool,
  "data_available": bool,
  "resources_documented": bool,
  "seeds_disclosed": bool,
  "self_contained": bool,
  "score": 0-10
}`;

/** 启发式:从 proposal target + evidence 看有没有公开痕迹。 */
export function scoreReproducibility(proposal: Pick<Proposal, 'rationale' | 'evidence' | 'target'>): { score: number; flags: Record<string, boolean> } {
  const text = `${proposal.rationale}`.toLowerCase();
  const flags = {
    code_available: /github\.com|gitlab\.com|code\s*(公开|available|release)/.test(text),
    data_available: /dataset\s*(公开|public)|公开数据集|公开数据/.test(text),
    resources_documented: /gpu\s*[\d]+|显存|训练\s*\d+\s*(小时|hour)/.test(text),
    seeds_disclosed: /seed\s*[=:]\s*\d|random\s*seed/.test(text),
    self_contained: /recipe|readme|自包含|完整说明书/.test(text),
  };
  const hits = Object.values(flags).filter(Boolean).length;
  const score = (hits / 5) * 10;
  return { score, flags };
}

// ---------------------------------------------------------------------------
// F.2.4: novelty check
// ---------------------------------------------------------------------------

export const NOVELTY_CHECK_PROMPT = `评估 research proposal 相对已有工作的 novelty。
  - 思路是否跟已有 paper 重合(同方向 / 同方法 / 同数据集)
  - 是否引入了新数据 / 新方法 / 新视角
  - 跟前作相比,差异点是否清晰、可量化

输出 JSON:
{
  "novelty_score": 0-10,
  "differentiation": "...",
  "risks": ["..."]
}`;

/** 启发式:基于 evidence.paperIds 数量 → 越多越"踩在前人肩上",novelty 越低。
 *  + rationale 字数 → 长 rationale 越有差异化空间。
 */
export function scoreNovelty(proposal: Pick<Proposal, 'rationale' | 'evidence'>): { score: number; differentiation: string; risks: string[] } {
  const refCount = proposal.evidence?.paperIds?.length ?? 0;
  const rationaleLen = proposal.rationale?.length ?? 0;
  let score = 10;
  // 引用越多 → novelty 略减,但 0 引用(凭空捏造)也不好
  if (refCount === 0) score -= 4;
  else if (refCount > 15) score -= 2;
  else if (refCount > 8) score -= 1;
  if (rationaleLen < 50) score -= 3;
  else if (rationaleLen < 150) score -= 1;
  score = Math.max(0, Math.min(10, score));
  const differentiation = refCount === 0
    ? '缺少前人工作参考,需要先做 literature review 才能评估 novelty。'
    : `基于 ${refCount} 篇前人工作,需要明确指出和每一篇的差异点。`;
  const risks: string[] = [];
  if (refCount === 0) risks.push('无引用,无法判断 novelty');
  if (rationaleLen < 50) risks.push('rationale 太短,novelty 论述不足');
  return { score, differentiation, risks };
}

// ---------------------------------------------------------------------------
// 综合 helpers
// ---------------------------------------------------------------------------

export const DIMENSION_NAMES = ['citation_validity', 'methodology', 'reproducibility', 'novelty'] as const;
export type DimensionName = typeof DIMENSION_NAMES[number];

/** 把 4 个 dimension 的 score 装进 CritiqueScores,同时算 overall(等权平均)。 */
export function buildCritiqueScores(
  personaScores: Pick<CritiqueScores, 'methodologist' | 'engineer' | 'skeptic'>,
  dimensionScores: Pick<CritiqueScores, 'citation_validity' | 'methodology' | 'reproducibility' | 'novelty'>,
): CritiqueScores {
  const dims = [
    dimensionScores.citation_validity,
    dimensionScores.methodology,
    dimensionScores.reproducibility,
    dimensionScores.novelty,
  ];
  const overall = dims.reduce((a, b) => a + b, 0) / dims.length;
  return {
    methodologist: personaScores.methodologist,
    engineer: personaScores.engineer,
    skeptic: personaScores.skeptic,
    citation_validity: dimensionScores.citation_validity,
    methodology: dimensionScores.methodology,
    reproducibility: dimensionScores.reproducibility,
    novelty: dimensionScores.novelty,
    overall,
  };
}

/** F.2.5 fixture:用纯函数跑出一个 proposal 的 4 维度 score。 */
export function scoreAllDimensions(
  proposal: Pick<Proposal, 'rationale' | 'risk' | 'evidence' | 'target'>,
  knownPaperIds: ReadonlySet<string> = new Set(),
): {
  citation: ReturnType<typeof scoreCitationValidity>;
  methodology: ReturnType<typeof scoreMethodology>;
  reproducibility: ReturnType<typeof scoreReproducibility>;
  novelty: ReturnType<typeof scoreNovelty>;
} {
  return {
    citation: scoreCitationValidity(proposal, knownPaperIds),
    methodology: scoreMethodology(proposal),
    reproducibility: scoreReproducibility(proposal),
    novelty: scoreNovelty(proposal),
  };
}
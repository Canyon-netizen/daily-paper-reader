/**
 * agents/evaluator.mjs — Evaluator (iter #69) JS mirror.
 *
 * 背景:
 *   DPR 4 agent 闭环(Designer → Feedback → Gate → Modifier)每跑一轮产出 1
 *   个 round_record,但**没有从"已完成 session"反推"这一轮的研究质量怎么样"**
 *   的视角。Evaluator 第 4 智能体负责这事:读 archive/<sid>/rounds/*.json +
 *   deliverables + syntheses,产出 EvaluationReport:
 *     - 1 个 overall 分(0-1)
 *     - 4 个子分:coverage / alignment / consistency / synthesisCoverage
 *     - 明细(每个子分怎么算的)
 *
 * 用法(CLI):
 *   node astro-src/scripts/agents-run.mjs --session <sid> --evaluate
 *
 * 与 Sakana AI Scientist / STORM 对比:
 *   Sakana v2 内置 reviewer 自动打分,但只能 inline,不能 re-evaluate 旧 session
 *   STORM 没专门的 evaluator,只看 cite coverage
 *   DPR Evaluator 是 **post-hoc**,跑过的 session 都能 re-evaluate(看 evolution)
 *
 * 单一真相源:evaluator.ts(浏览器侧,带类型)— 行为必须一致
 * 镜像文件:evaluator.mjs(Node CLI 直接 import,纯 ESM,0 类型)
 *
 * 改任一文件务必同步另一份,由 scripts/agents-mirror.test.mjs 守护。
 */

// ---------------------------------------------------------------------------
// 工具:从 round / deliverable 提取信号
// ---------------------------------------------------------------------------

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const safeArr = (x) => (Array.isArray(x) ? x : []);
const safeObj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

/**
 * 内部:收集 session 内出现过的所有 arxivId(从 rounds + deliverables)
 */
function collectArxivIds(rounds, deliverables) {
  const set = new Set();
  for (const r of safeArr(rounds)) {
    for (const id of safeArr(r?.proposal?.evidence?.paperIds)) set.add(String(id));
    for (const a of safeArr(r?.actions)) {
      for (const id of safeArr(a?.target?.arxivIds)) set.add(String(id));
      for (const id of safeArr(a?.paperIds)) set.add(String(id));
    }
  }
  for (const d of safeArr(deliverables)) {
    for (const id of safeArr(d?.arxivIds)) set.add(String(id));
  }
  return [...set];
}

/**
 * 内部:收集 session 内出现过的所有 proposal type
 */
function collectProposalTypes(rounds) {
  const set = new Set();
  for (const r of safeArr(rounds)) {
    const t = r?.proposal?.type;
    if (t) set.add(t);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// 4 子分计算
// ---------------------------------------------------------------------------

/**
 * coverage — session 内 evidence paper 数量 / type 多样性
 *   公式:0.6 * min(1, distinct_arxiv / 8) + 0.4 * min(1, distinct_type / 4)
 *   直觉:8 篇不同 arxiv + 4 种 type 就算"覆盖广"
 */
function computeCoverage(rounds, deliverables) {
  const arxivIds = collectArxivIds(rounds, deliverables);
  const types = collectProposalTypes(rounds);
  const arxivScore = clamp01(arxivIds.length / 8);
  const typeScore = clamp01(types.length / 4);
  const score = clamp01(0.6 * arxivScore + 0.4 * typeScore);
  return {
    score,
    details: {
      distinct_arxiv: arxivIds.length,
      distinct_proposal_types: types.length,
      arxiv_ids: arxivIds,
      proposal_types: types,
      arxiv_component: arxivScore,
      type_component: typeScore,
    },
  };
}

/**
 * alignment — session goal(若有)跟实际产出类型的一致性
 *   公式:对齐 type 数 / 实际产出 type 数
 *   无 goal 时退化为 proposal 都有 rationale + risk 字段的覆盖率
 */
function computeAlignment(meta, rounds, deliverables) {
  const goal = safeObj(meta?.goal);
  const goalTypes = safeArr(goal.proposal_types);
  const actualTypes = new Set(collectProposalTypes(rounds));
  if (goalTypes.length > 0) {
    const overlap = goalTypes.filter((t) => actualTypes.has(t)).length;
    const score = clamp01(overlap / goalTypes.length);
    return {
      score,
      details: {
        mode: 'goal_alignment',
        goal_types: goalTypes,
        actual_types: [...actualTypes],
        overlap,
      },
    };
  }
  // fallback:每个 round 的 proposal 都有 rationale + risk 字段
  if (rounds.length === 0) {
    return { score: 0, details: { mode: 'rationale_coverage', rounds_total: 0, rounds_with_rationale: 0 } };
  }
  const withRationale = rounds.filter(
    (r) => r?.proposal?.rationale && r?.proposal?.risk,
  ).length;
  const score = clamp01(withRationale / rounds.length);
  return {
    score,
    details: {
      mode: 'rationale_coverage',
      rounds_total: rounds.length,
      rounds_with_rationale: withRationale,
    },
  };
}

/**
 * consistency — gate decision 在 rounds 间的稳定性
 *   公式:1 - 决策切换次数 / (rounds 数 - 1)
 *   直觉:一直 promote 比忽 promote 忽 reject 好
 *   0 rounds → 0.5(中性,不能算"差")
 */
function computeConsistency(rounds) {
  if (rounds.length < 2) {
    return {
      score: rounds.length === 1 ? 0.5 : 0,
      details: { rounds_total: rounds.length, transitions: 0, note: rounds.length < 2 ? 'too_few_rounds' : 'ok' },
    };
  }
  const decisions = rounds.map((r) => r?.gate?.decision).filter(Boolean);
  let transitions = 0;
  for (let i = 1; i < decisions.length; i++) {
    if (decisions[i] !== decisions[i - 1]) transitions++;
  }
  const denominator = Math.max(1, decisions.length - 1);
  const score = clamp01(1 - transitions / denominator);
  return {
    score,
    details: {
      rounds_total: rounds.length,
      decisions,
      transitions,
      max_possible_transitions: denominator,
    },
  };
}

/**
 * synthesisCoverage — 有 deliverable + 有 synthesis 的比例
 *   公式:min(1, deliverable 数 / 5) * 0.5 + (syntheses > 0 ? 0.5 : 0)
 *   直觉:至少 5 个 deliverable 且至少 1 个 synthesis 算"产出了可发布的内容"
 */
function computeSynthesisCoverage(deliverables, syntheses) {
  const dCount = safeArr(deliverables).length;
  const sCount = safeArr(syntheses).length;
  const dScore = clamp01(dCount / 5);
  const sScore = sCount > 0 ? 1 : 0;
  const score = clamp01(0.5 * dScore + 0.5 * sScore);
  return {
    score,
    details: {
      deliverable_count: dCount,
      synthesis_count: sCount,
      deliverable_component: dScore,
      synthesis_component: sScore,
    },
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * buildEvaluationReport(input) → EvaluationReport
 *   input: { meta, rounds, deliverables, syntheses, generatedAt }
 *   meta 可选;rounds / deliverables / syntheses 都是数组
 */
export function buildEvaluationReport(input = {}) {
  const meta = safeObj(input.meta);
  const rounds = safeArr(input.rounds);
  const deliverables = safeArr(input.deliverables);
  const syntheses = safeArr(input.syntheses);
  const generatedAt = input.generatedAt || new Date().toISOString();

  const cov = computeCoverage(rounds, deliverables);
  const ali = computeAlignment(meta, rounds, deliverables);
  const con = computeConsistency(rounds);
  const syn = computeSynthesisCoverage(deliverables, syntheses);

  // overall = 4 子分加权和(等权起步,后面想做加权可改这里)
  const overall = clamp01(0.25 * cov.score + 0.25 * ali.score + 0.25 * con.score + 0.25 * syn.score);

  const report = {
    generatedAt,
    goal: typeof meta.goal === 'string' ? meta.goal : (meta.goal?.summary || null),
    scores: {
      coverage: cov.score,
      alignment: ali.score,
      consistency: con.score,
      synthesisCoverage: syn.score,
      overall,
    },
    details: {
      coverage: cov.details,
      alignment: ali.details,
      consistency: con.details,
      synthesisCoverage: syn.details,
    },
    counts: {
      rounds: rounds.length,
      deliverables: deliverables.length,
      syntheses: syntheses.length,
      arxivIds: collectArxivIds(rounds, deliverables).length,
      proposalTypes: collectProposalTypes(rounds).length,
    },
    version: 1,
  };
  return report;
}

/**
 * formatEvaluationReportText(report) → string
 *   人类可读文本(给 CLI 终端 / md 报告用)
 */
export function formatEvaluationReportText(report) {
  if (!report || !report.scores) return '(empty report)';
  const s = report.scores;
  const c = report.counts || {};
  const lines = [];
  lines.push(`Overall: ${(s.overall * 100).toFixed(1)}%`);
  lines.push('');
  lines.push(`Sub-scores:`);
  lines.push(`  - coverage:           ${(s.coverage * 100).toFixed(1)}%  (arxiv ${c.arxivIds ?? 0} / types ${c.proposalTypes ?? 0})`);
  lines.push(`  - alignment:          ${(s.alignment * 100).toFixed(1)}%`);
  lines.push(`  - consistency:        ${(s.consistency * 100).toFixed(1)}%  (rounds ${c.rounds ?? 0})`);
  lines.push(`  - synthesisCoverage:  ${(s.synthesisCoverage * 100).toFixed(1)}%  (deliverables ${c.deliverables ?? 0} / syntheses ${c.syntheses ?? 0})`);
  if (report.goal) {
    lines.push('');
    lines.push(`Goal: ${report.goal}`);
  }
  return lines.join('\n');
}

/**
 * toJSON(report) → string(JSON 序列化,稳定字段顺序,方便 diff)
 */
export function toJSON(report) {
  return JSON.stringify(report, null, 2);
}
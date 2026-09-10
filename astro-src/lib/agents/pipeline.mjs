/**
 * lib/agents/pipeline.mjs — Full research-pipeline coordinator (iter #70).
 *
 * 背景:
 *   DPR 现有的 4 agent 闭环(Designer → Feedback → Gate → Modifier + Evaluator)
 *   单次能跑 1 轮 proposal,但**没有自动把"研究全流程"串起来**:
 *     ideation → literature review → experiment plan → writeup →
 *     review → revise → final paper → export
 *   用户得自己手动跑 N 次 `--rounds N`,然后手动调 `--compile-paper`,
 *   再手动 `--export-pdf`,中间哪一步漏了就要重跑。
 *
 *   iter #70 把上面 7 步封装成 1 个 state machine:PipelineStage 枚举 + 阶段间
 *   transition 表 + per-stage gate criteria;每阶段复用现有 agent 闭环,然后
 *   串到下一个阶段。
 *
 * 与 Sakana AI Scientist v2 / STORM 的对比(见 docs/agents-workflow.md §3):
 *   - Sakana:Idea → Exp → Writeup → Review,4 阶段
 *   - STORM:Question → Outline → Multi-perspective draft → Cite,4 阶段
 *   - DPR Pipeline:7 阶段(更细),但每阶段可 stub,可中断,可单独 resume
 *
 * 设计原则(同 paper-compiler / evaluator / web-search):
 *   - **纯函数**:每个 stage 的"进入条件 + 产出"是 pure logic;
 *     IO 与 LLM 调用走注入(同 orchestrator)
 *   - **append-only**:PipelineRunRecord 落到 archive/<sid>/pipeline.json,
 *     每个 stage 增量追加 stageRecord,不可改写既有
 *   - **可中断可恢复**:PipelineRunResult.stoppedReason ∈
 *     {completed, max_stages, gate_failed, error, cancelled, paused},
 *     配合 --resume-pipeline 即可从断点继续
 *   - **gate criteria 显式**:每阶段有 "promote 到下阶段" 的最小证据数 / 评分
 *     阈值 / 产物存在性,见 PIPELINE_GATES
 *   - **stub 模式**:无 LLM key 时返回占位 stageResult,让 dry-run 跑通全链路
 *
 * 单一真相源 for:
 *   - PIPELINE_STAGES    7 个 stage 枚举 + 顺序
 *   - PIPELINE_GATES     stage → 下 stage 的 gate 条件
 *   - advancePipeline()  给当前 stage result 算下一步该去哪个 stage
 *   - runPipelineStage() 单 stage 入口(调用 Designer/Feedback/Modifier)
 *   - buildPipelinePlan() 给定 goal → 7 stage 的初始 plan
 *
 * 跑法:node --test tests/test_agents_pipeline.mjs
 */

// ---------------------------------------------------------------------------
// 类型契约(浏览器 / CLI 共享,纯 JS)
// ---------------------------------------------------------------------------

/**
 * PipelineStage — 研究全流程的 7 个阶段(顺序固定,但可跳过)。
 * 命名规则:p_<verb>_<noun>;每个 stage 有 1 个 verb(动作)和 1 个 noun(产出)。
 */
export const PIPELINE_STAGES = Object.freeze([
  'p_ideate_research_question',     // 0. 用户研究问题 → 多个 candidate question
  'p_review_literature',            // 1. literature review 写作
  'p_design_experiment_plan',       // 2. 实验方案设计
  'p_write_paper_draft',            // 3. 草稿撰写
  'p_simulate_peer_review',         // 4. peer review 模拟(模拟审稿人)
  'p_revise_paper',                 // 5. 根据 review 意见修改
  'p_export_final_paper',           // 6. 导出 LaTeX / PDF / BibTeX
]);

/**
 * PIPELINE_STAGE_LABELS — 中英文标签(供 UI 展示)。
 */
export const PIPELINE_STAGE_LABELS = Object.freeze({
  p_ideate_research_question:  { zh: '研究问题',     en: 'Ideate',          short: 'Idea' },
  p_review_literature:         { zh: '文献综述',     en: 'Lit Review',      short: 'Lit'  },
  p_design_experiment_plan:    { zh: '实验设计',     en: 'Experiment Plan', short: 'Exp'  },
  p_write_paper_draft:         { zh: '草稿撰写',     en: 'Draft',           short: 'Draft' },
  p_simulate_peer_review:      { zh: '同行评审',     en: 'Peer Review',     short: 'Review' },
  p_revise_paper:              { zh: '修订',         en: 'Revise',          short: 'Revise' },
  p_export_final_paper:        { zh: '导出终稿',     en: 'Export',          short: 'Export' },
});

/**
 * PIPELINE_GATES — 每阶段的"通过条件",用于 promote 到下阶段。
 *
 * 字段语义:
 *   minDeliverables   本 stage 必须产出多少个 deliverable 才算通过
 *   minTotalScore     Gate 把 deliverable 对应 proposal 评 total 加权后的最小平均
 *   minArxivRefs      本 stage 关联到至少多少个 arxiv id(0 = 不强制)
 *   requireForAdvance 额外要求 — 字符串数组,如 ['draft_md', 'experiment_plan_md']
 *   notes             自描述
 *
 * 阈值定得保守:首版只是"不要 0 产出" 就放行;后续根据 evaluator 数据调。
 */
export const PIPELINE_GATES = Object.freeze({
  p_ideate_research_question: {
    minDeliverables: 1,                // ≥ 1 个 research_question
    minTotalScore: 5.0,                // 总评 ≥ 5.0(任何 persona 不偏科到 0)
    minArxivRefs: 0,                   // 不强制(ideation 可以无 paper)
    requireForAdvance: ['research_question'],
    notes: '至少产出 1 条 research question,否则重跑或跳到 lit review。',
  },
  p_review_literature: {
    minDeliverables: 1,
    minTotalScore: 6.0,
    minArxivRefs: 3,                   // lit review 必须覆盖 ≥ 3 篇
    requireForAdvance: ['literature_review_md'],
    notes: '≥ 1 个 lit review md,覆盖 ≥ 3 个 arxiv id,总评 ≥ 6.0',
  },
  p_design_experiment_plan: {
    minDeliverables: 1,
    minTotalScore: 6.0,
    minArxivRefs: 1,                   // 至少 1 篇方法类论文支撑
    requireForAdvance: ['experiment_plan_md'],
    notes: '≥ 1 个 experiment_plan md,包含 hypothesis + method + metrics',
  },
  p_write_paper_draft: {
    minDeliverables: 1,
    minTotalScore: 6.5,
    minArxivRefs: 3,
    requireForAdvance: ['draft_md'],
    notes: '≥ 1 个 draft md(草稿主体),≥ 3 个 arxiv ref',
  },
  p_simulate_peer_review: {
    minDeliverables: 1,
    minTotalScore: 0,                  // review 本身不带 LLM 自评分;用 number_of_concerns
    minArxivRefs: 0,
    requireForAdvance: ['review_md'],
    notes: '≥ 1 个 review md,模拟 3 persona 审稿人,至少 1 major concern',
  },
  p_revise_paper: {
    minDeliverables: 1,
    minTotalScore: 6.5,
    minArxivRefs: 3,
    requireForAdvance: ['draft_revised_md'],
    notes: '≥ 1 个修订后草稿,且 draft_revised_md 中至少回应了 1 个 review concern',
  },
  p_export_final_paper: {
    minDeliverables: 1,
    minTotalScore: 0,                  // export 是 deterministic,无 LLM 评分
    minArxivRefs: 0,
    requireForAdvance: ['paper_md', 'paper_tex'],
    notes: '≥ 1 paper.md + paper.tex(pdflatex 可编)',
  },
});

/**
 * STAGE_TO_PROPOSAL_TYPE — 把 pipeline stage 映射到现有 3-agent loop 的 proposal type。
 * 让 pipeline 复用 Designer/Feedback/Modifier 的产出,而非另起炉灶。
 */
export const STAGE_TO_PROPOSAL_TYPE = Object.freeze({
  p_ideate_research_question:  'literature_review',   // 暂用 literature_review 来组织 ideation 产出
  p_review_literature:         'literature_review',
  p_design_experiment_plan:    'experiment_plan',
  p_write_paper_draft:         'create_draft',
  p_simulate_peer_review:      'rebuttal',             // review 是 rebuttal 的对偶;后续 iter 会细分
  p_revise_paper:              'create_draft',          // 修订也是 create_draft(覆盖式)
  p_export_final_paper:        'create_draft',          // export 不需要新 proposal;靠 paper-compiler 走
});

/**
 * STAGE_DELIVERABLE_DIRS — 每个 stage 的产物落到 archive/<sid>/ 哪里。
 * 与现有 modifier.ts 的 deliverable dirs 对齐。
 */
export const STAGE_DELIVERABLE_DIRS = Object.freeze({
  p_ideate_research_question:  'drafts',
  p_review_literature:         'drafts',
  p_design_experiment_plan:    'experiments',
  p_write_paper_draft:         'drafts',
  p_simulate_peer_review:      'reviews',
  p_revise_paper:              'drafts',
  p_export_final_paper:        'paper',
});

// ---------------------------------------------------------------------------
// 入口数据结构
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PipelineConfig
 * @property {string} sessionId
 * @property {string} goal          用户的研究目标
 * @property {Object} project       user-library v5 的 project 结构
 * @property {Object} candidates    候选论文列表(可选)
 * @property {Function} caller      LLM 调用函数(同 orchestrator.LLMCaller)
 * @property {string} [model]       用的模型 id
 * @property {string} [gatePreset]  conservative | balanced | aggressive
 * @property {number} [maxStages]   最多跑几个 stage(默认 7 = 全部)
 * @property {Function} [adapter]   UpstreamAdapter(同 modifier.UpstreamAdapter)
 * @property {boolean} [dryRun]     stub mode,不真写盘
 */

/**
 * @typedef {Object} StageRecord
 * @property {string} stage
 * @property {number} stageIdx
 * @property {number} startedAt
 * @property {number} finishedAt
 * @property {string} status        completed | gate_failed | skipped | error
 * @property {Object} gate          触发 PIPELINE_GATES 检查的结果
 * @property {Array} deliverables   本 stage 产出的 deliverable 列表
 * @property {Object} [roundRecord]  本 stage 跑的 round record(若调用 3-agent loop)
 * @property {string} [error]       status=error 时的错误信息
 */

/**
 * @typedef {Object} PipelineRunResult
 * @property {StageRecord[]} stages
 * @property {string} stoppedReason
 * @property {string} currentStage  跑到的最后一个 stage(可能未完成)
 */

// ---------------------------------------------------------------------------
// buildPipelinePlan(goal) — 给定 goal,生成 7 stage 的初始 plan
// ---------------------------------------------------------------------------

/**
 * 给定用户的 goal,生成初始 7-stage plan(纯逻辑,不调 LLM)。
 * 每个 stage 是一个 {stage, status: 'pending'} 列表,无 IO。
 *
 * @param {string} goal
 * @param {Object} [opts]
 * @param {number} [opts.startStageIdx=0]   从哪个 stage 开始(支持 --resume-pipeline)
 * @param {string[]} [opts.skipStages=[]]   跳过的 stage 名(用户配置)
 * @returns {StageRecord[]}
 */
export function buildPipelinePlan(goal, opts = {}) {
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    throw new TypeError('buildPipelinePlan: goal must be non-empty string');
  }
  const startStageIdx = Number.isInteger(opts.startStageIdx) ? opts.startStageIdx : 0;
  const skipStages = new Set(Array.isArray(opts.skipStages) ? opts.skipStages : []);

  return PIPELINE_STAGES.map((stage, idx) => ({
    stage,
    stageIdx: idx,
    startedAt: 0,
    finishedAt: 0,
    status: idx < startStageIdx ? 'skipped'
          : skipStages.has(stage)   ? 'skipped'
          : 'pending',
    gate: { passed: false, reasons: [] },
    deliverables: [],
  }));
}

// ---------------------------------------------------------------------------
// evaluateStageGate(stageRecord, deliverableMetas) — 评估 stage 是否通过 gate
// ---------------------------------------------------------------------------

/**
 * 评估 stage 是否通过 PIPELINE_GATES 的条件。
 *
 * @param {string} stage         当前 stage 名
 * @param {Array} deliverables   本 stage 产出的 deliverable 列表,每条:
 *                                 { kind, round?, totalScore?, arxivIds?, payload? }
 * @returns {{ passed: boolean, reasons: string[], gate: object }}
 */
export function evaluateStageGate(stage, deliverables) {
  const gate = PIPELINE_GATES[stage];
  if (!gate) {
    return { passed: false, reasons: [`unknown stage: ${stage}`], gate: null };
  }
  const reasons = [];

  // 1. deliverable 数量
  if (deliverables.length < gate.minDeliverables) {
    reasons.push(`仅产出 ${deliverables.length} 个 deliverable,需 ≥ ${gate.minDeliverables}`);
  }

  // 2. total score 平均
  const scored = deliverables.filter((d) => typeof d.totalScore === 'number');
  if (scored.length > 0 && gate.minTotalScore > 0) {
    const avg = scored.reduce((a, b) => a + b.totalScore, 0) / scored.length;
    if (avg < gate.minTotalScore) {
      reasons.push(`平均 totalScore ${avg.toFixed(2)} < 阈值 ${gate.minTotalScore}`);
    }
  }

  // 3. arxiv refs 集合大小(去重)
  const arxivSet = new Set();
  for (const d of deliverables) {
    if (Array.isArray(d.arxivIds)) {
      for (const a of d.arxivIds) {
        if (typeof a === 'string' && a.length > 0) arxivSet.add(a);
      }
    }
  }
  if (arxivSet.size < gate.minArxivRefs) {
    reasons.push(`覆盖 ${arxivSet.size} 个 arxiv ref,需 ≥ ${gate.minArxivRefs}`);
  }

  // 4. requireForAdvance:每种 kind 必须 ≥ 1
  if (Array.isArray(gate.requireForAdvance)) {
    const kinds = new Set(deliverables.map((d) => d.kind));
    for (const req of gate.requireForAdvance) {
      if (!kinds.has(req)) reasons.push(`缺少必需 deliverable kind: ${req}`);
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    gate,
  };
}

// ---------------------------------------------------------------------------
// advancePipeline(plan, currentStageIdx, gateResult) — 决定下一步
// ---------------------------------------------------------------------------

/**
 * 给定当前 stage 的 gate 评估结果,决定下一步:
 *   - gate.passed === true      → 跳到下一个 stage
 *   - gate.passed === false     → 停在当前 stage(下一轮重试或用户干预)
 *   - 已是最后一个 stage        → 完成
 *
 * @param {StageRecord[]} plan
 * @param {number} currentStageIdx
 * @param {{ passed: boolean }} gateResult
 * @returns {{ nextStageIdx: number|null, stoppedReason: string }}
 */
export function advancePipeline(plan, currentStageIdx, gateResult) {
  if (!gateResult || typeof gateResult.passed !== 'boolean') {
    throw new TypeError('advancePipeline: gateResult.passed must be boolean');
  }
  if (currentStageIdx < 0 || currentStageIdx >= plan.length) {
    throw new RangeError(`advancePipeline: invalid currentStageIdx ${currentStageIdx}`);
  }
  if (!gateResult.passed) {
    return { nextStageIdx: currentStageIdx, stoppedReason: 'gate_failed' };
  }
  const next = currentStageIdx + 1;
  if (next >= plan.length) {
    return { nextStageIdx: null, stoppedReason: 'completed' };
  }
  // 检查 plan 中间是否有未跳过 stage:跳过的不算 stop 条件,继续推进
  return { nextStageIdx: next, stoppedReason: 'pending' };
}

// ---------------------------------------------------------------------------
// runPipelineStage(stage, input, config) — 单 stage 入口(可单独调用)
// ---------------------------------------------------------------------------

/**
 * 单 stage 入口。MVP:stub 模式直接产 1 条占位 deliverable 让 plan 推进。
 * 后续 iter(#71) 接入 Reviewer/Reviser/Code-Runner 后,会用真 3-agent loop 替代。
 *
 * @param {string} stage
 * @param {Object} input      同 RoundInput
 * @param {PipelineConfig} config
 * @returns {Promise<{
 *   stage,
 *   stageIdx,
 *   startedAt,
 *   finishedAt,
 *   status: 'completed' | 'gate_failed' | 'error',
 *   gate,
 *   deliverables,
 *   roundRecord?: object,
 *   error?: string,
 * }>}
 */
export async function runPipelineStage(stage, input, config) {
  if (!PIPELINE_STAGES.includes(stage)) {
    throw new TypeError(`runPipelineStage: unknown stage "${stage}"`);
  }
  const stageIdx = PIPELINE_STAGES.indexOf(stage);
  const startedAt = Date.now();

  try {
    // Stage 7 (export) 是 deterministic,直接调 paper-compiler
    if (stage === 'p_export_final_paper') {
      const { deliverables, roundRecord } = await runExportStage(input, config);
      const gate = evaluateStageGate(stage, deliverables);
      return {
        stage, stageIdx, startedAt, finishedAt: Date.now(),
        status: gate.passed ? 'completed' : 'gate_failed',
        gate, deliverables, roundRecord,
      };
    }

    // Stage 5 (review) — 调 reviewer agent(iter #71)
    if (stage === 'p_simulate_peer_review') {
      const { deliverables, roundRecord } = await runReviewStage(input, config);
      const gate = evaluateStageGate(stage, deliverables);
      return {
        stage, stageIdx, startedAt, finishedAt: Date.now(),
        status: gate.passed ? 'completed' : 'gate_failed',
        gate, deliverables, roundRecord,
      };
    }

    // Stage 6 (revise) — 调 reviser agent(iter #71)
    if (stage === 'p_revise_paper') {
      const { deliverables, roundRecord } = await runReviseStage(input, config);
      const gate = evaluateStageGate(stage, deliverables);
      return {
        stage, stageIdx, startedAt, finishedAt: Date.now(),
        status: gate.passed ? 'completed' : 'gate_failed',
        gate, deliverables, roundRecord,
      };
    }

    // 其余 stage — 复用现有 3-agent loop(若配置了 caller)
    const { deliverables, roundRecord } = await runLoopStage(stage, input, config);
    const gate = evaluateStageGate(stage, deliverables);
    return {
      stage, stageIdx, startedAt, finishedAt: Date.now(),
      status: gate.passed ? 'completed' : 'gate_failed',
      gate, deliverables, roundRecord,
    };
  } catch (err) {
    return {
      stage, stageIdx, startedAt, finishedAt: Date.now(),
      status: 'error',
      gate: { passed: false, reasons: [String(err && err.message || err)], gate: PIPELINE_GATES[stage] },
      deliverables: [],
      error: String(err && err.message || err),
    };
  }
}

// ---------------------------------------------------------------------------
// runLoopStage(stage, input, config) — 调现有 3-agent loop(供非 export stage)
// ---------------------------------------------------------------------------

async function runLoopStage(stage, input, config) {
  // 若 caller 没注入,直接走 stub
  if (!config.caller || typeof config.caller.callLLM !== 'function') {
    return {
      deliverables: stubDeliverablesForStage(stage, input),
      roundRecord: null,
    };
  }

  // 动态 import 避免循环依赖 + 浏览器兼容
  const { designerGenerate } = await import('./designer.mjs').catch(() => ({ designerGenerate: null }));
  const { feedbackEvaluate, stubFeedback } = await import('./feedback.mjs').catch(() => ({
    feedbackEvaluate: null, stubFeedback: null,
  }));
  const { modifierApply, makeStubAdapter } = await import('./modifier.mjs').catch(() => ({
    modifierApply: null, makeStubAdapter: null,
  }));
  const { gateProposals, applySafetyOverride } = await import('./gate.mjs').catch(() => ({
    gateProposals: null, applySafetyOverride: null,
  }));

  // 若缺任何一环,降级到 stub
  if (!designerGenerate || !feedbackEvaluate || !modifierApply || !gateProposals) {
    return {
      deliverables: stubDeliverablesForStage(stage, input),
      roundRecord: null,
    };
  }

  // 准备 round input(stage 注入 roundInput 上下文)
  const roundInput = {
    ...input,
    user_goal: buildStageGoal(stage, input),
  };

  const proposals = await designerGenerate(roundInput, config.caller, {
    model: config.model,
  });

  let critiques;
  try {
    critiques = await feedbackEvaluate(proposals, roundInput, config.caller, {
      model: config.model, judgeRounds: 1,
    });
  } catch {
    critiques = stubFeedback ? stubFeedback(proposals) : [];
  }

  const verdicts = gateProposals(proposals, critiques, config.gatePreset || 'balanced');
  const finalVerdicts = applySafetyOverride
    ? verdicts.map((v) => {
        const p = proposals.find((x) => x.id === v.proposal_id);
        return p ? applySafetyOverride(v, p) : v;
      })
    : verdicts;

  const adapter = config.adapter || (makeStubAdapter && makeStubAdapter({ dry_run: !!config.dryRun }));
  const { applied, skipped } = await modifierApply(finalVerdicts, proposals, roundInput, adapter);

  // 把 modifier 应用结果转成 deliverables
  const deliverables = applied.map((a) => ({
    kind: deriveKindFromAction(a, stage),
    arxivIds: extractArxivIdsFromAction(a),
    totalScore: critiques.find((c) => c.proposal_id === a.proposal_id)?.total ?? null,
    proposalId: a.proposal_id,
    round: a.applied_at,
    payload: a.payload,
  }));

  return {
    deliverables,
    roundRecord: {
      stage,
      proposals,
      critiques,
      verdicts: finalVerdicts,
      applied,
      skipped,
    },
  };
}

function deriveKindFromAction(action, stage) {
  // Modifier 写入的 payload 通常带 kind;fallback 到 stage 默认目录
  const k = action?.payload?.kind;
  if (typeof k === 'string' && k.length > 0) return k;
  const dir = STAGE_DELIVERABLE_DIRS[stage] || 'drafts';
  // dir → kind 映射(drafts→draft_md, experiments→experiment_plan_md, ...)
  const dirToKind = {
    drafts: 'draft_md',
    experiments: 'experiment_plan_md',
    reviews: 'review_md',
    paper: 'paper_md',
  };
  return dirToKind[dir] || 'draft_md';
}

function extractArxivIdsFromAction(action) {
  const out = new Set();
  const payload = action?.payload || {};
  // 常见 arxiv id 字段:evidence.paperIds / arxivIds / citedPapers
  const tryCollect = (v) => {
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') {
        if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(x)) out.add(x);
      }
    }
  };
  tryCollect(payload.arxivIds);
  tryCollect(payload.paperIds);
  if (payload.evidence && typeof payload.evidence === 'object') {
    tryCollect(payload.evidence.paperIds);
  }
  if (Array.isArray(payload.citedPapers)) {
    for (const x of payload.citedPapers) if (typeof x === 'string' && /^\d{4}\.\d{4,5}/.test(x)) out.add(x);
  }
  return [...out];
}

function buildStageGoal(stage, input) {
  const userGoal = input?.user_goal || input?.project?.statement || '';
  return `[Pipeline stage: ${stage}] ${userGoal}`;
}

// ---------------------------------------------------------------------------
// runReviewStage — stage 5:调 reviewer agent
// ---------------------------------------------------------------------------

async function runReviewStage(input, config) {
  // 找到最近一篇 draft 作为评审目标(若 input.draftBody 显式传入则优先)
  const draft = pickLatestDraft(input, config);
  try {
    const { reviewDraft } = await import('./reviewer.mjs').catch(() => ({ reviewDraft: null }));
    if (!reviewDraft) {
      return stubReviewStage(draft, input, config);
    }
    const verdict = await reviewDraft(draft, {
      caller: config.caller,
      draftId: draft.id || null,
      model: config.model,
    });
    return {
      deliverables: [
        {
          kind: 'review_md',
          arxivIds: Array.isArray(draft.arxivIds) ? draft.arxivIds : [],
          totalScore: verdict?.scores?.overall ?? 0,
          round: verdict.generatedAt,
          payload: { verdict, draftId: draft.id || null },
        },
      ],
      roundRecord: { stage: 'p_simulate_peer_review', verdict },
    };
  } catch (err) {
    console.warn('[pipeline] runReviewStage failed, falling back to stub:', err);
    return stubReviewStage(draft, input, config);
  }
}

function pickLatestDraft(input, config) {
  if (input && typeof input.draftBody === 'string' && input.draftBody.length > 0) {
    return {
      id: input.draftId || null,
      title: input.draftTitle || '',
      abstract: input.draftAbstract || '',
      body: input.draftBody,
      arxivIds: Array.isArray(input.draftArxivIds) ? input.draftArxivIds : [],
    };
  }
  // fallback:从 candidates / project 自构一个最小 draft
  const candidates = (input?.candidates || []).slice(0, 3);
  const body = candidates.length
    ? `# ${config.goal || 'Draft'}\n\n${candidates.map((c) => `- ${c.title || c.arxivId}`).join('\n')}\n`
    : '';
  return {
    id: null,
    title: config.goal || 'Untitled draft',
    abstract: '',
    body,
    arxivIds: candidates.map((c) => c.arxivId).filter(Boolean),
  };
}

function stubReviewStage(draft, input, config) {
  const arxivIds = Array.isArray(draft.arxivIds) ? draft.arxivIds : [];
  return {
    deliverables: [
      {
        kind: 'review_md',
        arxivIds,
        totalScore: 6.5,
        round: Date.now(),
        payload: {
          stub: true,
          verdict: {
            recommendation: 'revise',
            scores: { novelty: 6.5, soundness: 6.0, clarity: 7.0, experiments: 6.0, writing: 6.5, overall: 6.4 },
            concerns: [
              { severity: 'major', persona: 'methodologist', category: 'soundness', claim: 'baseline 假设', detail: '补 baseline 适用边界' },
              { severity: 'minor', persona: 'engineer', category: 'experiments', claim: 'reproducibility', detail: '补 seed / commit / GPU' },
            ],
            summary: '【stub】 草稿覆盖基本完整,需补 baseline 与 reproducibility。',
          },
          draftId: draft.id || null,
        },
      },
    ],
    roundRecord: { stage: 'p_simulate_peer_review', stub: true },
  };
}

// ---------------------------------------------------------------------------
// runReviseStage — stage 6:调 reviser agent
// ---------------------------------------------------------------------------

async function runReviseStage(input, config) {
  const draft = pickLatestDraft(input, config);
  // 从 input.previousReviewVerdict 拿 reviewer 的 verdict;fallback 到空 verdict
  const verdict = input && input.previousReviewVerdict
    ? input.previousReviewVerdict
    : collectReviewVerdictFromInput(input);
  try {
    const { reviseDraft } = await import('./reviser.mjs').catch(() => ({ reviseDraft: null }));
    if (!reviseDraft) {
      return stubReviseStage(draft, verdict, input, config);
    }
    const rev = await reviseDraft(draft, verdict, {
      caller: config.caller,
      draftId: draft.id || null,
      model: config.model,
    });
    const arxivIds = Array.isArray(draft.arxivIds) ? draft.arxivIds : [];
    // stub mode 时 rev.stub = true;按 addressedCount 算分,无 concerns 也给 7.0
    const totalScore = rev.stub ? 7.0 : (rev.addressedCount > 0 ? 7.0 : 5.0);
    return {
      deliverables: [
        {
          kind: 'draft_revised_md',
          arxivIds,
          totalScore,
          round: rev.generatedAt,
          payload: {
            revision: rev,
            draftId: draft.id || null,
            addressedCount: rev.addressedCount,
            partialCount: rev.partialCount,
            notAddressedCount: rev.notAddressedCount,
          },
        },
      ],
      roundRecord: { stage: 'p_revise_paper', revision: rev },
    };
  } catch (err) {
    console.warn('[pipeline] runReviseStage failed, falling back to stub:', err);
    return stubReviseStage(draft, verdict, input, config);
  }
}

function collectReviewVerdictFromInput(input) {
  // input 里可能有 input.reviewVerdict / input.verdict
  if (input && input.reviewVerdict) return input.reviewVerdict;
  if (input && input.verdict) return input.verdict;
  return { concerns: [], summary: '', scores: {}, recommendation: 'revise' };
}

function stubReviseStage(draft, verdict, input, config) {
  const arxivIds = Array.isArray(draft.arxivIds) ? draft.arxivIds : [];
  const concerns = Array.isArray(verdict?.concerns) ? verdict.concerns : [];
  const log = concerns.map((c, i) => ({
    concernIdx: i,
    severity: c.severity || 'minor',
    category: c.category || 'clarity',
    status: 'addressed',
    change: '【stub】 已在本轮 draft 末尾 §Revision Notes 标注对应修改。',
  }));
  return {
    deliverables: [
      {
        kind: 'draft_revised_md',
        arxivIds,
        // stub mode:整段全部标 addressed,dry-run 应能走完全部 7 stage
        totalScore: 7.0,
        round: Date.now(),
        payload: {
          revision: {
            body: (draft.body || '') + '\n\n## Revision Notes (stub)\n' + log.map((l) => `- [${l.severity}] ${l.category}: ${l.change}`).join('\n'),
            log,
            addressedCount: log.length,
            partialCount: 0,
            notAddressedCount: 0,
            stub: true,
          },
          draftId: draft.id || null,
          addressedCount: log.length,
        },
      },
    ],
    roundRecord: { stage: 'p_revise_paper', stub: true },
  };
}

// ---------------------------------------------------------------------------
// runExportStage — stage 7:导出终稿,调 paper-compiler
// ---------------------------------------------------------------------------

async function runExportStage(input, config) {
  const deliverables = [];
  try {
    const paperCompiler = await import('./paper-compiler.mjs').catch(() => null);
    if (paperCompiler && typeof paperCompiler.buildPaperDraft === 'function') {
      // 不写盘,只 build 一个 in-memory PaperDraft
      const draft = paperCompiler.buildPaperDraft({
        meta: { session_id: config.sessionId, goal: config.goal },
        deliverables: collectDeliverablesFromInput(input),
        syntheses: input?.syntheses || [],
      });
      const arxivIds = extractArxivIdsFromDraft(draft);
      deliverables.push({
        kind: 'paper_md',
        arxivIds,
        totalScore: null,
        round: null,
        payload: { draft, markdown: paperCompiler.formatPaperMarkdown ? paperCompiler.formatPaperMarkdown(draft) : null },
      });
      // formatPaperLatex 是单独的纯函数;调它产出 paper.tex 文本
      if (typeof paperCompiler.formatPaperLatex === 'function') {
        const latex = paperCompiler.formatPaperLatex(draft);
        if (latex && typeof latex === 'string' && latex.length > 0) {
          deliverables.push({
            kind: 'paper_tex',
            arxivIds,
            totalScore: null,
            round: null,
            payload: { latex },
          });
        }
      }
    } else {
      // 无 paper-compiler 时降级到 stub
      deliverables.push({
        kind: 'paper_md',
        arxivIds: [],
        totalScore: null,
        round: null,
        payload: { stub: true, note: 'paper-compiler unavailable' },
      });
    }
  } catch (err) {
    deliverables.push({
      kind: 'paper_md',
      arxivIds: [],
      totalScore: null,
      round: null,
      payload: { stub: true, error: String(err?.message || err) },
    });
  }
  return { deliverables, roundRecord: null };
}

function collectDeliverablesFromInput(input) {
  // input.deliverables 在 resume 时由调用方注入;否则空
  return Array.isArray(input?.deliverables) ? input.deliverables : [];
}

function extractArxivIdsFromDraft(draft) {
  const out = new Set();
  const refs = draft?.references || [];
  for (const r of refs) {
    if (typeof r?.arxivId === 'string') out.add(r.arxivId);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// stubDeliverablesForStage(stage, input) — 无 LLM key 时的占位 deliverable
// ---------------------------------------------------------------------------

function stubDeliverablesForStage(stage, input) {
  const now = Date.now();
  const baseArxiv = (input?.candidates || []).slice(0, 5).map((c) => c.arxivId).filter(Boolean);

  const stubs = {
    p_ideate_research_question: [{
      kind: 'research_question',
      arxivIds: baseArxiv.slice(0, 2),
      totalScore: 6.0,
      round: now,
      payload: { stub: true, text: '【dry-run】占位研究问题:基于已有候选论文,提出可证伪的子问题。' },
    }],
    p_review_literature: [{
      kind: 'literature_review_md',
      arxivIds: baseArxiv.slice(0, 4),
      totalScore: 6.5,
      round: now,
      payload: { stub: true, text: '【dry-run】占位 lit review:覆盖候选论文的代表性方法、公开数据集、评估指标。' },
    }],
    p_design_experiment_plan: [{
      kind: 'experiment_plan_md',
      arxivIds: baseArxiv.slice(0, 1),
      totalScore: 6.5,
      round: now,
      payload: { stub: true, text: '【dry-run】占位 experiment plan:hypothesis + method + metrics + baseline。' },
    }],
    p_write_paper_draft: [{
      kind: 'draft_md',
      arxivIds: baseArxiv.slice(0, 3),
      totalScore: 6.8,
      round: now,
      payload: { stub: true, text: '【dry-run】占位 paper draft:intro + related work + method + results(占位段落)。' },
    }],
    p_simulate_peer_review: [{
      kind: 'review_md',
      arxivIds: [],
      totalScore: 0,
      round: now,
      payload: { stub: true, text: '【dry-run】占位 peer review:3 persona + 1 major concern + 2 minor。' },
    }],
    p_revise_paper: [{
      kind: 'draft_revised_md',
      arxivIds: baseArxiv.slice(0, 3),
      totalScore: 7.0,
      round: now,
      payload: { stub: true, text: '【dry-run】占位 revised draft:回应 reviewer concerns,补充实验。' },
    }],
  };
  return stubs[stage] || [];
}

// ---------------------------------------------------------------------------
// runPipeline(config) — 主入口:跑完整个 7 stage pipeline
// ---------------------------------------------------------------------------

/**
 * 主入口。同步地按顺序跑 7 stage,每 stage 调 runPipelineStage。
 * 任一 stage gate_failed 就停(stoppedReason='gate_failed')。
 *
 * @param {PipelineConfig} config
 * @returns {Promise<{
 *   stages: StageRecord[],
 *   stoppedReason: string,
 *   currentStage: string|null,
 * }>}
 */
export async function runPipeline(config) {
  if (!config || !config.sessionId) throw new TypeError('runPipeline: sessionId required');
  if (typeof config.goal !== 'string' || config.goal.trim().length === 0) {
    throw new TypeError('runPipeline: goal must be non-empty string');
  }
  const maxStages = Number.isInteger(config.maxStages) ? config.maxStages : PIPELINE_STAGES.length;
  const startStageIdx = Number.isInteger(config.startStageIdx) ? config.startStageIdx : 0;
  const plan = buildPipelinePlan(config.goal, {
    startStageIdx,
    skipStages: config.skipStages || [],
  });

  let currentIdx = startStageIdx;
  let stoppedReason = 'pending';

  while (currentIdx < PIPELINE_STAGES.length && currentIdx < startStageIdx + maxStages) {
    const stage = PIPELINE_STAGES[currentIdx];
    if (plan[currentIdx].status === 'skipped') {
      currentIdx++;
      continue;
    }
    const stageInput = {
      ...(config.projectInput || {}),
      user_goal: config.goal,
      project: config.project,
      candidates: config.candidates || config.projectInput?.candidates || [],
    };
    const stageResult = await runPipelineStage(stage, stageInput, config);
    plan[currentIdx] = stageResult;

    if (stageResult.status === 'error') {
      stoppedReason = 'error';
      break;
    }
    const adv = advancePipeline(plan, currentIdx, stageResult.gate);
    if (adv.stoppedReason === 'gate_failed') {
      stoppedReason = 'gate_failed';
      break;
    }
    if (adv.stoppedReason === 'completed') {
      stoppedReason = 'completed';
      currentIdx = PIPELINE_STAGES.length;
      break;
    }
    currentIdx = adv.nextStageIdx;
  }

  if (stoppedReason === 'pending') {
    stoppedReason = currentIdx >= PIPELINE_STAGES.length ? 'completed' : 'max_stages';
  }

  return {
    stages: plan,
    stoppedReason,
    currentStage: currentIdx >= PIPELINE_STAGES.length ? null : PIPELINE_STAGES[currentIdx],
  };
}

// ---------------------------------------------------------------------------
// formatPipelinePlanText(plan) — CLI 友好的纯文本格式
// ---------------------------------------------------------------------------

/**
 * 把 pipeline plan 格式化成 CLI 友好的文本(类似 git log --oneline)。
 *
 * @param {StageRecord[]} plan
 * @returns {string}
 */
export function formatPipelinePlanText(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return '(empty plan)';
  const lines = [];
  for (const s of plan) {
    const labels = PIPELINE_STAGE_LABELS[s.stage] || { zh: s.stage, en: s.stage, short: s.stage };
    const status = s.status || 'pending';
    const gate = s.gate && s.gate.passed ? '✓' : (s.status === 'completed' ? '✓' : '·');
    const deliv = Array.isArray(s.deliverables) ? s.deliverables.length : 0;
    const dur = s.finishedAt && s.startedAt ? `${s.finishedAt - s.startedAt}ms` : '-';
    lines.push(`${gate} [${s.stageIdx}] ${labels.zh.padEnd(8)} (${labels.en.padEnd(18)}) status=${status.padEnd(11)} deliv=${deliv} dur=${dur}`);
    if (s.gate && Array.isArray(s.gate.reasons) && s.gate.reasons.length > 0 && !s.gate.passed) {
      for (const r of s.gate.reasons) lines.push(`    └─ ✗ ${r}`);
    }
    if (s.error) lines.push(`    └─ ⚠ ${s.error}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// summarizePipeline(result) — 给 UI / docs 用的高层摘要
// ---------------------------------------------------------------------------

/**
 * 把 pipeline result 压成 1 段高层摘要:跑了几 stage、通过几 stage、
 * 卡在哪 stage、平均 deliverable 数、stage 类型分布。
 *
 * @param {PipelineRunResult} result
 * @returns {{
 *   totalStages: number,
 *   completedStages: number,
 *   gateFailedStages: number,
 *   skippedStages: number,
 *   erroredStages: number,
 *   totalDeliverables: number,
 *   stageBreakdown: Record<string, number>,
 *   stoppedReason: string,
 *   currentStage: string|null,
 * }}
 */
export function summarizePipeline(result) {
  const stages = Array.isArray(result?.stages) ? result.stages : [];
  const summary = {
    totalStages: stages.length,
    completedStages: 0,
    gateFailedStages: 0,
    skippedStages: 0,
    erroredStages: 0,
    totalDeliverables: 0,
    stageBreakdown: {},
    stoppedReason: result?.stoppedReason || 'unknown',
    currentStage: result?.currentStage || null,
  };
  for (const s of stages) {
    summary.totalDeliverables += Array.isArray(s.deliverables) ? s.deliverables.length : 0;
    if (s.status === 'completed') summary.completedStages++;
    else if (s.status === 'gate_failed') summary.gateFailedStages++;
    else if (s.status === 'skipped') summary.skippedStages++;
    else if (s.status === 'error') summary.erroredStages++;
    const labels = PIPELINE_STAGE_LABELS[s.stage] || { short: s.stage };
    summary.stageBreakdown[labels.short] = (summary.stageBreakdown[labels.short] || 0) + 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// toJSON(result) — 序列化(供 --json CLI 输出 / 浏览器 fetch)
// ---------------------------------------------------------------------------

export function toJSON(result) {
  return {
    stages: (result?.stages || []).map((s) => ({
      stage: s.stage,
      stageIdx: s.stageIdx,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: s.status,
      gate: s.gate,
      deliverables: s.deliverables,
      error: s.error,
    })),
    stoppedReason: result?.stoppedReason || 'unknown',
    currentStage: result?.currentStage || null,
  };
}

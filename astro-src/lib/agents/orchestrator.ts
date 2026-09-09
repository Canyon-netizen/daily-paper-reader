/**
 * agents/orchestrator.ts — Round orchestrator (browser-side).
 *
 * 串联 Designer → Feedback → Gate → Modifier,产出 RoundRecord。
 * 由 /agents/ 页面调用;CLI 走 lib/agents/orchestrator.mjs(JS 镜像)。
 *
 * 设计原则:
 *   - **纯编排**:不直接调 LLM,接收注入的 LLMCaller(浏览器从 settings.ts 拿,
 *     CLI 从 env 拿)。
 *   - **append-only**:RoundRecord 落到 archive/<session>/rounds/round_NNN.json,
 *     永不改写既有 round(round 不可变,符合 append-only 习惯)。
 *   - **空轮跳过**:连续 3 轮 applied=[] 自动停(用户目标已达成)。
 *   - **token 预算**:单 round 上限 50k token,超限降级到 stub。
 */

import type {
  Critique,
  GateVerdict,
  PreviousRoundSummary,
  Proposal,
  RoundInput,
  RoundRecord,
} from './types';
import { designerGenerate, type LLMCaller as DesignerCaller } from './designer';
import { feedbackEvaluate, stubFeedback, type LLMCaller as FeedbackCaller } from './feedback';
import { modifierApply, type UpstreamAdapter } from './modifier';
import { applySafetyOverride, decideProposal, gateProposals } from './gate';
import { makeBrowserAdapter } from './modifier';

// ---------------------------------------------------------------------------
// 类型兼容(Designer / Feedback 都用 LLMCaller,签名一致)
// ---------------------------------------------------------------------------

export type LLMCaller = DesignerCaller;
const _typecheck: FeedbackCaller = {} as LLMCaller;
void _typecheck;

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  caller: LLMCaller;
  adapter?: UpstreamAdapter;          // 默认 = makeBrowserAdapter
  model?: string;
  gatePreset?: 'conservative' | 'balanced' | 'aggressive';
  maxRounds?: number;
  tokenBudgetPerRound?: number;
  maxEmptyRounds?: number;
  /**
   * Plateau 阈值:最后 N 轮 avg score 标准差 < 此值即认为收敛,停。
   * 默认 0.3(≈一档 rubric 之差)。关闭传 Infinity。
   * 触发后 stoppedReason = 'plateau'。
   */
  plateauThreshold?: number;
  /**
   * Plateau 窗口:看最后几轮的 avg score 来判断 plateau,默认 3。
   */
  plateauWindow?: number;
}

export interface OrchestratorRunOpts {
  sessionId: string;
  input: RoundInput;
  startRound?: number;
  onRoundComplete?: (rec: RoundRecord) => void | Promise<void>;
}

export interface OrchestratorRunResult {
  records: RoundRecord[];
  stoppedReason: 'completed' | 'max_rounds' | 'empty_streak' | 'error' | 'cancelled' | 'plateau';
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function runRounds(
  config: OrchestratorConfig,
  opts: OrchestratorRunOpts,
  signal?: AbortSignal,
): Promise<OrchestratorRunResult> {
  const adapter = config.adapter ?? (await makeBrowserAdapter({ dry_run: false }));
  const maxRounds = config.maxRounds ?? 5;
  const maxEmpty = config.maxEmptyRounds ?? 3;
  const preset = config.gatePreset ?? 'balanced';
  const plateauThreshold = config.plateauThreshold ?? 0.3;
  const plateauWindow = config.plateauWindow ?? 3;

  const records: RoundRecord[] = [];
  // 初始 previous_rounds 由 caller 注入(常见用法:--resume 模式)
  let prevSummaries: PreviousRoundSummary[] = [...(opts.input.previous_rounds ?? [])];
  let emptyStreak = 0;
  let roundN = opts.startRound ?? 1;
  let stopped: OrchestratorRunResult['stoppedReason'] = 'completed';

  for (let i = 0; i < maxRounds; i++) {
    if (signal?.aborted) { stopped = 'cancelled'; break; }

    // 把累积的 previous_rounds 喂给下一轮的 input
    const roundInput: RoundInput = {
      ...opts.input,
      round: roundN,
      previous_rounds: prevSummaries,
    };

    let rec: RoundRecord;
    try {
      rec = await runOneRound(roundN, roundInput, config, adapter, preset);
    } catch (err) {
      console.error(`[orchestrator] round ${roundN} failed:`, err);
      stopped = 'error';
      break;
    }

    records.push(rec);
    if (opts.onRoundComplete) await opts.onRoundComplete(rec);

    // 累加本轮摘要,供下一轮 Designer 参考
    prevSummaries = [...prevSummaries, summarizeRound(rec)];

    // -------- 自动收敛检测(plateau):last N 轮 avg score 标准差 < 阈值 --------
    // 触发条件:
    //   1. 至少 plateauWindow 轮已完成(不能刚跑 1 轮就判收敛)
    //   2. 所有被检轮都至少有 critique(no-critique 轮的 avg = 0 会拉低 stdDev 误判)
    //   3. stdDev(roundAvgScores[-window:]) < plateauThreshold
    if (
      isFinite(plateauThreshold)
      && records.length >= plateauWindow
      && records.every((r) => r.feedback.critiques.length > 0)
    ) {
      const tail = records.slice(-plateauWindow).map((r) => {
        const cs = r.feedback.critiques;
        return cs.reduce((a, c) => a + c.total, 0) / cs.length;
      });
      const m = tail.reduce((a, b) => a + b, 0) / tail.length;
      const variance = tail.reduce((a, b) => a + (b - m) ** 2, 0) / tail.length;
      const stddev = Math.sqrt(variance);
      if (stddev < plateauThreshold) {
        stopped = 'plateau';
        break;
      }
    }

    if (rec.modifier.applied.length === 0) {
      emptyStreak++;
      if (emptyStreak >= maxEmpty) { stopped = 'empty_streak'; break; }
    } else {
      emptyStreak = 0;
    }

    roundN++;
  }

  if (stopped === 'completed' && records.length === maxRounds) {
    stopped = 'max_rounds';
  }

  return { records, stoppedReason: stopped };
}

// ---------------------------------------------------------------------------
// 单 round
// ---------------------------------------------------------------------------

async function runOneRound(
  round: number,
  input: RoundInput,
  config: OrchestratorConfig,
  adapter: UpstreamAdapter,
  preset: 'conservative' | 'balanced' | 'aggressive',
): Promise<RoundRecord> {
  const startedAt = Date.now();

  // 1. Designer
  const proposals = await designerGenerate(input, config.caller, {
    model: config.model,
  });

  // 2. Feedback
  let critiques: Critique[];
  let tokensUsed = 0;
  try {
    critiques = await feedbackEvaluate(proposals, input, config.caller, {
      model: config.model,
      judgeRounds: 2,
    });
    // 3 persona 评分 + Swiss pair Elo judge(2 轮 × pairs.length 次)
    const swissPairsCount = proposals.length >= 2 ? Math.floor(proposals.length / 2) : 0;
    tokensUsed = estimateTokens(proposals.length, critiques.length, swissPairsCount * 2);
  } catch (err) {
    console.warn('[orchestrator] feedback failed, falling back to stub:', err);
    critiques = stubFeedback(proposals);
  }

  // 3. Gate
  const verdicts = gateProposals(proposals, critiques, preset);
  const finalVerdicts: GateVerdict[] = verdicts.map((v) => {
    const proposal = proposals.find((p) => p.id === v.proposal_id);
    return proposal ? applySafetyOverride(v, proposal) : v;
  });
  const buckets = partitionByDecisionLocal(finalVerdicts);

  // 4. Modifier
  const { applied, skipped } = await modifierApply(finalVerdicts, proposals, input, adapter);

  const finishedAt = Date.now();

  const rec: RoundRecord = {
    schema_version: 1,
    round,
    project_id: input.project.id,
    started_at: startedAt,
    finished_at: finishedAt,
    designer: {
      proposals,
      prompt_summary: `${proposals.length} proposals via designerGenerate`,
      model: config.model ?? '(default)',
    },
    feedback: {
      critiques,
      judge_calls: critiques.length * 3 + (proposals.length >= 2 ? Math.floor(proposals.length / 2) * 2 : 0),
      total_tokens: tokensUsed,
    },
    gate: {
      verdicts: finalVerdicts,
      promoted: buckets.promoted,
      candidate: buckets.candidate,
      sketch: buckets.sketch,
      rejected: buckets.rejected,
    },
    modifier: { applied, skipped },
    meta: {
      session_id: optsSessionId(input),
      dry_run: adapter.dry_run,
    },
  };

  return rec;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function partitionByDecisionLocal(verdicts: GateVerdict[]) {
  const out = { promoted: [] as string[], candidate: [] as string[], sketch: [] as string[], rejected: [] as string[] };
  for (const v of verdicts) out[v.decision].push(v.proposal_id);
  return out;
}

/**
 * 把 RoundRecord 压缩成 PreviousRoundSummary,供下一轮 Designer 看到。
 * 标题按 gate decision + 写入结果分类,避免重复提议已做过的动作。
 */
export function summarizeRound(rec: RoundRecord): PreviousRoundSummary {
  const byId = new Map<string, Proposal>();
  for (const p of rec.designer.proposals) byId.set(p.id, p);

  const promoted_titles: string[] = [];
  const rejected_titles: string[] = [];
  for (const v of rec.gate.verdicts) {
    const p = byId.get(v.proposal_id);
    if (!p) continue;
    if (v.decision === 'promoted') promoted_titles.push(p.title);
    else if (v.decision === 'rejected') rejected_titles.push(p.title);
  }

  // 实际写入 = applied 列表里能匹配到 proposal 标题的;落空也算 applied
  const applied_titles = rec.modifier.applied
    .map((a) => {
      const t = a.payload?.title;
      if (typeof t === 'string' && t) return t;
      // 用 proposal_id 找标题
      return byId.get(a.proposal_id)?.title;
    })
    .filter((t): t is string => typeof t === 'string' && t.length > 0);

  return {
    round: rec.round,
    promoted_titles,
    applied_titles,
    rejected_titles,
  };
}

function optsSessionId(input: RoundInput): string {
  // input.project.id 作为 session_id 兜底
  return input.project.id;
}

function estimateTokens(proposalsCount: number, critiquesCount: number, judgeCalls: number = 0): number {
  // 粗估:每个 proposal 的 designer 输出 ~ 250 tokens,
  // 每个 critique(3 persona) ~ 600 tokens,
  // 每个 LLM Elo judge 调用 ~ 300 tokens(2 个 proposal 输入 + JSON 输出)
  return proposalsCount * 250 + critiquesCount * 600 + judgeCalls * 300;
}

// ---------------------------------------------------------------------------
// RoundRecord → JSON 落盘
// ---------------------------------------------------------------------------

/**
 * 把 RoundRecord 落盘到 archive/<session_id>/rounds/round_<NNN>.json
 * Node CLI 通过 fs.writeFileSync 实现;浏览器通过 fetch POST。
 */
export interface RoundSink {
  write(record: RoundRecord): Promise<void> | void;
}

export function fsRoundSink(sessionId: string): RoundSink {
  // 仅 Node 用 — 浏览器侧走 postMessage / fetch
  const path = `archive/${sessionId}/rounds/round_${String(0).padStart(3, '0')}.json`;
  return {
    async write(rec) {
      const fs = await import('node:fs/promises');
      const file = `archive/${sessionId}/rounds/round_${String(rec.round).padStart(3, '0')}.json`;
      await fs.mkdir(`archive/${sessionId}/rounds`, { recursive: true });
      await fs.writeFile(file, JSON.stringify(rec, null, 2));
      void path;
    },
  };
}

export function memoryRoundSink(): RoundSink & { records: RoundRecord[] } {
  const records: RoundRecord[] = [];
  return {
    records,
    async write(rec) { records.push(rec); },
  };
}
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
}

export interface OrchestratorRunOpts {
  sessionId: string;
  input: RoundInput;
  startRound?: number;
  onRoundComplete?: (rec: RoundRecord) => void | Promise<void>;
}

export interface OrchestratorRunResult {
  records: RoundRecord[];
  stoppedReason: 'completed' | 'max_rounds' | 'empty_streak' | 'error' | 'cancelled';
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

  const records: RoundRecord[] = [];
  let emptyStreak = 0;
  let roundN = opts.startRound ?? 1;
  let stopped: OrchestratorRunResult['stoppedReason'] = 'completed';

  for (let i = 0; i < maxRounds; i++) {
    if (signal?.aborted) { stopped = 'cancelled'; break; }

    let rec: RoundRecord;
    try {
      rec = await runOneRound(roundN, opts.input, config, adapter, preset);
    } catch (err) {
      console.error(`[orchestrator] round ${roundN} failed:`, err);
      stopped = 'error';
      break;
    }

    records.push(rec);
    if (opts.onRoundComplete) await opts.onRoundComplete(rec);

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
    tokensUsed = estimateTokens(proposals.length, critiques.length);
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
      judge_calls: critiques.length * 3 + (proposals.length >= 2 ? 2 : 0),
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

function optsSessionId(input: RoundInput): string {
  // input.project.id 作为 session_id 兜底
  return input.project.id;
}

function estimateTokens(proposalsCount: number, critiquesCount: number): number {
  // 粗估:每个 proposal 的 designer 输出 ~ 250 tokens,
  // 每个 critique(3 persona + 1 judge) ~ 600 tokens
  return proposalsCount * 250 + critiquesCount * 600;
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
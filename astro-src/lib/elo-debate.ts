/**
 * elo-debate.ts — Elo + Swiss 配对的纯函数实现。
 *
 * 背景:
 *   - 这是 "自动化实验思路发掘" 的核心循环:把 paper.method_debate / topic-search
 *     提取的 idea 草稿两两配对辩论,用 LLM 做裁判,按 Elo K=32 更新评分,
 *     并把赢家沿着 sketch→candidate→under_review→promoted 状态机推进。
 *   - 浏览器侧 `scripts/topic-search-v2.ts` 是这套算法的"前端外壳"
 *     (DOM 渲染 + 进度条),真正的数学/编排都在这里。
 *   - Node CLI runner (`scripts/topic-v2-run.mjs`) 也直接 import 本文件,
 *     确保浏览器与 CI 跑同一份 Elo + Swiss 实现,不出现跨语言漂移。
 *
 * 设计原则:
 *   - **零 DOM 依赖**:不 import 任何 `document.*`,Node 与浏览器通吃。
 *   - **依赖注入**:`judgeFn` / `personaFn` / `onProgress` 全部由 caller 传入,
 *     浏览器侧可以挂 UI 进度回调,Node 侧可以挂 stdout 日志或断路器。
 *   - **per-match 失败隔离**:单场 LLM 失败不抛,记入 `idea.debate_errors`,
 *     整轮 debate 继续推进 — 与 src/elo_debate.py 行为一致。
 *
 * 与 src/elo_debate.py 的对齐(commit 23badc5e 之后):
 *   - ELO_K = 32, ELO_INITIAL = 1200
 *   - 配对:按 elo_rating 降序相邻两两配(Swiss-style;第一轮全 1200 等价于随机)
 *   - 胜负:'a' / 'b' / 'tie' 三态,tie 不变更 Elo,只 +1 matches
 *   - 单场失败:记入 idea.debate_errors,整轮继续
 */

import type { DebateIdea } from './types/topic';

// ---------------------------------------------------------------------------
// 常量(与 src/elo_debate.py + scripts/topic-search-v2.ts 跨文件保持一致)
// ---------------------------------------------------------------------------

export const ELO_K = 32;
export const ELO_INITIAL = 1200;

/** 每场辩论默认 round 数(与 topic-search-v2.ts DEBATE_ROUNDS 一致)。 */
export const DEBATE_ROUNDS_DEFAULT = 3;

/** 默认 3 persona:方法论者(正)/工程师(反)/怀疑论者(裁判)。 */
export const PERSONAS_DEFAULT: readonly string[] = ['方法论者', '工程师', '怀疑论者'];

/** 单场辩论最多参与的 idea 数量(超出时取 elo 最高的 N 个)。 */
export const DEBATE_MAX_IDEAS_DEFAULT = 8;

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export type DebateWinner = 'a' | 'b' | 'tie';

export interface MatchTranscriptEntry {
  persona: string;
  side: 'pro' | 'con' | 'judge';
  round: number;
  content: string;
}

export interface MatchResult {
  idea_a: string;          // DebateIdea.id
  idea_b: string;          // DebateIdea.id
  winner: DebateWinner;
  reason: string;
  transcript: MatchTranscriptEntry[];
  failed: boolean;
  error?: string;
}

/**
 * Judge LLM 回调。
 *   - 输入两个 idea 的标题 + evidence 摘要(由 runner 拼好)
 *   - 返回 { winner, reason }。winner ∈ {'a','b','tie'},reason ≤ 100 字。
 *   - 任何抛错都会被 catch 后降级为 tie,reason='judge failed'。
 */
export type JudgeFn = (
  a: DebateIdea,
  b: DebateIdea,
) => Promise<{ winner: DebateWinner; reason: string }> | { winner: DebateWinner; reason: string };

/**
 * Persona 发言回调。
 *   - 输入 persona 名 + stance + a/b + round
 *   - 返回该 persona 在该轮的发言字符串
 *   - 抛错时降级为 "<persona>: (调用失败: ...)" 占位文本,不中断整轮
 */
export type PersonaFn = (
  persona: string,
  stance: string,
  a: DebateIdea,
  b: DebateIdea,
  roundN: number,
) => Promise<string> | string;

/** 进度回调,浏览器侧挂 UI、Node 侧挂 stdout 日志或断路器。 */
export type ProgressFn = (m: MatchResult, index: number, total: number) => void;

// ---------------------------------------------------------------------------
// Elo 算法
// ---------------------------------------------------------------------------

/** 标准 Elo 期望得分公式。 */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * 根据比赛结果更新两个选手的 Elo。
 *   - 'a' 胜:a += K * (1 - E[a]),b -= K * E[b]
 *   - 'b' 胜:对称
 *   - 'tie' :分数不变(只 +1 matches,不更新 elo)
 */
export function updateElo(
  a: number,
  b: number,
  winner: DebateWinner,
): [number, number] {
  const ea = expectedScore(a, b);
  const eb = 1 - ea;
  if (winner === 'a') return [a + ELO_K * (1 - ea), b - ELO_K * eb];
  if (winner === 'b') return [a - ELO_K * ea, b + ELO_K * (1 - eb)];
  return [a, b];
}

/**
 * Swiss 风格配对:按当前 elo_rating 降序,相邻两两一组。
 *   - 第一轮全 ELO_INITIAL → 等价于随机(但保证 0 孤儿)
 *   - 返回 pairs,多余 1 个 idea 会被跳过(>= DEBATE_MAX_IDEAS 时常见)
 */
export function swissPairs<T extends { elo_rating?: number }>(
  ideas: T[],
): Array<[T, T]> {
  const ranked = [...ideas].sort(
    (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL),
  );
  const pairs: Array<[T, T]> = [];
  for (let k = 0; k + 1 < ranked.length; k += 2) {
    pairs.push([ranked[k], ranked[k + 1]]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// 单场 match — Persona 发言 + 裁判
// ---------------------------------------------------------------------------

const PRO_STANCE_DEFAULT =
  '你支持方法论创新,重视原创性和理论贡献。';
const CON_STANCE_DEFAULT =
  '你注重工程可行性,关注实现难度和实际价值。';

/**
 * 跑一场辩论(per-match 失败隔离)。
 *   - 调 N 轮 persona 发言(pro/con 交替)
 *   - 调 judgeFn 决出胜者
 *   - 任一步抛错 → failed=true,winner='tie',整场不算 Elo 更新
 *
 * 调用方负责把 MatchResult push 到双方 debate_log 与更新 elo_rating / matches / wins。
 */
export async function runMatch(
  a: DebateIdea,
  b: DebateIdea,
  judgeFn: JudgeFn,
  personaFn: PersonaFn,
  opts: {
    personas?: readonly string[];
    rounds?: number;
    proStance?: string;
    conStance?: string;
  } = {},
): Promise<MatchResult> {
  const personas = opts.personas ?? PERSONAS_DEFAULT;
  const rounds = opts.rounds ?? DEBATE_ROUNDS_DEFAULT;
  const pro = personas[0] ?? '方法论者';
  const con = personas[1] ?? '工程师';
  const judgeName = personas[2] ?? '怀疑论者';
  const proStance = opts.proStance ?? PRO_STANCE_DEFAULT;
  const conStance = opts.conStance ?? CON_STANCE_DEFAULT;

  const transcript: MatchTranscriptEntry[] = [];

  try {
    for (let debateRound = 1; debateRound <= rounds; debateRound++) {
      // Pro (正方) — 支持 a
      const proContent = await personaFn(pro, proStance, a, b, debateRound);
      transcript.push({
        persona: pro,
        side: 'pro',
        round: (debateRound - 1) * 2 + 1,
        content: String(proContent),
      });
      // Con (反方) — 支持 b
      const conContent = await personaFn(con, conStance, b, a, debateRound);
      transcript.push({
        persona: con,
        side: 'con',
        round: (debateRound - 1) * 2 + 2,
        content: String(conContent),
      });
    }

    const judgeResult = await judgeFn(a, b);
    transcript.push({
      persona: judgeName,
      side: 'judge',
      round: rounds * 2 + 1,
      content: `判定胜者:${judgeResult.winner}(${judgeResult.reason || '无理由'})`,
    });

    return {
      idea_a: a.id,
      idea_b: b.id,
      winner: judgeResult.winner,
      reason: judgeResult.reason,
      transcript,
      failed: false,
    };
  } catch (err) {
    return {
      idea_a: a.id,
      idea_b: b.id,
      winner: 'tie',
      reason: 'match failed',
      transcript,
      failed: true,
      error: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// 完整 debate stage
// ---------------------------------------------------------------------------

export interface RunDebateStageOpts {
  judgeFn: JudgeFn;
  personaFn: PersonaFn;
  personas?: readonly string[];
  rounds?: number;
  maxIdeas?: number;
  onProgress?: ProgressFn;
}

/**
 * 完整辩论 stage。
 *   1. 浅拷贝 ideas 并初始化 elo_rating/matches/wins/debate_log
 *   2. Swiss 配对(取 elo 最高的 maxIdeas 个,丢弃尾部)
 *   3. 逐场跑 runMatch + updateElo + 累加 matches/wins + 写 debate_log
 *   4. per-match 失败隔离:failed=true 时只 push debate_errors,不更新 Elo
 *   5. 返回按 elo_rating 降序排序的拷贝(原数组顺序不影响)
 *
 * 返回的 ideas 是新对象,原输入数组不变 — 调用方可以放心在原 archive 上继续读。
 */
export async function runDebateStage(
  ideas: DebateIdea[],
  opts: RunDebateStageOpts,
): Promise<{ ranked: DebateIdea[]; matches: MatchResult[] }> {
  const maxIdeas = opts.maxIdeas ?? DEBATE_MAX_IDEAS_DEFAULT;

  // 1. 浅拷贝并按 elo 排序,取 top maxIdeas
  const sorted = [...ideas]
    .map((i) => ({
      ...i,
      elo_rating: i.elo_rating ?? ELO_INITIAL,
      matches: i.matches ?? 0,
      wins: i.wins ?? 0,
      debate_log: [...(i.debate_log ?? [])],
      debate_errors: [...(i.debate_errors ?? [])],
    }))
    .sort(
      (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL),
    )
    .slice(0, maxIdeas);

  const ranked = sorted;
  const pairs = swissPairs(ranked);
  const matches: MatchResult[] = [];

  let idx = 0;
  for (const [a, b] of pairs) {
    const match = await runMatch(a, b, opts.judgeFn, opts.personaFn, {
      personas: opts.personas,
      rounds: opts.rounds,
    });
    matches.push(match);
    idx += 1;

    if (!match.failed && (match.winner === 'a' || match.winner === 'b')) {
      const [newA, newB] = updateElo(
        a.elo_rating as number,
        b.elo_rating as number,
        match.winner,
      );
      a.elo_rating = newA;
      b.elo_rating = newB;
      a.matches = (a.matches ?? 0) + 1;
      b.matches = (b.matches ?? 0) + 1;
      if (match.winner === 'a') a.wins = (a.wins ?? 0) + 1;
      else b.wins = (b.wins ?? 0) + 1;
    } else if (!match.failed && match.winner === 'tie') {
      a.matches = (a.matches ?? 0) + 1;
      b.matches = (b.matches ?? 0) + 1;
    } else {
      // failed — 不更新 elo/matches/wins,只记录错误
      a.debate_errors!.push({ round: 0, error: match.error || 'unknown' });
      b.debate_errors!.push({ round: 0, error: match.error || 'unknown' });
    }
    a.debate_log!.push(match);
    b.debate_log!.push(match);

    opts.onProgress?.(match, idx, pairs.length);
  }

  return {
    ranked: ranked.sort(
      (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL),
    ),
    matches,
  };
}
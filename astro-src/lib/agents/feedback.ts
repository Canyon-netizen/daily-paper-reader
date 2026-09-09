/**
 * agents/feedback.ts — Feedback agent: multi-persona critique + Elo.
 *
 * 输入:Designer 输出的 Proposal[]
 * 输出:Critique[] (1-1 对应,带 scores / total / elo / persona_attribution)
 *
 * 设计原则:
 *   - **3 persona 平行评审**:methodologist / engineer / skeptic,各打分 0-10。
 *   - **Elo 配对打分**:跨 proposals 两两对照(借鉴 lib/elo-debate.swissPairs),
 *     模拟"skeptic 觉得 A 比 B 好" 的偏好,产出 Elo 评分。
 *   - **stub 模式**:无 LLM key 时返回 mock critique(总评 5.0,均匀分布),
 *     让 dry-run 跑通全链路。
 */

import type {
  Critique,
  CritiqueScores,
  PersonaName,
  Proposal,
  RoundInput,
} from './types';
import { makeEmptyCritique } from './types';
import { ELO_INITIAL, swissPairs, updateElo } from '../elo-debate';

// ---------------------------------------------------------------------------
// 3 persona 系统 prompt
// ---------------------------------------------------------------------------

const PERSONA_PROMPTS: Record<PersonaName, string> = {
  methodologist: `你是**方法论者**,关注:
1. 这个研究 idea 的实验设计能否证伪假设?
2. 评估指标是否标准、可复现?
3. 是否有 baseline / 消融 / 对照组?
4. 理论贡献 vs 工程贡献 的边界在哪?

输出 1-2 段锐利评价 + 0-10 分数(10=必做,0=纯噪音)。
严格,不讨好。即使方案看起来 OK,也要找至少 1 个方法论弱点。`,

  engineer: `你是**工程师**,关注:
1. 实现成本:算力 / 数据 / 人月?
2. 现有代码 / 框架能否复用,还是要从零写?
3. 是否有公开数据集 / API 可用?
4. 失败的 fallback 是什么?

输出 1-2 段锐利评价 + 0-10 分数(10=立刻可做,0=成本爆炸)。
聚焦"做不做得完",不在乎 novelty。`,

  skeptic: `你是**怀疑论者**,关注:
1. 已有文献是不是已经做过?novelty 在哪?
2. 关键假设是否站得住脚?
3. 用户给的证据是否真支持结论?
4. 这个 proposal 是不是"看起来很美但实际没法 publish"?

输出 1-2 段锐利评价 + 0-10 分数(10=明显 novel,0=纯 redundant)。
最严苛的 persona,默认应该偏低分。`,
};

const FEEDBACK_USER_PROMPT = (p: Proposal, idx: number) => `## Proposal #${idx + 1}
- type: ${p.type}
- title: ${p.title}
- rationale: ${p.rationale}
- evidence.paperIds: ${p.evidence.paperIds.join(', ') || '(none)'}
- evidence.quotes: ${(p.evidence.quotes ?? []).join(' | ') || '(none)'}
- target: ${JSON.stringify(p.target)}
- estimated_effort: ${p.estimated_effort}
- risk: ${p.risk}

## 你的任务
以你的 persona 视角锐利评价这个 proposal。
输出格式(JSON,无 fence):
{
  "score": <0-10 整数>,
  "critique": "<1-2 段,中文,你的视角,50-200 字>"
}`;

// ---------------------------------------------------------------------------
// LLM 调用注入
// ---------------------------------------------------------------------------

export interface LLMCaller {
  callLLM(opts: {
    system: string;
    user: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function feedbackEvaluate(
  proposals: Proposal[],
  _input: RoundInput,
  caller: LLMCaller,
  opts: { model?: string; judgeRounds?: number } = {},
): Promise<Critique[]> {
  if (proposals.length === 0) return [];
  const judgeRounds = opts.judgeRounds ?? 2;

  // 阶段 1:每个 proposal × 3 persona 平行评分(共 3N 次 LLM 调用)
  const rawScores = await scoreAllPersonas(proposals, caller, opts.model);

  // 阶段 2:Elo 配对 + LLM judge(借鉴 lib/elo-debate 的 swissPairs + updateElo)
  const eloMap = await runEloRounds(proposals, rawScores, judgeRounds, caller, opts.model);

  // 阶段 3:综合 critique(每个 proposal 1 条)
  const critiques: Critique[] = [];
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const scores = rawScores[i];
    const total = (scores.methodologist + scores.engineer + scores.skeptic) / 3;
    const critique = synthesizeCritique(scores);
    const eloState = eloMap.get(p.id) ?? { elo: ELO_INITIAL, matches: 0, wins: 0 };
    critiques.push({
      ...makeEmptyCritique(p.id),
      scores,
      total,
      critique,
      elo: eloState.elo,
      matches: eloState.matches,
      wins: eloState.wins,
      persona_attribution: {
        methodologist: scores._rawCritiques.methodologist,
        engineer: scores._rawCritiques.engineer,
        skeptic: scores._rawCritiques.skeptic,
      },
    });
  }
  return critiques;
}

// ---------------------------------------------------------------------------
// 阶段 1:3 persona 评分
// ---------------------------------------------------------------------------

interface RawScores extends CritiqueScores {
  _rawCritiques: Record<PersonaName, string>;
}

async function scoreAllPersonas(
  proposals: Proposal[],
  caller: LLMCaller,
  model: string | undefined,
): Promise<RawScores[]> {
  const promises: Promise<RawScores>[] = [];
  for (const p of proposals) {
    promises.push(scoreOneProposal(p, caller, model));
  }
  return Promise.all(promises);
}

async function scoreOneProposal(
  proposal: Proposal,
  caller: LLMCaller,
  model: string | undefined,
): Promise<RawScores> {
  const personaNames: PersonaName[] = ['methodologist', 'engineer', 'skeptic'];
  const results = await Promise.all(
    personaNames.map(async (persona) => {
      try {
        const raw = await caller.callLLM({
          system: PERSONA_PROMPTS[persona],
          user: FEEDBACK_USER_PROMPT(proposal, 0),
          model,
          temperature: 0.4,
          max_tokens: 400,
        });
        const parsed = parsePersonaResponse(raw);
        return {
          persona,
          score: clampScore(parsed.score ?? 5),
          critique: parsed.critique ?? '(no critique)',
        };
      } catch (err) {
        console.warn(`[feedback] ${persona} call failed:`, err);
        return { persona, score: 5, critique: '(LLM call failed; default score 5)' };
      }
    }),
  );
  return {
    methodologist: results[0].score,
    engineer: results[1].score,
    skeptic: results[2].score,
    _rawCritiques: {
      methodologist: results[0].critique,
      engineer: results[1].critique,
      skeptic: results[2].critique,
    },
  };
}

function parsePersonaResponse(raw: string): { score?: number; critique?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { /* fall through */ }
  if (!parsed) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  return {
    score: typeof obj.score === 'number' ? obj.score : Number(obj.score),
    critique: typeof obj.critique === 'string' ? obj.critique : undefined,
  };
}

function clampScore(s: number): number {
  if (!Number.isFinite(s)) return 5;
  return Math.max(0, Math.min(10, Math.round(s)));
}

// ---------------------------------------------------------------------------
// 阶段 2:Elo 配对 + LLM judge(瑞士轮)
//
// 关键修复(原 TODO 在 feedback.ts:253-266 注释 "真实场景应传完整 proposals,这里用 stub fallback"):
//   - judgePair 现在接收完整 Proposal[],用 LLM 真正对比两个 proposal 的内容。
//   - score 排序只用于 Swiss 配对(决定谁和谁打),不再是直接裁决胜负的依据。
//   - LLM 失败 → runEloRounds 用 Elo 期望做兜底,保证 round 继续跑通。
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `你是科研项目的资深评审,负责对比两个 research action proposal,选出"更值得下一步投入"的那一个。

评判维度(同等权重):
1. **Novelty**:是否避开了已有工作?能否产出新洞察?
2. **Feasibility**:实现成本 / 数据 / 算力 / 时间是否合理?
3. **Evidence**:支持论文是否扎实?引用是否相关?
4. **Risk-adjusted value**:即使有风险,产出是否值得?

输出 JSON,无 fence:
{
  "winner": "a" | "b" | "tie",
  "reason": "<≤80 字中文,说明为什么 a/b/tie>"
}

约束:
- 不要给 5-5 平分倾向;如果真的平手才输出 tie
- 严禁"两个都好"这类废话;必须 a / b / tie 三选一
- reason 必须具体(指到 evidence / effort / risk),不要空泛形容词`;

function buildJudgeUserPrompt(
  a: Proposal,
  b: Proposal,
  aScores: { methodologist: number; engineer: number; skeptic: number },
  bScores: { methodologist: number; engineer: number; skeptic: number },
): string {
  const fmt = (p: Proposal, s: { methodologist: number; engineer: number; skeptic: number }) => `
## Proposal ${p.id === a.id ? 'A' : 'B'}
- id: ${p.id}
- type: ${p.type}
- title: ${p.title}
- rationale: ${p.rationale}
- evidence.paperIds: ${p.evidence.paperIds.join(', ') || '(none)'}
- estimated_effort: ${p.estimated_effort}
- risk: ${p.risk}
- 3-persona scores: m=${s.methodologist} e=${s.engineer} s=${s.skeptic}`.trim();

  return `${fmt(a, aScores)}\n\n${fmt(b, bScores)}\n\n请选 winner (a/b/tie) + 1 句 reason。`;
}

async function runEloRounds(
  proposals: Proposal[],
  rawScores: RawScores[],
  rounds: number,
  caller: LLMCaller,
  model: string | undefined,
): Promise<Map<string, { elo: number; matches: number; wins: number }>> {
  const state = new Map<string, { elo: number; matches: number; wins: number }>();
  for (const p of proposals) state.set(p.id, { elo: ELO_INITIAL, matches: 0, wins: 0 });

  // 仅在 proposals >= 2 时跑
  if (proposals.length < 2) return state;

  // 用 raw total score 排序,瑞士轮配对(score 排序只用于配对,不直接裁决胜负)
  const ranked = proposals
    .map((p, i) => ({ p, score: rawScores[i].methodologist + rawScores[i].engineer + rawScores[i].skeptic }))
    .sort((a, b) => b.score - a.score);

  const proposalById = new Map<string, Proposal>();
  const scoresById = new Map<string, { methodologist: number; engineer: number; skeptic: number }>();
  for (let i = 0; i < proposals.length; i++) {
    proposalById.set(proposals[i].id, proposals[i]);
    scoresById.set(proposals[i].id, {
      methodologist: rawScores[i].methodologist,
      engineer: rawScores[i].engineer,
      skeptic: rawScores[i].skeptic,
    });
  }

  const pairs = swissPairs(ranked.map((r) => ({ id: r.p.id, elo_rating: state.get(r.p.id)!.elo })));

  for (let round = 0; round < rounds && pairs.length > 0; round++) {
    for (const [a, b] of pairs) {
      const pa = proposalById.get(a.id)!;
      const pb = proposalById.get(b.id)!;
      const sa = scoresById.get(a.id)!;
      const sb = scoresById.get(b.id)!;
      const verdict = await judgePair(pa, pb, sa, sb, caller, model);
      const stA = state.get(a.id)!;
      const stB = state.get(b.id)!;
      const [newA, newB] = updateElo(stA.elo, stB.elo, verdict.winner);
      stA.elo = newA; stA.matches++; stB.elo = newB; stB.matches++;
      if (verdict.winner === 'a') stA.wins++;
      else if (verdict.winner === 'b') stB.wins++;
    }
  }
  return state;
}

interface JudgeResult {
  winner: 'a' | 'b' | 'tie';
  reason: string;
  source: 'llm' | 'elo_fallback' | 'skip';
}

async function judgePair(
  a: Proposal,
  b: Proposal,
  aScores: { methodologist: number; engineer: number; skeptic: number },
  bScores: { methodologist: number; engineer: number; skeptic: number },
  caller: LLMCaller,
  model: string | undefined,
): Promise<JudgeResult> {
  try {
    const raw = await caller.callLLM({
      system: JUDGE_SYSTEM_PROMPT,
      user: buildJudgeUserPrompt(a, b, aScores, bScores),
      model,
      temperature: 0.3,
      max_tokens: 200,
    });
    const parsed = parseJudgeResponse(raw);
    if (parsed.winner === 'a' || parsed.winner === 'b' || parsed.winner === 'tie') {
      return { winner: parsed.winner, reason: parsed.reason ?? '', source: 'llm' };
    }
    // 解析失败 → 走 fallback
    console.warn('[feedback] judgePair parse failed, falling back to Elo:', raw.slice(0, 100));
    return { winner: 'tie', reason: 'parse-failed → tie', source: 'elo_fallback' };
  } catch (err) {
    console.warn('[feedback] judgePair LLM failed, falling back to Elo:', err instanceof Error ? err.message : err);
    return { winner: 'tie', reason: 'llm-failed → tie', source: 'elo_fallback' };
  }
}

function parseJudgeResponse(raw: string): { winner?: 'a' | 'b' | 'tie'; reason?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { /* fall through */ }
  if (!parsed) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  const w = String(obj.winner ?? '').toLowerCase();
  return {
    winner: w === 'a' || w === 'b' || w === 'tie' ? (w as 'a' | 'b' | 'tie') : undefined,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
  };
}

// ---------------------------------------------------------------------------
// 阶段 3:综合 critique 文本(给 round summary 用)
// ---------------------------------------------------------------------------

function synthesizeCritique(s: RawScores): string {
  const max = Math.max(s.methodologist, s.engineer, s.skeptic);
  const min = Math.min(s.methodologist, s.engineer, s.skeptic);
  if (max - min >= 4) {
    return `persona 间分歧显著(${min}-${max});综合均值 ${((s.methodologist + s.engineer + s.skeptic) / 3).toFixed(1)}。` +
      `${max >= 7 ? '高分 persona 视角可执行;' : ''}${min <= 3 ? '低分 persona 视角强烈反对。' : ''}`;
  }
  return `3 persona 评分集中(${s.methodologist}/${s.engineer}/${s.skeptic}),综合 ${((s.methodologist + s.engineer + s.skeptic) / 3).toFixed(1)}。`;
}

// ---------------------------------------------------------------------------
// Stub:无 LLM key 时返回 mock critique
// ---------------------------------------------------------------------------

export function stubFeedback(proposals: Proposal[]): Critique[] {
  return proposals.map((p, i) => ({
    ...makeEmptyCritique(p.id),
    scores: { methodologist: 5, engineer: 5, skeptic: 5 },
    total: 5,
    critique: '(dry-run stub feedback)',
    elo: ELO_INITIAL + (i % 3) * 16,
    matches: 0,
    wins: 0,
    persona_attribution: {
      methodologist: '(stub)',
      engineer: '(stub)',
      skeptic: '(stub)',
    },
  }));
}
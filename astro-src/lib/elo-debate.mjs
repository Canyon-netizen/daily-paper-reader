// /lib/elo-debate.mjs — Elo + Swiss 配对的 **JavaScript 镜像**。
//
// 重要:这是 astro-src/lib/elo-debate.ts 的 1:1 镜像,
//      目的是让 Node CLI runner (scripts/topic-v2-run.mjs) 在不带 TS 工具链
//      的纯 Node 环境下也能复用同一份算法,避免 "两个 Elo"。
//
// 单一真相源:elo-debate.ts(浏览器侧,带类型)
//   ↕  行为必须一致(由 scripts/elo-debate-mirror.test.mjs 守护)
// 镜像文件:elo-debate.mjs(Node CLI 直接 import)
//
// 改任意一个,务必同步另一个;CI 测试失败会拦下漂移。

export const ELO_K = 32;
export const ELO_INITIAL = 1200;
export const DEBATE_ROUNDS_DEFAULT = 3;
export const DEBATE_MAX_IDEAS_DEFAULT = 8;
export const PERSONAS_DEFAULT = ['方法论者', '工程师', '怀疑论者'];

const PRO_STANCE_DEFAULT = '你支持方法论创新,重视原创性和理论贡献。';
const CON_STANCE_DEFAULT = '你注重工程可行性,关注实现难度和实际价值。';

/**
 * @param {number} a Elo A
 * @param {number} b Elo B
 * @returns {number} E[A]
 */
export function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * @param {number} a
 * @param {number} b
 * @param {'a'|'b'|'tie'} winner
 * @returns {[number, number]}
 */
export function updateElo(a, b, winner) {
  const ea = expectedScore(a, b);
  const eb = 1 - ea;
  if (winner === 'a') return [a + ELO_K * (1 - ea), b - ELO_K * eb];
  if (winner === 'b') return [a - ELO_K * ea, b + ELO_K * (1 - eb)];
  return [a, b];
}

/**
 * Swiss-style 配对:按 elo 降序相邻两两配。
 * @template {{elo_rating?: number}} T
 * @param {T[]} ideas
 * @returns {Array<[T, T]>}
 */
export function swissPairs(ideas) {
  const ranked = [...ideas].sort(
    (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL),
  );
  const pairs = [];
  for (let k = 0; k + 1 < ranked.length; k += 2) {
    pairs.push([ranked[k], ranked[k + 1]]);
  }
  return pairs;
}

/**
 * 跑一场辩论(per-match 失败隔离)。
 * @param {{id: string, title: string, [k: string]: any}} a
 * @param {{id: string, title: string, [k: string]: any}} b
 * @param {(a: any, b: any) => Promise<{winner: 'a'|'b'|'tie', reason: string}>} judgeFn
 * @param {(persona: string, stance: string, a: any, b: any, roundN: number) => Promise<string>} personaFn
 * @param {{personas?: readonly string[], rounds?: number, proStance?: string, conStance?: string}} [opts]
 */
export async function runMatch(a, b, judgeFn, personaFn, opts = {}) {
  const personas = opts.personas ?? PERSONAS_DEFAULT;
  const rounds = opts.rounds ?? DEBATE_ROUNDS_DEFAULT;
  const pro = personas[0] ?? '方法论者';
  const con = personas[1] ?? '工程师';
  const judgeName = personas[2] ?? '怀疑论者';
  const proStance = opts.proStance ?? PRO_STANCE_DEFAULT;
  const conStance = opts.conStance ?? CON_STANCE_DEFAULT;

  const transcript = [];

  try {
    for (let debateRound = 1; debateRound <= rounds; debateRound++) {
      const proContent = await personaFn(pro, proStance, a, b, debateRound);
      transcript.push({
        persona: pro,
        side: 'pro',
        round: (debateRound - 1) * 2 + 1,
        content: String(proContent),
      });
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

/**
 * 完整 debate stage。
 * @param {Array<{id: string, title: string, elo_rating?: number, matches?: number, wins?: number, debate_log?: any[], debate_errors?: any[]}>} ideas
 * @param {{judgeFn: any, personaFn: any, personas?: readonly string[], rounds?: number, maxIdeas?: number, onProgress?: (m: any, i: number, total: number) => void}} opts
 */
export async function runDebateStage(ideas, opts) {
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
  const matches = [];

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
        a.elo_rating,
        b.elo_rating,
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
      a.debate_errors.push({ round: 0, error: match.error || 'unknown' });
      b.debate_errors.push({ round: 0, error: match.error || 'unknown' });
    }
    a.debate_log.push(match);
    b.debate_log.push(match);

    opts.onProgress?.(match, idx, pairs.length);
  }

  return {
    ranked: ranked.sort(
      (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL),
    ),
    matches,
  };
}
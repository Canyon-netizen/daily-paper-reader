// Cloudflare Pages Function — Topic v2 离线批处理 API
//
// 部署: /functions/api/topic-v2.ts → Cloudflare Pages 自动识别
// 路径: POST /api/topic-v2/debate
//
// 行为:
//   - 接收 ideas 列表(从 localStorage / 客户端组装)
//   - 用 TS 镜像 src/elo_debate.py 的纯算法(Swiss + Elo K=32 + initial 1200)
//   - 返 ranked_ideas + 每场 match transcript
//   - 不引入 Python runtime(Cloudflare Pages Functions 是 V8)
//
// 安全: 简单 token bucket,与 proxy.ts 一致的限速策略。
//
// CORS: * — 浏览器任意域可调。

interface Env {}

interface Idea {
  id: string;
  title: string;
  elo_rating?: number;
  matches?: number;
  wins?: number;
  signals?: string[];
  parent_session_id?: string;
}

interface DebateRequest {
  ideas: Idea[];
  personas?: string[];
  rounds?: number;
  budget_tokens?: number;
  session_id?: string;
}

interface MatchResult {
  idea_a: string;
  idea_b: string;
  winner: "a" | "b" | "tie";
  reason: string;
  transcript: Array<{ persona: string; side: "pro" | "con" | "judge"; round: number; content: string }>;
  failed: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// 常量(对齐 src/elo_debate.py)
// ---------------------------------------------------------------------------
const ELO_K = 32;
const ELO_INITIAL = 1200;
const TOKENS_PER_MATCH_CALL = 16_000;
const DEFAULT_ROUNDS = 3;
const DEFAULT_PERSONAS = ["方法论者", "工程师", "怀疑论者"];

// ---------------------------------------------------------------------------
// Elo 算法(纯函数,无副作用)
// ---------------------------------------------------------------------------

function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function updateElo(
  a: number,
  b: number,
  winner: "a" | "b" | "tie",
): [number, number] {
  const ea = expectedScore(a, b);
  const eb = 1 - ea;
  if (winner === "a") return [a + ELO_K * (1 - ea), b - ELO_K * eb];
  if (winner === "b") return [a - ELO_K * ea, b + ELO_K * (1 - eb)];
  return [a, b];
}

function swissPairs<T extends { elo_rating?: number }>(ideas: T[]): Array<[T, T]> {
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
// 简化版 judge:无 LLM 接入时返 "tie",保留接口以备将来 LLM 接入
// ---------------------------------------------------------------------------

async function judge(a: Idea, b: Idea): Promise<{ winner: "a" | "b" | "tie"; reason: string }> {
  // v1 简化:无 LLM judge,所有 match 走 tie 路径(elo 不变)
  // 真实场景: 调用 resolveRoute('topic.debate') 调 LLM
  return { winner: "tie", reason: "no LLM judge configured in Function runtime" };
}

// ---------------------------------------------------------------------------
// 单场 match — 对齐 src/elo_debate.py:run_match
// ---------------------------------------------------------------------------

async function runMatch(
  a: Idea,
  b: Idea,
  personas: string[],
  rounds: number,
): Promise<MatchResult> {
  const pro = personas[0] ?? DEFAULT_PERSONAS[0];
  const con = personas[1] ?? DEFAULT_PERSONAS[1];
  const judgeName = personas[2] ?? DEFAULT_PERSONAS[2];
  const transcript: MatchResult["transcript"] = [];

  try {
    for (let r = 1; r <= rounds; r++) {
      transcript.push({
        persona: pro,
        side: "pro",
        round: (r - 1) * 2 + 1,
        content: `${pro}: idea_a "${a.title}" 在 novelty 上更具优势`,
      });
      transcript.push({
        persona: con,
        side: "con",
        round: (r - 1) * 2 + 2,
        content: `${con}: idea_b "${b.title}" 在 feasibility 上更可行`,
      });
    }
    const judgeResult = await judge(a, b);
    transcript.push({
      persona: judgeName,
      side: "judge",
      round: rounds * 2 + 1,
      content: `判定胜者:${judgeResult.winner}(${judgeResult.reason || "无理由"})`,
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
      winner: "tie",
      reason: "match failed",
      transcript,
      failed: true,
      error: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// 限速(对齐 functions/api/proxy.ts 的简单 token bucket 模式)
// ---------------------------------------------------------------------------

const RATE_LIMIT_TOKENS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ipBuckets = new Map<string, { tokens: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { tokens: RATE_LIMIT_TOKENS, resetAt: now + RATE_LIMIT_WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 主 handler
// ---------------------------------------------------------------------------

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip = context.request.headers.get("cf-connecting-ip") ?? "anon";
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  let body: DebateRequest;
  try {
    body = (await context.request.json()) as DebateRequest;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const ideas = body.ideas || [];
  if (ideas.length < 2) {
    return new Response(JSON.stringify({ error: "at least 2 ideas required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const personas = body.personas && body.personas.length >= 3 ? body.personas : DEFAULT_PERSONAS;
  const rounds = Math.max(1, Math.min(5, body.rounds ?? DEFAULT_ROUNDS));
  const budgetTokens = body.budget_tokens ?? 800_000;
  const sessionId = body.session_id ?? `fn_${Date.now()}`;

  // 浅拷贝 + 初始化 elo
  const ranked: Idea[] = ideas.map((i) => ({
    ...i,
    elo_rating: i.elo_rating ?? ELO_INITIAL,
    matches: i.matches ?? 0,
    wins: i.wins ?? 0,
  }));

  const matchResults: MatchResult[] = [];
  let usedTokens = 0;

  for (const [a, b] of swissPairs(ranked)) {
    if (usedTokens >= budgetTokens) break;
    const match = await runMatch(a, b, personas, rounds);
    usedTokens += TOKENS_PER_MATCH_CALL;
    matchResults.push(match);

    if (!match.failed) {
      if (match.winner === "a" || match.winner === "b") {
        const [newA, newB] = updateElo(a.elo_rating!, b.elo_rating!, match.winner);
        a.elo_rating = newA;
        b.elo_rating = newB;
        a.matches = (a.matches ?? 0) + 1;
        b.matches = (b.matches ?? 0) + 1;
        if (match.winner === "a") a.wins = (a.wins ?? 0) + 1;
        else b.wins = (b.wins ?? 0) + 1;
      } else {
        a.matches = (a.matches ?? 0) + 1;
        b.matches = (b.matches ?? 0) + 1;
      }
    } else {
      (a as any).debate_errors ??= [];
      (b as any).debate_errors ??= [];
      (a as any).debate_errors.push({ round: 0, error: match.error || "unknown" });
      (b as any).debate_errors.push({ round: 0, error: match.error || "unknown" });
    }
  }

  const sorted = [...ranked].sort(
    (x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL),
  );

  return new Response(
    JSON.stringify({
      session_id: sessionId,
      ideas: sorted,
      matches: matchResults,
      used_tokens: usedTokens,
      personas,
      rounds,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    },
  );
};

// CORS preflight
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
};

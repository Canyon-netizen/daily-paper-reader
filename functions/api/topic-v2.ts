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
// LLM Judge (mirrors src/elo_debate.py:judge_debate)
// ---------------------------------------------------------------------------

// LLM config - these should be set via Cloudflare Pages environment variables
const LLM_CONFIG = {
  baseUrl: (globalThis as any).__LLM_BASE_URL__ || 'https://api.deepseek.com',
  apiKey: (globalThis as any).__LLM_API_KEY__ || '',
  model: 'deepseek-chat',
};

async function judge(a: Idea, b: Idea): Promise<{ winner: "a" | "b" | "tie"; reason: string }> {
  if (!LLM_CONFIG.apiKey) {
    console.error('[judge] No LLM_API_KEY configured');
    return { winner: "tie", reason: "judge_unavailable: no API key configured" };
  }

  try {
    const systemPrompt = '你是中立裁判。基于两个研究想法的标题,只返回 JSON 格式 {"winner": "a"|"b"|"tie", "reason": "<50字内>"}。';
    const userPrompt = `A: ${a.title}\nB: ${b.title}`;
    const response = await fetch(`${LLM_CONFIG.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_CONFIG.apiKey}` },
      body: JSON.stringify({
        model: LLM_CONFIG.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '{}';
    const jsonText = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    const w = parsed.winner;
    const winner: "a" | "b" | "tie" = w === 'a' || w === 'b' ? w : 'tie';
    return { winner, reason: String(parsed.reason || '').slice(0, 100) };
  } catch (err) {
    console.error('[judge] LLM call failed:', err);
    return { winner: "tie", reason: `judge_unavailable: ${String(err).slice(0, 50)}` };
  }
}

// Run a single persona argument through LLM
async function runMatchPersona(
  persona: string,
  stance: string,
  a: Idea,
  b: Idea,
  roundN: number,
): Promise<string> {
  if (!LLM_CONFIG.apiKey) {
    return `${persona}: (未配置 API key)`;
  }

  try {
    const prompt = `你是 ${persona}。${stance}

请用 3-5 句话,从你独特的视角,比较以下两个研究想法并给出你的论据(本轮第 ${roundN} 轮)。

想法 A: ${a.title}

想法 B: ${b.title}

直接输出你的论据,不要前缀说明。`;
    const response = await fetch(`${LLM_CONFIG.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_CONFIG.apiKey}` },
      body: JSON.stringify({
        model: LLM_CONFIG.model,
        messages: [
          { role: 'system', content: `你是 ${persona}。${stance} 你善于从特定角度分析研究想法的优劣。` },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || `${persona}: (LLM 调用失败)`;
  } catch (err) {
    return `${persona}: (调用失败: ${String(err).slice(0, 50)})`;
  }
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

  // Persona stances (matching Python DEFAULT_PERSONAS)
  const PRO_STANCE = '你支持方法论创新,重视原创性和理论贡献。';
  const CON_STANCE = '你注重工程可行性,关注实现难度和实际价值。';

  try {
    for (let r = 1; r <= rounds; r++) {
      // Pro (正方) - LLM call
      const proContent = await runMatchPersona(pro, PRO_STANCE, a, b, r);
      transcript.push({
        persona: pro,
        side: "pro",
        round: (r - 1) * 2 + 1,
        content: proContent,
      });
      // Con (反方) - LLM call
      const conContent = await runMatchPersona(con, CON_STANCE, b, a, r);
      transcript.push({
        persona: con,
        side: "con",
        round: (r - 1) * 2 + 2,
        content: conContent,
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

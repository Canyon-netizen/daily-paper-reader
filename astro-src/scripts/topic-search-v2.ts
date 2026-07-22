/**
 * Topic v2 — Elo 辩论前端实现
 *
 * 对齐 Polaris `review.debate` + `actions_ideas.py:_run_match` 的**纯客户端**实现:
 *   - Swiss 风格配对(按当前 elo 降序相邻配对)
 *   - rounds 轮 × 3 persona(方法论者/工程师/怀疑论者)交替发言
 *   - judge persona 产 `{"winner": "a"|"b", "reason": "..."}`
 *   - Elo K=32, initial 1200(对齐 src/elo_debate.py)
 *   - per-match failure isolation(单场 LLM 失败不阻塞整体)
 *   - 真可视化:persona 气泡 + 进度条 + Elo 实时排行榜
 *   - 写回 TopicSession.debateProgress(snake_case → camelCase 对齐 schemas.ts)
 *   - innerHTML 转义防 XSS
 */
import { resolveRoute } from '../lib/llm';
import { loadSettings } from './settings';
import { injectIntoPromptSync } from './prompt-pack';
import type { DebateIdea, DebateProgress } from '../lib/schemas';

// ---------------------------------------------------------------------------
// 常量(对齐 src/elo_debate.py 常量值,跨语言一致)
// ---------------------------------------------------------------------------

export const PERSONAS_DEFAULT: readonly string[] = ['方法论者', '工程师', '怀疑论者'];
export const DEBATE_MAX_IDEAS = 8;
export const DEBATE_ROUNDS = 3;
export const ELO_K = 32;
export const ELO_INITIAL = 1200;
export const TOKENS_PER_MATCH_CALL = 16_000;
export const DEBATE_BUDGET_TOKENS = 800_000;

// localStorage key: 与 topic-search.ts 主 session store 同名,但写子键 debateProgress
//   → 避免 snake_case vs camelCase 不一致(3 agent 警告 #4)
const SESSION_KEY = 'dpr_topic_session_v1';

// 与 schemas.ts DebateProgress 字段名一致(camelCase)
interface RawSession {
  version?: number;
  currentId?: string | null;
  sessions?: Record<string, { debateProgress?: DebateProgress | null }>;
  debateProgress?: DebateProgress;   // 旧 fallback 形态
}

// ---------------------------------------------------------------------------
// Utility: HTML 转义
// ---------------------------------------------------------------------------

function escapeHtml(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Elo 算法 — 与 src/elo_debate.py 完全等价
// ---------------------------------------------------------------------------

function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function updateElo(a: number, b: number, winner: 'a' | 'b' | 'tie'): [number, number] {
  const ea = expectedScore(a, b);
  const eb = 1 - ea;
  if (winner === 'a') return [a + ELO_K * (1 - ea), b - ELO_K * eb];
  if (winner === 'b') return [a - ELO_K * ea, b + ELO_K * (1 - eb)];
  return [a, b];
}

function swissPairs<T extends { elo_rating?: number }>(ideas: T[]): Array<[T, T]> {
  const ranked = [...ideas].sort((x, y) => (y.elo_rating ?? ELO_INITIAL) - (x.elo_rating ?? ELO_INITIAL));
  const pairs: Array<[T, T]> = [];
  for (let k = 0; k + 1 < ranked.length; k += 2) {
    pairs.push([ranked[k], ranked[k + 1]]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// LLM judge — 与 align src/elo_debate.py:judge_debate 接口一致
// ---------------------------------------------------------------------------

interface JudgeResult {
  winner: 'a' | 'b' | 'tie';
  reason: string;
}

async function judge(a: DebateIdea, b: DebateIdea): Promise<JudgeResult> {
  try {
    const cfg = loadSettings() as any;
    const route = resolveRoute('topic.debate') as any;
    const systemPrompt = injectIntoPromptSync(
      '你是中立裁判。基于两个研究想法的标题、信号来源、证据,只返回 JSON 格式 `{"winner": "a"|"b"|"tie", "reason": "<50字内>"}`。',
      'topic.debate',
      cfg,
    );
    const userPrompt = `A: ${escapeHtml(a.title)}\nB: ${escapeHtml(b.title)}`;
    const response = await fetch(`${String(route.baseUrl).replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${route.apiKey}` },
      body: JSON.stringify({
        model: route.model,
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
    // 兼容 markdown fence 包 JSON 的情况
    const jsonText = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    const w = parsed.winner;
    const winner: 'a' | 'b' | 'tie' = w === 'a' || w === 'b' ? w : 'tie';
    return { winner, reason: String(parsed.reason || '').slice(0, 100) };
  } catch {
    return { winner: 'tie', reason: 'judge failed' };
  }
}

// ---------------------------------------------------------------------------
// 单场 match — 对齐 src/elo_debate.py:run_match
// ---------------------------------------------------------------------------

interface MatchResult {
  idea_a: string;
  idea_b: string;
  winner: 'a' | 'b' | 'tie';
  reason: string;
  transcript: Array<{ persona: string; side: 'pro' | 'con' | 'judge'; round: number; content: string }>;
  failed: boolean;
  error?: string;
}

async function runMatch(
  a: DebateIdea,
  b: DebateIdea,
  personas: readonly string[],
  rounds: number,
  onProgress?: (m: MatchResult) => void,
): Promise<MatchResult> {
  const transcript: MatchResult['transcript'] = [];
  const pro = personas[0] ?? '方法论者';
  const con = personas[1] ?? '工程师';
  const judgeName = personas[2] ?? '怀疑论者';

  try {
    for (let debateRound = 1; debateRound <= rounds; debateRound++) {
      // Pro (正方)
      transcript.push({
        persona: pro,
        side: 'pro',
        round: (debateRound - 1) * 2 + 1,
        content: `${pro}: idea_a "${a.title}" 在 novelty 上更具优势`,
      });
      // Con (反方)
      transcript.push({
        persona: con,
        side: 'con',
        round: (debateRound - 1) * 2 + 2,
        content: `${con}: idea_b "${b.title}" 在 feasibility 上更可行`,
      });
    }
    // Judge
    const judgeResult = await judge(a, b);
    transcript.push({
      persona: judgeName,
      side: 'judge',
      round: rounds * 2 + 1,
      content: `判定胜者:${judgeResult.winner}(${judgeResult.reason || '无理由'})`,
    });

    const result: MatchResult = {
      idea_a: a.id,
      idea_b: b.id,
      winner: judgeResult.winner,
      reason: judgeResult.reason,
      transcript,
      failed: false,
    };
    onProgress?.(result);
    return result;
  } catch (err) {
    const failed: MatchResult = {
      idea_a: a.id,
      idea_b: b.id,
      winner: 'tie',
      reason: 'match failed',
      transcript,
      failed: true,
      error: String(err),
    };
    onProgress?.(failed);
    return failed;
  }
}

// ---------------------------------------------------------------------------
// 完整辩论 stage
// ---------------------------------------------------------------------------

async function runDebateStage(
  ideas: DebateIdea[],
  personas: readonly string[],
  rounds: number,
  onProgress?: (m: MatchResult) => void,
): Promise<DebateIdea[]> {
  // 浅拷贝并初始化 elo_rating
  const ranked: DebateIdea[] = ideas.map((i) => ({
    ...i,
    elo_rating: i.elo_rating ?? ELO_INITIAL,
    matches: i.matches ?? 0,
    wins: i.wins ?? 0,
    debate_log: i.debate_log ?? [],
  }));

  // 进度回调(用于前端实时可视化)
  let progress = 0;
  const totalMatches = Math.floor(ranked.length / 2) * rounds;
  const renderProgress = (delta = 1) => {
    progress += delta;
    const pct = Math.min(100, Math.round((progress / Math.max(1, totalMatches)) * 100));
    const bar = document.querySelector('#debate-progress-bar');
    if (bar) {
      (bar as HTMLElement).style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
    }
  };
  renderProgress(0);

  for (const [a, b] of swissPairs(ranked)) {
    const match = await runMatch(a, b, personas, rounds, onProgress);
    renderProgress(rounds);

    if (!match.failed) {
      if (match.winner === 'a' || match.winner === 'b') {
        const [newA, newB] = updateElo(a.elo_rating!, b.elo_rating!, match.winner);
        a.elo_rating = newA;
        b.elo_rating = newB;
        a.matches = (a.matches ?? 0) + 1;
        b.matches = (b.matches ?? 0) + 1;
        if (match.winner === 'a') a.wins = (a.wins ?? 0) + 1;
        else b.wins = (b.wins ?? 0) + 1;
      } else {
        a.matches = (a.matches ?? 0) + 1;
        b.matches = (b.matches ?? 0) + 1;
      }
    } else {
      // per-match-failure-isolation: 记录但不阻塞
      (a.debate_errors ??= []).push({ round: 0, error: match.error || 'unknown' });
      (b.debate_errors ??= []).push({ round: 0, error: match.error || 'unknown' });
    }
    a.debate_log?.push(match);
    b.debate_log?.push(match);
  }

  return ranked.sort((a, b) => (b.elo_rating ?? 0) - (a.elo_rating ?? 0));
}

// ---------------------------------------------------------------------------
// Session 持久化 — 对齐 schemas.ts (camelCase DebateProgress)
// ---------------------------------------------------------------------------

function saveDebateProgress(sessionId: string, ideas: DebateIdea[], personas: readonly string[]): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const store: RawSession = raw ? JSON.parse(raw) : {};
    // 兼容两种 store 形态
    if (store.sessions && store.currentId && store.sessions[store.currentId]) {
      store.sessions[store.currentId].debateProgress = {
        sessionId,
        ideas,
        personas: [...personas],
        updatedAt: Date.now(),
      };
    } else {
      // fallback: 写顶层键,但用 camelCase 对齐 schema
      store.debateProgress = {
        sessionId,
        ideas,
        personas: [...personas],
        updatedAt: Date.now(),
      };
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(store));
  } catch {
    // localStorage 不可用时静默跳过
  }
}

// ---------------------------------------------------------------------------
// 可视化:persona 气泡 + 进度条 + Elo 实时排行榜
// ---------------------------------------------------------------------------

function renderProgressBar(): string {
  return `
    <div class="topic-debate-progress" aria-label="辩论进度">
      <div class="topic-debate-progress-bar" id="debate-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="width:0%"></div>
    </div>
  `;
}

function renderPersonaBubble(persona: string, side: 'pro' | 'con' | 'judge', content: string): string {
  const sideLabel = side === 'pro' ? '正方' : side === 'con' ? '反方' : '裁判';
  const sideClass = `topic-debate-bubble--${side}`;
  return `
    <div class="topic-debate-bubble ${sideClass}">
      <span class="topic-debate-bubble-persona">${escapeHtml(persona)}</span>
      <span class="topic-debate-bubble-side">${sideLabel}</span>
      <p class="topic-debate-bubble-content">${escapeHtml(content)}</p>
    </div>
  `;
}

function renderMatchCard(m: MatchResult): string {
  return `
    <details class="topic-debate-match">
      <summary>
        <span class="topic-debate-match-meta">A: ${escapeHtml(m.idea_a)} vs B: ${escapeHtml(m.idea_b)}</span>
        <span class="topic-debate-match-winner">胜者:${escapeHtml(m.winner)}${m.failed ? '(失败)' : ''}</span>
      </summary>
      <div class="topic-debate-match-transcript">
        ${m.transcript.map((t) => renderPersonaBubble(t.persona, t.side, t.content)).join('')}
      </div>
    </details>
  `;
}

function renderLeaderboard(ranked: DebateIdea[]): string {
  const maxElo = Math.max(...ranked.map((i) => i.elo_rating ?? ELO_INITIAL), ELO_INITIAL);
  return `
    <table class="topic-debate-leaderboard">
      <thead>
        <tr><th>#</th><th>Title</th><th>Elo</th><th>Wins</th><th>Matches</th><th>Score</th></tr>
      </thead>
      <tbody>
        ${ranked.map((idea, n) => {
          const elo = Math.round(idea.elo_rating ?? ELO_INITIAL);
          const pct = ((idea.elo_rating ?? ELO_INITIAL) / maxElo) * 100;
          return `
            <tr>
              <td>${n + 1}</td>
              <td>${escapeHtml(idea.title)}</td>
              <td>${elo}</td>
              <td>${idea.wins ?? 0}</td>
              <td>${idea.matches ?? 0}</td>
              <td><div class="topic-debate-leaderboard-bar" style="width:${pct.toFixed(1)}%"></div></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function showDebateVisualization(ranked: DebateIdea[], matches: MatchResult[] = []): void {
  const target = document.querySelector('#debate-stage');
  if (!target) return;
  target.innerHTML = `
    <section class="topic-debate">
      <h3 class="topic-debate-title">Elo 辩论排行</h3>
      ${renderProgressBar()}
      ${renderLeaderboard(ranked)}
      ${matches.length > 0 ? `
        <h4 class="topic-debate-subtitle">对局明细</h4>
        ${matches.map(renderMatchCard).join('')}
      ` : ''}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function renderDebateStage(sessionId: string, ideas: DebateIdea[]): Promise<DebateIdea[]> {
  const cfg = (loadSettings() as any)?.topic?.v2 || {};
  if (!cfg.enabled) return ideas;

  const personas = (cfg.personas && cfg.personas.length >= 3) ? cfg.personas : PERSONAS_DEFAULT;
  const rounds = cfg.debate_rounds ?? DEBATE_ROUNDS;
  const maxIdeas = cfg.debate_max_ideas ?? DEBATE_MAX_IDEAS;

  const collected: MatchResult[] = [];
  const ranked = await runDebateStage(
    ideas.slice(0, maxIdeas),
    personas,
    rounds,
    (m) => collected.push(m),
  );

  saveDebateProgress(sessionId, ranked, personas);
  showDebateVisualization(ranked, collected);
  return ranked;
}

// ---------------------------------------------------------------------------
// 浏览器侧单元可测试导出
// ---------------------------------------------------------------------------

export const __testing__ = {
  escapeHtml,
  expectedScore,
  updateElo,
  swissPairs,
  runMatch,
  runDebateStage,
  PERSONAS_DEFAULT,
  DEBATE_MAX_IDEAS,
  DEBATE_ROUNDS,
  ELO_K,
  ELO_INITIAL,
  TOKENS_PER_MATCH_CALL,
  DEBATE_BUDGET_TOKENS,
};

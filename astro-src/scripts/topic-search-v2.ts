import { resolveRoute } from '../lib/llm';
import { loadSettings } from './settings';
import { injectIntoPromptSync } from './prompt-pack';

const PERSONAS_DEFAULT = ['方法论者', '工程师', '怀疑论者'];
const DEBATE_MAX_IDEAS = 8;
const DEBATE_ROUNDS = 3;
const SESSION_KEY = 'dpr_topic_session_v1';

type Idea = Record<string, any>;

async function judge(a: Idea, b: Idea, persona: string): Promise<'a' | 'b' | 'tie'> {
  const cfg: any = loadSettings();
  const route: any = resolveRoute('topic.debate');
  const prompt = injectIntoPromptSync('你是中立裁判。只返回 JSON winner。', 'topic.debate', cfg);
  const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${route.apiKey}` },
    body: JSON.stringify({ model: route.model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: `${persona}\nA:${JSON.stringify(a)}\nB:${JSON.stringify(b)}` }], max_tokens: 100 }),
  });
  const data = await response.json();
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
  return parsed.winner === 'a' || parsed.winner === 'b' ? parsed.winner : 'tie';
}

function elo(a: number, b: number, winner: string): [number, number] {
  const ea = 1 / (1 + 10 ** ((b - a) / 400));
  if (winner === 'a') return [a + 32 * (1 - ea), b - 32 * (1 - ea)];
  if (winner === 'b') return [a - 32 * ea, b + 32 * ea];
  return [a, b];
}

async function runDebateStage(ideas: Idea[], personas: string[], rounds: number): Promise<Idea[]> {
  const ranked = ideas.map((i) => ({ ...i, elo_rating: i.elo_rating ?? 1200 }));
  for (let i = 0; i + 1 < ranked.length; i += 2) {
    for (let round = 0; round < rounds; round++) {
      for (const persona of personas) {
        try {
          const winner = await judge(ranked[i], ranked[i + 1], persona);
          [ranked[i].elo_rating, ranked[i + 1].elo_rating] = elo(ranked[i].elo_rating, ranked[i + 1].elo_rating, winner);
        } catch (error) {
          (ranked[i].debate_errors ??= []).push({ round, persona, error: String(error) });
        }
      }
    }
  }
  return ranked.sort((a, b) => b.elo_rating - a.elo_rating);
}

export async function renderDebateStage(sessionId: string, ideas: Idea[]): Promise<Idea[]> {
  const cfg: any = (loadSettings() as any)?.topic?.v2 || {};
  if (!cfg.enabled) return ideas;
  const ranked = await runDebateStage(ideas.slice(0, cfg.debate_max_ideas ?? DEBATE_MAX_IDEAS), cfg.personas ?? PERSONAS_DEFAULT, cfg.debate_rounds ?? DEBATE_ROUNDS);
  saveDebateProgress(sessionId, ranked);
  showDebateVisualization(ranked);
  return ranked;
}

export function showDebateVisualization(ranked: Idea[]): void {
  const target = document.querySelector('#debate-stage') || document.querySelector('#status-bar');
  if (target) target.innerHTML = `<h3>Elo 辩论排行</h3>${ranked.map((i, n) => `<div>${n + 1}. ${i.title || i.id} — ${Math.round(i.elo_rating)}</div>`).join('')}`;
}

export function saveDebateProgress(sessionId: string, ranked: Idea[]): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data.debate_progress = { sessionId, ranked, updatedAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch { /* storage is optional */ }
}

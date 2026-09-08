#!/usr/bin/env node
/**
 * agents-run.mjs — Multi-agent research loop CLI runner.
 *
 * 照搬 topic-v2-run.mjs 形态:纯 ESM, 0 npm 依赖, fetch-based LLM 调用。
 * 串联 Designer → Feedback → Gate → Modifier,产出 round_<NNN>.json 落
 * archive/<session_id>/rounds/。
 *
 * 用法:
 *   # Dry-run: 无 LLM key 也跑通(stub LLM caller)
 *   node astro-src/scripts/agents-run.mjs --all --dry-run --max-rounds 1
 *
 *   # 真跑(需 LLM env)
 *   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... \
 *     node astro-src/scripts/agents-run.mjs --project my-proj --rounds 3
 *
 *   # 只生成 summary(基于已有 JSONs, 不调 LLM)
 *   node astro-src/scripts/agents-run.mjs --project my-proj --digest-only
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Mirror imports(单一真相源 = agents/*.ts; 这里调 .mjs 镜像避免 TS 工具链)
// ---------------------------------------------------------------------------

import {
  decideProposal,
  gateProposals,
  partitionByDecision,
  applySafetyOverride,
  GATE_THRESHOLDS,
} from '../lib/agents/gate.mjs';

import { makeRoundRecord } from '../lib/agents/types.mjs';

// ---------------------------------------------------------------------------
// CLI 参数解析
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--digest-only') out.digestOnly = true;
    else if (a === '--session' || a === '--project') out.project = argv[++i];
    else if (a === '--rounds' || a === '--max-rounds') out.maxRounds = Number(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--preset') out.preset = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}

if (args.help) {
  console.log(`Usage: node agents-run.mjs [options]
  --all              Iterate all sessions under archive/
  --session ID       Single session id (= --project)
  --project ID       Same as --session
  --rounds N         Max rounds to run (default 3)
  --limit N          Cap sessions in --all mode (default 5)
  --dry-run          Use stub LLM caller; no external calls
  --digest-only      Skip round generation; only emit digest
  --preset NAME      conservative | balanced | aggressive
  --help             Show this help`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// LLM caller(OpenAI-compatible chat completions via fetch)
// ---------------------------------------------------------------------------

function makeLLMCaller(opts) {
  const baseUrl = opts.baseUrl ?? process.env.LLM_BASE_URL ?? '';
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY ?? '';
  const model = opts.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';

  if (!baseUrl || !apiKey) {
    return {
      async callLLM({ system, user, model: m }) {
        return stubLLMResponse(system, user, m ?? model);
      },
    };
  }

  return {
    async callLLM({ system, user, model: m, temperature = 0.7, max_tokens = 1024 }) {
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: m ?? model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature,
          max_tokens,
        }),
      });
      if (!r.ok) {
        throw new Error(`LLM ${r.status}: ${await r.text()}`);
      }
      const data = await r.json();
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

function stubLLMResponse(system, user, model) {
  // Designer stub: 1 条占位 proposal
  if (system.includes('资深科研合作者')) {
    return JSON.stringify([
      {
        type: 'literature_review',
        title: '【stub】 整理已有候选论文到 literature review',
        rationale: '(LLM 未配置; stub proposal 让 round 跑通骨架)',
        evidence: { paperIds: [], quotes: [] },
        target: { draftTitle: 'stub review' },
        estimated_effort: 'low',
        risk: 'dry-run',
      },
    ]);
  }
  // Feedback stub: 3 persona 各打 5 分
  if (system.includes('方法论者') || system.includes('工程师') || system.includes('怀疑论者')) {
    return JSON.stringify({ score: 5, critique: '(stub feedback)' });
  }
  return '(stub)';
}

// ---------------------------------------------------------------------------
// Round generation
// ---------------------------------------------------------------------------

async function runOneRoundCLI(roundN, input, caller, preset, dryRun) {
  const started = Date.now();

  // 1. Designer — 走真 LLM 或 stub
  const proposals = await designerCLI(input, caller);
  const tokens = proposals.length * 250;

  // 2. Feedback — 走真 LLM 或 stub
  const critiques = await feedbackCLI(proposals, caller);
  const fbTokens = proposals.length * 600;

  // 3. Gate
  const verdicts = gateProposals(proposals, critiques, preset)
    .map((v) => {
      const p = proposals.find((x) => x.id === v.proposal_id);
      return p ? applySafetyOverride(v, p) : v;
    });
  const buckets = partitionByDecision(verdicts);

  // 4. Modifier — dry_run 时只记录 would_call
  const { applied, skipped } = await modifierCLI(verdicts, proposals, input, dryRun);

  const rec = makeRoundRecord({
    round: roundN,
    project_id: input.project.id,
    session_id: input.session_id ?? input.project.id,
    dry_run: dryRun,
  });
  rec.started_at = started;
  rec.finished_at = Date.now();
  rec.designer.proposals = proposals;
  rec.designer.prompt_summary = '(CLI stub summary)';
  rec.designer.model = process.env.LLM_MODEL ?? 'stub';
  rec.feedback.critiques = critiques;
  rec.feedback.judge_calls = proposals.length * 3;
  rec.feedback.total_tokens = tokens + fbTokens;
  rec.gate = { verdicts, ...buckets };
  rec.modifier = { applied, skipped };

  return rec;
}

// ---------------------------------------------------------------------------
// Designer CLI(简化版,real LLM 或 stub)
// ---------------------------------------------------------------------------

async function designerCLI(input, caller) {
  const userPrompt = buildDesignerUserPrompt(input);
  const system = DESIGNER_SYSTEM_PROMPT;
  let raw = '';
  try {
    raw = await caller.callLLM({ system, user: userPrompt, temperature: 0.7, max_tokens: 2048 });
  } catch (err) {
    console.warn('[designer] LLM failed, using stub:', err.message);
    raw = stubLLMResponse(system, userPrompt, 'stub');
  }
  return parseProposalsCLI(raw, input.round ?? 1);
}

const DESIGNER_SYSTEM_PROMPT = `你是资深科研合作者,根据 project 上下文 + 候选论文 + 用户目标,提出 3-8 条 research action proposals。
输出 JSON 数组,字段: type/title/rationale/target/evidence/estimated_effort/risk。
type ∈ {add_paper, create_draft, experiment_plan, literature_review, rebuttal}。
不要 markdown fence,直接 JSON。`;

function buildDesignerUserPrompt(input) {
  const lines = [
    `Project: ${input.project.name ?? '(unnamed)'} (${input.project.id})`,
    `Statement: ${input.project.statement ?? '(none)'}`,
  ];
  if (input.candidates?.length) {
    lines.push('Candidates:');
    for (const c of input.candidates.slice(0, 30)) {
      lines.push(`- ${c.arxivId}: ${c.title}${c.tldr ? ' — ' + c.tldr : ''}`);
    }
  }
  if (input.user_goal) lines.push(`Goal: ${input.user_goal}`);
  return lines.join('\n');
}

function parseProposalsCLI(raw, round) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) { try { parsed = JSON.parse(m[1]); } catch { /* */ } }
  }
  if (!parsed) {
    const i = raw.indexOf('[');
    const j = raw.lastIndexOf(']');
    if (i >= 0 && j > i) { try { parsed = JSON.parse(raw.slice(i, j + 1)); } catch { /* */ } }
  }
  if (!parsed) return [{
    id: `p_${round}_fallback`,
    round,
    type: 'literature_review',
    title: '(parse failed)',
    rationale: raw.slice(0, 200),
    evidence: { paperIds: [], quotes: [] },
    target: {},
    estimated_effort: 'low',
    risk: 'parse-failed',
    created_at: Date.now(),
  }];

  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((x) => x && typeof x === 'object')
    .map((x, idx) => ({
      id: `p_${round}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      round,
      type: x.type ?? 'add_paper',
      title: String(x.title ?? '(untitled)').slice(0, 120),
      rationale: String(x.rationale ?? '').slice(0, 500),
      evidence: {
        paperIds: Array.isArray(x.evidence?.paperIds) ? x.evidence.paperIds.map(String).slice(0, 20) : [],
        quotes: Array.isArray(x.evidence?.quotes) ? x.evidence.quotes.map(String).slice(0, 5) : [],
      },
      target: x.target ?? {},
      estimated_effort: ['low', 'medium', 'high'].includes(x.estimated_effort) ? x.estimated_effort : 'medium',
      risk: String(x.risk ?? '').slice(0, 200),
      created_at: Date.now(),
    }));
}

// ---------------------------------------------------------------------------
// Feedback CLI(简化版)
// ---------------------------------------------------------------------------

async function feedbackCLI(proposals, caller) {
  if (proposals.length === 0) return [];
  const personas = ['methodologist', 'engineer', 'skeptic'];
  const personaPrompts = {
    methodologist: '你是方法论者,关注实验设计 / 评估指标 / 理论边界。输出 {score: 0-10, critique: "1-2段"}。',
    engineer: '你是工程师,关注实现成本 / 复用度 / 风险。输出 {score: 0-10, critique: "1-2段"}。',
    skeptic: '你是怀疑论者,关注 novelty / 假设 / redundant。输出 {score: 0-10, critique: "1-2段"}。',
  };

  const critiques = [];
  for (const p of proposals) {
    const scores = { methodologist: 5, engineer: 5, skeptic: 5 };
    const attributions = { methodologist: '', engineer: '', skeptic: '' };
    for (const persona of personas) {
      try {
        const raw = await caller.callLLM({
          system: personaPrompts[persona],
          user: `Proposal: ${p.title}\nRationale: ${p.rationale}\nPapers: ${p.evidence.paperIds.join(', ')}`,
          temperature: 0.4,
          max_tokens: 300,
        });
        const parsed = parseScoreCritique(raw);
        scores[persona] = clampScore(parsed.score ?? 5);
        attributions[persona] = parsed.critique ?? '(empty)';
      } catch (err) {
        attributions[persona] = `(LLM failed: ${err.message})`;
      }
    }
    const total = (scores.methodologist + scores.engineer + scores.skeptic) / 3;
    critiques.push({
      proposal_id: p.id,
      scores,
      total,
      critique: `${p.title} → ${total.toFixed(1)} (m${scores.methodologist}/e${scores.engineer}/s${scores.skeptic})`,
      elo: 1200,
      matches: 0,
      wins: 0,
      persona_attribution: attributions,
    });
  }
  return critiques;
}

function parseScoreCritique(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  return {
    score: typeof parsed.score === 'number' ? parsed.score : Number(parsed.score),
    critique: typeof parsed.critique === 'string' ? parsed.critique : undefined,
  };
}

function clampScore(s) {
  if (!Number.isFinite(s)) return 5;
  return Math.max(0, Math.min(10, Math.round(s)));
}

// ---------------------------------------------------------------------------
// Modifier CLI(stub-only,不真写 upstream localStorage)
// ---------------------------------------------------------------------------

async function modifierCLI(verdicts, proposals, input, dryRun) {
  const applied = [];
  const skipped = [];
  for (const v of verdicts) {
    const p = proposals.find((x) => x.id === v.proposal_id);
    if (!p) {
      skipped.push({ proposal_id: v.proposal_id, reason: 'proposal not found' });
      continue;
    }
    if (v.decision === 'promoted' || v.decision === 'candidate') {
      applied.push({
        id: `m_${Date.now()}_${applied.length}`,
        kind: 'archive_round_summary',
        proposal_id: p.id,
        payload: {
          would_call: p.type,
          title: p.title,
          evidence: p.evidence.paperIds,
          decision: v.decision,
          dry_run: dryRun,
        },
        applied_at: Date.now(),
      });
    } else {
      skipped.push({ proposal_id: p.id, reason: `gate=${v.decision}; ${v.reasons.join('; ')}` });
    }
  }
  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// 落盘 + digest
// ---------------------------------------------------------------------------

async function writeRound(record, sessionId) {
  const dir = join('archive', sessionId, 'rounds');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `round_${String(record.round).padStart(3, '0')}.json`);
  await writeFile(file, JSON.stringify(record, null, 2));
  return file;
}

async function listExistingRounds(sessionId) {
  const dir = join('archive', sessionId, 'rounds');
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((f) => /^round_\d+\.json$/.test(f))
    .map((f) => join(dir, f))
    .sort();
}

async function buildDigest(sessionId) {
  const files = await listExistingRounds(sessionId);
  const records = [];
  for (const f of files) {
    const raw = await readFile(f, 'utf8');
    records.push(JSON.parse(raw));
  }
  const lines = [`# Digest: ${sessionId}`, '', `- Rounds: ${records.length}`, ''];
  for (const rec of records) {
    lines.push(`## Round ${rec.round} (${new Date(rec.started_at).toISOString()})`);
    lines.push(`- Designer: ${rec.designer.proposals.length} proposals`);
    lines.push(`- Feedback: ${rec.feedback.critiques.length} critiques, ${rec.feedback.total_tokens} tok`);
    lines.push(`- Gate: promoted=${rec.gate.promoted.length} candidate=${rec.gate.candidate.length} sketch=${rec.gate.sketch.length} rejected=${rec.gate.rejected.length}`);
    lines.push(`- Modifier: applied=${rec.modifier.applied.length} skipped=${rec.modifier.skipped.length}`);
    if (rec.modifier.applied.length) {
      lines.push(`  - Applied:`);
      for (const a of rec.modifier.applied) {
        lines.push(`    - [${a.kind}] ${a.payload.would_call ?? a.proposal_id}`);
      }
    }
    lines.push('');
  }
  const digestFile = join('archive', sessionId, `digest_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`);
  await writeFile(digestFile, lines.join('\n'));
  return digestFile;
}

// ---------------------------------------------------------------------------
// Session 列举
// ---------------------------------------------------------------------------

async function listSessions() {
  if (!existsSync('archive')) return [];
  const entries = await readdir('archive', { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^[a-f0-9]{8,}$/.test(e.name))
    .map((e) => e.name)
    .slice(0, args.limit ?? 5);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const preset = args.preset ?? 'balanced';
  if (!['conservative', 'balanced', 'aggressive'].includes(preset)) {
    console.error(`[error] --preset must be conservative|balanced|aggressive, got: ${preset}`);
    process.exit(2);
  }

  const caller = makeLLMCaller({});
  const dryRun = !!args.dryRun;

  // 模式 1: --digest-only
  if (args.digestOnly) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) { console.error('--digest-only requires --session ID'); process.exit(2); }
    const file = await buildDigest(sessionId);
    console.log(`[digest] wrote ${file}`);
    return;
  }

  // 模式 2: --all (遍历所有 sessions)
  if (args.all) {
    const sessions = await listSessions();
    const maxRounds = args.maxRounds ?? 1;
    for (const sid of sessions) {
      await runOneSession(sid, caller, { maxRounds, dryRun, preset });
    }
    return;
  }

  // 模式 3: --session
  const sessionId = args.project ?? args.session;
  if (!sessionId) {
    console.error('[error] need --session ID or --all');
    process.exit(2);
  }
  await runOneSession(sessionId, caller, {
    maxRounds: args.maxRounds ?? 3,
    dryRun,
    preset,
  });
}

async function runOneSession(sessionId, caller, opts) {
  console.log(`[session ${sessionId}] starting (maxRounds=${opts.maxRounds}, dryRun=${opts.dryRun}, preset=${opts.preset})`);
  const existing = await listExistingRounds(sessionId);
  const startRound = existing.length + 1;

  const input = {
    project: { id: sessionId, name: sessionId, statement: '(auto)' },
    candidates: [],
    user_goal: '(CLI auto-run)',
    round: startRound,
    session_id: sessionId,
  };

  for (let i = 0; i < opts.maxRounds; i++) {
    const roundN = startRound + i;
    input.round = roundN;
    const rec = await runOneRoundCLI(roundN, input, caller, opts.preset, opts.dryRun);
    const file = await writeRound(rec, sessionId);
    console.log(`  [round ${roundN}] → ${file}  (proposals=${rec.designer.proposals.length}, applied=${rec.modifier.applied.length})`);

    if (rec.modifier.applied.length === 0 && i >= 1) {
      console.log(`  [empty] 0 applied for 2 consecutive rounds; stopping early`);
      break;
    }
  }

  const digest = await buildDigest(sessionId);
  console.log(`[session ${sessionId}] digest → ${digest}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
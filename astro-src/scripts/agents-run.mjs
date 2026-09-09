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
import { createHash } from 'node:crypto';
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
    else if (a === '--resume') out.resume = true;
    else if (a === '--no-candidates') out.noCandidates = true;
    else if (a === '--status') out.status = true;
    else if (a === '--json') out.json = true;
    else if (a === '--last') out.last = Number(argv[++i]);
    else if (a === '--new-session') out.newSession = argv[++i];
    else if (a === '--no-run') out.noRun = true;
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
  --resume           Load previous round JSONs into Designer's context
                     (so it doesn't repeat the same proposals)
  --no-candidates    Skip auto-loading papers from archive/<session>/recommend/
  --preset NAME      conservative | balanced | aggressive
  --status           Inspect mode: print session summary to stdout
                     (use with --session ID; no LLM, no writes)
  --json             With --status, emit machine-readable JSON instead of text
  --last N           With --status, limit recent-rounds + top-elo to last N (default 5)
  --new-session GOAL Bootstrap mode: create archive/<sid>/{meta,rounds/} from GOAL,
                     generate 8-char sid, print sid to stdout. Combine with
                     --rounds N to immediately run N rounds on the new session.
                     Use --no-run to skip the round run.
  --no-run           With --new-session, only create the dir + meta (skip rounds)
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
  const stubCandidates = opts.stubCandidates ?? [];

  if (!baseUrl || !apiKey) {
    return {
      async callLLM({ system, user, model: m }) {
        return stubLLMResponse(system, user, m ?? model, stubCandidates);
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

function stubLLMResponse(system, user, model, candidates = []) {
  // Designer stub: 1 条占位 proposal(若有 candidates,把前 5 个 paperId 塞进 evidence,
  // 让用户看到 candidates 真的接入了)
  if (system.includes('资深科研合作者')) {
    const seedIds = candidates.slice(0, 5).map((c) => c.arxivId);
    return JSON.stringify([
      {
        type: 'literature_review',
        title: '【stub】 整理已有候选论文到 literature review',
        rationale: candidates.length
          ? `(LLM 未配置; stub 用 ${candidates.length} 个候选论文作为 evidence 演示 integration)`
          : '(LLM 未配置; stub proposal 让 round 跑通骨架)',
        evidence: { paperIds: seedIds, quotes: [] },
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
  // 检测是否在 stub 模式(无 LLM key):直接走 candidate-aware stub,
  // 避免 LLM caller 没有传 candidates 的上下文
  const isStub = !process.env.LLM_BASE_URL || !process.env.LLM_API_KEY;
  if (isStub) {
    return parseProposalsCLI(
      stubLLMResponse(system, userPrompt, 'stub', input.candidates ?? []),
      input.round ?? 1,
    );
  }
  let raw = '';
  try {
    raw = await caller.callLLM({ system, user: userPrompt, temperature: 0.7, max_tokens: 2048 });
  } catch (err) {
    console.warn('[designer] LLM failed, using stub:', err.message);
    raw = stubLLMResponse(system, userPrompt, 'stub', input.candidates ?? []);
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
  // 上一轮已做的事 — 让 Designer 避免重复(--resume 模式)
  if (input.previous_rounds?.length) {
    const recent = input.previous_rounds.slice(-5);
    lines.push(`\nPrevious rounds (${input.previous_rounds.length} total, last ${recent.length} shown):`);
    for (const prev of recent) {
      const parts = [`Round ${prev.round}`];
      if (prev.promoted_titles?.length) parts.push(`promoted: ${prev.promoted_titles.slice(0, 5).join(' | ')}`);
      if (prev.applied_titles?.length) parts.push(`applied: ${prev.applied_titles.slice(0, 5).join(' | ')}`);
      if (prev.rejected_titles?.length) parts.push(`rejected: ${prev.rejected_titles.slice(0, 3).join(' | ')}`);
      lines.push(`- ${parts.join(' · ')}`);
    }
    lines.push(`→ Do NOT repeat promoted/applied proposals. Suggest new angles or follow-ups.`);
  }
  if (input.user_goal) lines.push(`Goal: ${input.user_goal}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Previous-rounds 加载与摘要(--resume 模式)
// ---------------------------------------------------------------------------

async function loadPreviousRounds(sessionId) {
  const files = await listExistingRounds(sessionId);
  const out = [];
  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf8');
      out.push(summarizeRec(JSON.parse(raw)));
    } catch (err) {
      console.warn(`[resume] skip ${f}: ${err.message}`);
    }
  }
  return out;
}

function summarizeRec(rec) {
  const byId = new Map();
  for (const p of rec.designer.proposals ?? []) byId.set(p.id, p);
  const promoted = [];
  const rejected = [];
  for (const v of rec.gate?.verdicts ?? []) {
    const p = byId.get(v.proposal_id);
    if (!p) continue;
    if (v.decision === 'promoted') promoted.push(p.title);
    else if (v.decision === 'rejected') rejected.push(p.title);
  }
  const applied = (rec.modifier?.applied ?? [])
    .map((a) => a.payload?.title ?? byId.get(a.proposal_id)?.title)
    .filter((t) => typeof t === 'string' && t.length > 0);
  return {
    round: rec.round,
    promoted_titles: promoted,
    applied_titles: applied,
    rejected_titles: rejected,
  };
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

/**
 * formatDraftFrontmatter(proposal, ctx) — 写 deliverable .md 顶部的 YAML frontmatter。
 * 纯函数;create_draft / literature_review 共用。
 */
function formatDraftFrontmatter(proposal, ctx = {}) {
  const titleEsc = String(proposal.title ?? '').replace(/"/g, '\\"');
  const paperIds = proposal.evidence?.paperIds ?? [];
  const lines = [
    '---',
    `title: "${titleEsc}"`,
    `type: ${proposal.type}`,
    `decision: ${ctx.decision ?? 'candidate'}`,
    `session_id: "${ctx.session_id ?? 'unknown'}"`,
    `round: ${ctx.round ?? '?'}`,
    `created_at: "${ctx.created_at ?? new Date().toISOString()}"`,
    `dry_run: ${ctx.dryRun ? 'true' : 'false'}`,
    `estimated_effort: ${proposal.estimated_effort ?? 'medium'}`,
    `related_papers: [${paperIds.map((p) => `"${String(p).replace(/"/g, '\\"')}"`).join(', ')}]`,
    `tags: [${(proposal.tags ?? []).map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(', ')}]`,
    '---',
  ];
  return lines.join('\n');
}

/**
 * formatDraftMarkdown(proposal, ctx) — create_draft 类型的 markdown 草稿。
 * 纯函数;dry-run 时输出"占位符骨架 + ⚠️ DRY-RUN"提示,真实 LLM 跑时可注入 ctx.body 覆盖。
 */
export function formatDraftMarkdown(proposal, ctx = {}) {
  const fm = formatDraftFrontmatter(proposal, ctx);
  const paperIds = proposal.evidence?.paperIds ?? [];
  const body = ctx.body ?? null;
  const sections = [
    fm,
    '',
    `# ${proposal.title ?? '(untitled draft)'}`,
    '',
    `> Round ${ctx.round ?? '?'} · ${ctx.decision ?? 'candidate'} · session \`${ctx.session_id ?? 'unknown'}\``,
    '',
    '## 动机 / Rationale',
    proposal.rationale || '_(未提供)_',
    '',
    '## 证据 / 相关论文',
    paperIds.length ? paperIds.map((id) => `- ${id}`).join('\n') : '- (无引用论文)',
    '',
    '## 风险',
    proposal.risk || '_(未声明)_',
    '',
    '## 预估投入',
    proposal.estimated_effort || 'medium',
    '',
    '## 草稿正文',
    '',
    body ?? (
      ctx.dryRun
        ? '> ⚠️ DRY-RUN 占位符:配置 LLM_BASE_URL + LLM_API_KEY 后重跑,Designer 会用 LLM 生成正文覆盖此段。'
        : '> 在此区域直接编辑草稿;完成后回 /agents/ 标记 promoted。'
    ),
    '',
    '## 下一步',
    ctx.dryRun
      ? '- [ ] 配置 LLM key 重跑 `--rounds 1` 让 Designer 生成真实正文'
      : '- [ ] 编辑正文 → 回 /agents/ 标记 promoted → 进入下一 round',
    '',
  ];
  return sections.join('\n');
}

/**
 * formatReviewMarkdown(proposal, ctx) — literature_review 类型的 markdown 综述。
 * 纯函数;结构:摘要 / 论文清单 / 主题分类 / 关键 gap / 推荐阅读顺序。
 */
export function formatReviewMarkdown(proposal, ctx = {}) {
  const fm = formatDraftFrontmatter(proposal, ctx);
  const paperIds = proposal.evidence?.paperIds ?? [];
  const body = ctx.body ?? null;
  const sections = [
    fm,
    '',
    `# 📚 ${proposal.title ?? '(untitled review)'}`,
    '',
    `> Round ${ctx.round ?? '?'} · ${ctx.decision ?? 'candidate'} · session \`${ctx.session_id ?? 'unknown'}\``,
    '',
    '## 摘要',
    proposal.rationale || '_(未提供)_',
    '',
    '## 引用论文清单',
    paperIds.length ? paperIds.map((id) => `- ${id}`).join('\n') : '- (无)',
    '',
    '## 主题分类',
    body?.themes ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下自动聚类。'
        : '> 由 LLM 自动生成主题聚类(本轮 stub 模式留空)。'
    ),
    '',
    '## 关键 Gap / 待研究问题',
    body?.gaps ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下从 critiques 综合。'
        : '> 由 Feedback 3 persona 综合生成(本轮 stub 模式留空)。'
    ),
    '',
    '## 推荐阅读顺序',
    body?.reading_order ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符。'
        : '> 1. 先读 survey → 2. 跳到最新 baseline → 3. 沿 timeline 补全关键 gap。'
    ),
    '',
    '## 风险',
    proposal.risk || '_(未声明)_',
    '',
    '---',
    '',
    '## 下一步',
    ctx.dryRun
      ? '- [ ] 配置 LLM key 让 Designer 用真 LLM 生成 themes/gaps/reading_order'
      : '- [ ] 审阅 → 编辑 → 回 /agents/ 标记 promoted',
    '',
  ];
  return sections.join('\n');
}

/**
 * writeDeliverable(proposal, ctx) — 把 proposal 写成真 .md 文件。
 * 路径:archive/<sid>/{drafts,reviews}/<type>_<round>_<idx>.md
 * 幂等:文件已存在则不覆盖,返回 skipped=true。
 * 返回:{ written: bool, path: string|null, kind: 'draft'|'review'|null }
 */
export async function writeDeliverable(proposal, ctx = {}) {
  const sid = ctx.session_id;
  if (!sid) return { written: false, path: null, kind: null, reason: 'missing session_id' };
  let subdir = null;
  let formatter = null;
  if (proposal.type === 'create_draft') { subdir = 'drafts'; formatter = formatDraftMarkdown; }
  else if (proposal.type === 'literature_review') { subdir = 'reviews'; formatter = formatReviewMarkdown; }
  else return { written: false, path: null, kind: null, reason: `unsupported type ${proposal.type}` };

  const round = ctx.round ?? 0;
  const idx = ctx.idx ?? 0;
  const dir = join('archive', sid, subdir);
  const file = join(dir, `${subdir === 'drafts' ? 'draft' : 'review'}_r${String(round).padStart(3, '0')}_${idx}.md`);
  await mkdir(dir, { recursive: true });
  // 幂等:文件已存在不覆盖
  if (existsSync(file)) {
    return { written: false, path: file, kind: subdir === 'drafts' ? 'draft' : 'review', skipped: true };
  }
  const content = formatter(proposal, ctx);
  await writeFile(file, content);
  return { written: true, path: file, kind: subdir === 'drafts' ? 'draft' : 'review', skipped: false };
}

async function modifierCLI(verdicts, proposals, input, dryRun) {
  const applied = [];
  const skipped = [];
  // 记录每个 type 在本 round 已写过的 idx(同 round 多 proposal → 不同 idx)
  const writeIdxByType = new Map();
  for (const v of verdicts) {
    const p = proposals.find((x) => x.id === v.proposal_id);
    if (!p) {
      skipped.push({ proposal_id: v.proposal_id, reason: 'proposal not found' });
      continue;
    }
    if (v.decision === 'promoted' || v.decision === 'candidate') {
      // 真写 deliverable:create_draft / literature_review → archive/<sid>/{drafts,reviews}/*.md
      // add_paper / experiment_plan / rebuttal → 暂时仍走 archive_round_summary
      // (等后续 iter 补 experiment_plan / rebuttal 的 writer)
      let deliverableResult = null;
      if (p.type === 'create_draft' || p.type === 'literature_review') {
        const idx = writeIdxByType.get(p.type) ?? 0;
        writeIdxByType.set(p.type, idx + 1);
        try {
          deliverableResult = await writeDeliverable(p, {
            session_id: input.session_id ?? input.project?.id,
            round: input.round,
            idx,
            decision: v.decision,
            dryRun,
          });
        } catch (err) {
          deliverableResult = { written: false, error: err.message };
        }
      }
      applied.push({
        id: `m_${Date.now()}_${applied.length}`,
        kind: deliverableResult?.written
          ? (deliverableResult.kind === 'draft' ? 'write_draft_md' : 'write_review_md')
          : (deliverableResult?.skipped
              ? 'deliverable_already_exists'
              : 'archive_round_summary'),
        proposal_id: p.id,
        payload: {
          would_call: p.type,
          title: p.title,
          evidence: p.evidence.paperIds,
          decision: v.decision,
          dry_run: dryRun,
          ...(deliverableResult ?? {}),
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
// 从 archive/<session>/recommend/arxiv_papers_*.json 读 candidates
// ---------------------------------------------------------------------------

export async function loadCandidatesFromArchive(sessionId, maxPapers = 30) {
  const dir = join('archive', sessionId, 'recommend');
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const paperFiles = files.filter((f) => /^arxiv_papers_.*\.json$/.test(f));
  if (!paperFiles.length) return [];
  paperFiles.sort();
  const latest = paperFiles[paperFiles.length - 1];
  let raw;
  try {
    raw = JSON.parse(await readFile(join(dir, latest), 'utf8'));
  } catch (err) {
    console.warn(`[candidates] failed to read ${latest}: ${err.message}`);
    return [];
  }
  const items = [...(raw.deep_dive ?? []), ...(raw.quick_skim ?? [])];
  return items
    .slice(0, maxPapers)
    .map((p) => ({
      arxivId: p.id,
      title: p.title,
      tldr: p.llm_tldr_cn ?? p.llm_tldr_en ?? p.llm_tldr ?? undefined,
    }))
    .filter((c) => c.arxivId && c.title);
}

// ---------------------------------------------------------------------------
// --status 模式:从已有 round JSONs 生成 session 摘要(纯函数,无 LLM)
// ---------------------------------------------------------------------------

/**
 * buildStatusReport(records, opts) — 把 RoundRecord[] 压缩成一个 status report。
 * 与 CLI / 文件 IO 解耦,便于 tests/ 直接单测。
 *
 * 输入:records = RoundRecord[](已经 parse 好的 JSON 对象数组)
 * 输出:{
 *   rounds: number,
 *   summary: { firstActivity, lastActivity, avgScore, proposalTypeMix,
 *              gateHistogram, totalProposals, totalApplied, totalSkipped, applyRate } | null,
 *   recent: [{ round, proposals, avgScore, applied, skipped, gate, duration_ms, started_at }],
 *   topElo: [{ round, proposal_id, title, type, total, elo }],
 *   message?: string  // 空 records 时返回
 * }
 */
export function buildStatusReport(records, opts = {}) {
  const lastN = opts.lastN ?? 5;
  if (!Array.isArray(records) || records.length === 0) {
    return { rounds: 0, summary: null, recent: [], topElo: [], message: 'no rounds yet' };
  }

  const sorted = [...records].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

  // avg score(NaN-safe:把所有 non-number total 兜底为 0)
  const allScores = sorted.flatMap((r) => (r.feedback?.critiques ?? []).map((c) => Number(c.total) || 0));
  const avgScore = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  // proposal type mix
  const typeMix = {};
  for (const r of sorted) {
    for (const p of r.designer?.proposals ?? []) {
      const t = p.type ?? '(unknown)';
      typeMix[t] = (typeMix[t] ?? 0) + 1;
    }
  }

  // gate histogram
  const gateHist = { promoted: 0, candidate: 0, sketch: 0, rejected: 0 };
  for (const r of sorted) {
    gateHist.promoted += r.gate?.promoted?.length ?? 0;
    gateHist.candidate += r.gate?.candidate?.length ?? 0;
    gateHist.sketch += r.gate?.sketch?.length ?? 0;
    gateHist.rejected += r.gate?.rejected?.length ?? 0;
  }

  // applied / skipped + applyRate
  let totalApplied = 0;
  let totalSkipped = 0;
  for (const r of sorted) {
    totalApplied += r.modifier?.applied?.length ?? 0;
    totalSkipped += r.modifier?.skipped?.length ?? 0;
  }
  const applyRate = totalApplied + totalSkipped > 0
    ? totalApplied / (totalApplied + totalSkipped)
    : 0;

  // top Elo(过滤初始 elo=1200 的未 judge critique,避免噪音)
  const allCritiques = [];
  for (const r of sorted) {
    const byId = new Map();
    for (const p of r.designer?.proposals ?? []) byId.set(p.id, p);
    for (const c of r.feedback?.critiques ?? []) {
      const proposal = byId.get(c.proposal_id);
      allCritiques.push({
        round: r.round,
        proposal_id: c.proposal_id,
        title: proposal?.title ?? '(?)',
        type: proposal?.type ?? '?',
        total: Number(c.total) || 0,
        elo: Number(c.elo) || 0,
        matches: Number(c.matches) || 0,
      });
    }
  }
  const topElo = allCritiques
    .filter((c) => c.matches > 0 || c.elo !== 1200)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, lastN);

  // recent rounds
  const recent = sorted.slice(-lastN).map((r) => {
    const cs = r.feedback?.critiques ?? [];
    const rAvg = cs.length ? cs.reduce((a, c) => a + (Number(c.total) || 0), 0) / cs.length : 0;
    return {
      round: r.round,
      proposals: r.designer?.proposals?.length ?? 0,
      avgScore: Math.round(rAvg * 100) / 100,
      applied: r.modifier?.applied?.length ?? 0,
      skipped: r.modifier?.skipped?.length ?? 0,
      gate: {
        promoted: r.gate?.promoted?.length ?? 0,
        candidate: r.gate?.candidate?.length ?? 0,
        sketch: r.gate?.sketch?.length ?? 0,
        rejected: r.gate?.rejected?.length ?? 0,
      },
      duration_ms: (r.finished_at ?? 0) - (r.started_at ?? 0),
      started_at: r.started_at,
    };
  });

  return {
    rounds: sorted.length,
    summary: {
      firstActivity: sorted[0]?.started_at ? new Date(sorted[0].started_at).toISOString() : null,
      lastActivity: sorted[sorted.length - 1]?.finished_at
        ? new Date(sorted[sorted.length - 1].finished_at).toISOString()
        : sorted[sorted.length - 1]?.started_at
          ? new Date(sorted[sorted.length - 1].started_at).toISOString()
          : null,
      avgScore: Math.round(avgScore * 100) / 100,
      proposalTypeMix: typeMix,
      gateHistogram: gateHist,
      totalProposals: Object.values(typeMix).reduce((a, b) => a + b, 0),
      totalApplied,
      totalSkipped,
      applyRate: Math.round(applyRate * 1000) / 1000,
    },
    recent,
    topElo,
  };
}

/**
 * formatStatusReportText(sessionId, report) — 把 buildStatusReport 输出渲染成 stdout-friendly 文本。
 * 给 --status(默认 text 模式)用;--json 走 JSON.stringify(report) + sessionId 包装。
 */
export function formatStatusReportText(sessionId, report) {
  const lines = [];
  lines.push(`📊 Session: ${sessionId}`);
  if (report.rounds === 0) {
    lines.push(`  ${report.message ?? 'no rounds yet'}`);
    return lines.join('\n');
  }
  const s = report.summary;
  lines.push(`Rounds: ${report.rounds}    First: ${s.firstActivity}    Last: ${s.lastActivity}`);
  lines.push(`Avg score: ${s.avgScore}    Apply rate: ${(s.applyRate * 100).toFixed(1)}%  (${s.totalApplied} applied / ${s.totalSkipped} skipped)`);
  lines.push('');
  lines.push('Proposal type mix:');
  const typeEntries = Object.entries(s.proposalTypeMix).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length === 0) lines.push('  (none)');
  for (const [t, n] of typeEntries) lines.push(`  ${t}: ${n}`);
  lines.push('');
  lines.push(`Gate histogram:  promoted=${s.gateHistogram.promoted}  candidate=${s.gateHistogram.candidate}  sketch=${s.gateHistogram.sketch}  rejected=${s.gateHistogram.rejected}`);
  lines.push('');
  if (report.topElo.length) {
    lines.push(`Top Elo (${report.topElo.length}):`);
    for (let i = 0; i < report.topElo.length; i++) {
      const p = report.topElo[i];
      lines.push(`  ${i + 1}. [round ${p.round}] ${p.title}  (elo=${p.elo}, score=${p.total}, type=${p.type})`);
    }
    lines.push('');
  }
  lines.push(`Recent rounds (last ${report.recent.length}):`);
  for (const r of report.recent) {
    lines.push(
      `  Round ${r.round}: ${r.proposals} proposals, avg=${r.avgScore.toFixed(1)}, applied=${r.applied}/skipped=${r.skipped}, gate(p=${r.gate.promoted}/c=${r.gate.candidate}/s=${r.gate.sketch}/r=${r.gate.rejected}), ${Math.round(r.duration_ms / 1000)}s`,
    );
  }
  return lines.join('\n');
}

/**
 * 加载 archive/<sessionId>/rounds/*.json + 跑 buildStatusReport。
 * CLI --status 模式的 IO wrapper;tests 不应该调它(只测 pure buildStatusReport)。
 */
async function loadStatusReport(sessionId, opts = {}) {
  const files = await listExistingRounds(sessionId);
  const records = [];
  let corruptCount = 0;
  for (const f of files) {
    try {
      records.push(JSON.parse(await readFile(f, 'utf8')));
    } catch (err) {
      corruptCount++;
      console.warn(`[status] skip ${f}: ${err.message}`);
    }
  }
  const report = buildStatusReport(records, opts);
  return { sessionId, corruptCount, ...report };
}

// ---------------------------------------------------------------------------
// --new-session 模式:从目标字符串生成 sid + 创建目录 + 写 meta.json
// ---------------------------------------------------------------------------

/**
 * generateSessionId(goal, opts) — 从 goal 派生 8 字符 hex session ID。
 * 算法:sha256(goal + ':' + timestamp) 取前 8 字符。
 * - 同时辰同 goal → 同 sid(幂等,CLI 重试友好)
 * - 同 goal 不同 timestamp → 不同 sid(允许同名 goal 跑多 session)
 * - sid 匹配 listSessions() 的 /^[a-f0-9]{8,}$/ 正则
 *
 * 纯函数,tests 可注入 timestamp 验证幂等性。
 */
export function generateSessionId(goal, opts = {}) {
  const ts = opts.timestamp ?? Date.now();
  const salt = opts.salt ?? '';
  const input = `${String(goal ?? '').trim()}:${ts}:${salt}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/**
 * createSession(sessionId, opts) — 创建 archive/<sessionId>/ 目录 + meta.json。
 * 幂等:目录已存在则保留,meta.json 已存在则不覆盖(返回 existing=true)。
 *
 * meta.json 字段:
 *   session_id, goal, created_at, rounds_requested, dry_run, schema_version
 *
 * 返回:{ sessionId, dir, metaPath, created: boolean, existing: boolean }
 */
export async function createSession(sessionId, opts = {}) {
  const dir = join('archive', sessionId);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'rounds'), { recursive: true });
  const metaPath = join(dir, 'meta.json');
  let existing = false;
  try {
    await readFile(metaPath, 'utf8');
    existing = true;
  } catch {
    // 不存在,继续写
  }
  let created = false;
  if (!existing) {
    const meta = {
      schema_version: 1,
      session_id: sessionId,
      goal: opts.goal ?? null,
      created_at: opts.created_at ?? Date.now(),
      rounds_requested: opts.rounds ?? null,
      dry_run: opts.dryRun ?? false,
      preset: opts.preset ?? 'balanced',
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    created = true;
  }
  return { sessionId, dir, metaPath, created, existing };
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

  // 模式 -1: --new-session (bootstrap,优先于所有其他模式)
  if (args.newSession !== undefined) {
    const goal = args.newSession;
    if (typeof goal !== 'string' || goal.trim().length === 0) {
      console.error('[error] --new-session requires a non-empty GOAL string');
      process.exit(2);
    }
    // sid 优先级:--session > 派生。允许覆盖便于幂等重试。
    const sid = args.project ?? args.session ?? generateSessionId(goal);
    const { created, existing } = await createSession(sid, {
      goal,
      rounds: args.maxRounds ?? null,
      dryRun,
      preset,
    });
    if (args.json) {
      console.log(JSON.stringify({
        sessionId: sid,
        goal,
        created,
        existing,
        roundsRequested: args.noRun ? 0 : (args.maxRounds ?? 3),
        skipRun: !!args.noRun,
      }, null, 2));
    } else {
      if (created) console.log(`✨ Created session ${sid} (goal: ${goal.slice(0, 60)}${goal.length > 60 ? '...' : ''})`);
      else if (existing) console.log(`♻️  Reusing existing session ${sid} (goal already bootstrapped)`);
      else console.log(`✓ Session ${sid} ready`);
    }
    if (args.noRun) {
      return;
    }
    // 自动设置 --session 并 fall through 到 runOneSession
    args.project = sid;
    args.session = sid;
    if (!args.maxRounds) args.maxRounds = 3;
    console.log(`[new-session] → running ${args.maxRounds} round(s) on ${sid} ...`);
    // 继续到下面的 session 处理
  }

  // 模式 0: --status (inspect only, 无 LLM 调用)
  if (args.status) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --status requires --session ID');
      process.exit(2);
    }
    const lastN = args.last ?? 5;
    const { sessionId: sid, ...report } = await loadStatusReport(sessionId, { lastN });
    if (args.json) {
      console.log(JSON.stringify({ sessionId: sid, ...report }, null, 2));
    } else {
      console.log(formatStatusReportText(sid, report));
      if (report.rounds === 0) {
        // exit 0 表示"跑成功了但无内容";调用方可用 --json + parse 区分
      }
    }
    return;
  }

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
      await runOneSession(sid, caller, {
        maxRounds, dryRun, preset,
        resume: !!args.resume,
        noCandidates: !!args.noCandidates,
      });
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
    resume: !!args.resume,
    noCandidates: !!args.noCandidates,
  });
}

async function runOneSession(sessionId, caller, opts) {
  console.log(`[session ${sessionId}] starting (maxRounds=${opts.maxRounds}, dryRun=${opts.dryRun}, preset=${opts.preset})`);
  const existing = await listExistingRounds(sessionId);
  const startRound = existing.length + 1;

  // --resume 模式:从已有 round JSONs 读出 previous_rounds,让 Designer 看到历史
  let previousRounds = [];
  if (opts.resume && existing.length > 0) {
    previousRounds = await loadPreviousRounds(sessionId);
    console.log(`  [resume] loaded ${previousRounds.length} previous round summary`);
  }

  // 自动从 archive/<session>/recommend/ 加载 candidates
  // 除非用户用 --no-candidates 显式关掉
  let candidates = [];
  if (!opts.noCandidates) {
    candidates = await loadCandidatesFromArchive(sessionId, 30);
    if (candidates.length) {
      console.log(`  [candidates] loaded ${candidates.length} papers from archive/${sessionId}/recommend/`);
    }
  }

  const input = {
    project: { id: sessionId, name: sessionId, statement: '(auto)' },
    candidates,
    user_goal: '(CLI auto-run)',
    round: startRound,
    session_id: sessionId,
    previous_rounds: previousRounds,
  };

  for (let i = 0; i < opts.maxRounds; i++) {
    const roundN = startRound + i;
    input.round = roundN;
    const rec = await runOneRoundCLI(roundN, input, caller, opts.preset, opts.dryRun);
    const file = await writeRound(rec, sessionId);
    console.log(`  [round ${roundN}] → ${file}  (proposals=${rec.designer.proposals.length}, applied=${rec.modifier.applied.length})`);

    if (opts.resume) {
      // resume 模式:每跑完一轮,把本轮摘要追加到 previous_rounds,供下一轮用
      input.previous_rounds = [...(input.previous_rounds ?? []), summarizeRec(rec)];
    }

    if (rec.modifier.applied.length === 0 && i >= 1) {
      console.log(`  [empty] 0 applied for 2 consecutive rounds; stopping early`);
      break;
    }
  }

  const digest = await buildDigest(sessionId);
  console.log(`[session ${sessionId}] digest → ${digest}`);
}

// 仅当作为主入口运行时才跑 main();被 import 时不触发(便于测试)。
// 注意:Windows 下 `import.meta.url` 是 file:///E:/... 用正斜杠,而 `process.argv[1]`
// 是 E:\\... 用反斜杠,直接字符串比较永远不等。用 realpathSync 双端归一化后比较,
// 跨平台通吃(Linux:argv[1] 也常是相对路径,realpath 后一致)。
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isMainEntry = (() => {
  const entry = process.argv[1];
  if (!entry || !existsSync(entry)) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainEntry) {
  main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
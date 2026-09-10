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

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
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

// Export-bundle builders are now a shared lib (iter #59):
//   agents-run.mjs --export-md (CLI)  ──┐
//   /agents/<sid>/export/ (browser)  ──┴── both import from lib/agents/export-bundle.mjs
// 同时 import 进本地作用域,供本文件 loadExportBundle() 内部使用;
// 末尾再 re-export 保持向后兼容(测试 + 外部 import 都从同一处拿)。
import { buildExportBundle, formatExportMarkdown } from '../lib/agents/export-bundle.mjs';
export { buildExportBundle, formatExportMarkdown };

// 论文装配器(iter #61):同样是 lib/agents/ 里的纯函数,CLI 只负责 IO。
// 把 3 智能体循环撒下的碎片 markdown 装配成 markdown + LaTeX + .bib 一整篇论文。
// iter #64 扩展:支持 4 个 LaTeX 模板(article / acmart / IEEEtran / iclr2026)。
import {
  DELIVERABLE_DIRS,
  PAPER_LATEX_TEMPLATES,
  buildPaperDraft,
  formatPaperMarkdown,
  formatPaperLatex,
  formatBibtex,
  listLatexTemplates,
  getLatexCompileHint,
} from '../lib/agents/paper-compiler.mjs';
export {
  buildPaperDraft,
  formatPaperMarkdown,
  formatPaperLatex,
  formatBibtex,
  PAPER_LATEX_TEMPLATES,
  listLatexTemplates,
  getLatexCompileHint,
};

// Synthesis → 打印就绪 HTML (iter #63)。生成自包含 HTML,
// 用户在浏览器里 Cmd/Ctrl+P → "Save as PDF" 即得到 PDF。
// 不依赖 pandoc / wkhtmltopdf 等系统工具,纯 JS,字节级稳定。
import { buildPdfBundle, formatPdfHtml, buildPdfFileName } from '../lib/agents/synthesis-pdf.mjs';
export { buildPdfBundle, formatPdfHtml, buildPdfFileName };

// Synthesis diff (iter #66):同一 session 两份 synthesis 对比 — topics 增减 /
// refs 增减 / 字数变化 / 模型切换 / similarity 评分
import { diffSyntheses, formatSynthesisDiffText } from '../lib/agents/synthesis-diff.mjs';
export { diffSyntheses, formatSynthesisDiffText };

// Web search (iter #68):Designer/Future 用 general web search 工具,关闭与
// Sakana/STORM/OpenAI Deep Research "tool use" 的第二大短板(第一是 --search-arxiv)。
// 默认 stub mode(零依赖,零网络);有 WEB_SEARCH_API_KEY 时走 Tavily backend。
// 浏览器页面也直接 import 同一份 lib,跟 export-bundle / paper-compiler /
// synthesis-pdf / synthesis-diff 同双 surface 共享模式。
import {
  normalizeWebSearchUrl,
  buildTavilyRequest,
  parseTavilyResponse,
  dedupeWebSearchResults,
  filterWebSearchResults,
  formatWebSearchText,
} from '../lib/agents/web-search.mjs';
export {
  normalizeWebSearchUrl,
  buildTavilyRequest,
  parseTavilyResponse,
  dedupeWebSearchResults,
  filterWebSearchResults,
  formatWebSearchText,
};

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
    else if (a === '--quickstart') out.quickstart = argv[++i];
    else if (a === '--diff') out.diff = true;
    else if (a === '--diff-syntheses') {
      // --diff-syntheses [--session SID] <idxA> <idxB>
      // 注:这两个位置参数是 idxA / idxB(整数)
      const positions = argv.slice(i + 1).filter((x) => !x.startsWith('--')).slice(0, 2);
      if (positions.length < 2) {
        out._err = '--diff-syntheses requires two positional args: <idxA> <idxB>';
      } else {
        out.diffSyntheses = { idxA: Number(positions[0]), idxB: Number(positions[1]) };
        i += positions.length;
      }
    }
    else if (a === '--web-search') out.webSearch = argv[++i];
    else if (a === '--web-max') out.webMax = Number(argv[++i]);
    else if (a === '--include-domain') {
      out.includeDomain = out.includeDomain ?? [];
      out.includeDomain.push(argv[++i]);
    }
    else if (a === '--exclude-domain') {
      out.excludeDomain = out.excludeDomain ?? [];
      out.excludeDomain.push(argv[++i]);
    }
    else if (a === '--min-score') out.minScore = Number(argv[++i]);
    else if (a === '--web-backend') out.webBackend = argv[++i];
    else if (a === '--leaderboard') out.leaderboard = true;
    else if (a === '--top') out.top = Number(argv[++i]);
    else if (a === '--type') out.type = argv[++i];
    else if (a === '--promote') out.promote = true;
    else if (a === '--synthesize') out.synthesize = true;
    else if (a === '--no-synthesize') out.noSynthesize = true;
    else if (a === '--auto') out.auto = argv[++i];
    else if (a === '--max-cycles') out.maxCycles = Number(argv[++i]);
    else if (a === '--auto-directive-mode') out.autoDirectiveMode = argv[++i];
    else if (a === '--auto-stop-threshold') out.autoStopThreshold = Number(argv[++i]);
    else if (a === '--auto-resume') out.autoResume = true;
    else if (a === '--write-deliverable') out.writeDeliverable = true;
    else if (a === '--few-shot-from') out.fewShotFrom = Number(argv[++i]);
    else if (a === '--search-arxiv') out.searchArxiv = argv[++i];
    else if (a === '--export-md') {
      // --export-md 可无参数(默认 archive/<sid>/export.md),也可 --export-md path/to/x.md
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.exportMd = next; i++; }
      else { out.exportMd = ''; } // 空字符串 = 默认路径
    }
    else if (a === '--compile-paper') {
      // --compile-paper 可无参数(默认 archive/<sid>/paper/),也可指定输出目录
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.compilePaper = next; i++; }
      else { out.compilePaper = ''; } // 空字符串 = 默认目录
    }
    else if (a === '--paper-format') out.paperFormat = argv[++i];
    else if (a === '--latex-template' || a === '--documentclass') out.latexTemplate = argv[++i];
    else if (a === '--list-templates') out.listTemplates = true;
    else if (a === '--export-pdf') {
      // --export-pdf 可无参数(默认 archive/<sid>/synthesis.html),也可指定输出文件路径
      // 无参数 = 默认路径(单个 HTML 包含所有 synthesis)
      // --export-pdf <path.html> = 自定义路径
      // --export-pdf <dir/>     = 落到指定目录(文件名用 buildPdfFileName)
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.exportPdf = next; i++; }
      else { out.exportPdf = ''; } // 空字符串 = 默认路径
    }
    else if (a === '--pdf-style') out.pdfStyle = argv[++i];
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
  --quickstart GOAL  One-command bootstrap for new users. Equivalent to
                     --new-session GOAL --rounds 1 --preset aggressive
                     --dry-run, then prints a friendly summary listing
                     what was produced + 4 next-step commands.
                     Goal: zero-friction first run (no LLM key required,
                     Modifier writes deliverables so archive/ is non-empty).
                     Combine with --no-dry-run to use real LLM.
  --export-md [PATH] Write a single self-contained markdown bundle of one
                     session to PATH (default: ./archive/<sid>/export.md).
                     Iter #57: lets users share / archive / post-process a
                     whole session as 1 file (no archive/ folder needed).
                     Bundle contains: meta + per-round proposals + critiques
                     + gate verdicts + modifier actions + latest synthesis.
                     Use --json to dump the bundle object to stdout instead
                     of writing to disk.
  --compile-paper [DIR]
                     Assemble the whole session into ONE submittable paper
                     (iter #61). Reads archive/<sid>/{drafts,reviews,
                     experiments,paper_additions,rebuttals}/*.md + synthesis/
                     and routes each deliverable into a real paper section
                     (Introduction / Related Work / Method / Results /
                     Limitations), then emits:
                       paper.md   markdown 版
                       paper.tex  可编译 LaTeX(pdflatex 一次过)
                       refs.bib   从 proposal evidence 抽的 arXiv 引文
                     Default DIR: archive/<sid>/paper/. Use --paper-format
                     to emit only one of latex / markdown. --json dumps the
                     structured PaperDraft instead of writing files.
                     This closes the "Modifier 不写 LaTeX" gap: the 3-agent
                     loop now ends in a paper, not just scattered fragments.
  --paper-format F   With --compile-paper: latex | markdown | both
                     (default both).
  --latex-template T | --documentclass T
                     With --compile-paper: pick a LaTeX document class
                     (iter #64/65 templates): article (default) | acmart |
                     ieeeconf | iclr2026 | neurips | acl. Each emits a
                     distinct preamble + title block tuned for that venue.
  --list-templates  Print the list of supported LaTeX templates with
                     their compile hints and exit. Useful for picking
                     --latex-template when scripting.
  --export-pdf [PATH]
                     Assemble all synthesis/*.md of one session into 1
                     self-contained print-ready HTML file (iter #63). Open
                     the resulting .html in any browser, then Cmd/Ctrl+P →
                     "Save as PDF". No system PDF tools required; CSS +
                     @page rules give proper page numbers / margins.
                     Default PATH: archive/<sid>/synthesis.html. Path may
                     also be a directory; filename falls back to
                     buildPdfFileName(<sid>).
                     Use --pdf-style academic | compact | presentation to
                     pick the CSS variant (default academic). --json dumps
                     the PDFBundle object to stdout instead of writing.
  --pdf-style NAME   With --export-pdf: academic | compact | presentation
                     (default academic).
  --diff             Compare two rounds of a session (use with --session ID
                     and two positional round numbers). Outputs proposals
                     added/removed/changed + score delta + gate decision
                     transitions. JSON via --json.
  --diff-syntheses <idxA> <idxB>
                     Compare two synthesis_*.md of a session (iter #66).
                     Use with --session ID + two positional synthesis idx
                     numbers. Outputs topics added/removed/shared,
                     arXiv refs added/removed/shared, word count delta,
                     model/title changes, similarity score (Jaccard on
                     topics 0.7 + refs 0.3). JSON via --json.
  --web-search "<QUERY>"
                     General web search via Tavily (iter #68). Closes the
                     second tool-use gap with Sakana/STORM/Deep Research.
                     Requires WEB_SEARCH_API_KEY env var; without it,
                     runs in stub mode (returns 0 results, no network).
                     Filter with --include-domain D / --exclude-domain D
                     (repeatable). Cap at --web-max N (default 5).
                     Drop low-quality hits with --min-score N (0-1).
                     Backend override: --web-backend stub|tavily.
                     --json emits the raw { results, query, backend, stub }
                     object instead of formatted text.
  --leaderboard      Cross-session aggregate: scan all archive/*/rounds/
                     and rank top proposal types by avg score / apply rate
                     + top Elo proposals + most-active sessions. Filter
                     by --type X, limit --top N (default 10), --json.
  --top N            With --leaderboard, limit each ranking to top N (default 10).
  --promote          Manual promotion: bump a sketch/candidate proposal
                     to promoted. Use with --session ID + two positional
                     args (roundN proposalId). Writes archive/<sid>/
                     promotions.json (append-only audit log); with
                     --write-deliverable, also triggers writeDeliverable
                     for create_draft / literature_review / experiment_plan
                     (does NOT mutate round_NNN.json — append-only preserved).
  --write-deliverable With --promote, also write the deliverable .md file
                     via writeDeliverable. By default --promote is dry
                     (records the promotion but does not write files).
  --synthesize       After running rounds, synthesize the session into a
                     unified answer markdown at
                     archive/<sid>/synthesis/synthesis_NNN.md
                     (Deep-Research-style: aggregates all rounds +
                     deliverables + bibliography; requires LLM_BASE_URL
                     + LLM_API_KEY for real synthesis; stub mode otherwise).
                     Each run writes a NEW numbered file (synthesis_001,
                     synthesis_002, ...); history is preserved so you can
                     watch the synthesis evolve as the session grows.
                     Auto-runs after --session round generation unless
                     --no-synthesize is also set.
  --no-synthesize    Skip the auto-synthesis step after running rounds.
  --auto GOAL        End-to-end autonomous research loop. Takes a goal,
                     bootstraps a session, then runs cycles of
                     (1 round + 1 synthesis). Each cycle's synthesis
                     directives (gaps_contradictions + next_steps) are
                     fed back as the next round's Designer context.
                     Stops when directives converge (≤ auto-stop-threshold)
                     or max cycles hit. Use --auto-directive-mode +
                     --max-cycles + --auto-stop-threshold to tune.
                     (Designed for the "give it a goal and let it run"
                     use case; not idempotent — each invocation creates
                     a new session unless --session is also passed.)
  --max-cycles N     With --auto, cap the number of cycles (default 5).
  --auto-directive-mode MODE
                     With --auto, which synthesis fields to feed back:
                     gaps | next_steps | both (default gaps).
  --auto-stop-threshold N
                     With --auto, stop when directive count ≤ N (default 2).
                     Set 0 to disable convergence detection and always run
                     --max-cycles.
  --auto-resume       With --auto, require --session SID and refuse to
                     create a new session. Refuses with exit 2 if the
                     session's archive/<sid>/meta.json doesn't exist.
                     Use to pick up a previously-stopped session.
  --few-shot-from N  With --new-session, inject top-N proposals from all
                     other sessions (by Elo, from --leaderboard topElo)
                     as Designer few-shot examples. Closes iter #34 ↔
                     iter #31 loop: new sessions learn from past wins.
                     Default 0 (disabled). Capped at 20 to bound prompt.
  --search-arxiv Q   Designer tool use (iter #56): search arXiv API for Q
                     before the round runs, use top results as candidates.
                     Closes the "candidates empty → Designer has no input"
                     gap that was the biggest blocker vs Sakana / STORM
                     (those tools have web/Python tool use; DPR didn't).
                     By default max 12 results, dedup by canonical id,
                     filtered to ti: (title match) for relevance.
                     Combine with --new-session "<GOAL>" --search-arxiv Q
                     to bootstrap a session from a topic query, zero
                     prior papers needed.
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
  const stage = {}; // ms per stage

  // 1. Designer — 走真 LLM 或 stub
  const t0 = Date.now();
  const proposals = await designerCLI(input, caller);
  stage.designer = Date.now() - t0;
  const tokens = proposals.length * 250;

  // 2. Feedback — 走真 LLM 或 stub
  const t1 = Date.now();
  const critiques = await feedbackCLI(proposals, caller);
  stage.feedback = Date.now() - t1;
  const fbTokens = proposals.length * 600;

  // 3. Gate
  const t2 = Date.now();
  const verdicts = gateProposals(proposals, critiques, preset)
    .map((v) => {
      const p = proposals.find((x) => x.id === v.proposal_id);
      return p ? applySafetyOverride(v, p) : v;
    });
  const buckets = partitionByDecision(verdicts);
  stage.gate = Date.now() - t2;

  // 4. Modifier — dry_run 时只记录 would_call
  const t3 = Date.now();
  const { applied, skipped } = await modifierCLI(verdicts, proposals, input, dryRun);
  stage.modifier = Date.now() - t3;

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

  // iter #42 — telemetry
  rec.telemetry = {
    duration_ms: rec.finished_at - rec.started_at,
    llm_calls: 1 + proposals.length * 3, // 1 designer + 3 feedback per proposal
    approx_tokens: tokens + fbTokens,
    stage_durations_ms: { ...stage },
  };

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
  // 跨 session few-shot examples(iter #39)
  if (input.previous_designer_examples?.length) {
    lines.push(formatFewShotExamples(input.previous_designer_examples));
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
// --few-shot-from:跨 session 学习的 top proposals 拉取(iter #39)
// ---------------------------------------------------------------------------

/**
 * loadTopProposals(opts) — IO wrapper,扫所有 session 聚合 top-Elo proposals。
 * 用于 --few-shot-from N:把过去胜出的 proposals 作为新 session Designer 的 few-shot examples。
 *
 * opts:
 *   topN:           max proposals to return (default 5, cap 20)
 *   excludeSid:     排除当前 session(避免 self-reference)
 *   minMatches:     过滤 matches=0 的初始 Elo=1200(default 1)
 *
 * 返回:[{ sessionId, round, title, type, total, elo, matches, wins }]
 *     按 elo 倒序,只含 matches > 0 且 matches > minMatches
 */
export async function loadTopProposals(opts = {}) {
  const topN = Math.min(opts.topN ?? 5, 20);
  const excludeSid = opts.excludeSid ?? null;
  const minMatches = opts.minMatches ?? 1;

  if (!existsSync('archive')) return [];
  const entries = await readdir('archive', { withFileTypes: true });
  const sessionIds = entries
    .filter((e) => e.isDirectory() && /^[a-f0-9]{8,}$/.test(e.name))
    .map((e) => e.name)
    .filter((sid) => sid !== excludeSid);

  const all = [];
  for (const sid of sessionIds) {
    const files = await listExistingRounds(sid);
    for (const f of files) {
      try {
        const rec = JSON.parse(await readFile(f, 'utf8'));
        const proposalsById = new Map((rec.designer?.proposals ?? []).map((p) => [p.id, p]));
        for (const c of rec.feedback?.critiques ?? []) {
          const matches = Number(c.matches) || 0;
          if (matches < minMatches) continue;
          const p = proposalsById.get(c.proposal_id);
          if (!p) continue;
          all.push({
            sessionId: sid,
            round: rec.round,
            proposal_id: c.proposal_id,
            title: p.title,
            type: p.type,
            total: Number(c.total) || 0,
            elo: Number(c.elo) || 0,
            matches,
            wins: Number(c.wins) || 0,
          });
        }
      } catch { /* skip corrupt */ }
    }
  }

  all.sort((a, b) => b.elo - a.elo);
  return all.slice(0, topN);
}

/**
 * formatFewShotExamples(examples) — 把 top proposals 渲染成 Designer prompt 段。
 * 给 buildDesignerUserPrompt 内部调用。
 */
function formatFewShotExamples(examples) {
  if (!examples || examples.length === 0) return '';
  const lines = ['\nFew-shot examples (top past proposals by Elo):'];
  for (const ex of examples) {
    lines.push(`- [${ex.sessionId} r${ex.round}] ${ex.title}  [${ex.type}]  elo=${ex.elo}, score=${ex.total}, ${ex.matches}m/${ex.wins}w`);
  }
  lines.push('→ 这些是过去 session 表现好的 proposal 类型 / 模式。新 session 借鉴其思路,但不要重复同一论文 ID。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// --promote 模式:手动把 sketch / candidate 升到 promoted,append-only audit log
// ---------------------------------------------------------------------------

/**
 * readPromotionLog(sessionId) — 读 archive/<sid>/promotions.json。
 * 不存在或损坏 → 返回空 log:{ schema_version: 1, entries: [] }。
 */
export async function readPromotionLog(sessionId) {
  const file = join('archive', sessionId, 'promotions.json');
  if (!existsSync(file)) return { schema_version: 1, session_id: sessionId, entries: [] };
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { schema_version: 1, session_id: sessionId, entries: [] };
  }
}

/**
 * appendPromotion(sessionId, entry) — atomic append 到 promotions.json。
 * 每次重读整个 log → push → 写回(单用户 CLI,无并发风险)。
 */
async function appendPromotion(sessionId, entry) {
  const log = await readPromotionLog(sessionId);
  log.entries.push(entry);
  const file = join('archive', sessionId, 'promotions.json');
  await mkdir(join('archive', sessionId), { recursive: true });
  await writeFile(file, JSON.stringify(log, null, 2));
  return { log, entry };
}

/**
 * promoteProposal(sessionId, roundN, proposalId, opts) — 主入口。
 *
 * opts: { writeDeliverable?: boolean }
 *
 * 流程:
 *   1. 读 round_<NNN>.json
 *   2. 找 proposal id;find verdict 决策
 *   3. 如果已经是 promoted/rejected → returns { ok: false, reason }
 *   4. 写 promotion audit log entry
 *   5. (可选) 触发 writeDeliverable(创建 draft / review / experiment .md)
 *   6. 返回 { ok: true, entry, deliverable? }
 *
 * 不修改 round_NNN.json(append-only)。改 promotion 的 audit 在 promotions.json。
 */
export async function promoteProposal(sessionId, roundN, proposalId, opts = {}) {
  const writeDeliverableFlag = !!opts.writeDeliverable;

  const files = await listExistingRounds(sessionId);
  const roundFile = files.find((f) => f.endsWith(`round_${String(roundN).padStart(3, '0')}.json`));
  if (!roundFile) throw new Error(`round ${roundN} not found in archive/${sessionId}/rounds/`);

  const roundRecord = JSON.parse(await readFile(roundFile, 'utf8'));
  const proposal = (roundRecord.designer?.proposals ?? []).find((p) => p.id === proposalId);
  if (!proposal) throw new Error(`proposal ${proposalId} not found in round ${roundN}`);

  const verdict = (roundRecord.gate?.verdicts ?? []).find((v) => v.proposal_id === proposalId);
  const previousDecision = verdict?.decision ?? '(no verdict recorded)';
  if (previousDecision === 'promoted') {
    return { ok: false, reason: 'already promoted', previousDecision };
  }
  if (previousDecision === 'rejected') {
    return { ok: false, reason: 'gate=rejected; cannot promote a rejected proposal', previousDecision };
  }

  const entry = {
    schema_version: 1,
    promoted_at: Date.now(),
    session_id: sessionId,
    round: roundN,
    proposal_id: proposalId,
    proposal_title: proposal.title,
    proposal_type: proposal.type,
    previous_decision: previousDecision,
    new_decision: 'promoted',
    rationale: opts.rationale ?? null,
    actor: opts.actor ?? 'cli',
    wrote_deliverable: false,
    deliverable_path: null,
    deliverable_kind: null,
  };

  // 可选触发 deliverable(用 next available idx 在该 type 的归档里)
  if (writeDeliverableFlag) {
    const existingDeliverables = [];
    const { readdir: rd } = await import('node:fs/promises');
    const subdirs = {
      create_draft: 'drafts',
      literature_review: 'reviews',
      experiment_plan: 'experiments',
    };
    const subdir = subdirs[proposal.type];
    if (subdir) {
      try {
        const files2 = await rd(join('archive', sessionId, subdir));
        for (const f of files2) {
          const m = f.match(/^.+_r(\d+)_(\d+)\.md$/);
          if (m && Number(m[1]) === roundN) existingDeliverables.push(Number(m[2]));
        }
      } catch { /* no dir yet */ }
      const idx = existingDeliverables.length;
      const result = await writeDeliverable(proposal, {
        session_id: sessionId,
        round: roundN,
        idx,
        decision: 'promoted',
        dryRun: false,
      });
      entry.wrote_deliverable = result.written;
      entry.deliverable_path = result.written ? result.path : null;
      entry.deliverable_kind = result.written ? result.kind : null;
    }
    // add_paper / rebuttal 等不支持的 type:不写文件,deliverable_* 保持 null
  }

  await appendPromotion(sessionId, entry);
  return { ok: true, entry, previousDecision };
}

/**
 * formatPromoteText(result) — stdout 输出。
 */
export function formatPromoteText(result) {
  if (!result.ok) {
    return `❌ Cannot promote: ${result.reason} (previous_decision: ${result.previousDecision})`;
  }
  const e = result.entry;
  const lines = [];
  lines.push(`✨ Promoted [${e.session_id}] round ${e.round} → proposal ${e.proposal_id}`);
  lines.push(`   title: ${e.proposal_title}`);
  lines.push(`   type: ${e.proposal_type}`);
  lines.push(`   previous_decision: ${e.previous_decision} → promoted`);
  if (e.wrote_deliverable) {
    lines.push(`   📝 deliverable: ${e.deliverable_path}`);
  } else {
    lines.push(`   (no deliverable written; rerun with --write-deliverable)`);
  }
  lines.push(`   audit: archive/${e.session_id}/promotions.json`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// --leaderboard 模式:跨 session 聚合
// ---------------------------------------------------------------------------

/**
 * aggregateLeaderboard(sessionsData, opts) — 纯函数,把多个 session 的 rounds
 * 聚合成全局排行榜。sessionsData: [{ sessionId, records: RoundRecord[] }]。
 *
 * 返回:
 *   totals: { sessions, rounds, proposals, applied, skipped }
 *   byType: [{ type, count, avgScore, applyRate, promoted, candidate, sketch, rejected }]
 *     按 count 倒序
 *   topElo: [{ sessionId, round, title, type, total, elo, matches, wins }]
 *     按 elo 倒序(过滤初始 1200)
 *   topSessions: [{ sessionId, rounds, proposals, applied, avgScore }]
 *     按 applied 倒序
 */
export function aggregateLeaderboard(sessionsData, opts = {}) {
  const topN = opts.topN ?? 10;
  // 同时接受 opts.type 和 opts.typeFilter,方便 caller 选喜欢的名字
  const typeFilter = opts.type ?? opts.typeFilter ?? null;
  const sessions = Array.isArray(sessionsData) ? sessionsData : [];

  // 累加 per-type + per-session
  const typeStats = new Map(); // type → { count, scores[], decisions, applied }
  const sessionStats = new Map(); // sid → { rounds, proposals, applied, scores[] }
  const allCritiques = [];
  let totalRounds = 0;
  let totalProposals = 0;
  let totalApplied = 0;
  let totalSkipped = 0;

  for (const { sessionId, records } of sessions) {
    const sStats = { rounds: records.length, proposals: 0, applied: 0, scores: [] };
    for (const rec of records) {
      totalRounds++;
      const proposals = rec.designer?.proposals ?? [];
      const critiquesById = new Map((rec.feedback?.critiques ?? []).map((c) => [c.proposal_id, c]));
      const verdictById = new Map((rec.gate?.verdicts ?? []).map((v) => [v.proposal_id, v]));
      const appliedIds = new Set((rec.modifier?.applied ?? []).map((a) => a.proposal_id));

      for (const p of proposals) {
        if (typeFilter && p.type !== typeFilter) continue;
        totalProposals++;
        sStats.proposals++;
        const c = critiquesById.get(p.id);
        const v = verdictById.get(p.id);
        const score = c ? Number(c.total) : NaN;
        const validScore = Number.isFinite(score) ? score : 0;
        sStats.scores.push(validScore);
        if (!typeStats.has(p.type)) {
          typeStats.set(p.type, { count: 0, scores: [], decisions: { promoted: 0, candidate: 0, sketch: 0, rejected: 0 }, applied: 0 });
        }
        const ts = typeStats.get(p.type);
        ts.count++;
        ts.scores.push(validScore);
        if (v?.decision && ts.decisions[v.decision] != null) ts.decisions[v.decision]++;
        if (appliedIds.has(p.id)) ts.applied++;

        if (c) {
          allCritiques.push({
            sessionId,
            round: rec.round,
            proposal_id: p.id,
            title: p.title,
            type: p.type,
            total: validScore,
            elo: Number(c.elo) || 0,
            matches: Number(c.matches) || 0,
            wins: Number(c.wins) || 0,
          });
        }
      }

      totalApplied += rec.modifier?.applied?.length ?? 0;
      totalSkipped += rec.modifier?.skipped?.length ?? 0;
      sStats.applied += rec.modifier?.applied?.length ?? 0;
    }
    sessionStats.set(sessionId, sStats);
  }

  // 派生 byType 数组
  const byType = [...typeStats.entries()].map(([type, ts]) => {
    const sumScores = ts.scores.reduce((a, b) => a + b, 0);
    const applyRate = ts.count > 0 ? ts.applied / ts.count : 0;
    return {
      type,
      count: ts.count,
      avgScore: ts.count > 0 ? Math.round((sumScores / ts.count) * 100) / 100 : 0,
      applyRate: Math.round(applyRate * 1000) / 1000,
      promoted: ts.decisions.promoted,
      candidate: ts.decisions.candidate,
      sketch: ts.decisions.sketch,
      rejected: ts.decisions.rejected,
    };
  }).sort((a, b) => b.count - a.count);

  // 过滤 + 排序 topElo
  const topElo = allCritiques
    .filter((c) => c.matches > 0 || c.elo !== 1200)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, topN);

  // topSessions
  const topSessions = [...sessionStats.entries()]
    .map(([sessionId, s]) => ({
      sessionId,
      rounds: s.rounds,
      proposals: s.proposals,
      applied: s.applied,
      avgScore: s.scores.length ? Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.applied - a.applied)
    .slice(0, topN);

  return {
    totals: {
      sessions: sessions.length,
      rounds: totalRounds,
      proposals: totalProposals,
      applied: totalApplied,
      skipped: totalSkipped,
    },
    byType,
    topElo,
    topSessions,
  };
}

/**
 * formatLeaderboardText(report, opts) — 文本模式 stdout 输出。
 */
export function formatLeaderboardText(report, opts = {}) {
  const lines = [];
  const t = report.totals;
  lines.push(`🏆 Cross-session Leaderboard`);
  if (opts.typeFilter) lines.push(`(filtered: type = ${opts.typeFilter})`);
  lines.push(`Totals: ${t.sessions} sessions, ${t.rounds} rounds, ${t.proposals} proposals, ${t.applied} applied / ${t.skipped} skipped`);
  lines.push('');
  if (report.byType.length) {
    lines.push(`📊 By Proposal Type (sorted by count desc):`);
    const header = `  ${'type'.padEnd(20)} ${'count'.padStart(5)}  ${'avg'.padStart(5)}  ${'apply%'.padStart(6)}  ${'p/c/s/r'.padStart(11)}`;
    lines.push(header);
    for (const t of report.byType) {
      lines.push(
        `  ${t.type.padEnd(20)} ${String(t.count).padStart(5)}  ${String(t.avgScore).padStart(5)}  ${(t.applyRate * 100).toFixed(1).padStart(5)}%  ${String(t.promoted).padStart(3)}/${String(t.candidate).padStart(3)}/${String(t.sketch).padStart(3)}/${String(t.rejected).padStart(3)}`,
      );
    }
    lines.push('');
  } else {
    lines.push('(no proposals match)');
    lines.push('');
  }
  if (report.topElo.length) {
    lines.push(`🥇 Top Elo Proposals (${report.topElo.length}):`);
    for (let i = 0; i < report.topElo.length; i++) {
      const p = report.topElo[i];
      lines.push(`  ${i + 1}. [${p.sessionId} round ${p.round}] ${p.title}  (elo=${p.elo}, score=${p.total}, type=${p.type}, ${p.matches}m/${p.wins}w)`);
    }
    lines.push('');
  }
  if (report.topSessions.length) {
    lines.push(`📂 Most Active Sessions (by applied count):`);
    for (const s of report.topSessions) {
      lines.push(`  ${s.sessionId}  rounds=${s.rounds}, proposals=${s.proposals}, applied=${s.applied}, avg=${s.avgScore}`);
    }
  }
  return lines.join('\n');
}

/**
 * loadLeaderboard(opts) — 扫 archive/<sid>/rounds/*.json (所有 sid),
 * 聚合。typeFilter 从 opts 取。
 */
async function loadLeaderboard(opts = {}) {
  if (!existsSync('archive')) return { totals: { sessions: 0, rounds: 0, proposals: 0, applied: 0, skipped: 0 }, byType: [], topElo: [], topSessions: [] };
  const entries = await readdir('archive', { withFileTypes: true });
  const sessionIds = entries
    .filter((e) => e.isDirectory() && /^[a-f0-9]{8,}$/.test(e.name))
    .map((e) => e.name);

  const sessionsData = [];
  for (const sid of sessionIds) {
    const files = await listExistingRounds(sid);
    const records = [];
    for (const f of files) {
      try {
        records.push(JSON.parse(await readFile(f, 'utf8')));
      } catch {
        // skip corrupt
      }
    }
    if (records.length > 0) sessionsData.push({ sessionId: sid, records });
  }
  return aggregateLeaderboard(sessionsData, opts);
}

// ---------------------------------------------------------------------------
// --diff 模式:两 round diff (added / removed / changed / score delta / gate transition)
// ---------------------------------------------------------------------------

/**
 * normalizeTitle(title) — 给 title 做 fuzzy match 前的归一化:
 *   - lowercase
 *   - 去掉所有非字母数字 / 非 CJK 字符(punctuation 统一空白)
 *   - 多个空白压成单个
 *   - 去掉首尾空白
 * 返回标准化字符串 + word set(给 Jaccard 用)。
 *
 * 纯函数;tests 直接 import。
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return { str: '', words: new Set() };
  // 把 CJK 字符按字拆成"单词"(英文则按 \w+ 拆),统一去标点
  const lowered = title.toLowerCase();
  // 把非 \w、非 CJK 字符替换成空格
  const cleaned = lowered
    .replace(/[^\w一-鿿]+/gu, ' ')
    .trim();
  // 英文按空白拆;CJK 字符每个算一个 token
  const tokens = [];
  const enMatches = cleaned.match(/[a-z0-9]+/g);
  if (enMatches) tokens.push(...enMatches);
  // CJK 字符逐一
  const cjkChars = cleaned.match(/[一-鿿]/gu);
  if (cjkChars) tokens.push(...cjkChars);
  return { str: cleaned, words: new Set(tokens) };
}

/**
 * titleJaccard(a, b) — Jaccard 相似度 = |A ∩ B| / |A ∪ B|。
 * 0 = 完全不同,1 = 完全相同。
 * 空集合处理:a 或 b 任一空 → 0。
 */
export function titleJaccard(a, b) {
  if (!a.words.size || !b.words.size) return 0;
  let inter = 0;
  for (const w of a.words) if (b.words.has(w)) inter++;
  const union = a.words.size + b.words.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * findTitleFuzzyMatches(proposalsA, proposalsB, opts) — 在 proposalsA 和
 * proposalsB 中找 title-Jaccard 相似度 >= threshold 的配对。
 *
 * 输入:proposalsA/B = array of proposals(都有 id 和 title)
 * opts.threshold = 0.5(Jaccard >= 0.5 算"同一个 proposal 的不同 id")
 * opts.excludeMatchedIds = Set<string> 已经按 id 配上的,跳过
 *
 * 返回:[{ idA, idB, titleA, titleB, similarity }] 按 similarity 倒序。
 */
export function findTitleFuzzyMatches(proposalsA, proposalsB, opts = {}) {
  const threshold = opts.threshold ?? 0.5;
  const excludeA = opts.excludeMatchedIdsA ?? new Set();
  const excludeB = opts.excludeMatchedIdsB ?? new Set();
  const matches = [];

  const normB = new Map();
  for (const pB of proposalsB) {
    if (excludeB.has(pB.id)) continue;
    normB.set(pB.id, { proposal: pB, norm: normalizeTitle(pB.title) });
  }

  for (const pA of proposalsA) {
    if (excludeA.has(pA.id)) continue;
    const normA = normalizeTitle(pA.title);
    if (!normA.words.size) continue;
    for (const [idB, { proposal: pB, norm: nB }] of normB) {
      if (!nB.words.size) continue;
      const sim = titleJaccard(normA, nB);
      if (sim >= threshold) {
        matches.push({
          idA: pA.id,
          idB,
          titleA: pA.title,
          titleB: pB.title,
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  // Greedy 去重:每个 proposal id 只配一次(最高相似度的优先)
  const usedA = new Set();
  const usedB = new Set();
  const final = [];
  for (const m of matches) {
    if (usedA.has(m.idA) || usedB.has(m.idB)) continue;
    usedA.add(m.idA);
    usedB.add(m.idB);
    final.push(m);
  }
  return final;
}

/**
 * diffRounds(roundA, roundB) — 纯函数,比较两个 RoundRecord。
 * 匹配维度:
 *   1. proposal.id(原有)— LLM 保持 id 稳定时用这个
 *   2. title-fuzzy(Jaccard >= 0.5)— stub LLM 或 LLM 重生 id 时 fallback
 * 输出:
 *   {
 *     roundA, roundB,
 *     added:     [{ id, title, type, score, decision, matchedBy? }]   // 只在 B 里
 *     removed:   [{ id, title, type, score, decision }]                // 只在 A 里
 *     changed:   [{ idA, idB?, title, type, scoreA, scoreB, scoreDelta,
 *                   decisionA, decisionB, decisionChange, matchedBy }]
 *     unchanged: [...]
 *     stats: { proposalsA, proposalsB, avgScoreA, avgScoreB,
 *              avgScoreDelta, promotedA, promotedB,
 *              idMatched, fuzzyMatched }
 *   }
 */
export function diffRounds(roundA, roundB, opts = {}) {
  const threshold = opts.fuzzyThreshold ?? 0.5;
  const proposalsA = new Map((roundA?.designer?.proposals ?? []).map((p) => [p.id, p]));
  const proposalsB = new Map((roundB?.designer?.proposals ?? []).map((p) => [p.id, p]));

  const scoreA = new Map((roundA?.feedback?.critiques ?? []).map((c) => [c.proposal_id, c]));
  const scoreB = new Map((roundB?.feedback?.critiques ?? []).map((c) => [c.proposal_id, c]));
  const gateA = new Map((roundA?.gate?.verdicts ?? []).map((v) => [v.proposal_id, v]));
  const gateB = new Map((roundB?.gate?.verdicts ?? []).map((v) => [v.proposal_id, v]));

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  let idMatched = 0;
  let fuzzyMatched = 0;

  // 阶段 1:严格 id 匹配(原有逻辑)
  for (const [id, pB] of proposalsB) {
    if (!proposalsA.has(id)) continue; // id 不匹配 → 留给 fuzzy fallback
    idMatched++;
    const sA = scoreA.get(id);
    const sB = scoreB.get(id);
    const gA = gateA.get(id)?.decision ?? null;
    const gB = gateB.get(id)?.decision ?? null;
    const numA = sA ? Number(sA.total) : NaN;
    const numB = sB ? Number(sB.total) : NaN;
    const validA = Number.isFinite(numA) ? numA : null;
    const validB = Number.isFinite(numB) ? numB : null;
    const scoreDelta = validA != null && validB != null ? Math.round((validB - validA) * 100) / 100 : null;
    const scoreChanged = sA && sB && validA !== validB;
    const gateChanged = gA !== gB;
    const entry = {
      id,
      idA: id,
      idB: id,
      title: pB.title ?? proposalsA.get(id)?.title,
      type: pB.type ?? proposalsA.get(id)?.type,
      scoreA: validA,
      scoreB: validB,
      scoreDelta,
      decisionA: gA,
      decisionB: gB,
      decisionChange: gateChanged ? { from: gA, to: gB } : null,
      matchedBy: 'id',
    };
    if (scoreChanged || gateChanged) changed.push(entry);
    else unchanged.push(entry);
  }

  // 阶段 2:title-fuzzy 匹配(只对 id 没配上的)
  const idMatchedA = new Set(); // A 中已配上的 id
  const idMatchedB = new Set(); // B 中已配上的 id
  for (const [id, pB] of proposalsB) {
    if (proposalsA.has(id)) {
      idMatchedA.add(id);
      idMatchedB.add(id);
    }
  }
  const unmatchedA = [...proposalsA.values()].filter((p) => !idMatchedA.has(p.id));
  const unmatchedB = [...proposalsB.values()].filter((p) => !idMatchedB.has(p.id));
  const fuzzy = findTitleFuzzyMatches(unmatchedA, unmatchedB, { threshold });
  const fuzzyByA = new Map(fuzzy.map((m) => [m.idA, m]));
  const fuzzyByB = new Map(fuzzy.map((m) => [m.idB, m]));
  const consumedA = new Set();
  const consumedB = new Set();

  for (const { idA, idB, titleA, titleB, similarity } of fuzzy) {
    fuzzyMatched++;
    consumedA.add(idA);
    consumedB.add(idB);
    const pA = proposalsA.get(idA);
    const pB = proposalsB.get(idB);
    const sA = scoreA.get(idA);
    const sB = scoreB.get(idB);
    const gA = gateA.get(idA)?.decision ?? null;
    const gB = gateB.get(idB)?.decision ?? null;
    const numA = sA ? Number(sA.total) : NaN;
    const numB = sB ? Number(sB.total) : NaN;
    const validA = Number.isFinite(numA) ? numA : null;
    const validB = Number.isFinite(numB) ? numB : null;
    const scoreDelta = validA != null && validB != null ? Math.round((validB - validA) * 100) / 100 : null;
    const scoreChanged = sA && sB && validA !== validB;
    const gateChanged = gA !== gB;
    const entry = {
      id: `${idA}≡${idB}`, // 显示用,表示"通过 fuzzy 配对"
      idA,
      idB,
      title: pB.title ?? pA.title,
      type: pB.type ?? pA.type,
      scoreA: validA,
      scoreB: validB,
      scoreDelta,
      decisionA: gA,
      decisionB: gB,
      decisionChange: gateChanged ? { from: gA, to: gB } : null,
      matchedBy: 'fuzzy',
      similarity,
      titleA,
      titleB,
    };
    if (scoreChanged || gateChanged) changed.push(entry);
    else unchanged.push(entry);
  }
  // 静默避免 lint 警告
  void fuzzyByA; void fuzzyByB;

  // 阶段 3:剩下的都是真正 added / removed
  for (const [id, pB] of proposalsB) {
    if (idMatchedB.has(id) || consumedB.has(id)) continue;
    added.push({
      id,
      title: pB.title,
      type: pB.type,
      score: scoreB.get(id)?.total ?? null,
      decision: gateB.get(id)?.decision ?? null,
      matchedBy: 'none',
    });
  }
  for (const [id, pA] of proposalsA) {
    if (idMatchedA.has(id) || consumedA.has(id)) continue;
    removed.push({
      id,
      title: pA.title,
      type: pA.type,
      score: scoreA.get(id)?.total ?? null,
      decision: gateA.get(id)?.decision ?? null,
    });
  }

  // 排序:scoreDelta 绝对值大的优先
  changed.sort((a, b) => Math.abs(b.scoreDelta ?? 0) - Math.abs(a.scoreDelta ?? 0));

  const avgOf = (m) => (m.size ? [...m.values()].reduce((s, c) => s + (Number(c.total) || 0), 0) / m.size : 0);
  const avgA = avgOf(scoreA);
  const avgB = avgOf(scoreB);

  return {
    roundA: roundA?.round ?? null,
    roundB: roundB?.round ?? null,
    added,
    removed,
    changed,
    unchanged,
    stats: {
      proposalsA: proposalsA.size,
      proposalsB: proposalsB.size,
      avgScoreA: Math.round(avgA * 100) / 100,
      avgScoreB: Math.round(avgB * 100) / 100,
      avgScoreDelta: Math.round((avgB - avgA) * 100) / 100,
      promotedA: roundA?.gate?.promoted?.length ?? 0,
      promotedB: roundB?.gate?.promoted?.length ?? 0,
      idMatched,
      fuzzyMatched,
    },
  };
}

/**
 * formatDiffText(diff) — 把 diffRounds 输出渲染成 stdout 文本。
 */
export function formatDiffText(diff) {
  const lines = [];
  lines.push(`🔄 Round ${diff.roundA} → Round ${diff.roundB}`);
  const sign = diff.stats.avgScoreDelta >= 0 ? '+' : '';
  const matchInfo = [];
  if (diff.stats.idMatched != null) matchInfo.push(`${diff.stats.idMatched} by-id`);
  if (diff.stats.fuzzyMatched != null) matchInfo.push(`${diff.stats.fuzzyMatched} fuzzy`);
  const matchSuffix = matchInfo.length ? `  [matched: ${matchInfo.join(', ')}]` : '';
  lines.push(
    `Stats: avg score ${diff.stats.avgScoreA} → ${diff.stats.avgScoreB} (Δ ${sign}${diff.stats.avgScoreDelta}); promoted ${diff.stats.promotedA} → ${diff.stats.promotedB}; proposals ${diff.stats.proposalsA} → ${diff.stats.proposalsB}${matchSuffix}`,
  );
  if (diff.added.length) {
    lines.push('');
    lines.push(`➕ Added (${diff.added.length}):`);
    for (const p of diff.added) {
      lines.push(`  + ${p.title}  [${p.type}]  score=${p.score ?? '?'}, decision=${p.decision ?? '?'}`);
    }
  }
  if (diff.removed.length) {
    lines.push('');
    lines.push(`➖ Removed (${diff.removed.length}):`);
    for (const p of diff.removed) {
      lines.push(`  - ${p.title}  [${p.type}]  was score=${p.score ?? '?'}, was decision=${p.decision ?? '?'}`);
    }
  }
  if (diff.changed.length) {
    lines.push('');
    lines.push(`🔁 Changed (${diff.changed.length}):`);
    for (const p of diff.changed) {
      const sDelta = p.scoreDelta != null ? `Δscore=${p.scoreDelta >= 0 ? '+' : ''}${p.scoreDelta}` : 'Δscore=?';
      const gChange = p.decisionChange ? `decision ${p.decisionChange.from} → ${p.decisionChange.to}` : '';
      const matchTag = p.matchedBy === 'fuzzy' ? `  [fuzzy=${p.similarity}, ${p.idA}≡${p.idB}]` : '';
      lines.push(`  ~ ${p.title}  [${p.type}]  ${sDelta}${gChange ? ', ' + gChange : ''}${matchTag}`);
    }
  }
  if (diff.unchanged.length) {
    lines.push('');
    lines.push(`✓ Unchanged (${diff.unchanged.length})`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// --export-md 模式(iter #57):把整 session 打包成 1 个自包含 markdown
//
// 纯函数 buildExportBundle / formatExportMarkdown 已抽到 lib/agents/export-bundle.mjs
// (iter #59),CLI + 浏览器 export 页共享同一份实现。CLI 端从顶部 import + re-export,
// 见 file head。
//
// IO 部分(留在 CLI 这一侧):
//   loadExportBundle(sessionId)  — 读 archive/<sid>/{meta,rounds,digest,synthesis}
// ---------------------------------------------------------------------------

/**
 * loadExportBundle(sessionId) — IO:从 archive/<sid>/ 读 meta + rounds + syntheses + digest。
 * 找不到 meta.json → 抛清晰错误。
 */
export async function loadExportBundle(sessionId) {
  const root = join('archive', sessionId);
  if (!existsSync(root)) {
    throw new Error(`session ${sessionId} not found (no archive/${sessionId}/ dir)`);
  }
  let meta = null;
  try {
    meta = JSON.parse(await readFile(join(root, 'meta.json'), 'utf8'));
  } catch (err) {
    throw new Error(`failed to read meta.json: ${err.message}`);
  }

  let rounds = [];
  try {
    const files = (await readdir(join(root, 'rounds')))
      .filter((f) => /^round_\d+\.json$/.test(f))
      .sort();
    rounds = await Promise.all(
      files.map((f) => readFile(join(root, 'rounds', f), 'utf8').then((s) => JSON.parse(s))),
    );
    rounds.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  } catch (err) {
    console.warn(`[export-md] failed to read rounds: ${err.message}`);
  }

  let syntheses = [];
  try {
    const sfiles = (await readdir(join(root, 'synthesis')))
      .filter((f) => /^synthesis_\d+\.md$/.test(f))
      .sort();
    syntheses = await Promise.all(
      sfiles.map(async (f) => {
        const m = f.match(/^synthesis_(\d+)\.md$/);
        const idx = m ? Number(m[1]) : 0;
        const raw = await readFile(join(root, 'synthesis', f), 'utf8');
        return { idx, raw };
      }),
    );
    syntheses.sort((a, b) => a.idx - b.idx);
  } catch (err) {
    // synthesis/ 可能不存在(无 rounds 时);静默
  }

  // digest:取最新 1 份 (lex 排序最末 = 同一天的最后一份)
  let digest = null;
  try {
    const dfiles = (await readdir(root))
      .filter((f) => /^digest_\d+\.md$/.test(f))
      .sort();
    if (dfiles.length) {
      digest = await readFile(join(root, dfiles[dfiles.length - 1]), 'utf8');
    }
  } catch (err) {
    // digest/ 可能不存在;静默
  }

  return buildExportBundle({ meta, rounds, syntheses, digest });
}

/**
 * loadDeliverables(sessionId) — IO:读 archive/<sid>/{drafts,reviews,experiments,
 * paper_additions,rebuttals}/*.md,返回 paper-compiler 要的 DeliverableInput[]。
 *
 * 目录不存在(该 session 没产出这类 deliverable)是正常情况,静默跳过。
 * 文件名里的 round / idx 用来做稳定排序:<prefix>_r<NNN>_<idx>.md。
 */
export async function loadDeliverables(sessionId) {
  const root = join('archive', sessionId);
  const out = [];
  for (const [kind, subdir] of Object.entries(DELIVERABLE_DIRS)) {
    const dir = join(root, subdir);
    if (!existsSync(dir)) continue;
    let files;
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    } catch {
      continue; // 目录读不了就跳过,不让整次编译失败
    }
    for (const f of files) {
      const m = f.match(/_r(\d+)_(\d+)\.md$/);
      try {
        out.push({
          kind,
          path: join(dir, f),
          round: m ? Number(m[1]) : null,
          idx: m ? Number(m[2]) : 0,
          raw: await readFile(join(dir, f), 'utf8'),
        });
      } catch (err) {
        console.warn(`[compile-paper] skipped ${join(dir, f)}: ${err.message}`);
      }
    }
  }
  return out;
}

/**
 * loadPaperDraft(sessionId) — IO wrapper:凑齐 meta + rounds + syntheses + deliverables,
 * 交给纯函数 buildPaperDraft 装配。
 *
 * 复用 loadExportBundle 已经读好的 meta / rounds / syntheses(避免重复读盘逻辑),
 * 再补上它不需要而论文需要的 deliverables。
 */
export async function loadPaperDraft(sessionId) {
  const bundle = await loadExportBundle(sessionId);
  const deliverables = await loadDeliverables(sessionId);
  return buildPaperDraft({
    meta: bundle.meta,
    rounds: bundle.rounds,
    syntheses: bundle.syntheses,
    deliverables,
  });
}

/**
 * loadSynthesisPdfBundle(sessionId) — IO wrapper:读 archive/<sid>/{meta,synthesis},
 * 交给纯函数 buildPdfBundle 装配。
 *
 * 复用 loadExportBundle 已经读好的 meta / syntheses(避免重复读盘逻辑),
 * 它不需要 rounds / digest。session 不存在 → throws with descriptive error。
 */
export async function loadSynthesisPdfBundle(sessionId) {
  const bundle = await loadExportBundle(sessionId);
  return buildPdfBundle({
    meta: bundle.meta,
    syntheses: bundle.syntheses,
  });
}

/**
 * loadSynthesis(sessionId, idx) — IO:读 archive/<sid>/synthesis/synthesis_<NNN>.md。
 * 找不到 → throws with descriptive error。给 diff / pdf 单文件喂 raw 内容。
 */
export async function loadSynthesis(sessionId, idx) {
  const path = join('archive', sessionId, 'synthesis', `synthesis_${String(idx).padStart(3, '0')}.md`);
  if (!existsSync(path)) {
    throw new Error(`synthesis file not found: ${path}`);
  }
  const raw = await readFile(path, 'utf8');
  return { idx, raw };
}

/**
 * loadSynthesesPair(sessionId, idxA, idxB) — IO wrapper:一次读两份合成喂给
 * diffSyntheses 纯函数。idxA / idxB 任一不存在就 throws(另一边不读)。
 */
export async function loadSynthesesPair(sessionId, idxA, idxB) {
  const [a, b] = await Promise.all([
    loadSynthesis(sessionId, idxA),
    loadSynthesis(sessionId, idxB),
  ]);
  return { a, b };
}

/**
 * loadDiff(sessionId, roundA, roundB) — IO wrapper,读 archive/<sid>/rounds/round_<A|B>.json。
 * 找不到 roundA / roundB → throws with descriptive error。
 */
async function loadDiff(sessionId, roundA, roundB) {
  const files = await listExistingRounds(sessionId);
  const byRound = new Map();
  for (const f of files) {
    const m = f.match(/round_(\d+)\.json$/);
    if (m) byRound.set(Number(m[1]), f);
  }
  if (!byRound.has(roundA)) throw new Error(`round ${roundA} not found in archive/${sessionId}/rounds/`);
  if (!byRound.has(roundB)) throw new Error(`round ${roundB} not found in archive/${sessionId}/rounds/`);
  const recA = JSON.parse(await readFile(byRound.get(roundA), 'utf8'));
  const recB = JSON.parse(await readFile(byRound.get(roundB), 'utf8'));
  return diffRounds(recA, recB);
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
 * formatAddPaperMarkdown(proposal, ctx) — add_paper 类型的 markdown 引用清单。
 * 纯函数;列出 evidence.paperIds + rationale + 下一步。
 */
export function formatAddPaperMarkdown(proposal, ctx = {}) {
  const fm = formatDraftFrontmatter(proposal, ctx);
  const paperIds = proposal.evidence?.paperIds ?? [];
  const sections = [
    fm,
    '',
    `# 📄 ${proposal.title ?? '(untitled paper addition)'}`,
    '',
    `> Round ${ctx.round ?? '?'} · ${ctx.decision ?? 'candidate'} · session \`${ctx.session_id ?? 'unknown'}\``,
    '',
    '## 加入理由 / Why',
    proposal.rationale || '_(未提供)_',
    '',
    '## 候选论文 IDs',
    paperIds.length ? paperIds.map((id) => `- ${id}`).join('\n') : '- (无)',
    '',
    '## 风险',
    proposal.risk || '_(未声明)_',
    '',
    '## 下一步',
    ctx.dryRun
      ? '- [ ] 用 paper-analyzer 对每个 paperId 跑速览,生成中文摘要'
      : '- [ ] 查 arxiv → 写入 docs/papers/<id>.md → /papers/ 列表可见',
    '',
  ];
  return sections.join('\n');
}

/**
 * formatRebuttalMarkdown(proposal, ctx) — rebuttal 类型的 markdown 反驳信骨架。
 * 纯函数;结构:reviewer comments / responses / changes to manuscript。
 */
export function formatRebuttalMarkdown(proposal, ctx = {}) {
  const fm = formatDraftFrontmatter(proposal, ctx);
  const paperIds = proposal.evidence?.paperIds ?? [];
  const sections = [
    fm,
    '',
    `# ✉️ ${proposal.title ?? '(untitled rebuttal)'}`,
    '',
    `> Round ${ctx.round ?? '?'} · ${ctx.decision ?? 'candidate'} · session \`${ctx.session_id ?? 'unknown'}\``,
    '',
    '## 摘要 / Summary',
    proposal.rationale || '_(未提供)_',
    '',
    '## 目标论文',
    paperIds.length ? paperIds.map((id) => `- ${id}`).join('\n') : '- (未指定)',
    '',
    '## Reviewer Comments',
    ctx.body?.reviewer_comments ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下从 OpenReview / 会议 review 抓取。'
        : '> - Reviewer 1:\n> - Reviewer 2:\n> - Reviewer 3:'
    ),
    '',
    '## Responses',
    ctx.body?.responses ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下逐条回复。'
        : '> 对每条 reviewer comment 给出:(a) 同意 / 部分同意 / 不同意 + 理由; (b) 实验 / 引用补充。'
    ),
    '',
    '## 论文修改 / Changes to Manuscript',
    ctx.body?.changes ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符。'
        : '> - Section X 增加 Y 实验\n> - Figure Z 重画\n> - 引用补充 W'
    ),
    '',
    '## 风险',
    proposal.risk || '_(未声明)_',
    '',
    '## 下一步',
    ctx.dryRun
      ? '- [ ] 配置 LLM key 让 Designer 用真 LLM 生成 reviewer_comments / responses / changes'
      : '- [ ] 对每条 review 写 response → 修改论文 → 上传 rebuttal',
    '',
  ];
  return sections.join('\n');
}

/**
 * formatExperimentMarkdown(proposal, ctx) — experiment_plan 类型的 markdown 实验方案。
 * 纯函数;结构:hypothesis / method / dataset / metrics / risks / next-steps。
 * 字段 hypothesis / method / dataset / metrics 接受 ctx.body 注入(LLM 真跑时覆盖)。
 */
export function formatExperimentMarkdown(proposal, ctx = {}) {
  const fm = formatDraftFrontmatter(proposal, ctx);
  const paperIds = proposal.evidence?.paperIds ?? [];
  const body = ctx.body ?? null;
  const sections = [
    fm,
    '',
    `# 🧪 ${proposal.title ?? '(untitled experiment)'}`,
    '',
    `> Round ${ctx.round ?? '?'} · ${ctx.decision ?? 'candidate'} · session \`${ctx.session_id ?? 'unknown'}\``,
    '',
    '## 假设 / Hypothesis',
    body?.hypothesis ?? proposal.rationale ?? '_(未提供)_',
    '',
    '## 方法 / Method',
    body?.method ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下生成实验步骤。'
        : '> 在此区域详细描述实验步骤 / 模型架构 / 训练流程。'
    ),
    '',
    '## 数据集 / Dataset',
    body?.dataset ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下指定数据集 + 划分方式。'
        : '> - 数据集:\n> - 划分:train / val / test\n> - 规模:'
    ),
    '',
    '## 评估指标 / Metrics',
    body?.metrics ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下指定主指标 + 辅助指标。'
        : '> - 主指标:\n> - 辅助指标:\n> - baseline 对比:'
    ),
    '',
    '## 算力 / Compute',
    body?.compute ?? (
      ctx.dryRun
        ? '> DRY-RUN 占位符;LLM 模式下估算 GPU·h / 内存峰值。'
        : '> 估算:约 N GPU·h(单卡 A100 / 8×A100 / TPU pod)'
    ),
    '',
    '## 相关论文 / Related Work',
    paperIds.length ? paperIds.map((id) => `- ${id}`).join('\n') : '- (无)',
    '',
    '## 风险 / Risks',
    proposal.risk || '_(未声明)_',
    '',
    '## 下一步',
    ctx.dryRun
      ? '- [ ] 配置 LLM key 重跑,Designer 生成完整 method / dataset / metrics'
      : '- [ ] 细化方法 → 准备数据 → baseline 跑通 → 主实验',
    '',
  ];
  return sections.join('\n');
}

/**
 * writeDeliverable(proposal, ctx) — 把 proposal 写成真 .md 文件。
 * 路径:archive/<sid>/{drafts,reviews,experiments}/<type>_<round>_<idx>.md
 * 幂等:文件已存在则不覆盖,返回 skipped=true。
 * 返回:{ written: bool, path: string|null, kind: 'draft'|'review'|'experiment'|null }
 */
export async function writeDeliverable(proposal, ctx = {}) {
  const sid = ctx.session_id;
  if (!sid) return { written: false, path: null, kind: null, reason: 'missing session_id' };
  let subdir = null;
  let formatter = null;
  if (proposal.type === 'create_draft') { subdir = 'drafts'; formatter = formatDraftMarkdown; }
  else if (proposal.type === 'literature_review') { subdir = 'reviews'; formatter = formatReviewMarkdown; }
  else if (proposal.type === 'experiment_plan') { subdir = 'experiments'; formatter = formatExperimentMarkdown; }
  else if (proposal.type === 'add_paper') { subdir = 'paper_additions'; formatter = formatAddPaperMarkdown; }
  else if (proposal.type === 'rebuttal') { subdir = 'rebuttals'; formatter = formatRebuttalMarkdown; }
  else return { written: false, path: null, kind: null, reason: `unsupported type ${proposal.type}` };

  const round = ctx.round ?? 0;
  const idx = ctx.idx ?? 0;
  const prefixByType = {
    drafts: 'draft',
    reviews: 'review',
    experiments: 'exp',
    paper_additions: 'paper',
    rebuttals: 'rebuttal',
  };
  const kindByType = {
    drafts: 'draft',
    reviews: 'review',
    experiments: 'experiment',
    paper_additions: 'paper_addition',
    rebuttals: 'rebuttal',
  };
  const prefix = prefixByType[subdir];
  const dir = join('archive', sid, subdir);
  const file = join(dir, `${prefix}_r${String(round).padStart(3, '0')}_${idx}.md`);
  await mkdir(dir, { recursive: true });
  // 幂等:文件已存在不覆盖
  if (existsSync(file)) {
    return { written: false, path: file, kind: kindByType[subdir], skipped: true };
  }
  const content = formatter(proposal, ctx);
  await writeFile(file, content);
  return { written: true, path: file, kind: kindByType[subdir], skipped: false };
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
      // 真写 deliverable:5 种 ProposalType 全覆盖
      // → archive/<sid>/{drafts,reviews,experiments,paper_additions,rebuttals}/*.md
      let deliverableResult = null;
      if (['create_draft', 'literature_review', 'experiment_plan', 'add_paper', 'rebuttal'].includes(p.type)) {
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
          ? ({
              draft: 'write_draft_md',
              review: 'write_review_md',
              experiment: 'write_experiment_md',
              paper_addition: 'write_paper_addition_md',
              rebuttal: 'write_rebuttal_md',
            }[deliverableResult.kind] ?? 'archive_round_summary')
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
// --search-arxiv:Designer tool use (iter #56)
//
// arXiv API export.arxiv.org/api/query 走原生 fetch,XML 用正则抽 entry (Node 无 DOMParser)。
// 仅搜 ti: 标题匹配,避免 all: 召回噪音;按 canonical arxiv id dedup 保留 latest。
// 输入:query (string), opts { maxResults?: number }
// 输出:Promise<Array<{ arxivId, title, tldr, summary, published, authors[] }>>
//
// 失败兜底:network 错 / 解析失败 → 返回 [] 不抛,让 round 继续跑(stub 模式)。
// ---------------------------------------------------------------------------

/**
 * parseArxivEntry(xml) — 从 arXiv API 单条 <entry> XML 抽字段。纯函数。
 * 用正则而不是 DOMParser,Node 没有原生 DOMParser;字段命名与 TS ArxivEntry 对齐。
 */
export function parseArxivEntry(xml) {
  const idMatch = xml.match(/<id>\s*(https?:\/\/arxiv\.org\/abs\/([^<>\s]+))\s*<\/id>/);
  if (!idMatch) return null;
  const arxivId = idMatch[2].trim();
  const titleMatch = xml.match(/<title>\s*([\s\S]*?)\s*<\/title>/);
  const summaryMatch = xml.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
  const publishedMatch = xml.match(/<published>\s*([^<]+?)\s*<\/published>/);
  const updatedMatch = xml.match(/<updated>\s*([^<]+?)\s*<\/updated>/);
  const authors = [];
  const authorRe = /<author>\s*<name>\s*([^<]+?)\s*<\/name>/g;
  let m;
  while ((m = authorRe.exec(xml)) !== null) authors.push(m[1].trim());
  return {
    arxivId,
    title: (titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    summary: (summaryMatch?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    published: publishedMatch?.[1]?.trim() ?? '',
    updated: updatedMatch?.[1]?.trim() ?? '',
    authors,
  };
}

/**
 * canonicalArxivId(id) — 去掉 /v\d+ 后缀,避免 v1/v2 视为不同论文。
 * 与 astro-src/lib/dom-utils.ts canonicalArxivId 行为一致。
 */
export function canonicalArxivId(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/\/v\d+$/i, '').replace(/v\d+$/i, '');
}

/**
 * searchArxivApi(query, opts) — 调 arXiv API,返回 dedup + 截断后的 candidates。
 * 纯 IO,内部失败 → 返回 [],不抛(让 round 跑 stub)。
 *
 * opts.maxResults 默认 12(与 paper-analyzer.ts:searchArxiv 一致)。
 */
export async function searchArxivApi(query, opts = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) return [];
  const maxResults = Math.max(1, Math.min(50, opts.maxResults ?? 12));
  const q = query.trim();
  // 限定 ti: 标题匹配 + 默认 cs 主流类目过滤
  // 类目过滤与 paper-analyzer.ts:buildCategoryFilter 行为一致,但硬编码避免引 settings.ts
  const cats = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.CV', 'cs.MA', 'cs.IR'];
  const catFilter = cats.map((c) => `cat:${c}`).join(' OR ');
  const searchExpr = `ti:"${q.replace(/"/g, '\\"')}" AND (${catFilter})`;
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchExpr)}&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

  let xmlText;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'dpr-agents-runner/1.0 (+https://github.com/Canyon-netizen/daily-paper-reader)' },
    });
    if (!res.ok) {
      console.warn(`[search-arxiv] HTTP ${res.status} for "${q}"`);
      return [];
    }
    xmlText = await res.text();
  } catch (err) {
    console.warn(`[search-arxiv] network failed for "${q}": ${err.message}`);
    return [];
  }

  // 抽所有 <entry>...</entry> 块;允许跨行
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  const entries = [];
  let m;
  while ((m = entryRe.exec(xmlText)) !== null) {
    const parsed = parseArxivEntry(m[1]);
    if (parsed && parsed.arxivId && parsed.title) entries.push(parsed);
  }

  // 按 canonical id dedup,保留 updated 最新的
  const byCanonical = new Map();
  for (const e of entries) {
    const key = canonicalArxivId(e.arxivId);
    const cur = byCanonical.get(key);
    if (!cur || (e.updated || '') > (cur.updated || '')) byCanonical.set(key, e);
  }
  return Array.from(byCanonical.values()).slice(0, maxResults);
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
  // 模式 -1: --quickstart (新用户零摩擦入口,iter #54)
  // 等价于 --new-session GOAL --rounds 1 --preset aggressive --dry-run,
  // 然后打印 1 段友好 summary,列出产生了哪些文件 + 4 条下一步建议。
  // 注:--quickstart 始终 dry-run(无 API key 也能跑),真跑请用 --new-session。
  // 必须放在 preset/dryRun const 之前,否则会被默认值盖住。
  if (args.quickstart !== undefined) {
    const goal = args.quickstart;
    if (typeof goal !== 'string' || goal.trim().length === 0) {
      console.error('[error] --quickstart requires a non-empty GOAL string');
      process.exit(2);
    }
    // opinionated defaults: 1 round + dry-run + aggressive(让 Modifier 写 deliverables)
    args.newSession = goal;
    if (args.maxRounds === undefined) args.maxRounds = 1;
    if (args.preset === undefined) args.preset = 'aggressive';
    args.dryRun = true;
    args._quickstartMode = true;
  }

  const preset = args.preset ?? 'balanced';
  if (!['conservative', 'balanced', 'aggressive'].includes(preset)) {
    console.error(`[error] --preset must be conservative|balanced|aggressive, got: ${preset}`);
    process.exit(2);
  }

  const caller = makeLLMCaller({});
  const dryRun = !!args.dryRun;

  // 模式 -1: --auto (autonomous research loop,优先于所有其他模式)
  if (typeof args.auto === 'string' && args.auto.trim()) {
    const goal = args.auto.trim();
    let sid = args.project ?? args.session ?? null; // 不强制 sid,让 generateSessionId 派生

    // --auto-resume: 强制要求 --session,refuse 创建新 session
    if (args.autoResume) {
      if (!sid) {
        console.error('[error] --auto-resume requires --session SID (refuses to create a new session)');
        process.exit(2);
      }
      const metaPath = join(process.cwd(), 'archive', sid, 'meta.json');
      try {
        const st = await stat(metaPath);
        if (!st.isFile()) throw new Error('not a file');
      } catch {
        console.error(`[error] --auto-resume: no meta.json found at ${metaPath}`);
        console.error('        session must exist on disk; use plain --auto to bootstrap a new session.');
        process.exit(2);
      }
    }

    try {
      const result = await runAutoLoop(goal, {
        caller,
        dryRun,
        preset,
        maxCycles: args.maxCycles ?? 5,
        directiveMode: args.autoDirectiveMode ?? 'gaps',
        stopThreshold: args.autoStopThreshold ?? 2,
        sessionId: sid ?? undefined,
        noCandidates: !!args.noCandidates,
        resume: args.resume ?? true,
      });
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatAutoSummary(result));
      }
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
    return;
  }

  // 模式 0: --new-session (bootstrap,优先于所有其他模式)
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
    // 跨 session few-shot examples(iter #39):把 leaderboard topElo 注入
    const fewShotN = Math.max(0, Number(args.fewShotFrom ?? 0));
    if (fewShotN > 0) {
      const examples = await loadTopProposals({ topN: fewShotN, excludeSid: sid });
      if (examples.length) {
        args._fewShotExamples = examples;
        if (!args.json) {
          console.log(`[few-shot-from] loaded ${examples.length} examples from past sessions (excluded ${sid})`);
        }
      }
    }
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

  // 模式 0.5: --diff (两 round diff,无 LLM 调用)
  if (args.diff) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --diff requires --session ID');
      process.exit(2);
    }
    const positions = args._.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (positions.length < 2) {
      console.error('[error] --diff requires two positional round numbers, e.g. --diff 1 3');
      process.exit(2);
    }
    const [roundA, roundB] = positions;
    try {
      const diff = await loadDiff(sessionId, roundA, roundB);
      if (args.json) {
        console.log(JSON.stringify({ sessionId, ...diff }, null, 2));
      } else {
        console.log(formatDiffText(diff));
      }
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
    return;
  }

  // 模式 0.6: --export-md (整 session 打包成 1 个 markdown,iter #57)
  if (args.exportMd !== undefined) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --export-md requires --session ID');
      process.exit(2);
    }
    try {
      const bundle = await loadExportBundle(sessionId);
      if (args.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        const outPath = args.exportMd.length > 0
          ? args.exportMd
          : join('archive', sessionId, 'export.md');
        const md = formatExportMarkdown(bundle);
        const outDir = dirname(outPath);
        if (outDir && outDir !== '.' && !existsSync(outDir)) {
          await mkdir(outDir, { recursive: true });
        }
        await writeFile(outPath, md, 'utf8');
        console.log(`📦 Exported session ${sessionId} → ${outPath}`);
        console.log(`   ${bundle.stats.rounds} rounds, ${bundle.stats.proposals} proposals, ${bundle.stats.applied} applied, ${bundle.stats.syntheses} syntheses, hasDigest=${bundle.stats.hasDigest}`);
      }
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
    return;
  }

  // 模式 0.63: --diff-syntheses <idxA> <idxB> (iter #66)
  if (args.diffSyntheses) {
    if (args._err) {
      console.error(`[error] ${args._err}`);
      process.exit(2);
    }
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --diff-syntheses requires --session ID');
      process.exit(2);
    }
    const { idxA, idxB } = args.diffSyntheses;
    try {
      const { a, b } = await loadSynthesesPair(sessionId, idxA, idxB);
      const diff = diffSyntheses(a, b);
      if (args.json) {
        console.log(JSON.stringify(diff, null, 2));
        return;
      }
      console.log(formatSynthesisDiffText(diff));
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
    return;
  }

  // 模式 0.67: --web-search "<QUERY>" (iter #68)
  if (args.webSearch != null) {
    const query = String(args.webSearch ?? '').trim();
    if (!query) {
      console.error('[error] --web-search requires a non-empty query string');
      process.exit(2);
    }
    const requestedBackend = args.webBackend ?? 'tavily';
    const apiKey = process.env.WEB_SEARCH_API_KEY ?? '';
    const useTavily = requestedBackend === 'tavily' && apiKey.length > 0;

    const searchOpts = {
      maxResults: args.webMax ?? 5,
      includeDomains: Array.isArray(args.includeDomain) ? args.includeDomain : undefined,
      excludeDomains: Array.isArray(args.excludeDomain) ? args.excludeDomain : undefined,
      minScore: typeof args.minScore === 'number' ? args.minScore : 0,
    };

    /** @type {{ results: any[], query: string, backend: 'stub'|'tavily', stub: boolean, error: string|null }} */
    let response;
    if (useTavily) {
      try {
        const req = buildTavilyRequest(query, { ...searchOpts, apiKey });
        const fetchResp = await fetch(req.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        });
        if (!fetchResp.ok) {
          response = {
            query, backend: 'tavily', stub: false,
            results: [],
            error: `Tavily HTTP ${fetchResp.status}: ${fetchResp.statusText}`,
          };
        } else {
          const json = await fetchResp.json();
          const parsed = parseTavilyResponse(json);
          const deduped = dedupeWebSearchResults(parsed);
          const filtered = filterWebSearchResults(deduped, searchOpts);
          response = { query, backend: 'tavily', stub: false, results: filtered, error: null };
        }
      } catch (err) {
        response = {
          query, backend: 'tavily', stub: false,
          results: [],
          error: `Tavily fetch failed: ${err?.message ?? err}`,
        };
      }
    } else {
      // stub mode — 没设 WEB_SEARCH_API_KEY 或显式 --web-backend stub
      response = {
        query, backend: 'stub', stub: true, results: [], error: null,
      };
      if (requestedBackend === 'tavily' && !apiKey) {
        response.error = 'WEB_SEARCH_API_KEY not set — falling back to stub mode';
      }
    }

    if (args.json) {
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.log(formatWebSearchText(response));
      if (!useTavily && requestedBackend === 'tavily' && !apiKey) {
        // 友好提示怎么启用真 backend
        console.error('\nℹ  Set WEB_SEARCH_API_KEY (e.g. Tavily tvly-...) to enable real search.');
      }
    }
    return;
  }

  // 模式 0.64: --list-templates (打印可用 LaTeX 模板,iter #64)
  if (args.listTemplates) {
    const list = listLatexTemplates();
    console.log('📐 Available LaTeX templates (iter #64):');
    for (const t of list) {
      console.log(`  ${t.id.padEnd(12)}  ${t.preambleHead}`);
      console.log(`  ${''.padEnd(12)}  compile: ${t.compileHint}`);
    }
    return;
  }

  // 模式 0.65: --compile-paper (session 碎片 → 一篇论文,iter #61)
  if (args.compilePaper !== undefined) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --compile-paper requires --session ID');
      process.exit(2);
    }
    const format = args.paperFormat ?? 'both';
    if (!['latex', 'markdown', 'both'].includes(format)) {
      console.error(`[error] --paper-format must be latex | markdown | both (got "${format}")`);
      process.exit(2);
    }
    try {
      const draft = await loadPaperDraft(sessionId);
      if (args.json) {
        console.log(JSON.stringify(draft, null, 2));
        return;
      }
      const outDir = args.compilePaper.length > 0
        ? args.compilePaper
        : join('archive', sessionId, 'paper');
      if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

      const written = [];
      if (format === 'markdown' || format === 'both') {
        const p = join(outDir, 'paper.md');
        await writeFile(p, formatPaperMarkdown(draft), 'utf8');
        written.push(p);
      }
      // iter #64: --latex-template 选择具体模板
      const tmplName = args.latexTemplate ?? 'article';
      if (!PAPER_LATEX_TEMPLATES[tmplName]) {
        console.error(`[error] unknown --latex-template "${tmplName}". Available: ${Object.keys(PAPER_LATEX_TEMPLATES).join(', ')}`);
        process.exit(2);
      }
      const compileHint = getLatexCompileHint(tmplName);
      if (format === 'latex' || format === 'both') {
        const tex = join(outDir, 'paper.tex');
        await writeFile(tex, formatPaperLatex(draft, { documentclass: tmplName }), 'utf8');
        written.push(tex);
        const bib = join(outDir, 'refs.bib');
        await writeFile(bib, formatBibtex(draft.bibliography), 'utf8');
        written.push(bib);
      }

      const s = draft.stats;
      console.log(`📄 Compiled paper for session ${sessionId} → ${outDir}/`);
      for (const p of written) console.log(`   ✍️  ${p}`);
      console.log(`   template: ${tmplName}`);
      console.log(`   ${s.rounds} rounds · ${s.deliverables} deliverables · ${s.sectionsWithContent}/${draft.sections.length} sections filled · ${s.references} references`);
      const emptySections = draft.sections.filter((x) => x.empty).map((x) => x.title);
      if (emptySections.length) {
        console.log(`   ⚠️  empty sections: ${emptySections.join(', ')}`);
        console.log('      (跑更多轮让 Modifier 产出对应 deliverable,或用 --promote --write-deliverable 手动补)');
      }
      if (format !== 'markdown') {
        console.log(`   编译:${compileHint}`);
      }
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
    return;
  }

  // 模式 0.66: --export-pdf (synthesis → 打印就绪 HTML,iter #63)
  if (args.exportPdf !== undefined) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --export-pdf requires --session ID');
      process.exit(2);
    }
    const style = args.pdfStyle ?? 'academic';
    if (!['academic', 'compact', 'presentation'].includes(style)) {
      console.error(`[error] --pdf-style must be academic | compact | presentation (got "${style}")`);
      process.exit(2);
    }
    try {
      const bundle = await loadSynthesisPdfBundle(sessionId);
      if (args.json) {
        console.log(JSON.stringify(bundle, null, 2));
        return;
      }

      // 解析输出路径:无参数 = archive/<sid>/synthesis.html;
      // 给的是目录(以 / 结尾或不存在 .html 后缀且是已存在的目录)= 落到该目录
      // 给的是文件路径(以 .html 结尾或不存在)= 写到该文件
      let outPath;
      const arg = args.exportPdf;
      if (!arg) {
        outPath = join('archive', sessionId, 'synthesis.html');
      } else if (arg.endsWith('/') || (existsSync(arg) && (await stat(arg)).isDirectory())) {
        const fname = buildPdfFileName(sessionId);
        outPath = join(arg, fname);
      } else if (arg.endsWith('.html') || arg.endsWith('.htm')) {
        outPath = arg;
      } else {
        // 不带 .html 后缀且不是目录:也当文件路径(append .html)
        outPath = `${arg}.html`;
      }
      if (!existsSync(dirname(outPath))) await mkdir(dirname(outPath), { recursive: true });

      const html = formatPdfHtml(bundle, { cssVariant: style });
      await writeFile(outPath, html, 'utf8');

      console.log(`📑 Synthesized print-ready HTML for session ${sessionId}`);
      console.log(`   ✍️  ${outPath}  (${(html.length / 1024).toFixed(1)} KB)`);
      console.log(`   📊 ${bundle.stats.syntheses} synthesis / synthesis · ${bundle.syntheses.length} pieces · style=${style}`);
      console.log(`   🖨  Open in browser, then Cmd/Ctrl+P → "Save as PDF" (推荐边距:默认 / 缩放:100% / 启用"背景图形")`);
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
    return;
  }

  // 模式 0.7: --leaderboard (跨 session 聚合,无 LLM 调用)
  if (args.leaderboard) {
    const topN = args.top ?? 10;
    const typeFilter = args.type ?? null;
    const report = await loadLeaderboard({ topN, typeFilter });
    if (args.json) {
      console.log(JSON.stringify({ typeFilter, topN, ...report }, null, 2));
    } else {
      console.log(formatLeaderboardText(report, { typeFilter }));
    }
    return;
  }

  // 模式 0.8: --promote (手动升级,无 LLM 调用,可选写 deliverable)
  if (args.promote) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --promote requires --session ID');
      process.exit(2);
    }
    const positions = args._.map((x) => String(x));
    if (positions.length < 2) {
      console.error('[error] --promote requires two positional args: roundN proposalId');
      process.exit(2);
    }
    const roundN = Number(positions[0]);
    const proposalId = positions[1];
    if (!Number.isFinite(roundN)) {
      console.error(`[error] first positional must be a numeric round number, got: ${positions[0]}`);
      process.exit(2);
    }
    try {
      const result = await promoteProposal(sessionId, roundN, proposalId, {
        writeDeliverable: !!args.writeDeliverable,
        actor: 'cli',
      });
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatPromoteText(result));
      }
      if (!result.ok) process.exit(3);
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
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

  // 模式 0.9: --synthesize (跨 round 综合 session 答案)
  if (args.synthesize) {
    const sessionId = args.project ?? args.session;
    if (!sessionId) {
      console.error('[error] --synthesize requires --session ID');
      process.exit(2);
    }
    try {
      const result = await runSynthesis(sessionId, {
        caller,
        dryRun,
        model: process.env.LLM_MODEL ?? 'stub',
      });
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatSynthesisText(result));
      }
      if (!result.written) process.exit(3);
    } catch (err) {
      console.error(`[error] ${err.message}`);
      process.exit(2);
    }
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
        noSynthesize: !!args.noSynthesize,
        fewShotExamples: args._fewShotExamples ?? [],
        _quickstartMode: !!args._quickstartMode,
        searchArxiv: args.searchArxiv ?? null,
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
    noSynthesize: !!args.noSynthesize,
    fewShotExamples: args._fewShotExamples ?? [],
    _quickstartMode: !!args._quickstartMode,
    searchArxiv: args.searchArxiv ?? null,
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
  // 或者 --search-arxiv 提供了真 arXiv 实时搜索(覆盖 archive 推荐)
  let candidates = [];
  let candidatesSource = 'archive';
  if (opts.searchArxiv) {
    const queried = await searchArxivApi(opts.searchArxiv, { maxResults: 12 });
    candidates = queried.map((q) => ({
      arxivId: q.arxivId,
      title: q.title,
      tldr: q.summary?.slice(0, 200),
    }));
    candidatesSource = `arxiv-search:${opts.searchArxiv}`;
    console.log(`  [search-arxiv] loaded ${candidates.length} papers from arXiv API for "${opts.searchArxiv}"`);
  } else if (!opts.noCandidates) {
    candidates = await loadCandidatesFromArchive(sessionId, 30);
    if (candidates.length) {
      console.log(`  [candidates] loaded ${candidates.length} papers from archive/${sessionId}/recommend/`);
    }
  }
  console.log(`  [candidates-source] ${candidatesSource}`);

  const input = {
    project: { id: sessionId, name: sessionId, statement: '(auto)' },
    candidates,
    user_goal: '(CLI auto-run)',
    round: startRound,
    session_id: sessionId,
    previous_rounds: previousRounds,
    previous_designer_examples: opts.fewShotExamples ?? [],
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

  // 自动综合(除非 --no-synthesize 显式关掉)
  if (!opts.noSynthesize) {
    try {
      const synth = await runSynthesis(sessionId, {
        caller,
        dryRun: opts.dryRun,
        model: process.env.LLM_MODEL ?? 'stub',
      });
      console.log(`[session ${sessionId}] synthesis → ${synth.path} (#${synth.synthesisIndex}, prior=${synth.priorCount})`);
    } catch (err) {
      console.warn(`[session ${sessionId}] synthesis failed: ${err.message}`);
    }
  }

  // --quickstart 模式:跑完后打印友好 summary(iter #54)
  if (opts._quickstartMode) {
    printQuickstartSummary(sessionId);
  }
}

// ---------------------------------------------------------------------------
// --quickstart 友好 summary(iter #54):列出本轮产出 + 4 条下一步命令
// ---------------------------------------------------------------------------

function printQuickstartSummary(sessionId) {
  const sid = sessionId;
  const files = [
    `archive/${sid}/meta.json`,
    `archive/${sid}/rounds/round_001.json`,
    `archive/${sid}/digest_<YYYYMMDD>.md`,
    `archive/${sid}/synthesis/synthesis_001.md`,
  ];
  console.log(`
🎉 Quickstart 完成 — 你的第一个 3 智能体 session 已落地:

   session id: ${sid}

📂 产出文件:
   - archive/${sid}/meta.json               (session 元数据)
   - archive/${sid}/rounds/round_001.json   (Designer + Feedback + Gate + Modifier 完整轮)
   - archive/${sid}/drafts/ / reviews/ /    (Modifier 真写的 deliverables)
     experiments/ / paper_additions/ /
     rebuttals/   (按 proposal type 路由)
   - archive/${sid}/digest_<YYYYMMDD>.md    (1 段中文摘要)
   - archive/${sid}/synthesis/synthesis_001.md  (Deep-Research 综合报告)

🚀 下一步:
   1. 浏览器看结果:    /agents/${sid}/  (localStorage 已写一份副本)
   2. 继续跑 3 轮:     node astro-src/scripts/agents-run.mjs --session ${sid} --rounds 3
   3. 看全局战况:       node astro-src/scripts/agents-run.mjs --leaderboard
   4. 接真 LLM 再跑:    LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... \\
                        node astro-src/scripts/agents-run.mjs --new-session "<新目标>" --rounds 3

🔬 这是 3 智能体闭环的一次跑通版本 — Designer 提议 → Feedback 多 persona 评分 →
   Gate 过滤 → Modifier 真写 deliverables。详见 docs/agents-workflow.md。
`);
}

// ---------------------------------------------------------------------------
// --synthesize 模式:跨 round 综合 session 答案(Deep-Research-style)
//
// 把整段 session 跑过的 rounds + 已写的 deliverables + promotions 喂给 LLM,
// 产出 1 份统一的"对研究问题的回答 + 论据 + gap + 下一步" markdown,落盘到
// archive/<sid>/synthesis/synthesis_<NNN>.md。
//
// 输入:sessionId + opts { llmCaller? }。
// 输出:{ sessionId, synthesis_index, path, written, used_rounds, used_deliverables,
//        unique_papers, model, synthesis: { answer, key_findings, evidence,
//        gaps_contradictions, next_steps } }
//
// 纯函数:collectSynthesisInputs / buildSynthesisPrompt / formatSynthesisMarkdown
// IO 边界:runSynthesis / writeSynthesis
// ---------------------------------------------------------------------------

/**
 * extractRoundProposalContexts(records) — 从 RoundRecord[] 抽出 (round, type,
 * title, rationale, paperIds, decision, score, gate_reason) 列表,供 prompt 用。
 * 纯函数;不读文件。
 */
export function extractRoundProposalContexts(records) {
  const out = [];
  for (const rec of records ?? []) {
    const verdicts = new Map((rec.gate?.verdicts ?? []).map((v) => [v.proposal_id, v]));
    const critiques = new Map((rec.feedback?.critiques ?? []).map((c) => [c.proposal_id, c]));
    for (const p of rec.designer?.proposals ?? []) {
      const v = verdicts.get(p.id);
      const c = critiques.get(p.id);
      out.push({
        round: rec.round ?? 0,
        proposal_id: p.id,
        type: p.type ?? '(?)',
        title: p.title ?? '(untitled)',
        rationale: p.rationale ?? '',
        paperIds: Array.isArray(p.evidence?.paperIds) ? p.evidence.paperIds.map(String) : [],
        decision: v?.decision ?? '(no verdict)',
        gate_reasons: Array.isArray(v?.reasons) ? v.reasons : [],
        score: Number(c?.total) || 0,
      });
    }
  }
  return out;
}

/**
 * collectDeliverables(sessionId, opts) — 扫 archive/<sid>/{drafts,reviews,
 * experiments,paper_additions,rebuttals}/*.md,返回 [{ subdir, file, type,
 * title, round, decision, paperIds, frontmatter }]。
 *
 * 纯函数:不直接读盘,接受 caller 提供的 file contents (path → text)。
 *   loadDeliverablesFromDisk(sessionId) 是 IO wrapper。
 */
export function collectDeliverables(fileMap, opts = {}) {
  const out = [];
  const paperIdsByFile = opts.paperIdsByFile ?? {};
  for (const [path, content] of Object.entries(fileMap ?? {})) {
    if (typeof content !== 'string') continue;
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const frontmatter = parseFrontmatter(fmMatch[1]);
    // path: archive/<sid>/<subdir>/<file>.md → subdir
    const parts = path.replace(/\\/g, '/').split('/');
    // expect [..., 'archive', '<sid>', '<subdir>', '<file>']
    const subdir = parts[parts.length - 2];
    // 标题 = 第一行 H1 行(去掉 # / emoji / 空白)
    const titleMatch = content.match(/^#\s+(?:📄|📚|🧪|✉️)?\s*(.+)$/m);
    out.push({
      subdir,
      file: parts[parts.length - 1],
      path,
      type: frontmatter.type ?? '(unknown)',
      title: titleMatch ? titleMatch[1].trim() : frontmatter.title ?? '(untitled)',
      round: Number(frontmatter.round) || 0,
      decision: frontmatter.decision ?? 'candidate',
      paperIds: paperIdsByFile[path] ?? extractPaperIdsFromBody(content),
      frontmatter,
    });
  }
  return out;
}

function parseFrontmatter(raw) {
  const out = {};
  for (const line of String(raw).split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    }
    out[key] = val;
  }
  return out;
}

function extractPaperIdsFromBody(content) {
  const ids = new Set();
  // arxiv id 形如 YYMM.NNNNN(v# 可选) — 4 位 + 点 + 5 位
  const re = /\b\d{4}\.\d{4,5}(?:v\d+)?\b/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.add(m[0]);
  return [...ids];
}

/**
 * collectBibliography(proposals, deliverables) — 合并 round proposals 的
 * paperIds + deliverable body 抽出的 paperIds,返回按出现次数倒序的 unique 列表。
 *
 * 纯函数。
 */
export function collectBibliography(proposalContexts, deliverables, opts = {}) {
  const limit = opts.limit ?? 50;
  const counts = new Map();
  for (const ctx of proposalContexts ?? []) {
    for (const id of ctx.paperIds ?? []) counts.set(String(id), (counts.get(String(id)) ?? 0) + 1);
  }
  for (const d of deliverables ?? []) {
    for (const id of d.paperIds ?? []) counts.set(String(id), (counts.get(String(id)) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([arxivId, count]) => ({ arxivId, count }));
}

/**
 * buildSynthesisPrompt(input) — 把 collected inputs 喂给 LLM,产出一个 JSON。
 *
 * input: { sessionId, goal, proposalContexts, deliverables, bibliography,
 *          priorSynthesisCount }
 *
 * 输出纯字符串 prompt(system + user)。
 */
export function buildSynthesisPrompt(input) {
  const ctx = input ?? {};
  const goal = String(ctx.goal ?? '(未提供研究目标)');
  const sessionId = String(ctx.sessionId ?? 'unknown');
  const proposalContexts = Array.isArray(ctx.proposalContexts) ? ctx.proposalContexts : [];
  const deliverables = Array.isArray(ctx.deliverables) ? ctx.deliverables : [];
  const bibliography = Array.isArray(ctx.bibliography) ? ctx.bibliography : [];
  const priorSynthesisCount = Number(ctx.priorSynthesisCount ?? 0) || 0;

  const system = SYNTHESIS_SYSTEM_PROMPT;
  const userLines = [];
  userLines.push(`# 研究问题 / Goal`);
  userLines.push(goal);
  userLines.push('');
  userLines.push(`# Session: ${sessionId}`);
  userLines.push(`Proposal 上下文: ${proposalContexts.length} 条`);
  userLines.push(`已写 deliverables: ${deliverables.length} 份`);
  userLines.push(`唯一引用论文(去重): ${bibliography.length} 篇`);
  userLines.push(`之前 synthesis 次数: ${priorSynthesisCount}`);
  userLines.push('');

  if (proposalContexts.length) {
    userLines.push('## Proposal 上下文(按 round 升序)');
    for (const p of proposalContexts.slice(0, 60)) {
      userLines.push(
        `- [round ${p.round}] ${p.title} [${p.type}] decision=${p.decision} score=${p.score} papers=[${p.paperIds.join(', ') || '(none)'}]`,
      );
      if (p.rationale) userLines.push(`    rationale: ${String(p.rationale).slice(0, 200)}`);
    }
    userLines.push('');
  }

  if (deliverables.length) {
    userLines.push('## 已写 Deliverables(archive/)');
    for (const d of deliverables.slice(0, 30)) {
      userLines.push(
        `- [${d.subdir}] ${d.file} — ${d.title} [${d.type}] round=${d.round} decision=${d.decision} papers=[${d.paperIds.join(', ') || '(none)'}]`,
      );
    }
    userLines.push('');
  }

  if (bibliography.length) {
    userLines.push('## Bibliography(unique paperIds,按出现次数倒序,前 30)');
    for (const b of bibliography.slice(0, 30)) {
      userLines.push(`- ${b.arxivId} (×${b.count})`);
    }
    userLines.push('');
  }

  userLines.push('## 请输出 JSON(无 markdown fence)');
  userLines.push('{');
  userLines.push('  "answer": "<直接给用户的研究问题答案,中文,3-8 段>",');
  userLines.push('  "key_findings": ["<发现 1>", "<发现 2>", ...],');
  userLines.push('  "evidence": ["<论据,引用 paperId>" , ...],');
  userLines.push('  "gaps_contradictions": ["<gap/矛盾,简述>" , ...],');
  userLines.push('  "next_steps": ["<可执行的下一步,中文>" , ...]');
  userLines.push('}');
  return { system, user: userLines.join('\n') };
}

const SYNTHESIS_SYSTEM_PROMPT = `你是资深科研综述作者,根据一段研究 session 跑过的 proposal 上下文 + 已写 deliverables + bibliography,
产出对用户原始研究问题的**统一回答**(Deep-Research-style)。

# 严格要求
- answer 必须**直面研究问题**,不是描述"做了什么" — 用户要的是答案,不是流水账。
- key_findings 是 3-6 条**最有价值的洞察**,按重要性倒序,中文,每条 1-2 句。
- evidence 是支撑 answer 的**关键引文/论据**,每条带 paperId(arxivId) 引用。
- gaps_contradictions 是**未回答的子问题**或**多 proposal 间冲突**,诚实标注。
- next_steps 是**用户接下来 3-6 步能立刻执行的动作**(跑实验 / 写论文 / 进一步读 paper),可执行,不空泛。

# 输出
JSON,无 markdown fence。字段:
  answer, key_findings[], evidence[], gaps_contradictions[], next_steps[]

# 约束
- 不要复述"rounds N proposals M"这种元信息 — 用户不关心你的流程。
- 必须用中文(用户语言是中文);只在引用 paperId 时保留英文 id。
- 如果 session 数据很薄(0-2 proposals,无 deliverables),answer 退化为"研究尚未充分,优先做 X"建议,不要硬编内容。`;

/**
 * parseSynthesisLLMResponse(raw) — 从 LLM 字符串抽 JSON。
 * 沿用 method-debate 的 4 策略:direct → fence → [...] slice → {object} wrap。
 * 返回:{ answer, key_findings, evidence, gaps_contradictions, next_steps } 或
 *      { ok: false, raw, error }。
 */
export function parseSynthesisLLMResponse(raw) {
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { /* */ }
    return null;
  };
  let parsed = tryParse(String(raw ?? ''));
  if (!parsed) {
    const m = String(raw ?? '').match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) parsed = tryParse(m[1]);
  }
  if (!parsed) {
    const i = String(raw ?? '').indexOf('{');
    const j = String(raw ?? '').lastIndexOf('}');
    if (i >= 0 && j > i) parsed = tryParse(String(raw).slice(i, j + 1));
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, raw: String(raw ?? ''), error: 'parse failed' };
  }
  const o = parsed;
  const asArr = (x) => (Array.isArray(x) ? x.map((v) => String(v)).filter(Boolean) : []);
  return {
    ok: true,
    answer: String(o.answer ?? '').slice(0, 4000),
    key_findings: asArr(o.key_findings).slice(0, 10),
    evidence: asArr(o.evidence).slice(0, 20),
    gaps_contradictions: asArr(o.gaps_contradictions).slice(0, 10),
    next_steps: asArr(o.next_steps).slice(0, 10),
  };
}

/**
 * formatSynthesisMarkdown(synthesis, ctx) — 把 LLM 输出的 JSON + 元数据
 * 渲染成最终 synthesis .md。
 *
 * ctx: { sessionId, goal, synthesisIndex, usedRounds, usedDeliverables,
 *        uniquePaperCount, generatedAt, model, dryRun }
 *
 * 纯函数。
 */
export function formatSynthesisMarkdown(synthesis, ctx = {}) {
  const s = synthesis ?? {};
  const safeTitle = String(ctx.goal ?? `Synthesis for ${ctx.sessionId ?? 'session'}`).replace(/"/g, '\\"');
  const fm = [
    '---',
    `title: "${safeTitle}"`,
    `session_id: "${ctx.sessionId ?? 'unknown'}"`,
    `schema_version: 1`,
    `synthesis_index: ${ctx.synthesisIndex ?? 0}`,
    `generated_at: "${ctx.generatedAt ?? new Date().toISOString()}"`,
    `model: "${ctx.model ?? 'stub'}"`,
    `dry_run: ${ctx.dryRun ? 'true' : 'false'}`,
    `rounds_synthesized: ${ctx.usedRounds ?? 0}`,
    `deliverables_referenced: ${ctx.usedDeliverables ?? 0}`,
    `unique_papers: ${ctx.uniquePaperCount ?? 0}`,
    '---',
  ].join('\n');

  const sections = [
    fm,
    '',
    `# 🧠 ${ctx.goal ?? 'Synthesis'}`,
    '',
    `> Session \`${ctx.sessionId ?? 'unknown'}\` · synthesis #${ctx.synthesisIndex ?? 0} · rounds=${ctx.usedRounds ?? 0} · deliverables=${ctx.usedDeliverables ?? 0} · papers=${ctx.uniquePaperCount ?? 0}`,
    '',
    '## 摘要 / Answer',
    '',
    s.ok === false
      ? `> ⚠️ LLM 解析失败:${s.error ?? 'unknown'}\n\n\`\`\`\n${(s.raw ?? '').slice(0, 1000)}\n\`\`\``
      : (s.answer && s.answer.trim()) || '_(未生成)_',
    '',
    '## 关键发现 / Key Findings',
    ...(s.key_findings?.length
      ? s.key_findings.map((f) => `- ${f}`)
      : ['- (无)']),
    '',
    '## 论据 / Evidence(带 paperId 引用)',
    ...(s.evidence?.length
      ? s.evidence.map((e) => `- ${e}`)
      : ['- (无)']),
    '',
    '## Gap & 矛盾 / Gaps & Contradictions',
    ...(s.gaps_contradictions?.length
      ? s.gaps_contradictions.map((g) => `- ${g}`)
      : ['- (无明显 gap / contradiction)']),
    '',
    '## 下一步建议 / Recommended Next Steps',
    ...(s.next_steps?.length
      ? s.next_steps.map((n) => `- [ ] ${n}`)
      : ['- [ ] (LLM 未给出建议;补一轮 Designer 跑更细的 next-step proposal)']),
    '',
    '## 元数据',
    '',
    `- 生成时间: ${ctx.generatedAt ?? new Date().toISOString()}`,
    `- Model: \`${ctx.model ?? 'stub'}\``,
    `- Dry-run: ${ctx.dryRun ? 'yes' : 'no'}`,
    `- Rounds synthesized: ${ctx.usedRounds ?? 0}`,
    `- Deliverables referenced: ${ctx.usedDeliverables ?? 0}`,
    `- Unique papers: ${ctx.uniquePaperCount ?? 0}`,
    `- 路径: \`archive/${ctx.sessionId ?? 'unknown'}/synthesis/synthesis_${String(ctx.synthesisIndex ?? 0).padStart(3, '0')}.md\``,
    '',
  ];
  return sections.join('\n');
}

/**
 * listExistingSyntheses(sessionId) — 扫 archive/<sid>/synthesis/synthesis_<NNN>.md,
 * 返回 [{ path, index }] 按 index 升序。纯函数:接受 caller 提供的目录 listing。
 */
export function listExistingSynthesesFromListing(files, sessionId) {
  const out = [];
  const re = /synthesis_(\d{3})\.md$/;
  for (const f of files ?? []) {
    const m = String(f).match(re);
    if (m) out.push({ path: f, index: Number(m[1]) });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * loadSynthesisInputs(sessionId) — IO wrapper,读 session 的 rounds +
 * meta + 所有 deliverable .md + promotions,返回给 buildSynthesisPrompt。
 */
async function loadSynthesisInputs(sessionId) {
  // 1. 读 meta.json
  let meta = null;
  try {
    meta = JSON.parse(await readFile(join('archive', sessionId, 'meta.json'), 'utf8'));
  } catch { /* 没有 meta 也继续 */ }

  // 2. 读 rounds
  const roundFiles = await listExistingRounds(sessionId);
  const records = [];
  for (const f of roundFiles) {
    try {
      records.push(JSON.parse(await readFile(f, 'utf8')));
    } catch (err) {
      console.warn(`[synthesize] skip ${f}: ${err.message}`);
    }
  }

  // 3. 读 deliverables(5 个 subdir)
  const subdirs = ['drafts', 'reviews', 'experiments', 'paper_additions', 'rebuttals'];
  const deliverableFiles = [];
  for (const sub of subdirs) {
    try {
      const files = await readdir(join('archive', sessionId, sub));
      for (const f of files) {
        if (f.endsWith('.md')) deliverableFiles.push(join('archive', sessionId, sub, f));
      }
    } catch { /* 没有这个 subdir 跳过 */ }
  }
  const fileMap = {};
  for (const p of deliverableFiles) {
    try { fileMap[p] = await readFile(p, 'utf8'); } catch { /* skip */ }
  }
  const deliverables = collectDeliverables(fileMap);

  // 4. 算 prior synthesis count
  let priorSyntheses = [];
  try {
    const sdir = await readdir(join('archive', sessionId, 'synthesis'));
    priorSyntheses = listExistingSynthesesFromListing(sdir, sessionId);
  } catch { /* 没有 synthesis/ 目录就是 0 */ }

  return {
    meta,
    records,
    deliverables,
    priorSyntheses,
    roundCount: records.length,
    deliverableCount: deliverables.length,
  };
}

/**
 * isStubLlmMode() — 检测 LLM 是否处于 stub 模式(没配 key / baseUrl)。
 * 调用方即使注入了 caller,只要没有真 key,合成走 stub 分支。
 */
function isStubLlmMode() {
  return !process.env.LLM_BASE_URL || !process.env.LLM_API_KEY;
}

/**
 * runSynthesis(sessionId, opts) — 主入口。
 *
 * opts: { caller?: LLMCaller, dryRun?: bool, model?: string }
 *
 * 永远写一份**新的** synthesis_<nextIndex>.md(N = 当前已有数 + 1),
 * 保留历史版本;不覆盖既有 synthesis。这给"再跑一次看到综合如何随 session 演化"留痕。
 *
 * 返回:{ sessionId, path, written, synthesisIndex, usedRounds, usedDeliverables,
 *        uniquePapers, model, synthesis, priorCount }
 *
 * 不写 LLM key 时 stub 模式:answer = "stub",其它字段填空,保证 round 跑通骨架。
 */
export async function runSynthesis(sessionId, opts = {}) {
  const dryRun = !!opts.dryRun;
  const model = opts.model ?? process.env.LLM_MODEL ?? 'stub';

  const inputs = await loadSynthesisInputs(sessionId);

  // 已有 synthesis 数(决定本份编号 — 永远 +1,保留历史)
  const nextIndex = (inputs.priorSyntheses?.length ?? 0) + 1;

  const proposalContexts = extractRoundProposalContexts(inputs.records);
  const bibliography = collectBibliography(proposalContexts, inputs.deliverables);

  // 0 round / 0 deliverable → 警告但仍写(skeleton + "research insufficient" 提示)
  const isThin = inputs.roundCount === 0 && inputs.deliverableCount === 0;
  // stub 模式条件:数据太薄 / dryRun / 无 caller / 环境无 LLM key
  const useStub = isThin || dryRun || !opts.caller || isStubLlmMode();

  let synthesisResult;
  if (useStub) {
    // stub 模式(stub LLM caller / 无 caller / 数据太薄)
    synthesisResult = {
      ok: true,
      answer: isThin
        ? '⚠️ Session 数据不足(无 rounds 也无 deliverables);建议先跑若干轮 Designer 让 session 累积 proposals 后再 synthesize。'
        : `(stub synthesis;配置 LLM_BASE_URL + LLM_API_KEY 后重跑可获真实回答)
研究目标:${inputs.meta?.goal ?? '(未提供)'}
当前 session 跑了 ${inputs.roundCount} rounds、写了 ${inputs.deliverableCount} deliverables、覆盖 ${bibliography.length} 篇唯一论文。
下一步:见 deliverables 文件夹 + round 摘要。`,
      key_findings: stubFindings(proposalContexts),
      evidence: bibliography.slice(0, 10).map((b) => `${b.arxivId} (引用 ×${b.count})`),
      gaps_contradictions: ['(stub 模式未识别 gap;LLM 模式会分析矛盾)'],
      next_steps: [
        '重跑 `--synthesize` with LLM key 获取真实综合',
        '如果 session 太薄,先 `--rounds 3` 跑更多 proposal',
        '审阅 archive/<sid>/drafts/reviews/experiments/ 下的 deliverables',
      ],
    };
  } else {
    const goal = inputs.meta?.goal ?? `${sessionId} 综合`;
    const { system, user } = buildSynthesisPrompt({
      sessionId,
      goal,
      proposalContexts,
      deliverables: inputs.deliverables,
      bibliography,
      priorSynthesisCount: inputs.priorSyntheses?.length ?? 0,
    });
    let raw = '';
    try {
      raw = await opts.caller.callLLM({
        system,
        user,
        temperature: 0.5,
        max_tokens: 2048,
      });
    } catch (err) {
      console.warn('[synthesize] LLM call failed, falling back to stub:', err.message);
      raw = JSON.stringify({ answer: `(LLM call failed: ${err.message})` });
    }
    synthesisResult = parseSynthesisLLMResponse(raw);
    if (!synthesisResult.ok) {
      synthesisResult.answer = synthesisResult.answer || '(LLM 输出无法解析)';
      synthesisResult.key_findings = synthesisResult.key_findings?.length ? synthesisResult.key_findings : ['(parse failed)'];
    }
  }

  // 写盘(永远 +1,保留历史)
  const dir = join('archive', sessionId, 'synthesis');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `synthesis_${String(nextIndex).padStart(3, '0')}.md`);
  const content = formatSynthesisMarkdown(synthesisResult, {
    sessionId,
    goal: inputs.meta?.goal ?? `${sessionId} synthesis`,
    synthesisIndex: nextIndex,
    usedRounds: inputs.roundCount,
    usedDeliverables: inputs.deliverableCount,
    uniquePaperCount: bibliography.length,
    generatedAt: new Date().toISOString(),
    model,
    dryRun,
  });
  await writeFile(file, content);
  return {
    sessionId,
    path: file,
    written: true,
    synthesisIndex: nextIndex,
    usedRounds: inputs.roundCount,
    usedDeliverables: inputs.deliverableCount,
    uniquePapers: bibliography.length,
    model,
    priorCount: inputs.priorSyntheses?.length ?? 0,
    synthesis: synthesisResult,
  };
}

function stubFindings(proposalContexts) {
  if (!proposalContexts?.length) return ['(无 rounds;research not started)'];
  const byType = new Map();
  for (const p of proposalContexts) {
    const key = `${p.type}:${p.title}`;
    if (!byType.has(key)) byType.set(key, p);
  }
  const deduped = [...byType.values()].slice(0, 5);
  return deduped.map((p) => `[round ${p.round}] ${p.title} — ${p.decision} (score ${p.score})`);
}

/**
 * formatSynthesisText(result) — stdout 输出。
 */
export function formatSynthesisText(result) {
  const lines = [];
  if (!result.written) {
    lines.push(`❌ Synthesis failed (no path)`);
    return lines.join('\n');
  }
  lines.push(`🧠 Synthesized [${result.sessionId}] → ${result.path}`);
  lines.push(`   synthesis #${result.synthesisIndex}  · rounds=${result.usedRounds} · deliverables=${result.usedDeliverables} · unique_papers=${result.uniquePapers}`);
  if (result.priorCount != null) {
    lines.push(`   (prior syntheses: ${result.priorCount}; history preserved)`);
  }
  lines.push(`   model: ${result.model}`);
  const s = result.synthesis ?? {};
  if (s.ok === false) {
    lines.push(`   ⚠️  LLM parse failed: ${s.error}`);
  }
  if (s.answer) {
    const preview = String(s.answer).slice(0, 300);
    lines.push(`   answer preview: ${preview}${s.answer.length > 300 ? '...' : ''}`);
  }
  if (s.key_findings?.length) {
    lines.push(`   key findings (${s.key_findings.length}):`);
    for (const f of s.key_findings.slice(0, 5)) lines.push(`     - ${f}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// --auto 模式:端到端 autonomous research loop
//
// 给一个 goal,系统自动:
//   1. bootstrap 一个 session(用 createSession + generateSessionId)
//   2. 跑 1 cycle = 1 round(designer/feedback/modifier)+ 1 synthesis
//   3. 从 synthesis 抽 directives(gaps_contradictions + next_steps)喂给下一轮 Designer
//   4. 直到 directives 收敛或到达 max_cycles
//
// 设计原则:
//   - **复用,不重写**:每个 cycle 复用 runOneRoundCLI + runSynthesis,只额外
//     注入 auto_directives 到 Designer prompt。
//   - **可中断**:每 cycle 之间检查 opts.signal?。给 watcher / 用户 abort 留口。
//   - **append-only**:不写 round_000.json;若已有 rounds,从现有数 + 1 开始。
//
// 纯函数:extractAutoDirectives / shouldAutoStop / formatAutoProgress
// IO:runAutoLoop
// ---------------------------------------------------------------------------

/**
 * extractAutoDirectives(synthesisResult, opts) — 从 synthesis 抽出 directive 列表。
 *
 * opts.mode: 'gaps' | 'next_steps' | 'both'(默认 'gaps')
 *   - 'gaps':只取 gaps_contradictions,前缀 'gap:'
 *   - 'next_steps':只取 next_steps,前缀 'next:'
 *   - 'both':两种都取,gaps 在前(更紧急的优先级高)
 * opts.maxItems: 最多取多少条 directive(默认 8,避免 prompt 过长)
 *
 * Dedup:case-insensitive + 前 80 字 prefix 比较;避免重复 directive。
 *
 * 纯函数。
 */
export function extractAutoDirectives(synthesisResult, opts = {}) {
  const mode = opts.mode ?? 'gaps';
  const maxItems = opts.maxItems ?? 8;
  const s = synthesisResult ?? {};
  const raw = [];
  if ((mode === 'gaps' || mode === 'both') && Array.isArray(s.gaps_contradictions)) {
    for (const g of s.gaps_contradictions) {
      if (typeof g === 'string' && g.trim()) raw.push(`gap:${g.trim()}`);
    }
  }
  if ((mode === 'next_steps' || mode === 'both') && Array.isArray(s.next_steps)) {
    for (const n of s.next_steps) {
      if (typeof n === 'string' && n.trim()) raw.push(`next:${n.trim()}`);
    }
  }
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const key = item.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * shouldAutoStop(opts) — 判断 autonomous loop 是否该停。
 *
 * opts: { cycle, maxCycles, directiveCount, stopThreshold, plateau? }
 *   cycle: 当前 cycle 数(从 1 开始)
 *   maxCycles: 用户指定上限(默认 5)
 *   directiveCount: 本轮 synthesis 抽出的 directive 数
 *   stopThreshold: 当 directive 数 ≤ 此值认为收敛(默认 2)
 *   plateau: 可选,plateau detector 命中时直接停
 *
 * 返回:{ stop: bool, reason: 'max_cycles' | 'converged' | 'plateau' | null }
 *
 * 纯函数。
 */
export function shouldAutoStop(opts = {}) {
  const cycle = Number(opts.cycle ?? 0);
  const maxCycles = Number(opts.maxCycles ?? 5);
  const directiveCount = Number(opts.directiveCount ?? 0);
  const stopThreshold = Number(opts.stopThreshold ?? 2);
  if (opts.plateau) return { stop: true, reason: 'plateau' };
  if (cycle >= maxCycles) return { stop: true, reason: 'max_cycles' };
  // strict < so stopThreshold=0 disables convergence (only max_cycles stops the loop)
  if (directiveCount < stopThreshold) return { stop: true, reason: 'converged' };
  return { stop: false, reason: null };
}

/**
 * formatAutoProgress(cycle, synthesisResult, opts) — 每次 cycle 完打印一行进度。
 *
 * 纯函数。
 */
export function formatAutoProgress(cycle, synthesisResult, opts = {}) {
  const lines = [];
  const maxCycles = opts.maxCycles ?? '?';
  const r = synthesisResult ?? {};
  const s = r.synthesis ?? {};
  lines.push(`🔄 Auto cycle ${cycle}/${maxCycles}  → ${r.path ?? '(no path)'}`);
  lines.push(`   synthesis #${r.synthesisIndex ?? '?'} · rounds=${r.usedRounds ?? 0} · deliverables=${r.usedDeliverables ?? 0} · unique_papers=${r.uniquePapers ?? 0}`);
  if (s.ok === false) {
    lines.push(`   ⚠️  LLM parse failed: ${s.error ?? 'unknown'}`);
  }
  if (s.answer) {
    const preview = String(s.answer).slice(0, 200).replace(/\n+/g, ' ');
    lines.push(`   answer: ${preview}${s.answer.length > 200 ? '...' : ''}`);
  }
  if (Array.isArray(s.key_findings) && s.key_findings.length) {
    lines.push(`   key findings (${s.key_findings.length}):`);
    for (const f of s.key_findings.slice(0, 3)) lines.push(`     - ${f}`);
  }
  return lines.join('\n');
}

/**
 * runAutoLoop(goal, opts) — autonomous research loop 主入口。
 *
 * opts: {
 *   caller: LLMCaller,
 *   dryRun?: bool,
 *   preset?: string,
 *   maxCycles?: number (default 5),
 *   directiveMode?: 'gaps' | 'next_steps' | 'both' (default 'gaps'),
 *   stopThreshold?: number (default 2),
 *   sessionId?: string (override sid; default = generateSessionId(goal)),
 *   noCandidates?: bool,
 *   resume?: bool (default true if session exists),
 * }
 *
 * 每个 cycle:
 *   1. runOneRoundCLI(roundN, input, caller, opts) → write round_NNN.json + 可能 deliverable
 *   2. runSynthesis(sessionId) → write synthesis_NNN.md
 *   3. extract directives from synthesis → inject as 'auto_directives' into next cycle's input
 *   4. shouldAutoStop 检查 → break 或 continue
 *
 * 返回:{
 *   sessionId, goal,
 *   cycles: [{ cycle, roundFile, synthesisPath, directiveCount, stoppedReason? }],
 *   finalSynthesisPath, stoppedReason,
 * }
 */
export async function runAutoLoop(goal, opts = {}) {
  if (typeof goal !== 'string' || !goal.trim()) {
    throw new Error('runAutoLoop requires non-empty goal string');
  }
  const dryRun = !!opts.dryRun;
  const preset = opts.preset ?? 'balanced';
  const maxCycles = Number(opts.maxCycles ?? 5);
  const directiveMode = opts.directiveMode ?? 'gaps';
  const stopThreshold = Number(opts.stopThreshold ?? 2);
  const model = opts.model ?? process.env.LLM_MODEL ?? 'stub';
  const caller = opts.caller;

  // Bootstrap session
  const sid = opts.sessionId ?? generateSessionId(goal);
  await createSession(sid, {
    goal,
    rounds: maxCycles,
    dryRun,
    preset,
  });

  const cycleResults = [];
  let autoDirectives = []; // 累积到下个 cycle 的 directive
  let stoppedReason = 'completed';
  let finalSynthesisPath = null;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // 计算 round number
    const existing = await listExistingRounds(sid);
    const roundN = existing.length + 1;

    // candidates 自动从 recommend/ 加载(除非显式关掉)
    let candidates = [];
    if (!opts.noCandidates) {
      candidates = await loadCandidatesFromArchive(sid, 30);
    }

    // 上一轮摘要供 Designer 参考(--resume 等价)
    const previousRounds = [];
    if (opts.resume !== false && existing.length > 0) {
      previousRounds.push(...await loadPreviousRounds(sid));
    }

    const input = {
      project: { id: sid, name: sid, statement: goal },
      candidates,
      user_goal: buildAutoUserGoal(goal, autoDirectives),
      round: roundN,
      session_id: sid,
      previous_rounds: previousRounds,
    };

    // 跑 1 round
    const rec = await runOneRoundCLI(roundN, input, caller, preset, dryRun);
    const roundFile = await writeRound(rec, sid);

    // resume 模式:更新 previous_rounds 摘要供下一轮(若需要)
    if (opts.resume !== false) {
      previousRounds.push(summarizeRec(rec));
    }

    // 跑 1 synthesis
    const synthesisResult = await runSynthesis(sid, {
      caller,
      dryRun,
      model,
    });

    console.log(formatAutoProgress(cycle, synthesisResult, { maxCycles }));

    // 抽 directives
    const directives = extractAutoDirectives(synthesisResult.synthesis, {
      mode: directiveMode,
    });

    finalSynthesisPath = synthesisResult.path;

    cycleResults.push({
      cycle,
      roundFile,
      synthesisPath: synthesisResult.path,
      directiveCount: directives.length,
      directives,
      synthesisResult,
    });

    // 下一轮把这些 directives 注入 Designer user_goal
    autoDirectives = directives;

    // 停? 已完成的 cycle 数 = cycle,与 for 循环 (cycle <= maxCycles) 同语义,
    // 避免提前 break 后丢一个 cycle。
    const stop = shouldAutoStop({
      cycle,
      maxCycles,
      directiveCount: directives.length,
      stopThreshold,
    });
    if (stop.stop) {
      stoppedReason = stop.reason ?? 'completed';
      break;
    }
  }

  return {
    sessionId: sid,
    goal,
    cycles: cycleResults.map(({ cycle, roundFile, synthesisPath, directiveCount }) => ({
      cycle, roundFile, synthesisPath, directiveCount,
    })),
    finalSynthesisPath,
    stoppedReason,
  };
}

/**
 * buildAutoUserGoal(goal, directives) — 把 goal + 累积 directives 拼成 Designer 的 user_goal。
 * directive 列表显示成 markdown bullet 列表;若空只返回 goal。
 *
 * 纯函数。
 */
export function buildAutoUserGoal(goal, directives = []) {
  const base = String(goal ?? '').trim() || '(no goal)';
  if (!directives.length) return base;
  const lines = [base, '', '## Auto directives (from previous synthesis)'];
  for (const d of directives) lines.push(`- ${d}`);
  return lines.join('\n');
}

/**
 * formatAutoSummary(result) — runAutoLoop 完成时给 stdout 总结。
 */
export function formatAutoSummary(result) {
  const lines = [];
  lines.push(`✅ Auto loop finished for [${result.sessionId}]`);
  lines.push(`   goal: ${String(result.goal).slice(0, 100)}`);
  lines.push(`   cycles: ${result.cycles.length}`);
  lines.push(`   stopped: ${result.stoppedReason}`);
  lines.push(`   final synthesis: ${result.finalSynthesisPath ?? '(none)'}`);
  for (const c of result.cycles) {
    lines.push(`     cycle ${c.cycle}: ${c.roundFile} → ${c.synthesisPath} (directives=${c.directiveCount})`);
  }
  return lines.join('\n');
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
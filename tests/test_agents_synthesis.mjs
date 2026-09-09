/**
 * tests/test_agents_synthesis.mjs — Synthesis Agent (iter #39)
 *
 * 覆盖:
 *   buildSynthesisPrompt:
 *    1. system + user 双段;user 含 goal / session / proposal 上下文 / deliverables / bibliography
 *    2. 空 input → graceful fallback (proposal 上下文 = 0 条时仍生成)
 *    3. proposalContexts 截断到 60 条;bibliography 截断到 30 条
 *
 *   extractRoundProposalContexts:
 *    4. 从 RoundRecord 抽出 (round, type, title, rationale, paperIds, decision, score)
 *    5. 缺 critiques / verdicts 时不崩(NaN-safe)
 *
 *   collectDeliverables:
 *    6. 解析 5 个 subdir 的 YAML frontmatter + 抽出 title / paperIds
 *    7. paperIds 既来自 frontmatter.related_papers 也来自 body arxiv-id 正则
 *
 *   collectBibliography:
 *    8. 按出现次数倒序;limit 截断
 *
 *   parseSynthesisLLMResponse:
 *    9. 直接 JSON parse
 *   10. markdown fence 包装
 *   11. 无 fence 但含 {...}
 *   12. 完全 garbage → { ok: false, raw, error }
 *
 *   formatSynthesisMarkdown:
 *   13. 含 frontmatter + H1 + 5 个 sections(answer / key_findings / evidence /
 *       gaps_contradictions / next_steps) + 元数据
 *   14. ok=false 时 answer 区显示 raw + 错误
 *   15. 空数组 → (无) / (LLM 未给出建议) 占位符
 *
 *   listExistingSynthesesFromListing:
 *   16. 文件名带 _NNN.md → index 抽取
 *   17. 非 synthesis 文件跳过
 *
 *   formatSynthesisText:
 *   18. written=true 时给出完整 preview
 *   19. skipped 时显示 ⏭️ + would_write path
 *   20. ok=false 时显示 ⚠️ parse failed
 *
 *   CLI integration:
 *   21. exports runSynthesis / buildSynthesisPrompt / formatSynthesisMarkdown /
 *       collectDeliverables / collectBibliography / extractRoundProposalContexts /
 *       parseSynthesisLLMResponse / listExistingSynthesesFromListing /
 *       formatSynthesisText
 *   22. --synthesize / --no-synthesize 出现在 parseArgs
 *   23. main() 模式 0.9 调 runSynthesis
 *   24. runOneSession 末尾调 runSynthesis(除非 noSynthesize)
 *
 * 跑法:node --test tests/test_agents_synthesis.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliSrc = await readFile(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')),
  'utf8',
);

process.argv = ['node', '/__never_used__/agents-run.mjs'];
const agentsRun = await import(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')).href
);
const {
  buildSynthesisPrompt,
  extractRoundProposalContexts,
  collectDeliverables,
  collectBibliography,
  parseSynthesisLLMResponse,
  formatSynthesisMarkdown,
  listExistingSynthesesFromListing,
  formatSynthesisText,
  runSynthesis,
} = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRoundRecord(overrides = {}) {
  return {
    schema_version: 1,
    round: overrides.round ?? 1,
    project_id: 'synth-test',
    started_at: 1700000000000,
    finished_at: 1700000005000,
    designer: {
      proposals: overrides.proposals ?? [],
      prompt_summary: '(test)',
      model: 'stub',
    },
    feedback: {
      critiques: overrides.critiques ?? [],
      judge_calls: 0,
      total_tokens: 0,
    },
    gate: {
      verdicts: overrides.verdicts ?? [],
      promoted: [], candidate: [], sketch: [], rejected: [],
    },
    modifier: { applied: [], skipped: [] },
    meta: { session_id: 'synth-test', dry_run: false },
  };
}

function makeProposal(o = {}) {
  return {
    id: o.id ?? 'p_synth',
    round: o.round ?? 1,
    type: o.type ?? 'literature_review',
    title: o.title ?? 'Test proposal',
    rationale: o.rationale ?? '因为 X 所以 Y',
    evidence: { paperIds: o.paperIds ?? ['2401.01234'], quotes: [] },
    target: {},
    estimated_effort: 'low',
    risk: 'test risk',
    created_at: 1700000000000,
  };
}

function makeCritique(proposalId, score = 7) {
  return {
    proposal_id: proposalId,
    scores: { methodologist: score, engineer: score, skeptic: score },
    total: score,
    critique: 'mock',
    elo: 1200,
    matches: 0,
    wins: 0,
    persona_attribution: { methodologist: '', engineer: '', skeptic: '' },
  };
}

const sampleDeliverableContent = `---
title: "Test Review"
type: literature_review
decision: promoted
session_id: "synth-test"
round: 1
created_at: "2026-09-09T00:00:00.000Z"
dry_run: false
estimated_effort: low
related_papers: ["2401.01234", "2402.56789"]
tags: ["synthesis-test"]
---

# 📚 Test Review

引用 2401.01234 / 2402.56789 / 2403.99999v1 作为支撑。
`;

const baseSynthesisInput = {
  sessionId: 'synth-test',
  goal: '如何在 LLM agent 中提高 reproducibility?',
  proposalContexts: [
    { round: 1, proposal_id: 'p1', type: 'literature_review', title: '整理 reproducibility 文献',
      rationale: 'r1', paperIds: ['2401.01234', '2402.56789'], decision: 'promoted',
      gate_reasons: [], score: 7 },
    { round: 2, proposal_id: 'p2', type: 'experiment_plan', title: '跑 reproducibility benchmark',
      rationale: 'r2', paperIds: ['2401.01234'], decision: 'candidate',
      gate_reasons: [], score: 6 },
  ],
  deliverables: [
    { subdir: 'reviews', file: 'review_r001_0.md', path: 'archive/synth-test/reviews/review_r001_0.md',
      type: 'literature_review', title: 'Test Review', round: 1, decision: 'promoted',
      paperIds: ['2401.01234', '2402.56789', '2403.99999v1'], frontmatter: {} },
  ],
  bibliography: [
    { arxivId: '2401.01234', count: 2 },
    { arxivId: '2402.56789', count: 1 },
  ],
  priorSynthesisCount: 0,
};

// ---------------------------------------------------------------------------
// buildSynthesisPrompt
// ---------------------------------------------------------------------------

describe('buildSynthesisPrompt', () => {
  it('returns { system, user } with goal + session header + JSON spec', () => {
    const { system, user } = buildSynthesisPrompt(baseSynthesisInput);
    assert.ok(system.length > 100);
    assert.match(user, /如何在 LLM agent 中提高 reproducibility/);
    assert.match(user, /Session: synth-test/);
    assert.match(user, /Proposal 上下文: 2 条/);
    assert.match(user, /已写 deliverables: 1 份/);
    assert.match(user, /2401\.01234/);
    assert.match(user, /请输出 JSON/);
    assert.match(user, /"answer"/);
    assert.match(user, /"key_findings"/);
    assert.match(user, /"next_steps"/);
  });

  it('graceful fallback: empty inputs still emit a usable prompt', () => {
    const { user } = buildSynthesisPrompt({
      sessionId: 'empty',
      goal: '(none)',
      proposalContexts: [],
      deliverables: [],
      bibliography: [],
    });
    assert.match(user, /Session: empty/);
    assert.match(user, /Proposal 上下文: 0 条/);
  });

  it('truncates proposalContexts to 60 and bibliography to 30', () => {
    const big = {
      ...baseSynthesisInput,
      proposalContexts: Array.from({ length: 80 }, (_, i) => ({
        ...baseSynthesisInput.proposalContexts[0],
        proposal_id: `big_${i}`,
        title: `big ${i}`,
      })),
      bibliography: Array.from({ length: 50 }, (_, i) => ({ arxivId: `2400.${String(i).padStart(5, '0')}`, count: 50 - i })),
    };
    const { user } = buildSynthesisPrompt(big);
    // proposalContexts 只列前 60 个
    const bigMatches = user.match(/big \d+/g) ?? [];
    assert.ok(bigMatches.length <= 60, `expected ≤60 big entries, got ${bigMatches.length}`);
    // bibliography 只列前 30
    const bibMatches = user.match(/2400\.\d{5}/g) ?? [];
    assert.ok(bibMatches.length <= 30, `expected ≤30 bibliography entries, got ${bibMatches.length}`);
  });
});

// ---------------------------------------------------------------------------
// extractRoundProposalContexts
// ---------------------------------------------------------------------------

describe('extractRoundProposalContexts', () => {
  it('extracts (round, type, title, paperIds, decision, score)', () => {
    const rec1 = makeRoundRecord({
      round: 1,
      proposals: [makeProposal({ id: 'p1', type: 'literature_review', title: 'A', paperIds: ['2401.01234'] })],
      critiques: [makeCritique('p1', 8)],
      verdicts: [{ proposal_id: 'p1', decision: 'promoted', reasons: ['good'] }],
    });
    const rec2 = makeRoundRecord({
      round: 2,
      proposals: [makeProposal({ id: 'p2', type: 'experiment_plan', title: 'B', paperIds: ['2402.56789'] })],
      critiques: [makeCritique('p2', 5)],
      verdicts: [{ proposal_id: 'p2', decision: 'candidate', reasons: [] }],
    });
    const ctx = extractRoundProposalContexts([rec1, rec2]);
    assert.equal(ctx.length, 2);
    assert.deepEqual(ctx[0], {
      round: 1, proposal_id: 'p1', type: 'literature_review', title: 'A',
      rationale: '因为 X 所以 Y', paperIds: ['2401.01234'],
      decision: 'promoted', gate_reasons: ['good'], score: 8,
    });
    assert.equal(ctx[1].decision, 'candidate');
    assert.equal(ctx[1].score, 5);
  });

  it('NaN-safe when critiques / verdicts missing', () => {
    const rec = makeRoundRecord({
      round: 1,
      proposals: [makeProposal({ id: 'p3' })],
      // no critiques, no verdicts
    });
    const ctx = extractRoundProposalContexts([rec]);
    assert.equal(ctx.length, 1);
    assert.equal(ctx[0].decision, '(no verdict)');
    assert.equal(ctx[0].score, 0);
    assert.deepEqual(ctx[0].paperIds, ['2401.01234']);
  });

  it('empty records → empty contexts', () => {
    assert.deepEqual(extractRoundProposalContexts([]), []);
  });
});

// ---------------------------------------------------------------------------
// collectDeliverables
// ---------------------------------------------------------------------------

describe('collectDeliverables', () => {
  it('parses YAML frontmatter + H1 title from 5 subdirs', () => {
    const fileMap = {
      'archive/synth-test/drafts/draft_r001_0.md': sampleDeliverableContent.replace('Test Review', 'Draft A'),
      'archive/synth-test/reviews/review_r001_0.md': sampleDeliverableContent,
      'archive/synth-test/experiments/exp_r001_0.md': sampleDeliverableContent.replace('Test Review', 'Exp X').replace('literature_review', 'experiment_plan'),
      'archive/synth-test/paper_additions/paper_r001_0.md': sampleDeliverableContent.replace('Test Review', 'Paper Z').replace('literature_review', 'add_paper'),
      'archive/synth-test/rebuttals/rebuttal_r001_0.md': sampleDeliverableContent.replace('Test Review', 'Rebuttal').replace('literature_review', 'rebuttal'),
    };
    const out = collectDeliverables(fileMap);
    assert.equal(out.length, 5);
    const subdirs = out.map((d) => d.subdir).sort();
    assert.deepEqual(subdirs, ['drafts', 'experiments', 'paper_additions', 'rebuttals', 'reviews']);
    // body 中 2403.99999v1 也被抽出
    const review = out.find((d) => d.subdir === 'reviews');
    assert.ok(review.paperIds.includes('2403.99999v1'), `expected 2403.99999v1 in ${JSON.stringify(review.paperIds)}`);
    // frontmatter 的 related_papers 也并入
    assert.ok(review.paperIds.includes('2401.01234'));
    assert.ok(review.paperIds.includes('2402.56789'));
  });

  it('skips files without YAML frontmatter', () => {
    const out = collectDeliverables({ 'plain.md': 'no frontmatter here' });
    assert.equal(out.length, 0);
  });
});

// ---------------------------------------------------------------------------
// collectBibliography
// ---------------------------------------------------------------------------

describe('collectBibliography', () => {
  it('aggregates paperIds across proposals + deliverables, sorted by count desc', () => {
    const out = collectBibliography(
      [
        { paperIds: ['2401.01234', '2402.56789'] },
        { paperIds: ['2401.01234', '2403.99999'] },
      ],
      [
        { paperIds: ['2401.01234', '2404.11111'] },
      ],
    );
    assert.equal(out[0].arxivId, '2401.01234');
    assert.equal(out[0].count, 3);
    assert.equal(out.length, 4);
  });

  it('respects limit option', () => {
    const out = collectBibliography(
      Array.from({ length: 30 }, (_, i) => ({ paperIds: [`2400.${String(i).padStart(5, '0')}`] })),
      [],
      { limit: 5 },
    );
    assert.equal(out.length, 5);
  });
});

// ---------------------------------------------------------------------------
// parseSynthesisLLMResponse
// ---------------------------------------------------------------------------

describe('parseSynthesisLLMResponse', () => {
  it('parses direct JSON', () => {
    const raw = JSON.stringify({
      answer: 'A',
      key_findings: ['f1', 'f2'],
      evidence: ['e1'],
      gaps_contradictions: ['g1'],
      next_steps: ['n1', 'n2'],
    });
    const r = parseSynthesisLLMResponse(raw);
    assert.equal(r.ok, true);
    assert.equal(r.answer, 'A');
    assert.deepEqual(r.key_findings, ['f1', 'f2']);
    assert.deepEqual(r.next_steps, ['n1', 'n2']);
  });

  it('parses ```json ... ``` fence', () => {
    const raw = '```json\n{"answer":"B","key_findings":["k"],"evidence":[],"gaps_contradictions":[],"next_steps":[]}\n```';
    const r = parseSynthesisLLMResponse(raw);
    assert.equal(r.ok, true);
    assert.equal(r.answer, 'B');
  });

  it('parses bare { ... } substring', () => {
    const raw = 'noise before {"answer":"C","key_findings":[],"evidence":[],"gaps_contradictions":[],"next_steps":["s"]} noise after';
    const r = parseSynthesisLLMResponse(raw);
    assert.equal(r.ok, true);
    assert.equal(r.answer, 'C');
    assert.deepEqual(r.next_steps, ['s']);
  });

  it('returns { ok: false } on garbage', () => {
    const r = parseSynthesisLLMResponse('totally not json ✨');
    assert.equal(r.ok, false);
    assert.match(r.error, /parse/);
    assert.equal(typeof r.raw, 'string');
  });

  it('clamps answer to 4000 chars and arrays to safe sizes', () => {
    const raw = JSON.stringify({
      answer: 'x'.repeat(5000),
      key_findings: Array.from({ length: 30 }, (_, i) => `f${i}`),
      evidence: Array.from({ length: 50 }, (_, i) => `e${i}`),
      gaps_contradictions: Array.from({ length: 30 }, (_, i) => `g${i}`),
      next_steps: Array.from({ length: 30 }, (_, i) => `n${i}`),
    });
    const r = parseSynthesisLLMResponse(raw);
    assert.equal(r.answer.length, 4000);
    assert.equal(r.key_findings.length, 10);
    assert.equal(r.evidence.length, 20);
    assert.equal(r.gaps_contradictions.length, 10);
    assert.equal(r.next_steps.length, 10);
  });
});

// ---------------------------------------------------------------------------
// formatSynthesisMarkdown
// ---------------------------------------------------------------------------

describe('formatSynthesisMarkdown', () => {
  it('renders frontmatter + 5 sections + 元数据', () => {
    const md = formatSynthesisMarkdown(
      { ok: true, answer: '答案段落', key_findings: ['f1', 'f2'],
        evidence: ['e1'], gaps_contradictions: ['g1'], next_steps: ['n1', 'n2'] },
      {
        sessionId: 'sess1', goal: '如何 X', synthesisIndex: 1,
        usedRounds: 3, usedDeliverables: 2, uniquePaperCount: 8,
        generatedAt: '2026-09-09T12:00:00.000Z', model: 'gpt-4o-mini', dryRun: false,
      },
    );
    assert.match(md, /^---\n/);
    assert.match(md, /title: "如何 X"/);
    assert.match(md, /session_id: "sess1"/);
    assert.match(md, /rounds_synthesized: 3/);
    assert.match(md, /# 🧠 如何 X/);
    assert.match(md, /synthesis #1/);
    assert.match(md, /## 摘要 \/ Answer/);
    assert.match(md, /答案段落/);
    assert.match(md, /## 关键发现 \/ Key Findings/);
    assert.match(md, /- f1/);
    assert.match(md, /## 论据 \/ Evidence/);
    assert.match(md, /- e1/);
    assert.match(md, /## Gap & 矛盾/);
    assert.match(md, /- g1/);
    assert.match(md, /## 下一步建议 \/ Recommended Next Steps/);
    assert.match(md, /- \[ \] n1/);
    assert.match(md, /生成时间: 2026-09-09T12:00:00\.000Z/);
    assert.match(md, /Model: `gpt-4o-mini`/);
    assert.match(md, /synthesis_001\.md/);
  });

  it('ok=false renders raw in answer section + warning', () => {
    const md = formatSynthesisMarkdown(
      { ok: false, error: 'bad json', raw: '{not really json' },
      { sessionId: 'sess2', synthesisIndex: 2, dryRun: false },
    );
    assert.match(md, /LLM 解析失败:bad json/);
    assert.match(md, /\{not really json/);
  });

  it('empty arrays → (无) / (LLM 未给出建议) 占位符', () => {
    const md = formatSynthesisMarkdown(
      { ok: true, answer: '', evidence: [], key_findings: [],
        gaps_contradictions: [], next_steps: [] },
      { sessionId: 'sess3', synthesisIndex: 1, dryRun: false },
    );
    assert.match(md, /- \(无\)/);
    assert.match(md, /补一轮 Designer/);
    assert.match(md, /_\(未生成\)_/);
  });
});

// ---------------------------------------------------------------------------
// listExistingSynthesesFromListing
// ---------------------------------------------------------------------------

describe('listExistingSynthesesFromListing', () => {
  it('extracts index from synthesis_NNN.md', () => {
    const out = listExistingSynthesesFromListing(
      ['synthesis_001.md', 'synthesis_002.md', 'synthesis_010.md', 'round_001.json'],
      'sess',
    );
    assert.deepEqual(out.map((x) => x.index), [1, 2, 10]);
  });

  it('empty listing → empty', () => {
    assert.deepEqual(listExistingSynthesesFromListing([], 'sess'), []);
  });
});

// ---------------------------------------------------------------------------
// formatSynthesisText
// ---------------------------------------------------------------------------

describe('formatSynthesisText', () => {
  it('written=true shows path + counts + answer preview', () => {
    const t = formatSynthesisText({
      sessionId: 's1', path: 'archive/s1/synthesis/synthesis_001.md', written: true,
      synthesisIndex: 1, usedRounds: 2, usedDeliverables: 1, uniquePapers: 5,
      model: 'stub', synthesis: { ok: true, answer: 'A'.repeat(400), key_findings: ['f1', 'f2'] },
    });
    assert.match(t, /Synthesized \[s1\]/);
    assert.match(t, /synthesis #1/);
    assert.match(t, /rounds=2/);
    assert.match(t, /key findings \(2\)/);
    assert.match(t, /A{300}\.\.\./);
  });

  it('skipped shows ⏭️ + would_write path', () => {
    const t = formatSynthesisText({
      sessionId: 's1', path: 'archive/s1/synthesis/synthesis_001.md', written: false,
      synthesisIndex: 1, usedRounds: 0, usedDeliverables: 0, uniquePapers: 0,
      model: 'stub', synthesis: { ok: true, answer: '', key_findings: [] },
    });
    assert.match(t, /❌/);
  });

  it('ok=false shows ⚠️ parse failed', () => {
    const t = formatSynthesisText({
      sessionId: 's1', path: '/x', written: true, synthesisIndex: 1,
      usedRounds: 0, usedDeliverables: 0, uniquePapers: 0, model: 'stub',
      synthesis: { ok: false, error: 'parse fail', raw: '...' },
    });
    assert.match(t, /⚠️/);
    assert.match(t, /parse fail/);
  });
});

// ---------------------------------------------------------------------------
// runSynthesis end-to-end(stub LLM mode)
// ---------------------------------------------------------------------------

describe('runSynthesis (stub mode)', () => {
  let tmpRoot;
  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-synth-'));
    process.chdir(tmpRoot);
    // 造一个 session:meta + 2 rounds + 1 deliverable
    const sid = 'syntest';
    await mkdir(join('archive', sid, 'rounds'), { recursive: true });
    await mkdir(join('archive', sid, 'reviews'), { recursive: true });
    await mkdir(join('archive', sid, 'experiments'), { recursive: true });
    await writeFile(
      join('archive', sid, 'meta.json'),
      JSON.stringify({ session_id: sid, goal: '如何在 agent loop 中收敛?', created_at: 1700000000000 }),
    );
    const rec1 = makeRoundRecord({
      round: 1,
      proposals: [makeProposal({ id: 'p1', type: 'literature_review', title: 'survey X', paperIds: ['2401.01234', '2402.56789'] })],
      critiques: [makeCritique('p1', 8)],
      verdicts: [{ proposal_id: 'p1', decision: 'promoted', reasons: ['novel'] }],
    });
    const rec2 = makeRoundRecord({
      round: 2,
      proposals: [makeProposal({ id: 'p2', type: 'experiment_plan', title: 'run eval', paperIds: ['2401.01234'] })],
      critiques: [makeCritique('p2', 6)],
      verdicts: [{ proposal_id: 'p2', decision: 'candidate', reasons: [] }],
    });
    await writeFile(join('archive', sid, 'rounds', 'round_001.json'), JSON.stringify(rec1));
    await writeFile(join('archive', sid, 'rounds', 'round_002.json'), JSON.stringify(rec2));
    await writeFile(join('archive', sid, 'reviews', 'review_r001_0.md'), sampleDeliverableContent);
  });

  after(async () => {
    process.chdir(__dirname);
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes synthesis_001.md with stub content (no LLM caller)', async () => {
    const r = await runSynthesis('syntest', { dryRun: false });
    assert.equal(r.written, true);
    assert.equal(r.synthesisIndex, 1);
    assert.equal(r.usedRounds, 2);
    assert.equal(r.usedDeliverables, 1);
    assert.equal(r.uniquePapers >= 3, true, `expected ≥3 unique papers, got ${r.uniquePapers}`);
    assert.match(r.path, /archive[\\/]syntest[\\/]synthesis[\\/]synthesis_001\.md$/);
    assert.ok(existsSync(r.path), `expected file to exist at ${r.path}`);
    const content = await readFile(r.path, 'utf8');
    assert.match(content, /如何在 agent loop 中收敛/);
    assert.match(content, /rounds_synthesized: 2/);
    assert.match(content, /unique_papers: \d+/);
    assert.match(content, /## 摘要 \/ Answer/);
    assert.match(content, /## 关键发现 \/ Key Findings/);
    assert.match(content, /## 下一步建议/);
  });

  it('history-preserving: rerun writes synthesis_002 (does not overwrite 001)', async () => {
    const r = await runSynthesis('syntest', { dryRun: false });
    assert.equal(r.written, true);
    assert.equal(r.synthesisIndex, 2);
    assert.match(r.path, /synthesis_002\.md$/);
    assert.equal(r.priorCount, 1);
  });

  it('thin session (no rounds / no deliverables) still writes skeleton', async () => {
    const sid = 'thin';
    await mkdir(join('archive', sid), { recursive: true });
    const r = await runSynthesis(sid, { dryRun: false });
    assert.equal(r.written, true);
    assert.equal(r.usedRounds, 0);
    assert.equal(r.usedDeliverables, 0);
    const content = await readFile(r.path, 'utf8');
    assert.match(content, /数据不足/);
  });

  it('with fake LLM caller, uses real answer', async () => {
    // 显式设 env 让 runSynthesis 走真 LLM 分支(fake caller)
    process.env.LLM_BASE_URL = 'http://fake.test';
    process.env.LLM_API_KEY = 'fake-key';
    const fakeCaller = {
      async callLLM({ system: _s, user: _u }) {
        return JSON.stringify({
          answer: 'FAKE_ANSWER',
          key_findings: ['FF1', 'FF2'],
          evidence: ['2401.01234 (cited)'],
          gaps_contradictions: ['gap A'],
          next_steps: ['do X', 'do Y'],
        });
      },
    };
    const sid = 'llmtest';
    await mkdir(join('archive', sid, 'rounds'), { recursive: true });
    await writeFile(
      join('archive', sid, 'meta.json'),
      JSON.stringify({ session_id: sid, goal: 'real LLM test', created_at: 1700000000000 }),
    );
    const rec = makeRoundRecord({
      round: 1,
      proposals: [makeProposal({ id: 'p1', paperIds: ['2401.01234'] })],
      critiques: [makeCritique('p1', 9)],
      verdicts: [{ proposal_id: 'p1', decision: 'promoted', reasons: [] }],
    });
    await writeFile(join('archive', sid, 'rounds', 'round_001.json'), JSON.stringify(rec));
    const r = await runSynthesis(sid, { caller: fakeCaller, dryRun: false });
    assert.equal(r.written, true);
    assert.equal(r.synthesis.ok, true);
    assert.equal(r.synthesis.answer, 'FAKE_ANSWER');
    const content = await readFile(r.path, 'utf8');
    assert.match(content, /FAKE_ANSWER/);
    assert.match(content, /- FF1/);
    assert.match(content, /do X/);
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
  });

  it('stub LLM env (no LLM_BASE_URL/LLM_API_KEY) still writes skeleton even with caller', async () => {
    // 即使 caller 注入了 stub,缺 env 时必须走 stub 分支
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const fakeStubCaller = {
      async callLLM() { return '(stub)'; }, // 模拟 stubLLMResponse
    };
    const sid = 'stubenv';
    await mkdir(join('archive', sid, 'rounds'), { recursive: true });
    await writeFile(
      join('archive', sid, 'meta.json'),
      JSON.stringify({ session_id: sid, goal: 'stub env test', created_at: 1700000000000 }),
    );
    const rec = makeRoundRecord({
      round: 1,
      proposals: [makeProposal({ id: 'p1', paperIds: ['2401.01234'] })],
      critiques: [makeCritique('p1', 7)],
      verdicts: [{ proposal_id: 'p1', decision: 'promoted', reasons: [] }],
    });
    await writeFile(join('archive', sid, 'rounds', 'round_001.json'), JSON.stringify(rec));
    const r = await runSynthesis(sid, { caller: fakeStubCaller, dryRun: false });
    assert.equal(r.written, true);
    // 应该走 stub 分支 — 不出现 "parse failed"
    assert.match(r.synthesis.answer, /stub synthesis/);
    assert.doesNotMatch(r.synthesis.answer ?? '', /parse failed/);
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI integration (synthesis)', () => {
  it('exports all 9 synthesis pure functions', () => {
    const exports = [
      'runSynthesis', 'buildSynthesisPrompt', 'formatSynthesisMarkdown',
      'collectDeliverables', 'collectBibliography', 'extractRoundProposalContexts',
      'parseSynthesisLLMResponse', 'listExistingSynthesesFromListing', 'formatSynthesisText',
    ];
    for (const name of exports) {
      assert.match(cliSrc, new RegExp(`export (async )?function ${name}|export const ${name}`),
        `missing export: ${name}`);
    }
  });

  it('--synthesize / --no-synthesize appear in parseArgs', () => {
    assert.match(cliSrc, /a === '--synthesize'.*out\.synthesize = true/);
    assert.match(cliSrc, /a === '--no-synthesize'.*out\.noSynthesize = true/);
  });

  it('--synthesize mode in main() calls runSynthesis', () => {
    const mainBlock = cliSrc.slice(cliSrc.indexOf('async function main()'));
    assert.match(mainBlock, /if \(args\.synthesize\)/);
    const synthBlock = mainBlock.slice(mainBlock.indexOf('if (args.synthesize)'));
    assert.match(synthBlock, /runSynthesis\(sessionId/);
  });

  it('--help text mentions --synthesize', () => {
    assert.match(cliSrc, /--synthesize\s+After running rounds/);
    assert.match(cliSrc, /--no-synthesize/);
  });

  it('runOneSession auto-calls runSynthesis at end (unless noSynthesize)', () => {
    const block = cliSrc.slice(cliSrc.indexOf('async function runOneSession'));
    assert.match(block, /runSynthesis\(sessionId/);
    assert.match(block, /if \(!opts\.noSynthesize\)/);
  });
});
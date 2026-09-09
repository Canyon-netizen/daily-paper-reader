/**
 * tests/test_agents_modifier_full_types.mjs — Modifier 5 种 ProposalType 全覆盖
 *
 * 覆盖 add_paper / rebuttal 两种新加的类型。
 *
 * 覆盖:
 *   formatAddPaperMarkdown:
 *    1. 含 📄 title + 候选论文 IDs / 风险 / 下一步 sections
 *    2. dryRun=true → DRY-RUN 警告
 *    3. paperIds 空数组 → (无)
 *
 *   formatRebuttalMarkdown:
 *    4. 含 ✉️ title + Reviewer Comments / Responses / Changes sections
 *    5. ctx.body.{reviewer_comments, responses, changes} 覆盖
 *    6. dryRun=true → 多处 DRY-RUN 警告
 *
 *   writeDeliverable 5 type 路由:
 *    7. add_paper → paper_additions/paper_rNNN_<idx>.md, kind=paper_addition
 *    8. rebuttal → rebuttals/rebuttal_rNNN_<idx>.md, kind=rebuttal
 *    9. 全部 5 type 文件前缀正确(draft/review/exp/paper/rebuttal)
 *
 *   回归:
 *   10. 旧 type (create_draft / literature_review / experiment_plan) 仍能路由
 *
 * 跑法:node --test tests/test_agents_modifier_full_types.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
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
const { formatAddPaperMarkdown, formatRebuttalMarkdown, writeDeliverable } = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(overrides = {}) {
  return {
    id: overrides.id ?? 'p_full_test',
    round: 1,
    type: overrides.type ?? 'add_paper',
    title: overrides.title ?? 'Test add paper title',
    rationale: overrides.rationale ?? 'Cited by many recent surveys.',
    evidence: { paperIds: overrides.paperIds ?? ['2401.01234', '2402.56789'], quotes: [] },
    target: {},
    estimated_effort: overrides.effort ?? 'low',
    risk: overrides.risk ?? 'paper might not be relevant',
    tags: ['full-types'],
    created_at: 1700000000000,
  };
}

const baseCtx = {
  session_id: 'full-test-session',
  round: 5,
  decision: 'promoted',
  dryRun: true,
  created_at: '2026-09-09T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// formatAddPaperMarkdown
// ---------------------------------------------------------------------------

describe('formatAddPaperMarkdown', () => {
  it('contains 📄 title + sections', () => {
    const md = formatAddPaperMarkdown(makeProposal(), baseCtx);
    assert.match(md, /# 📄 Test add paper title/);
    assert.match(md, /## 加入理由 \/ Why/);
    assert.match(md, /Cited by many recent surveys\./);
    assert.match(md, /## 候选论文 IDs/);
    assert.match(md, /- 2401\.01234/);
    assert.match(md, /- 2402\.56789/);
    assert.match(md, /## 风险/);
    assert.match(md, /## 下一步/);
  });

  it('frontmatter type=add_paper', () => {
    const md = formatAddPaperMarkdown(makeProposal(), baseCtx);
    assert.match(md, /type: add_paper/);
  });

  it('empty paperIds → (无)', () => {
    const md = formatAddPaperMarkdown(makeProposal({ paperIds: [] }), baseCtx);
    assert.match(md, /## 候选论文 IDs\n- \(无\)/);
  });

  it('dryRun=true → DRY-RUN warning in next-steps', () => {
    const md = formatAddPaperMarkdown(makeProposal(), { ...baseCtx, dryRun: true });
    assert.match(md, /用 paper-analyzer/);
    assert.match(md, /生成中文摘要/);
  });

  it('dryRun=false → actionable next-step', () => {
    const md = formatAddPaperMarkdown(makeProposal(), { ...baseCtx, dryRun: false });
    assert.match(md, /写入 docs\/papers/);
    assert.doesNotMatch(md, /⚠️ DRY-RUN/);
  });
});

// ---------------------------------------------------------------------------
// formatRebuttalMarkdown
// ---------------------------------------------------------------------------

describe('formatRebuttalMarkdown', () => {
  it('contains ✉️ title + Reviewer Comments / Responses / Changes sections', () => {
    const md = formatRebuttalMarkdown(makeProposal({ type: 'rebuttal', title: 'Rebuttal for ICLR' }), baseCtx);
    assert.match(md, /# ✉️ Rebuttal for ICLR/);
    assert.match(md, /## 摘要 \/ Summary/);
    assert.match(md, /## 目标论文/);
    assert.match(md, /## Reviewer Comments/);
    assert.match(md, /## Responses/);
    assert.match(md, /## 论文修改 \/ Changes to Manuscript/);
    assert.match(md, /## 风险/);
    assert.match(md, /## 下一步/);
  });

  it('frontmatter type=rebuttal', () => {
    const md = formatRebuttalMarkdown(makeProposal({ type: 'rebuttal' }), baseCtx);
    assert.match(md, /type: rebuttal/);
  });

  it('ctx.body.{reviewer_comments, responses, changes} overrides defaults', () => {
    const md = formatRebuttalMarkdown(
      makeProposal({ type: 'rebuttal' }),
      {
        ...baseCtx,
        dryRun: false,
        body: {
          reviewer_comments: 'CUSTOM-REVIEWER-COMMENTS',
          responses: 'CUSTOM-RESPONSES',
          changes: 'CUSTOM-CHANGES',
        },
      },
    );
    assert.match(md, /CUSTOM-REVIEWER-COMMENTS/);
    assert.match(md, /CUSTOM-RESPONSES/);
    assert.match(md, /CUSTOM-CHANGES/);
  });

  it('dryRun=true → multiple DRY-RUN warnings', () => {
    const md = formatRebuttalMarkdown(makeProposal({ type: 'rebuttal' }), { ...baseCtx, dryRun: true });
    const matches = md.match(/DRY-RUN/g);
    assert.ok(matches && matches.length >= 3);
  });
});

// ---------------------------------------------------------------------------
// writeDeliverable 5-type routing
// ---------------------------------------------------------------------------

describe('writeDeliverable full 5-type coverage', () => {
  let tmpRoot;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-full-types-'));
    process.chdir(tmpRoot);
  });

  after(async () => {
    process.chdir(__dirname);
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('add_paper → archive/<sid>/paper_additions/paper_rNNN_<idx>.md', async () => {
    const sid = 'full01';
    const r = await writeDeliverable(makeProposal({ type: 'add_paper' }), {
      session_id: sid, round: 3, idx: 0, decision: 'promoted', dryRun: true,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'paper_addition');
    assert.match(r.path, /archive[\\/]full01[\\/]paper_additions[\\/]paper_r003_0\.md$/);
  });

  it('rebuttal → archive/<sid>/rebuttals/rebuttal_rNNN_<idx>.md', async () => {
    const sid = 'full02';
    const r = await writeDeliverable(makeProposal({ type: 'rebuttal', title: 'ICLR rebuttal' }), {
      session_id: sid, round: 1, idx: 0, decision: 'candidate', dryRun: false,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'rebuttal');
    assert.match(r.path, /archive[\\/]full02[\\/]rebuttals[\\/]rebuttal_r001_0\.md$/);
  });

  it('all 5 types use distinct file prefixes', async () => {
    const tests = [
      { type: 'create_draft', expectedPrefix: 'draft' },
      { type: 'literature_review', expectedPrefix: 'review' },
      { type: 'experiment_plan', expectedPrefix: 'exp' },
      { type: 'add_paper', expectedPrefix: 'paper' },
      { type: 'rebuttal', expectedPrefix: 'rebuttal' },
    ];
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const r = await writeDeliverable(makeProposal({ type: t.type, id: `prefix-${i}` }), {
        session_id: `prefix-${i}`, round: 1, idx: 0,
      });
      assert.ok(r.path.endsWith(`${t.expectedPrefix}_r001_0.md`),
        `expected ${t.type} to write ${t.expectedPrefix}_r001_0.md, got ${r.path}`);
    }
  });

  it('regression: create_draft still works', async () => {
    const r = await writeDeliverable(makeProposal({ type: 'create_draft', id: 'rg-cd' }), {
      session_id: 'rg-cd', round: 1, idx: 0,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'draft');
    assert.match(r.path, /drafts[\\/]draft_r001_0\.md$/);
  });

  it('regression: experiment_plan still works', async () => {
    const r = await writeDeliverable(makeProposal({ type: 'experiment_plan', id: 'rg-ep' }), {
      session_id: 'rg-ep', round: 1, idx: 0,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'experiment');
    assert.match(r.path, /experiments[\\/]exp_r001_0\.md$/);
  });

  it('unknown type still returns reason', async () => {
    const r = await writeDeliverable({ type: 'made_up_type' }, { session_id: 'unknown', round: 1 });
    assert.equal(r.written, false);
    assert.match(r.reason, /unsupported type made_up_type/);
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI integration (full type coverage)', () => {
  it('exports formatAddPaperMarkdown + formatRebuttalMarkdown', () => {
    assert.match(cliSrc, /export function formatAddPaperMarkdown/);
    assert.match(cliSrc, /export function formatRebuttalMarkdown/);
  });

  it('writeDeliverable routes all 5 types to distinct subdirs', () => {
    const writeBlock = cliSrc.slice(cliSrc.indexOf('export async function writeDeliverable'));
    assert.match(writeBlock, /subdir = 'drafts'/);
    assert.match(writeBlock, /subdir = 'reviews'/);
    assert.match(writeBlock, /subdir = 'experiments'/);
    assert.match(writeBlock, /subdir = 'paper_additions'/);
    assert.match(writeBlock, /subdir = 'rebuttals'/);
  });

  it('modifierCLI includes add_paper + rebuttal in writeDeliverable trigger', () => {
    const modBlock = cliSrc.slice(cliSrc.indexOf('async function modifierCLI'));
    assert.match(modBlock, /'create_draft', 'literature_review', 'experiment_plan', 'add_paper', 'rebuttal'/);
    assert.match(modBlock, /write_paper_addition_md/);
    assert.match(modBlock, /write_rebuttal_md/);
  });
});

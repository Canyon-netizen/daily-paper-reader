/**
 * tests/test_agents_modifier_experiment.mjs — experiment_plan 类型 deliverable
 *
 * 覆盖:
 *   formatExperimentMarkdown:
 *    1. 含 🧪 title + hypothesis / method / dataset / metrics / compute sections
 *    2. dryRun=true → 多处 DRY-RUN 警告
 *    3. dryRun=false → 默认占位符(可在 .md 里直接编辑)
 *    4. ctx.body.{hypothesis, method, dataset, metrics, compute} 覆盖默认
 *    5. paperIds 渲染成 markdown bullet list
 *    6. frontmatter 含 type: experiment_plan
 *
 *   writeDeliverable experiment_plan 路由:
 *    7. experiment_plan → archive/<sid>/experiments/exp_rNNN_<idx>.md
 *    8. kind = 'experiment'
 *    9. file 前缀 exp_ 而非 draft_ / review_
 *
 *   modifierCLI 集成:
 *   10. modifierCLI 在 create_draft/literature_review/experiment_plan 时调用 writeDeliverable
 *   11. 返回 write_experiment_md kind
 *
 * 跑法:node --test tests/test_agents_modifier_experiment.mjs
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
const { formatExperimentMarkdown, writeDeliverable } = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(overrides = {}) {
  return {
    id: overrides.id ?? 'p_exp_test',
    round: 1,
    type: 'experiment_plan',
    title: overrides.title ?? 'Test experiment title',
    rationale: overrides.rationale ?? 'Hypothesis to test.',
    evidence: { paperIds: overrides.paperIds ?? ['2401.01234', '2402.56789'], quotes: [] },
    target: {},
    estimated_effort: overrides.effort ?? 'high',
    risk: overrides.risk ?? 'training might not converge',
    tags: ['exp', 'iter35'],
    created_at: 1700000000000,
  };
}

const baseCtx = {
  session_id: 'exp-test-session',
  round: 4,
  decision: 'promoted',
  dryRun: true,
  created_at: '2026-09-09T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// formatExperimentMarkdown
// ---------------------------------------------------------------------------

describe('formatExperimentMarkdown / sections', () => {
  it('contains 🧪 in title + all expected sections', () => {
    const md = formatExperimentMarkdown(makeProposal(), baseCtx);
    assert.match(md, /# 🧪 Test experiment title/);
    assert.match(md, /## 假设 \/ Hypothesis/);
    assert.match(md, /Hypothesis to test\./);
    assert.match(md, /## 方法 \/ Method/);
    assert.match(md, /## 数据集 \/ Dataset/);
    assert.match(md, /## 评估指标 \/ Metrics/);
    assert.match(md, /## 算力 \/ Compute/);
    assert.match(md, /## 相关论文 \/ Related Work/);
    assert.match(md, /## 风险 \/ Risks/);
    assert.match(md, /## 下一步/);
  });

  it('frontmatter contains type: experiment_plan', () => {
    const md = formatExperimentMarkdown(makeProposal(), baseCtx);
    assert.match(md, /type: experiment_plan/);
    assert.match(md, /session_id: "exp-test-session"/);
    assert.match(md, /round: 4/);
    assert.match(md, /decision: promoted/);
  });

  it('paperIds rendered as markdown bullet list', () => {
    const md = formatExperimentMarkdown(makeProposal({ paperIds: ['aaa.111', 'bbb.222'] }), baseCtx);
    assert.match(md, /- aaa\.111/);
    assert.match(md, /- bbb\.222/);
  });

  it('empty paperIds → (无)', () => {
    const md = formatExperimentMarkdown(makeProposal({ paperIds: [] }), baseCtx);
    assert.match(md, /## 相关论文 \/ Related Work\n- \(无\)/);
  });

  it('dryRun=true → multiple DRY-RUN warnings', () => {
    const md = formatExperimentMarkdown(makeProposal(), { ...baseCtx, dryRun: true });
    const matches = md.match(/DRY-RUN/g);
    assert.ok(matches && matches.length >= 3, `expected ≥3 DRY-RUN warnings, got ${matches?.length}`);
  });

  it('dryRun=false → editable placeholders, no DRY-RUN', () => {
    const md = formatExperimentMarkdown(makeProposal(), { ...baseCtx, dryRun: false });
    assert.match(md, /在此区域详细描述实验步骤/);
    assert.doesNotMatch(md, /DRY-RUN/);
  });

  it('ctx.body overrides all five sections', () => {
    const md = formatExperimentMarkdown(
      makeProposal(),
      {
        ...baseCtx,
        dryRun: false,
        body: {
          hypothesis: 'CUSTOM-HYP',
          method: 'CUSTOM-METHOD',
          dataset: 'CUSTOM-DATA',
          metrics: 'CUSTOM-METRICS',
          compute: 'CUSTOM-COMPUTE',
        },
      },
    );
    assert.match(md, /CUSTOM-HYP/);
    assert.match(md, /CUSTOM-METHOD/);
    assert.match(md, /CUSTOM-DATA/);
    assert.match(md, /CUSTOM-METRICS/);
    assert.match(md, /CUSTOM-COMPUTE/);
    assert.doesNotMatch(md, /在此区域详细描述实验步骤/);
  });

  it('rationale defaults to hypothesis when body.hypothesis missing', () => {
    const md = formatExperimentMarkdown(
      makeProposal({ rationale: 'My specific hypothesis' }),
      { ...baseCtx, body: { method: 'X' } }, // body 但没有 hypothesis
    );
    assert.match(md, /## 假设 \/ Hypothesis\nMy specific hypothesis/);
  });
});

// ---------------------------------------------------------------------------
// writeDeliverable experiment_plan routing
// ---------------------------------------------------------------------------

describe('writeDeliverable experiment_plan routing', () => {
  let tmpRoot;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-experiment-'));
    process.chdir(tmpRoot);
  });

  after(async () => {
    process.chdir(__dirname);
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('experiment_plan → archive/<sid>/experiments/exp_rNNN_<idx>.md', async () => {
    const sid = 'exp01';
    const r = await writeDeliverable(makeProposal(), {
      session_id: sid, round: 4, idx: 0, decision: 'promoted', dryRun: true,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'experiment');
    assert.match(r.path, /archive[\\/]exp01[\\/]experiments[\\/]exp_r004_0\.md$/);
    assert.ok(existsSync(r.path));
  });

  it('uses exp_ prefix (not draft_/review_)', async () => {
    const sid = 'exp02';
    const r = await writeDeliverable(makeProposal(), {
      session_id: sid, round: 1, idx: 0,
    });
    assert.ok(r.path.endsWith('exp_r001_0.md'));
    assert.ok(!r.path.includes('draft_'));
    assert.ok(!r.path.includes('review_'));
  });

  it('written file has experiment sections + experiment_plan frontmatter', async () => {
    const sid = 'exp03';
    const r = await writeDeliverable(makeProposal({ title: 'EXPERIMENT TITLE' }), {
      session_id: sid, round: 2, idx: 0,
    });
    const content = await readFile(r.path, 'utf8');
    assert.match(content, /type: experiment_plan/);
    assert.match(content, /# 🧪 EXPERIMENT TITLE/);
    assert.match(content, /## 假设 \/ Hypothesis/);
    assert.match(content, /## 方法 \/ Method/);
    assert.match(content, /## 数据集 \/ Dataset/);
    assert.match(content, /## 评估指标 \/ Metrics/);
    assert.match(content, /## 算力 \/ Compute/);
  });

  it('multi-idx in same round writes multiple files', async () => {
    const sid = 'exp04';
    const a = await writeDeliverable(makeProposal({ id: 'm-a' }), {
      session_id: sid, round: 1, idx: 0,
    });
    const b = await writeDeliverable(makeProposal({ id: 'm-b' }), {
      session_id: sid, round: 1, idx: 1,
    });
    assert.equal(a.written, true);
    assert.equal(b.written, true);
    assert.ok(a.path.endsWith('exp_r001_0.md'));
    assert.ok(b.path.endsWith('exp_r001_1.md'));
  });

  it('made-up type still unsupported (writeDeliverable returns reason)', async () => {
    const r = await writeDeliverable({ type: 'made_up_type' }, { session_id: 'exp05', round: 1 });
    assert.equal(r.written, false);
    assert.match(r.reason, /unsupported type made_up_type/);
  });
});

// ---------------------------------------------------------------------------
// CLI integration (regex)
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI integration (experiment_plan)', () => {
  it('exports formatExperimentMarkdown', () => {
    assert.match(cliSrc, /export function formatExperimentMarkdown/);
  });

  it('writeDeliverable routes experiment_plan to experiments/ subdir', () => {
    const writeBlock = cliSrc.slice(cliSrc.indexOf('export async function writeDeliverable'));
    assert.match(writeBlock, /experiment_plan/);
    assert.match(writeBlock, /subdir = 'experiments'/);
    assert.match(writeBlock, /formatter = formatExperimentMarkdown/);
  });

  it('modifierCLI triggers writeDeliverable for experiment_plan', () => {
    const modBlock = cliSrc.slice(cliSrc.indexOf('async function modifierCLI'));
    assert.match(modBlock, /experiment_plan/);
    assert.match(modBlock, /write_experiment_md/);
    // 三类型都触发
    assert.match(modBlock, /create_draft.*literature_review.*experiment_plan|literature_review.*create_draft.*experiment_plan|experiment_plan.*create_draft.*literature_review/);
  });
});

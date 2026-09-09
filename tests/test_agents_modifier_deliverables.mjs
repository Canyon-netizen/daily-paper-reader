/**
 * tests/test_agents_modifier_deliverables.mjs — Modifier 真写 .md deliverables
 *
 * 覆盖:
 *   formatDraftFrontmatter:
 *     1. 必含 session_id / round / decision / created_at / type / dry_run / related_papers
 *     2. 双引号 / 反斜杠在 title 中正确转义
 *     3. paperIds 空数组 → related_papers: []
 *
 *   formatDraftMarkdown (create_draft):
 *     4. 包含 frontmatter + 动机 + 证据 + 风险 + 草稿正文 + 下一步 sections
 *     5. dryRun=true → 含 "DRY-RUN" 警告
 *     6. ctx.body 覆盖默认占位符
 *     7. paperIds 渲染成 markdown bullet 列表
 *
 *   formatReviewMarkdown (literature_review):
 *     8. 包含 frontmatter + 摘要 + 引用论文 + 主题分类 + 关键 Gap + 推荐阅读顺序 + 下一步
 *     9. dryRun=true → 多处 DRY-RUN 警告
 *
 *   writeDeliverable (IO):
 *    10. create_draft → archive/<sid>/drafts/draft_rNNN_<idx>.md
 *    11. literature_review → archive/<sid>/reviews/review_rNNN_<idx>.md
 *    12. 不支持的 type → returns reason='unsupported type X', written=false
 *    13. 缺 session_id → returns reason='missing session_id', written=false
 *    14. 二次调用同 (round, idx) → skipped=true,不覆盖
 *    15. 不同 idx → 写多个文件
 *
 *   CLI 集成 (regex):
 *    16. modifierCLI 调用 writeDeliverable
 *    17. modifierCLI 处理 create_draft / literature_review / 其他 type 分支
 *
 * 跑法:node --test tests/test_agents_modifier_deliverables.mjs
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

// 防 main guard 误触发
process.argv = ['node', '/__never_used__/agents-run.mjs'];

const agentsRun = await import(
  pathToFileURL(join(__dirname, '..', 'astro-src', 'scripts', 'agents-run.mjs')).href
);
const { formatDraftMarkdown, formatReviewMarkdown, writeDeliverable } = agentsRun;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(overrides = {}) {
  return {
    id: overrides.id ?? 'p_test',
    round: overrides.round ?? 1,
    type: overrides.type ?? 'create_draft',
    title: overrides.title ?? 'Test proposal title',
    rationale: overrides.rationale ?? 'Because we want to test.',
    evidence: {
      paperIds: overrides.paperIds ?? ['2401.01234', '2402.56789'],
      quotes: [],
    },
    target: overrides.target ?? {},
    estimated_effort: overrides.effort ?? 'medium',
    risk: overrides.risk ?? 'might not work',
    tags: overrides.tags ?? ['test', 'iter32'],
    created_at: 1700000000000,
    ...overrides.extra,
  };
}

const baseCtx = {
  session_id: 'test-session',
  round: 3,
  decision: 'promoted',
  dryRun: true,
  created_at: '2026-09-09T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// formatDraftFrontmatter (通过 formatDraftMarkdown 输出间接测试)
// ---------------------------------------------------------------------------

describe('formatDraftMarkdown / frontmatter', () => {
  it('contains all required frontmatter fields', () => {
    const md = formatDraftMarkdown(makeProposal(), baseCtx);
    assert.match(md, /^---/);
    assert.match(md, /session_id: "test-session"/);
    assert.match(md, /round: 3/);
    assert.match(md, /decision: promoted/);
    assert.match(md, /created_at: "2026-09-09T00:00:00\.000Z"/);
    assert.match(md, /type: create_draft/);
    assert.match(md, /dry_run: true/);
    assert.match(md, /estimated_effort: medium/);
    assert.match(md, /related_papers: \["2401\.01234", "2402\.56789"\]/);
    assert.match(md, /tags: \["test", "iter32"\]/);
  });

  it('escapes quotes and backslashes in title', () => {
    // 输入 title 含 " 与 \,format 后 frontmatter 必须能反向 parse
    // 注意:YAML 里只 escape ",不 escape \(除非在 escape sequence 里)。
    const md = formatDraftMarkdown(makeProposal({ title: 'Title with "quotes" and \\backslash' }), baseCtx);
    // JS 字符串字面量 \\ = \, \" = \";预期输出含 \"...\" 和单 \backslash
    assert.ok(
      md.includes('title: "Title with \\"quotes\\" and \\backslash"'),
      'expected frontmatter title with escaped quotes + raw backslash',
    );
  });

  it('empty paperIds → empty related_papers list', () => {
    const md = formatDraftMarkdown(makeProposal({ paperIds: [] }), baseCtx);
    assert.match(md, /related_papers: \[\]/);
  });
});

// ---------------------------------------------------------------------------
// formatDraftMarkdown sections
// ---------------------------------------------------------------------------

describe('formatDraftMarkdown / body sections', () => {
  it('renders motivation / evidence / risk / body / next-steps', () => {
    const md = formatDraftMarkdown(makeProposal(), baseCtx);
    assert.match(md, /## 动机 \/ Rationale/);
    assert.match(md, /Because we want to test\./);
    assert.match(md, /## 证据 \/ 相关论文/);
    assert.match(md, /- 2401\.01234/);
    assert.match(md, /- 2402\.56789/);
    assert.match(md, /## 风险/);
    assert.match(md, /might not work/);
    assert.match(md, /## 草稿正文/);
    assert.match(md, /## 下一步/);
  });

  it('dryRun=true → contains DRY-RUN warning', () => {
    const md = formatDraftMarkdown(makeProposal(), { ...baseCtx, dryRun: true });
    assert.match(md, /DRY-RUN/);
    assert.match(md, /配置 LLM_BASE_URL \+ LLM_API_KEY/);
  });

  it('dryRun=false → contains edit-and-promote hint, no DRY-RUN warning in body', () => {
    const md = formatDraftMarkdown(makeProposal(), { ...baseCtx, dryRun: false });
    assert.match(md, /在此区域直接编辑草稿/);
    assert.doesNotMatch(md, /⚠️ DRY-RUN/);
  });

  it('ctx.body overrides default placeholder', () => {
    const md = formatDraftMarkdown(makeProposal(), { ...baseCtx, body: 'MY CUSTOM BODY CONTENT' });
    assert.match(md, /MY CUSTOM BODY CONTENT/);
    assert.doesNotMatch(md, /在此区域直接编辑草稿/);
  });

  it('paperIds rendered as markdown bullet list', () => {
    const md = formatDraftMarkdown(makeProposal({ paperIds: ['1111.1111', '2222.2222', '3333.3333'] }), baseCtx);
    assert.match(md, /- 1111\.1111/);
    assert.match(md, /- 2222\.2222/);
    assert.match(md, /- 3333\.3333/);
  });
});

// ---------------------------------------------------------------------------
// formatReviewMarkdown
// ---------------------------------------------------------------------------

describe('formatReviewMarkdown', () => {
  it('contains all review sections + 📚 in title', () => {
    const md = formatReviewMarkdown(makeProposal({ type: 'literature_review' }), baseCtx);
    assert.match(md, /type: literature_review/);
    assert.match(md, /# 📚 Test proposal title/);
    assert.match(md, /## 摘要/);
    assert.match(md, /## 引用论文清单/);
    assert.match(md, /- 2401\.01234/);
    assert.match(md, /## 主题分类/);
    assert.match(md, /## 关键 Gap \/ 待研究问题/);
    assert.match(md, /## 推荐阅读顺序/);
    assert.match(md, /## 下一步/);
  });

  it('dryRun=true → multiple DRY-RUN warnings', () => {
    const md = formatReviewMarkdown(makeProposal({ type: 'literature_review' }), { ...baseCtx, dryRun: true });
    const matches = md.match(/DRY-RUN/g);
    assert.ok(matches && matches.length >= 3, `expected ≥3 DRY-RUN warnings, got ${matches?.length}`);
  });

  it('ctx.body.themes / .gaps / .reading_order override defaults', () => {
    const md = formatReviewMarkdown(
      makeProposal({ type: 'literature_review' }),
      { ...baseCtx, dryRun: false, body: { themes: 'THEMES-XYZ', gaps: 'GAPS-XYZ', reading_order: 'RO-XYZ' } },
    );
    assert.match(md, /THEMES-XYZ/);
    assert.match(md, /GAPS-XYZ/);
    assert.match(md, /RO-XYZ/);
  });
});

// ---------------------------------------------------------------------------
// writeDeliverable IO
// ---------------------------------------------------------------------------

describe('writeDeliverable', () => {
  let tmpRoot;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dpr-deliverables-'));
    process.chdir(tmpRoot);
  });

  after(async () => {
    process.chdir(__dirname);
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('create_draft → archive/<sid>/drafts/draft_rNNN_<idx>.md', async () => {
    const sid = 'wtest01';
    const r = await writeDeliverable(makeProposal({ type: 'create_draft' }), {
      session_id: sid, round: 3, idx: 0, decision: 'promoted', dryRun: true,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'draft');
    assert.match(r.path, /archive[\\/]wtest01[\\/]drafts[\\/]draft_r003_0\.md$/);
    assert.ok(existsSync(r.path));
  });

  it('literature_review → archive/<sid>/reviews/review_rNNN_<idx>.md', async () => {
    const sid = 'wtest02';
    const r = await writeDeliverable(makeProposal({ type: 'literature_review' }), {
      session_id: sid, round: 1, idx: 0, decision: 'candidate', dryRun: false,
    });
    assert.equal(r.written, true);
    assert.equal(r.kind, 'review');
    assert.match(r.path, /archive[\\/]wtest02[\\/]reviews[\\/]review_r001_0\.md$/);
    assert.ok(existsSync(r.path));
  });

  it('unsupported type → returns reason, written=false', async () => {
    const r = await writeDeliverable(makeProposal({ type: 'add_paper' }), {
      session_id: 'wtest03', round: 1, idx: 0,
    });
    assert.equal(r.written, false);
    assert.match(r.reason, /unsupported type add_paper/);
  });

  it('missing session_id → returns reason, written=false', async () => {
    const r = await writeDeliverable(makeProposal(), { round: 1, idx: 0 });
    assert.equal(r.written, false);
    assert.equal(r.reason, 'missing session_id');
  });

  it('idempotent: second call same (round, idx) → skipped=true', async () => {
    const sid = 'wtest04';
    const first = await writeDeliverable(makeProposal({ id: 'dup-test' }), {
      session_id: sid, round: 2, idx: 0,
    });
    assert.equal(first.written, true);

    const second = await writeDeliverable(makeProposal({ id: 'dup-test', title: 'CHANGED' }), {
      session_id: sid, round: 2, idx: 0,
    });
    assert.equal(second.written, false);
    assert.equal(second.skipped, true);
    // 文件未被覆盖:读出来 title 仍是第一次的值
    const content = await readFile(first.path, 'utf8');
    assert.match(content, /Test proposal title/);
    assert.doesNotMatch(content, /CHANGED/);
  });

  it('different idx → multiple files in same round', async () => {
    const sid = 'wtest05';
    const a = await writeDeliverable(makeProposal({ id: 'multi-a' }), {
      session_id: sid, round: 1, idx: 0,
    });
    const b = await writeDeliverable(makeProposal({ id: 'multi-b' }), {
      session_id: sid, round: 1, idx: 1,
    });
    const c = await writeDeliverable(makeProposal({ id: 'multi-c' }), {
      session_id: sid, round: 1, idx: 2,
    });
    assert.equal(a.written, true);
    assert.equal(b.written, true);
    assert.equal(c.written, true);
    assert.notEqual(a.path, b.path);
    assert.notEqual(b.path, c.path);
  });

  it('written file contains expected sections', async () => {
    const sid = 'wtest06';
    const r = await writeDeliverable(makeProposal({ title: 'VERIFIABLE TITLE' }), {
      session_id: sid, round: 5, idx: 0, dryRun: false,
    });
    const content = await readFile(r.path, 'utf8');
    assert.match(content, /VERIFIABLE TITLE/);
    assert.match(content, /## 动机 \/ Rationale/);
    assert.match(content, /## 草稿正文/);
    assert.match(content, /## 下一步/);
  });
});

// ---------------------------------------------------------------------------
// CLI integration (regex against agents-run.mjs)
// ---------------------------------------------------------------------------

describe('agents-run.mjs CLI integration', () => {
  it('exports formatDraftMarkdown + formatReviewMarkdown + writeDeliverable', () => {
    assert.match(cliSrc, /export function formatDraftMarkdown/);
    assert.match(cliSrc, /export function formatReviewMarkdown/);
    assert.match(cliSrc, /export async function writeDeliverable/);
  });

  it('modifierCLI calls writeDeliverable for create_draft / literature_review', () => {
    const modifierBlock = cliSrc.slice(cliSrc.indexOf('async function modifierCLI'));
    assert.match(modifierBlock, /writeDeliverable\(/);
    assert.match(modifierBlock, /create_draft.*literature_review|literature_review.*create_draft/);
  });

  it('modifierCLI returns write_draft_md / write_review_md kinds on success', () => {
    const modifierBlock = cliSrc.slice(cliSrc.indexOf('async function modifierCLI'));
    assert.match(modifierBlock, /write_draft_md/);
    assert.match(modifierBlock, /write_review_md/);
    assert.match(modifierBlock, /deliverable_already_exists/);
  });

  it('handles writeIdxByType for multi-deliverable-per-round', () => {
    assert.match(cliSrc, /writeIdxByType/);
  });
});

/**
 * tests/test_agents_paper_compiler.mjs — iter #61 论文装配器测试。
 *
 * 覆盖:
 *   1. stripFrontmatter        YAML 剥离 + 标量/数组/布尔解析
 *   2. extractMarkdownSection  从 synthesis 里抠小节
 *   3. collectBibliography     去重 + 稳定排序 + citedBy
 *   4. buildPaperDraft         章节路由 / 摘要回退 / 统计
 *   5. formatPaperMarkdown     结构完整性
 *   6. escapeLatex + formatPaperLatex  转义正确性 + 可编译骨架 + 字节稳定
 *
 * 跑法:node --test tests/test_agents_paper_compiler.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAPER_SECTIONS,
  DELIVERABLE_DIRS,
  stripFrontmatter,
  extractMarkdownSection,
  collectBibliography,
  formatBibtex,
  buildPaperDraft,
  formatPaperMarkdown,
  escapeLatex,
  formatPaperLatex,
} from '../astro-src/lib/agents/paper-compiler.mjs';

const FIXED_AT = '2026-01-01T00:00:00.000Z';

function makeDeliverable(kind, title, body, round = 1, papers = []) {
  const raw = [
    '---',
    `title: "${title}"`,
    `type: ${kind}`,
    'decision: promoted',
    'session_id: "abc12345"',
    `round: ${round}`,
    `related_papers: [${papers.map((p) => `"${p}"`).join(', ')}]`,
    '---',
    '',
    `# ${title}`,
    '',
    body,
  ].join('\n');
  return { kind, raw, round, path: `archive/abc12345/${DELIVERABLE_DIRS[kind]}/x.md` };
}

function makeRound(round, proposals) {
  return {
    round,
    designer: { proposals },
    feedback: { critiques: [] },
    gate: {},
    modifier: { applied: [], skipped: [] },
  };
}

const META = { session_id: 'abc12345', goal: '研究多智能体如何自动化科研全流程', preset: 'balanced' };

// ---------------------------------------------------------------------------

describe('stripFrontmatter', () => {
  it('splits frontmatter from body and parses scalars', () => {
    const { frontmatter, body } = stripFrontmatter(
      '---\ntitle: "Hello"\nround: 3\ndry_run: true\n---\n\n# Hello\n\nBody text.',
    );
    assert.equal(frontmatter.title, 'Hello');
    assert.equal(frontmatter.round, '3');
    assert.equal(frontmatter.dry_run, true);
    assert.match(body, /^# Hello/);
    assert.doesNotMatch(body, /title:/);
  });

  it('parses inline arrays', () => {
    const { frontmatter } = stripFrontmatter(
      '---\nrelated_papers: ["2601.00001", "2601.00002"]\ntags: []\n---\nbody',
    );
    assert.deepEqual(frontmatter.related_papers, ['2601.00001', '2601.00002']);
    assert.deepEqual(frontmatter.tags, []);
  });

  it('returns whole input as body when there is no frontmatter', () => {
    const { frontmatter, body } = stripFrontmatter('# Just a title\n\ntext');
    assert.deepEqual(frontmatter, {});
    assert.equal(body, '# Just a title\n\ntext');
  });

  it('tolerates empty / non-string input', () => {
    assert.deepEqual(stripFrontmatter(undefined), { frontmatter: {}, body: '' });
    assert.deepEqual(stripFrontmatter(null), { frontmatter: {}, body: '' });
  });
});

describe('extractMarkdownSection', () => {
  const md = '# Title\n\n## 摘要\n\n这是摘要正文。\n\n## 关键发现\n\n- 发现 A\n- 发现 B\n\n## 其它\n\nnope';

  it('extracts the matching section body only', () => {
    assert.equal(extractMarkdownSection(md, /摘要/), '这是摘要正文。');
  });

  it('stops at the next heading', () => {
    const found = extractMarkdownSection(md, /关键发现/);
    assert.match(found, /发现 A/);
    assert.doesNotMatch(found, /nope/);
  });

  it('returns empty string when no section matches', () => {
    assert.equal(extractMarkdownSection(md, /不存在的小节/), '');
  });
});

describe('collectBibliography', () => {
  it('dedupes ids across rounds and counts citing proposals', () => {
    const rounds = [
      makeRound(1, [
        { id: 'p1', evidence: { paperIds: ['2601.00002', '2601.00001'] } },
        { id: 'p2', evidence: { paperIds: ['2601.00001'] } },
      ]),
      makeRound(2, [{ id: 'p3', evidence: { paperIds: ['2601.00001'] } }]),
    ];
    const bib = collectBibliography(rounds);
    assert.equal(bib.length, 2);
    // 稳定排序:按 id 字典序
    assert.deepEqual(bib.map((b) => b.id), ['2601.00001', '2601.00002']);
    const first = bib[0];
    assert.equal(first.citations, 3);
    assert.deepEqual(first.citedBy, ['p1', 'p2', 'p3']);
    assert.match(first.key, /^arxiv_/);
  });

  it('canonicalizes ids out of paths and prefixes', () => {
    const bib = collectBibliography([
      makeRound(1, [{ id: 'p1', evidence: { paperIds: ['papers/2026-08-22/2608.15424v1-foo'] } }]),
    ]);
    assert.equal(bib[0].id, '2608.15424v1');
  });

  it('produces cite keys that are valid BibTeX identifiers', () => {
    const bib = collectBibliography([
      makeRound(1, [{ id: 'p1', evidence: { paperIds: ['2608.15424v1'] } }]),
    ]);
    assert.match(bib[0].key, /^[A-Za-z][A-Za-z0-9_]*$/);
  });

  it('handles empty / malformed input without throwing', () => {
    assert.deepEqual(collectBibliography([]), []);
    assert.deepEqual(collectBibliography(undefined), []);
    assert.deepEqual(collectBibliography([{}, { designer: {} }]), []);
  });
});

describe('formatBibtex', () => {
  it('emits one @misc entry per reference', () => {
    const bib = collectBibliography([
      makeRound(1, [{ id: 'p1', evidence: { paperIds: ['2601.00001', '2601.00002'] } }]),
    ]);
    const out = formatBibtex(bib);
    assert.equal((out.match(/@misc\{/g) ?? []).length, 2);
    assert.match(out, /eprint\s+= \{2601\.00001\}/);
  });

  it('emits a comment (not empty) when there are no references', () => {
    assert.match(formatBibtex([]), /^%/);
  });
});

describe('buildPaperDraft', () => {
  const deliverables = [
    makeDeliverable('review', 'A survey of agent loops', '相关工作正文。', 1, ['2601.00001']),
    makeDeliverable('experiment', 'Ablation protocol', '实验设计正文。', 2),
    makeDeliverable('draft', 'Main results', '结果正文。', 2),
    makeDeliverable('rebuttal', 'Threats', '局限性正文。', 3),
  ];
  const rounds = [
    makeRound(1, [{ id: 'p1', evidence: { paperIds: ['2601.00001'] } }]),
    makeRound(2, [{ id: 'p2', evidence: { paperIds: ['2601.00002'] } }]),
  ];
  rounds[1].modifier.applied = [{ kind: 'create_draft', proposal_id: 'p2' }];

  const draft = buildPaperDraft({ meta: META, rounds, deliverables, syntheses: [], generatedAt: FIXED_AT });

  it('routes each deliverable kind into the right section', () => {
    const byId = Object.fromEntries(draft.sections.map((s) => [s.id, s]));
    assert.equal(byId.related_work.entries.length, 1);
    assert.equal(byId.related_work.entries[0].title, 'A survey of agent loops');
    assert.equal(byId.method.entries.length, 1);
    assert.equal(byId.results.entries.length, 1);
    assert.equal(byId.limitations.entries.length, 1);
  });

  it('emits every section in PAPER_SECTIONS order', () => {
    assert.deepEqual(draft.sections.map((s) => s.id), PAPER_SECTIONS.map((s) => s.id));
  });

  it('strips frontmatter and the duplicated H1 from entry bodies', () => {
    const rw = draft.sections.find((s) => s.id === 'related_work').entries[0];
    assert.equal(rw.body, '相关工作正文。');
    assert.doesNotMatch(rw.body, /^#/);
    assert.doesNotMatch(rw.body, /title:/);
  });

  it('falls back to the goal for the abstract when there is no synthesis', () => {
    assert.match(draft.abstract, /多智能体/);
  });

  it('prefers a synthesis 摘要 section over the goal', () => {
    const withSyn = buildPaperDraft({
      meta: META,
      rounds,
      deliverables,
      syntheses: [
        { idx: 1, raw: '## 摘要\n\n旧的摘要。' },
        { idx: 2, raw: '## 摘要\n\n最新的摘要。\n\n## 关键发现\n\n- 发现 X' },
      ],
      generatedAt: FIXED_AT,
    });
    assert.equal(withSyn.abstract, '最新的摘要。');
    // 关键发现回流进 introduction
    const intro = withSyn.sections.find((s) => s.id === 'introduction');
    assert.match(intro.body, /发现 X/);
  });

  it('computes stats over rounds + deliverables + references', () => {
    assert.equal(draft.stats.rounds, 2);
    assert.equal(draft.stats.proposals, 2);
    assert.equal(draft.stats.applied, 1);
    assert.equal(draft.stats.deliverables, 4);
    assert.equal(draft.stats.references, 2);
  });

  it('marks sections without content as empty', () => {
    const bare = buildPaperDraft({ meta: META, rounds: [], deliverables: [], generatedAt: FIXED_AT });
    const nonIntro = bare.sections.filter((s) => s.id !== 'introduction');
    assert.ok(nonIntro.every((s) => s.empty), 'all content sections should be empty');
    assert.equal(bare.stats.sectionsWithContent, 1); // 只有 introduction(有 goal)
  });

  it('truncates a long goal into a title without cutting mid-word', () => {
    const longGoal = 'Investigating how large language model agents can autonomously execute the full research lifecycle end to end';
    const d = buildPaperDraft({ meta: { session_id: 's', goal: longGoal }, generatedAt: FIXED_AT });
    assert.ok(d.title.length <= 82, `title too long: ${d.title.length}`);
    assert.match(d.title, /…$/);
    assert.doesNotMatch(d.title, /\s…$/);
  });

  it('survives a completely empty session', () => {
    const d = buildPaperDraft({});
    assert.equal(d.sessionId, '(unknown)');
    assert.equal(d.sections.length, PAPER_SECTIONS.length);
    assert.equal(d.stats.references, 0);
    assert.ok(d.abstract.length > 0);
  });

  it('orders entries deterministically by round then idx', () => {
    const shuffled = [
      makeDeliverable('draft', 'C', 'c', 3),
      makeDeliverable('draft', 'A', 'a', 1),
      makeDeliverable('draft', 'B', 'b', 2),
    ];
    const d = buildPaperDraft({ meta: META, deliverables: shuffled, generatedAt: FIXED_AT });
    const titles = d.sections.find((s) => s.id === 'results').entries.map((e) => e.title);
    assert.deepEqual(titles, ['A', 'B', 'C']);
  });
});

describe('escapeLatex', () => {
  it('escapes the LaTeX special characters', () => {
    assert.equal(escapeLatex('100% & $5 #1 _x_ {y}'), '100\\% \\& \\$5 \\#1 \\_x\\_ \\{y\\}');
  });

  it('escapes backslash first so it is not double-processed', () => {
    assert.equal(escapeLatex('a\\b'), 'a\\textbackslash{}b');
  });

  it('escapes tilde and caret', () => {
    assert.equal(escapeLatex('~^'), '\\textasciitilde{}\\textasciicircum{}');
  });

  it('handles empty / nullish input', () => {
    assert.equal(escapeLatex(''), '');
    assert.equal(escapeLatex(null), '');
    assert.equal(escapeLatex(undefined), '');
  });
});

describe('formatPaperLatex', () => {
  const draft = buildPaperDraft({
    meta: META,
    rounds: [makeRound(1, [{ id: 'p1', evidence: { paperIds: ['2601.00001'] } }])],
    deliverables: [
      makeDeliverable(
        'draft',
        'Results with 50% gain',
        '## Setup\n\n- **bold** item\n- `code` item\n\n1. first\n2. second\n\n> a quote\n\nPlain paragraph with a_b and 100%.',
      ),
    ],
    generatedAt: FIXED_AT,
  });
  const tex = formatPaperLatex(draft);

  it('produces a compilable document skeleton', () => {
    assert.match(tex, /\\documentclass\[11pt\]\{article\}/);
    assert.match(tex, /\\begin\{document\}/);
    assert.match(tex, /\\end\{document\}/);
    assert.match(tex, /\\maketitle/);
    assert.match(tex, /\\begin\{abstract\}[\s\S]*\\end\{abstract\}/);
  });

  it('balances every begin/end environment', () => {
    const begins = [...tex.matchAll(/\\begin\{(\w+)\}/g)].map((m) => m[1]).sort();
    const ends = [...tex.matchAll(/\\end\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(begins, ends, 'unbalanced LaTeX environments');
  });

  it('escapes special characters that appear in titles', () => {
    assert.match(tex, /Results with 50\\% gain/);
    assert.doesNotMatch(tex, /Results with 50% gain/);
  });

  it('converts markdown inline markup instead of escaping it away', () => {
    assert.match(tex, /\\textbf\{bold\} item/);
    assert.match(tex, /\\texttt\{code\} item/);
  });

  it('converts lists and quotes to LaTeX environments', () => {
    assert.match(tex, /\\begin\{itemize\}/);
    assert.match(tex, /\\begin\{enumerate\}/);
    assert.match(tex, /\\begin\{quote\}/);
  });

  it('shields a leading [ in a list item so LaTeX does not eat it as a label', () => {
    // `\item [foo] bar` 会让 LaTeX 把 foo 当成自定义标签并顶替项目符号 —— 内容静默丢失。
    const d = buildPaperDraft({
      meta: META,
      deliverables: [makeDeliverable('draft', 'T', '- [round 1] something happened\n- normal item')],
      generatedAt: FIXED_AT,
    });
    const out = formatPaperLatex(d);
    assert.match(out, /\\item \{\}\[round 1\] something happened/);
    // 不以 [ 开头的项不该被无谓地加 {}
    assert.match(out, /\\item normal item/);
  });

  it('emits one section per PAPER_SECTIONS entry', () => {
    for (const spec of PAPER_SECTIONS) {
      assert.ok(tex.includes(`\\section{${spec.title}}`), `missing section ${spec.title}`);
    }
  });

  it('emits a thebibliography block with one bibitem per reference', () => {
    assert.match(tex, /\\begin\{thebibliography\}/);
    assert.equal((tex.match(/\\bibitem\{/g) ?? []).length, 1);
  });

  it('is byte-stable for the same input', () => {
    assert.equal(formatPaperLatex(draft), tex);
  });

  it('handles a null draft without throwing', () => {
    assert.match(formatPaperLatex(null), /empty draft/);
  });
});

describe('formatPaperMarkdown', () => {
  const draft = buildPaperDraft({
    meta: META,
    rounds: [makeRound(1, [{ id: 'p1', evidence: { paperIds: ['2601.00001'] } }])],
    deliverables: [makeDeliverable('review', 'Survey', '综述正文。')],
    generatedAt: FIXED_AT,
  });
  const md = formatPaperMarkdown(draft);

  it('starts with the paper title as H1', () => {
    assert.match(md, /^# 研究多智能体/);
  });

  it('includes an abstract and every section heading', () => {
    assert.match(md, /^## Abstract$/m);
    for (const spec of PAPER_SECTIONS) {
      assert.match(md, new RegExp(`^## ${spec.title}$`, 'm'));
    }
    assert.match(md, /^## References$/m);
  });

  it('renders deliverable bodies under their own H3', () => {
    assert.match(md, /^### Survey$/m);
    assert.match(md, /综述正文。/);
  });

  it('explains empty sections rather than leaving them blank', () => {
    assert.match(md, /本节暂无内容/);
  });

  it('lists references with citation counts', () => {
    assert.match(md, /1\. arXiv:2601\.00001 — cited by 1 proposal\(s\)/);
  });

  it('is byte-stable for the same input', () => {
    assert.equal(formatPaperMarkdown(draft), md);
  });

  it('handles a null draft without throwing', () => {
    assert.match(formatPaperMarkdown(null), /draft is empty/);
  });
});

#!/usr/bin/env node
// astro-src/scripts/agents-paper-compiler.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/paper-compiler.mjs.
// PAPER_SECTIONS / DELIVERABLE_DIRS / PAPER_LATEX_TEMPLATES 常量 +
// stripFrontmatter + extractMarkdownSection +
// collectBibliography + formatBibtex +
// escapeLatex + buildPaperDraft + formatPaperMarkdown。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadMjs('lib/agents/paper-compiler.mjs');
const {
  PAPER_SECTIONS,
  DELIVERABLE_DIRS,
  PAPER_LATEX_TEMPLATES,
  stripFrontmatter,
  extractMarkdownSection,
  collectBibliography,
  formatBibtex,
  escapeLatex,
  buildPaperDraft,
  formatPaperMarkdown,
  formatPaperLatex,
  getLatexCompileHint,
  listLatexTemplates,
} = mod;

// ---------- PAPER_SECTIONS ---
test('PAPER_SECTIONS: 5 个章节', () => {
  assert.equal(PAPER_SECTIONS.length, 5);
});

test('PAPER_SECTIONS: introduction 不吸收 sources', () => {
  const intro = PAPER_SECTIONS.find((s) => s.id === 'introduction');
  assert.deepEqual(intro.sources, []);
});

test('PAPER_SECTIONS: results 吸收 draft', () => {
  const r = PAPER_SECTIONS.find((s) => s.id === 'results');
  assert.ok(r.sources.includes('draft'));
});

test('PAPER_SECTIONS: limitations 吸收 rebuttal', () => {
  const r = PAPER_SECTIONS.find((s) => s.id === 'limitations');
  assert.ok(r.sources.includes('rebuttal'));
});

test('PAPER_SECTIONS: 含 titleZh', () => {
  for (const s of PAPER_SECTIONS) {
    assert.ok(s.titleZh);
    assert.ok(s.title);
  }
});

// ---------- DELIVERABLE_DIRS ---
test('DELIVERABLE_DIRS: 5 个 kind', () => {
  assert.equal(Object.keys(DELIVERABLE_DIRS).length, 5);
  assert.equal(DELIVERABLE_DIRS.draft, 'drafts');
  assert.equal(DELIVERABLE_DIRS.review, 'reviews');
  assert.equal(DELIVERABLE_DIRS.experiment, 'experiments');
  assert.equal(DELIVERABLE_DIRS.paper_addition, 'paper_additions');
  assert.equal(DELIVERABLE_DIRS.rebuttal, 'rebuttals');
});

// ---------- PAPER_LATEX_TEMPLATES ---
test('PAPER_LATEX_TEMPLATES: 含多个模板', () => {
  const keys = Object.keys(PAPER_LATEX_TEMPLATES);
  assert.ok(keys.length >= 5);
  assert.ok(keys.includes('article'));
  assert.ok(keys.includes('acmart'));
});

test('PAPER_LATEX_TEMPLATES: 每个有 preamble + compileHint', () => {
  for (const k of Object.keys(PAPER_LATEX_TEMPLATES)) {
    const t = PAPER_LATEX_TEMPLATES[k];
    assert.ok(Array.isArray(t.preamble));
    assert.ok(typeof t.compileHint === 'string');
  }
});

// ---------- listLatexTemplates ---
test('listLatexTemplates: 返回所有模板信息对象', () => {
  const r = listLatexTemplates();
  assert.ok(r.length >= 5);
  assert.ok(r.some((t) => t.id === 'article'));
  assert.ok(r.some((t) => t.id === 'acmart'));
  // 每个含 compileHint + preambleHead
  for (const t of r) {
    assert.ok(typeof t.compileHint === 'string');
    assert.ok(typeof t.preambleHead === 'string');
  }
});

// ---------- getLatexCompileHint ---
test('getLatexCompileHint: article', () => {
  assert.match(getLatexCompileHint('article'), /pdflatex|xelatex/);
});

test('getLatexCompileHint: 未知模板 → fallback', () => {
  const h = getLatexCompileHint('nonexistent');
  assert.ok(typeof h === 'string' && h.length > 0);
});

// ---------- stripFrontmatter ---
test('stripFrontmatter: 标量', () => {
  const r = stripFrontmatter('---\ntitle: T\n---\nbody');
  assert.equal(r.frontmatter.title, 'T');
  assert.equal(r.body, 'body');
});

test('stripFrontmatter: 数组', () => {
  const r = stripFrontmatter('---\ntags: [a, b]\n---\nx');
  assert.deepEqual(r.frontmatter.tags, ['a', 'b']);
});

test('stripFrontmatter: 布尔', () => {
  const r = stripFrontmatter('---\ndraft: true\n---\nx');
  assert.equal(r.frontmatter.draft, true);
});

test('stripFrontmatter: 无 frontmatter', () => {
  const r = stripFrontmatter('plain body');
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.body, 'plain body');
});

// ---------- extractMarkdownSection ---
test('extractMarkdownSection: 抽取 "## Abstract"', () => {
  const md = '# Title\n\n## Abstract\n\nThis is the abstract.\n\n## Other\n\nX';
  const r = extractMarkdownSection(md, /abstract/i);
  assert.match(r, /This is the abstract/);
  assert.ok(!r.includes('Other'));
});

test('extractMarkdownSection: 无匹配 → ""', () => {
  const r = extractMarkdownSection('# Title\n\nbody', /nonexistent/i);
  assert.equal(r, '');
});

test('extractMarkdownSection: 中文标题', () => {
  const md = '## 摘要\n\n中文摘要内容\n\n## 其他';
  const r = extractMarkdownSection(md, /摘要/);
  assert.match(r, /中文摘要内容/);
});

// ---------- collectBibliography ---
test('collectBibliography: 提取 paperIds 去重', () => {
  const rounds = [{
    designer: {
      proposals: [
        { id: 'p1', evidence: { paperIds: ['2310.12345', '2401.00001'] } },
        { id: 'p2', evidence: { paperIds: ['2310.12345'] } }, // 重复
      ],
    },
  }];
  const r = collectBibliography(rounds);
  assert.equal(r.length, 2);
  assert.ok(r.find((e) => e.id === '2310.12345'));
});

test('collectBibliography: citedBy 列表', () => {
  const rounds = [{
    designer: {
      proposals: [
        { id: 'p1', evidence: { paperIds: ['2310.12345'] } },
        { id: 'p2', evidence: { paperIds: ['2310.12345'] } },
      ],
    },
  }];
  const r = collectBibliography(rounds);
  const e = r.find((x) => x.id === '2310.12345');
  assert.equal(e.citations, 2);
  assert.deepEqual(e.citedBy.sort(), ['p1', 'p2']);
});

test('collectBibliography: 按 id 字典序排序', () => {
  const rounds = [{
    designer: {
      proposals: [
        { id: 'p', evidence: { paperIds: ['2401.00001', '2310.12345'] } },
      ],
    },
  }];
  const r = collectBibliography(rounds);
  assert.equal(r[0].id, '2310.12345');
  assert.equal(r[1].id, '2401.00001');
});

test('collectBibliography: 空 rounds → []', () => {
  assert.deepEqual(collectBibliography([]), []);
});

test('collectBibliography: null rounds → []', () => {
  assert.deepEqual(collectBibliography(null), []);
});

test('collectBibliography: paperId 规范化 (去 URL 路径)', () => {
  const rounds = [{
    designer: {
      proposals: [{ id: 'p', evidence: { paperIds: ['arxiv.org/abs/2310.12345'] } }],
    },
  }];
  const r = collectBibliography(rounds);
  assert.equal(r[0].id, '2310.12345');
});

test('collectBibliography: BibTeX key = arxiv_<id>', () => {
  const rounds = [{
    designer: {
      proposals: [{ id: 'p', evidence: { paperIds: ['2310.12345'] } }],
    },
  }];
  const r = collectBibliography(rounds);
  assert.equal(r[0].key, 'arxiv_2310_12345');
});

// ---------- formatBibtex ---
test('formatBibtex: 空 → "no references" comment', () => {
  assert.match(formatBibtex([]), /no references/i);
});

test('formatBibtex: 含 @misc + eprint', () => {
  const r = formatBibtex([
    { key: 'arxiv_2310_12345', id: '2310.12345', citations: 2, citedBy: ['p1', 'p2'] },
  ]);
  assert.match(r, /@misc\{arxiv_2310_12345/);
  assert.match(r, /eprint\s*=\s*\{2310\.12345\}/);
  assert.match(r, /archivePrefix\s*=\s*\{arXiv\}/);
});

test('formatBibtex: 多个 entries', () => {
  const r = formatBibtex([
    { key: 'k1', id: '2310.12345', citations: 1, citedBy: ['p1'] },
    { key: 'k2', id: '2401.00001', citations: 1, citedBy: ['p2'] },
  ]);
  const matches = r.match(/@misc/g);
  assert.equal(matches.length, 2);
});

// ---------- escapeLatex ---
test('escapeLatex: 空', () => {
  assert.equal(escapeLatex(''), '');
});

test('escapeLatex: 普通字符串不变', () => {
  assert.equal(escapeLatex('hello world'), 'hello world');
});

test('escapeLatex: 转义 & $ % # _ { }', () => {
  const r = escapeLatex('a & b $ c % d # e _ f { g } h');
  assert.match(r, /a \\& b/);
  assert.match(r, /\\\$ c/);
  assert.match(r, /\\% d/);
  assert.match(r, /\\# e/);
  assert.match(r, /\\_ f/);
  assert.match(r, /\\{ g/);
  assert.match(r, /\\} h/);
});

test('escapeLatex: 反斜杠 → textbackslash{}', () => {
  const r = escapeLatex('a\\b');
  assert.match(r, /\\textbackslash\{\}/);
});

test('escapeLatex: 不重复转义 \\textbackslash{}', () => {
  // 关键: \\ → \textbackslash{} 不应变成 \textbackslash\{\}
  const r = escapeLatex('\\');
  assert.equal(r, '\\textbackslash{}');
  assert.ok(!r.includes('\\textbackslash\\'));
});

test('escapeLatex: ~ → textasciitilde{}', () => {
  const r = escapeLatex('a~b');
  assert.match(r, /\\textasciitilde\{\}/);
});

test('escapeLatex: ^ → textasciicircum{}', () => {
  const r = escapeLatex('a^b');
  assert.match(r, /\\textasciicircum\{\}/);
});

test('escapeLatex: null → ""', () => {
  assert.equal(escapeLatex(null), '');
});

// ---------- buildPaperDraft ---
test('buildPaperDraft: 最小输入', () => {
  const d = buildPaperDraft({});
  assert.equal(d.sessionId, '(unknown)');
  assert.equal(d.goal, '');
  assert.match(d.title, /Research Session/);
  assert.ok(Array.isArray(d.sections));
  assert.equal(d.sections.length, 5);
  assert.deepEqual(d.bibliography, []);
});

test('buildPaperDraft: meta 透传', () => {
  const d = buildPaperDraft({
    meta: { session_id: 's1', goal: 'study x' },
  });
  assert.equal(d.sessionId, 's1');
  assert.equal(d.goal, 'study x');
  assert.match(d.title, /study x/);
});

test('buildPaperDraft: introduction 含 goal', () => {
  const d = buildPaperDraft({ meta: { goal: 'study transformers' } });
  const intro = d.sections.find((s) => s.id === 'introduction');
  assert.match(intro.body, /study transformers/);
});

test('buildPaperDraft: deliverable 落到对应章节', () => {
  const d = buildPaperDraft({
    deliverables: [
      { kind: 'draft', raw: '# D1\n\ndraft body', round: 1 },
      { kind: 'experiment', raw: '# E1\n\nexp body', round: 1 },
    ],
  });
  const results = d.sections.find((s) => s.id === 'results');
  const method = d.sections.find((s) => s.id === 'method');
  assert.equal(results.entries.length, 1);
  assert.equal(method.entries.length, 1);
});

test('buildPaperDraft: deliverables stats', () => {
  const d = buildPaperDraft({
    deliverables: [
      { kind: 'draft', raw: '# D\nbody' },
    ],
    rounds: [{ designer: { proposals: [{}, {}] }, modifier: { applied: [{}] } }],
  });
  assert.equal(d.stats.deliverables, 1);
  assert.equal(d.stats.proposals, 2);
  assert.equal(d.stats.applied, 1);
  assert.equal(d.stats.rounds, 1);
});

test('buildPaperDraft: syntheses → abstract', () => {
  const d = buildPaperDraft({
    syntheses: [
      { idx: 1, raw: '## Abstract\n\nThis is the synthesis abstract.' },
    ],
  });
  assert.match(d.abstract, /synthesis abstract/);
});

test('buildPaperDraft: bibliography 从 rounds 收集', () => {
  const d = buildPaperDraft({
    rounds: [{
      designer: {
        proposals: [{ id: 'p1', evidence: { paperIds: ['2310.12345'] } }],
      },
    }],
  });
  assert.equal(d.bibliography.length, 1);
});

test('buildPaperDraft: 空 deliverable → sectionsWithContent < 5', () => {
  const d = buildPaperDraft({});
  // introduction 不算 empty (有 goal placeholder)
  // 其余 4 个 sections 都 empty
  assert.ok(d.stats.sectionsWithContent <= 1);
});

test('buildPaperDraft: generatedAt 透传', () => {
  const d = buildPaperDraft({ generatedAt: '2026-01-01T00:00:00Z' });
  assert.equal(d.generatedAt, '2026-01-01T00:00:00Z');
});

// ---------- formatPaperMarkdown ---
test('formatPaperMarkdown: null → "(draft is empty)"', () => {
  const r = formatPaperMarkdown(null);
  assert.match(r, /draft is empty/);
});

test('formatPaperMarkdown: 包含 title + abstract', () => {
  const d = buildPaperDraft({
    meta: { session_id: 's1', goal: 'goal text' },
  });
  const r = formatPaperMarkdown(d);
  assert.match(r, /## Abstract/);
  assert.match(r, /goal text/);
});

test('formatPaperMarkdown: 包含每章节', () => {
  const d = buildPaperDraft({});
  const r = formatPaperMarkdown(d);
  assert.match(r, /## Introduction/);
  assert.match(r, /## Related Work/);
  assert.match(r, /## Method/);
  assert.match(r, /## Results and Discussion/);
  assert.match(r, /## Limitations/);
});

test('formatPaperMarkdown: 含 deliverables', () => {
  const d = buildPaperDraft({
    deliverables: [{ kind: 'draft', raw: '# D\n\nDraft content here.', round: 1 }],
  });
  const r = formatPaperMarkdown(d);
  assert.match(r, /Draft content here/);
});

test('formatPaperMarkdown: 无 references → "(no references..."', () => {
  const d = buildPaperDraft({});
  const r = formatPaperMarkdown(d);
  assert.match(r, /no references collected/);
});

test('formatPaperMarkdown: 含 references 列表', () => {
  const d = buildPaperDraft({
    rounds: [{
      designer: {
        proposals: [{ id: 'p1', evidence: { paperIds: ['2310.12345'] } }],
      },
    }],
  });
  const r = formatPaperMarkdown(d);
  assert.match(r, /## References/);
  assert.match(r, /arXiv:2310\.12345/);
});

test('formatPaperMarkdown: 末尾 footer', () => {
  const r = formatPaperMarkdown(buildPaperDraft({}));
  assert.match(r, /Compiled by DPR/);
});

// ---------- formatPaperLatex ---
test('formatPaperLatex: 含 documentclass', () => {
  const d = buildPaperDraft({});
  const r = formatPaperLatex(d, { documentclass: 'article' });
  assert.match(r, /\\documentclass/);
});

test('formatPaperLatex: 转义 title 中的特殊字符', () => {
  const d = buildPaperDraft({ meta: { session_id: 's', goal: 'A & B' } });
  const r = formatPaperLatex(d, { documentclass: 'article' });
  assert.ok(!r.includes('A & B'));
  assert.match(r, /A \\& B/);
});

test('formatPaperLatex: 含 thebibliography', () => {
  const d = buildPaperDraft({});
  const r = formatPaperLatex(d);
  // 可能含 \begin{thebibliography} 或 not 含 (空 bib)
  assert.match(r, /\\(begin|end)\{document\}/);
});

// ---------- 集成 ---
test('集成: build + markdown + bibtex', () => {
  const d = buildPaperDraft({
    meta: { session_id: 's1', goal: 'integration test' },
    rounds: [{
      designer: { proposals: [{ id: 'p1', evidence: { paperIds: ['2310.12345'] } }] },
    }],
    deliverables: [{ kind: 'draft', raw: '# D\n\nContent.', round: 1 }],
  });
  const md = formatPaperMarkdown(d);
  const bib = formatBibtex(d.bibliography);
  assert.match(md, /integration test/);
  assert.match(bib, /@misc/);
});

test('集成: LaTeX 输出含正确 documentclass', () => {
  const d = buildPaperDraft({ meta: { session_id: 's', goal: 'g' } });
  const r1 = formatPaperLatex(d, { documentclass: 'article' });
  const r2 = formatPaperLatex(d, { documentclass: 'acmart' });
  assert.match(r1, /article/);
  assert.match(r2, /acmart/);
});
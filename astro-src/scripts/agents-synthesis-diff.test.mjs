#!/usr/bin/env node
// astro-src/scripts/agents-synthesis-diff.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/synthesis-diff.mjs.
// stripFrontmatter + extractSynthesisTopics + extractSynthesisRefIds +
// countWords + diffSyntheses + formatSynthesisDiffText。

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

const mod = await loadMjs('lib/agents/synthesis-diff.mjs');
const {
  stripFrontmatter,
  extractSynthesisTopics,
  extractSynthesisRefIds,
  countWords,
  diffSyntheses,
  formatSynthesisDiffText,
} = mod;

// ---------- stripFrontmatter ---
test('stripFrontmatter: 标量 + 数组 + 数字', () => {
  const r = stripFrontmatter('---\ntitle: T\ncount: 42\ntags: [a, b]\n---\nx');
  assert.equal(r.frontmatter.title, 'T');
  assert.equal(r.frontmatter.count, 42);
  assert.deepEqual(r.frontmatter.tags, ['a', 'b']);
});

// ---------- extractSynthesisTopics ---
test('topics: H1/H2/H3', () => {
  const r = extractSynthesisTopics('# Foo\n\n## Bar\n\n### Baz\n');
  assert.deepEqual(r, ['Foo', 'Bar', 'Baz']);
});

test('topics: H4/H5/H6 不抽取', () => {
  const r = extractSynthesisTopics('#### H4\n##### H5\n###### H6\n');
  assert.deepEqual(r, []);
});

test('topics: 空 body → []', () => {
  assert.deepEqual(extractSynthesisTopics(''), []);
});

test('topics: null/undefined → []', () => {
  assert.deepEqual(extractSynthesisTopics(null), []);
});

// ---------- extractSynthesisRefIds ---
test('refs: arXiv URL 形式', () => {
  const r = extractSynthesisRefIds('See arxiv.org/abs/2310.12345 and arxiv.org/abs/2401.00001');
  assert.deepEqual(r, ['2310.12345', '2401.00001']);
});

test('refs: bare id 形式', () => {
  const r = extractSynthesisRefIds('paper 2501.0001 is good');
  assert.deepEqual(r, ['2501.0001']);
});

test('refs: 去重 + 排序', () => {
  const r = extractSynthesisRefIds('2401.00001 and 2310.12345 and 2401.00001 again');
  assert.deepEqual(r, ['2310.12345', '2401.00001']);
});

test('refs: 空 → []', () => {
  assert.deepEqual(extractSynthesisRefIds(''), []);
});

// ---------- countWords ---
test('countWords: 中文', () => {
  // '中文' = 2 chars
  assert.equal(countWords('中文字'), 3);
});

test('countWords: 英文', () => {
  assert.equal(countWords('hello world'), 2);
});

test('countWords: 混合', () => {
  // '你好 world 中文': 4 中文字符(你好中文 each char) + 1 拉丁词 = 5
  assert.equal(countWords('你好 world 中文'), 5);
});

test('countWords: 空 → 0', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
});

test('countWords: 数字 token', () => {
  // 'paper 2501.00001' 中 'paper' + '2501' + '00001' = 3 (句点 split)
  const r = countWords('paper 2501.00001');
  assert.ok(r >= 2);
});

// ---------- diffSyntheses: 基本 ---
test('diff: 空双方 → similarity=0 (Jaccard 0/1 = 0)', () => {
  // 空 body → topics 都 [] → jaccTopics = 0/max(1,0) = 0
  // similarity = 0*0.7 + 0*0.3 = 0
  const r = diffSyntheses({ idx: 0, raw: '' }, { idx: 0, raw: '' });
  assert.equal(r.stats.similarity, 0);
});

test('diff: meta 提取', () => {
  const a = { idx: 1, raw: '---\ntitle: A\nmodel: gpt-4\nrounds_synthesized: 3\n---\n' };
  const b = { idx: 2, raw: '---\ntitle: B\nmodel: claude\nrounds_synthesized: 5\n---\n' };
  const r = diffSyntheses(a, b);
  assert.equal(r.meta.titleA, 'A');
  assert.equal(r.meta.titleB, 'B');
  assert.equal(r.meta.modelA, 'gpt-4');
  assert.equal(r.meta.modelB, 'claude');
  assert.equal(r.metaDelta.roundsSynthesizedDelta, 2);
  assert.equal(r.metaDelta.modelChanged, true);
  assert.equal(r.metaDelta.titleChanged, true);
});

test('diff: model same → modelChanged=false', () => {
  const a = { idx: 1, raw: '---\nmodel: gpt-4\n---\n' };
  const b = { idx: 2, raw: '---\nmodel: gpt-4\n---\n' };
  const r = diffSyntheses(a, b);
  assert.equal(r.metaDelta.modelChanged, false);
});

// ---------- topics set diff ---
test('diff: topics shared/added/removed', () => {
  const a = { idx: 1, raw: '# A\n## B\n## C\n' };
  const b = { idx: 2, raw: '# A\n## C\n## D\n' };
  const r = diffSyntheses(a, b);
  assert.deepEqual(r.body.topicsShared.sort(), ['A', 'C']);
  assert.deepEqual(r.body.topicsAdded, ['D']);
  assert.deepEqual(r.body.topicsRemoved, ['B']);
});

// ---------- refs set diff ---
test('diff: refs added/removed/shared', () => {
  const a = { idx: 1, raw: 'arxiv.org/abs/2310.12345 and 2401.00001' };
  const b = { idx: 2, raw: 'arxiv.org/abs/2310.12345 and 2501.00002' };
  const r = diffSyntheses(a, b);
  assert.deepEqual(r.body.refsRefIdsShared, ['2310.12345']);
  assert.deepEqual(r.body.refsRefIdsAdded, ['2501.00002']);
  assert.deepEqual(r.body.refsRefIdsRemoved, ['2401.00001']);
});

// ---------- word count ---
test('diff: wordCount delta', () => {
  const a = { idx: 1, raw: '# Hello world' };
  const b = { idx: 2, raw: '# Hello world here is more text' };
  const r = diffSyntheses(a, b);
  assert.ok(r.body.wordCountB > r.body.wordCountA);
  assert.equal(r.body.wordCountDelta, r.body.wordCountB - r.body.wordCountA);
});

// ---------- similarity ---
test('diff: similarity = 0.7 * jacc_topics + 0.3 * jacc_refs', () => {
  // topics 完全一样 → jaccTopics=1
  // refs 完全不一样 → jaccRefs=0
  // similarity = 1*0.7 + 0*0.3 = 0.7
  const a = { idx: 1, raw: '# A\n## B\n\narxiv.org/abs/2310.12345' };
  const b = { idx: 2, raw: '# A\n## B\n\narxiv.org/abs/2501.00002' };
  const r = diffSyntheses(a, b);
  assert.ok(Math.abs(r.stats.similarity - 0.7) < 1e-9);
});

test('diff: similarity = 1 (完全相同)', () => {
  const md = '# A\n## B\n\narxiv.org/abs/2310.12345';
  const r = diffSyntheses({ idx: 1, raw: md }, { idx: 2, raw: md });
  assert.equal(r.stats.similarity, 1);
});

test('diff: similarity = 0 (完全不同)', () => {
  const a = { idx: 1, raw: '# Topic1\n\narxiv.org/abs/2310.00001' };
  const b = { idx: 2, raw: '# Topic2\n\narxiv.org/abs/2401.00002' };
  const r = diffSyntheses(a, b);
  assert.equal(r.stats.similarity, 0);
});

// ---------- opts ---
test('diff: includeBody=false → body=null', () => {
  const a = { idx: 1, raw: '# A\n' };
  const b = { idx: 2, raw: '# B\n' };
  const r = diffSyntheses(a, b, { includeBody: false });
  assert.equal(r.body, null);
  // stats 兜底为 0
  assert.equal(r.stats.topicsAdded, 0);
  assert.equal(r.stats.similarity, 1);
});

// ---------- generatedAt ---
test('diff: generatedAt delta ms', () => {
  const a = { idx: 1, raw: '---\ngenerated_at: 2026-01-01T00:00:00Z\n---\n' };
  const b = { idx: 2, raw: '---\ngenerated_at: 2026-01-01T00:00:05Z\n---\n' };
  const r = diffSyntheses(a, b);
  assert.equal(r.metaDelta.generatedAtDeltaMs, 5000);
});

test('diff: 缺 generatedAt → null', () => {
  const r = diffSyntheses({ idx: 1, raw: '' }, { idx: 2, raw: '' });
  assert.equal(r.metaDelta.generatedAtDeltaMs, null);
});

// ---------- stats ---
test('diff: stats counts', () => {
  const a = { idx: 1, raw: '# A\n## B\n## C\n\narxiv.org/abs/2310.00001\narxiv.org/abs/2310.00002' };
  const b = { idx: 2, raw: '# A\n## D\n\narxiv.org/abs/2310.00001\narxiv.org/abs/2310.00003' };
  const r = diffSyntheses(a, b);
  assert.equal(r.stats.topicsAdded, 1); // D
  assert.equal(r.stats.topicsRemoved, 2); // B, C
  assert.equal(r.stats.topicsShared, 1); // A
  assert.equal(r.stats.refsAdded, 1); // 2310.00003
  assert.equal(r.stats.refsRemoved, 1); // 2310.00002
  assert.equal(r.stats.refsShared, 1); // 2310.00001
});

// ---------- null 输入 ---
test('diff: null inputs → defaults', () => {
  const r = diffSyntheses(null, null);
  assert.equal(r.idxA, 0);
  assert.equal(r.idxB, 0);
});

// ---------- formatSynthesisDiffText ---
test('format: null → "(empty diff)"', () => {
  assert.equal(formatSynthesisDiffText(null), '(empty diff)');
});

test('format: 含 summary + meta + body 行', () => {
  const diff = {
    idxA: 1, idxB: 2,
    meta: {},
    metaDelta: { roundsSynthesizedDelta: 2, modelChanged: false, titleChanged: false },
    body: {
      wordCountA: 100, wordCountB: 150, wordCountDelta: 50,
      topicsAdded: ['T1'], topicsRemoved: [], topicsShared: [],
      refsRefIdsAdded: [], refsRefIdsRemoved: [], refsRefIdsShared: [],
      similarity: 0.5,
    },
    stats: { topicsAdded: 1, topicsRemoved: 0, topicsShared: 0, refsAdded: 0, refsRemoved: 0, refsShared: 0, similarity: 0.5 },
  };
  const r = formatSynthesisDiffText(diff);
  assert.match(r, /Synthesis #1 → #2/);
  assert.match(r, /rounds \+2/);
  assert.match(r, /words 100 → 150/);
  assert.match(r, /Topics added/);
  assert.match(r, /\+ T1/);
});

test('format: model CHANGED 标识', () => {
  const r = formatSynthesisDiffText({
    idxA: 1, idxB: 2, meta: {},
    metaDelta: { modelChanged: true, titleChanged: false },
    body: null,
    stats: {},
  });
  assert.match(r, /model CHANGED/);
});

test('format: title CHANGED 标识', () => {
  const r = formatSynthesisDiffText({
    idxA: 1, idxB: 2, meta: {},
    metaDelta: { modelChanged: false, titleChanged: true },
    body: null,
    stats: {},
  });
  assert.match(r, /title CHANGED/);
});

test('format: refs added/removed 列表', () => {
  const r = formatSynthesisDiffText({
    idxA: 1, idxB: 2, meta: {},
    metaDelta: {},
    body: {
      wordCountA: 0, wordCountB: 0, wordCountDelta: 0,
      topicsAdded: [], topicsRemoved: [], topicsShared: [],
      refsRefIdsAdded: ['2501.00002'], refsRefIdsRemoved: ['2310.00001'], refsRefIdsShared: [],
      similarity: 0,
    },
    stats: { topicsAdded: 0, topicsRemoved: 0, topicsShared: 0, refsAdded: 1, refsRemoved: 1, refsShared: 0, similarity: 0 },
  });
  assert.match(r, /Refs added \(1\)/);
  assert.match(r, /\+ arXiv:2501\.00002/);
  assert.match(r, /Refs removed \(1\)/);
  assert.match(r, /- arXiv:2310\.00001/);
});

test('format: null metaDelta 字段 → "?"', () => {
  const r = formatSynthesisDiffText({
    idxA: 1, idxB: 2, meta: {},
    metaDelta: { roundsSynthesizedDelta: null, modelChanged: false, titleChanged: false },
    body: null,
    stats: {},
  });
  assert.match(r, /rounds \?/);
});

test('format: 负 delta 标识', () => {
  const r = formatSynthesisDiffText({
    idxA: 1, idxB: 2, meta: {},
    metaDelta: { roundsSynthesizedDelta: -2, modelChanged: false, titleChanged: false },
    body: null,
    stats: {},
  });
  assert.match(r, /rounds -2/);
});

// ---------- 集成 ---
test('集成: diff + format end-to-end', () => {
  const a = { idx: 1, raw: '---\ntitle: Old\n---\n# Topic1\n## Topic2\n\narxiv.org/abs/2310.00001' };
  const b = { idx: 2, raw: '---\ntitle: New\n---\n# Topic1\n## Topic3\n\narxiv.org/abs/2310.00001\narxiv.org/abs/2401.00002' };
  const diff = diffSyntheses(a, b);
  const text = formatSynthesisDiffText(diff);
  assert.match(text, /Synthesis #1 → #2/);
  assert.match(text, /\+ Topic3/);
  assert.match(text, /- Topic2/);
  assert.match(text, /\+ arXiv:2401\.00002/);
});
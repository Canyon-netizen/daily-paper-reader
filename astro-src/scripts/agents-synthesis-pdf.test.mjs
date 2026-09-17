#!/usr/bin/env node
// astro-src/scripts/agents-synthesis-pdf.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/synthesis-pdf.mjs (纯函数)。
// stripFrontmatter (浅 YAML 解析) +
// buildPdfBundle (meta + syntheses → PdfBundle) +
// formatPdfHtml (PDFBundle → 自包含 HTML) +
// buildPdfFileName (sessionId → safe 文件名)。

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

const mod = await loadMjs('lib/agents/synthesis-pdf.mjs');
const { stripFrontmatter, buildPdfBundle, formatPdfHtml, buildPdfFileName } = mod;

// ---------- stripFrontmatter ----------
test('stripFrontmatter: 无 frontmatter → 空对象 + 全文 body', () => {
  const r = stripFrontmatter('hello world');
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.body, 'hello world');
});

test('stripFrontmatter: 空字符串', () => {
  const r = stripFrontmatter('');
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.body, '');
});

test('stripFrontmatter: null 输入', () => {
  const r = stripFrontmatter(null);
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.body, '');
});

test('stripFrontmatter: 基础标量', () => {
  const r = stripFrontmatter('---\ntitle: Foo\ncount: 42\n---\nbody text');
  assert.equal(r.frontmatter.title, 'Foo');
  assert.equal(r.frontmatter.count, '42');
  assert.equal(r.body, 'body text');
});

test('stripFrontmatter: 布尔', () => {
  const r = stripFrontmatter('---\ndraft: true\npublished: false\n---\nx');
  assert.equal(r.frontmatter.draft, true);
  assert.equal(r.frontmatter.published, false);
});

test('stripFrontmatter: 数组', () => {
  const r = stripFrontmatter('---\ntags: [a, b, c]\n---\nx');
  assert.deepEqual(r.frontmatter.tags, ['a', 'b', 'c']);
});

test('stripFrontmatter: 空数组 → []', () => {
  const r = stripFrontmatter('---\nempty: []\n---\nx');
  assert.deepEqual(r.frontmatter.empty, []);
});

test('stripFrontmatter: 数组带引号', () => {
  const r = stripFrontmatter('---\ntags: ["a", "b"]\n---\nx');
  assert.deepEqual(r.frontmatter.tags, ['a', 'b']);
});

test('stripFrontmatter: 引号包裹字符串', () => {
  const r = stripFrontmatter('---\ntitle: "Quoted Title"\n---\nx');
  assert.equal(r.frontmatter.title, 'Quoted Title');
});

test('stripFrontmatter: \\r\\n 行尾', () => {
  const r = stripFrontmatter('---\r\ntitle: A\r\n---\r\nbody');
  assert.equal(r.frontmatter.title, 'A');
  assert.equal(r.body, 'body');
});

test('stripFrontmatter: 无效行 → 跳过', () => {
  const r = stripFrontmatter('---\ntitle: ok\n!@#$% weird\nfoo: bar\n---\nbody');
  assert.equal(r.frontmatter.title, 'ok');
  assert.equal(r.frontmatter.foo, 'bar');
});

test('stripFrontmatter: 不闭合的 → 当作无 frontmatter', () => {
  const r = stripFrontmatter('---\ntitle: x\nbody continues');
  // 没有第二个 --- → 整段是 body
  assert.deepEqual(r.frontmatter, {});
});

// ---------- buildPdfBundle ----------
test('buildPdfBundle: 最小输入', () => {
  const b = buildPdfBundle({});
  assert.equal(b.sessionId, '(unknown)');
  assert.equal(b.goal, '');
  assert.match(b.title, /Research Session/);
  assert.deepEqual(b.syntheses, []);
  assert.equal(b.stats.syntheses, 0);
  assert.equal(b.stats.totalHtmlBytes, 0);
});

test('buildPdfBundle: 从 meta 提取 session_id + goal', () => {
  const b = buildPdfBundle({
    meta: { session_id: 'sess-001', goal: 'study transformers' },
  });
  assert.equal(b.sessionId, 'sess-001');
  assert.equal(b.goal, 'study transformers');
  assert.match(b.title, /study transformers/);
});

test('buildPdfBundle: 无 goal → 用 Research Session 标题', () => {
  const b = buildPdfBundle({ meta: { session_id: 'x' } });
  assert.match(b.title, /Research Session x/);
});

test('buildPdfBundle: syntheses 按 idx 排序', () => {
  const b = buildPdfBundle({
    syntheses: [
      { idx: 3, raw: 'three' },
      { idx: 1, raw: 'one' },
      { idx: 2, raw: 'two' },
    ],
  });
  assert.equal(b.syntheses[0].idx, 1);
  assert.equal(b.syntheses[1].idx, 2);
  assert.equal(b.syntheses[2].idx, 3);
});

test('buildPdfBundle: synthesis 提取 frontmatter 字段', () => {
  const md = '---\ntitle: My Synthesis\ngenerated_at: 2026-01-01\nmodel: gpt-4\nrounds_synthesized: 3\ndeliverables_referenced: 5\nunique_papers: 7\n---\n# Body';
  const b = buildPdfBundle({ syntheses: [{ idx: 1, raw: md }] });
  const s = b.syntheses[0];
  assert.equal(s.title, 'My Synthesis');
  assert.equal(s.generatedAt, '2026-01-01');
  assert.equal(s.model, 'gpt-4');
  assert.equal(s.roundsSynthesized, 3);
  assert.equal(s.deliverablesReferenced, 5);
  assert.equal(s.uniquePapers, 7);
});

test('buildPdfBundle: 缺 frontmatter title → "Synthesis #idx"', () => {
  const b = buildPdfBundle({ syntheses: [{ idx: 5, raw: 'plain' }] });
  assert.equal(b.syntheses[0].title, 'Synthesis #5');
});

test('buildPdfBundle: stats.totalHtmlBytes 累计', () => {
  const b = buildPdfBundle({
    syntheses: [
      { idx: 1, raw: 'hello' },
      { idx: 2, raw: 'world' },
    ],
  });
  const expected = b.syntheses[0].html.length + b.syntheses[1].html.length;
  assert.equal(b.stats.totalHtmlBytes, expected);
});

test('buildPdfBundle: 自定义 generatedAt 透传', () => {
  const b = buildPdfBundle({ generatedAt: '2026-09-17T00:00:00Z' });
  assert.equal(b.generatedAt, '2026-09-17T00:00:00Z');
});

test('buildPdfBundle: meta=null → defaults', () => {
  const b = buildPdfBundle({ meta: null });
  assert.equal(b.sessionId, '(unknown)');
  assert.equal(b.meta, null);
});

test('buildPdfBundle: html 字段非空', () => {
  const b = buildPdfBundle({ syntheses: [{ idx: 1, raw: '# Title\n\nbody' }] });
  assert.ok(b.syntheses[0].html.includes('<h1'));
  assert.ok(b.syntheses[0].html.includes('body'));
});

// ---------- formatPdfHtml ----------
test('formatPdfHtml: null bundle → 简单 empty', () => {
  const r = formatPdfHtml(null);
  assert.match(r, /<!doctype html>/i);
  assert.match(r, /empty bundle/);
});

test('formatPdfHtml: undefined bundle → 简单 empty', () => {
  const r = formatPdfHtml(undefined);
  assert.match(r, /empty bundle/);
});

test('formatPdfHtml: 包含 cover + meta', () => {
  const b = buildPdfBundle({ meta: { session_id: 's1', goal: 'goal' } });
  const r = formatPdfHtml(b);
  assert.match(r, /<!doctype html>/i);
  assert.match(r, /s1/);
  assert.match(r, /goal/);
});

test('formatPdfHtml: cssVariant academic 默认', () => {
  const b = buildPdfBundle({});
  const r = formatPdfHtml(b);
  assert.match(r, /@page/);
  assert.match(r, /@media print/);
});

test('formatPdfHtml: cssVariant compact', () => {
  const b = buildPdfBundle({});
  const r = formatPdfHtml(b, { cssVariant: 'compact' });
  assert.ok(r.length > 0);
});

test('formatPdfHtml: cssVariant presentation', () => {
  const b = buildPdfBundle({});
  const r = formatPdfHtml(b, { cssVariant: 'presentation' });
  assert.ok(r.length > 0);
});

test('formatPdfHtml: 含 synthesis → TOC', () => {
  const b = buildPdfBundle({
    syntheses: [{ idx: 1, raw: 's1 body' }, { idx: 2, raw: 's2 body' }],
  });
  const r = formatPdfHtml(b);
  assert.match(r, /目录/);
  assert.match(r, /synthesis-1/);
  assert.match(r, /synthesis-2/);
});

test('formatPdfHtml: 空 syntheses → 不显示 TOC', () => {
  const b = buildPdfBundle({});
  const r = formatPdfHtml(b);
  assert.ok(!r.includes('<nav class="toc">'));
  assert.match(r, /no syntheses/);
});

test('formatPdfHtml: page-break 间隔', () => {
  const b = buildPdfBundle({
    syntheses: [{ idx: 1, raw: 'a' }, { idx: 2, raw: 'b' }],
  });
  const r = formatPdfHtml(b);
  assert.match(r, /class="page-break"/);
});

test('formatPdfHtml: session_id HTML 转义', () => {
  const b = buildPdfBundle({ meta: { session_id: '<script>alert(1)</script>' } });
  const r = formatPdfHtml(b);
  assert.ok(!r.includes('<script>alert(1)</script>'));
  assert.match(r, /&lt;script&gt;/);
});

test('formatPdfHtml: 含单数/复数处理', () => {
  const b = buildPdfBundle({
    syntheses: [{
      idx: 1,
      raw: '---\nrounds_synthesized: 1\ndeliverables_referenced: 1\nunique_papers: 1\n---\nx',
    }],
  });
  const r = formatPdfHtml(b);
  // 1 round (单数) 不是 "1 rounds"
  assert.match(r, /1 round(?![s])/);
  assert.match(r, /1 deliverable(?![s])/);
  assert.match(r, /1 paper(?![s])/);
});

test('formatPdfHtml: 含复数处理', () => {
  const b = buildPdfBundle({
    syntheses: [{
      idx: 1,
      raw: '---\nrounds_synthesized: 3\ndeliverables_referenced: 5\nunique_papers: 7\n---\nx',
    }],
  });
  const r = formatPdfHtml(b);
  assert.match(r, /3 rounds/);
  assert.match(r, /5 deliverables/);
  assert.match(r, /7 papers/);
});

// ---------- buildPdfFileName ----------
test('buildPdfFileName: 默认合成文件名', () => {
  assert.equal(buildPdfFileName('sess-001'), 'sess-001-synthesis.html');
});

test('buildPdfFileName: 带 idx → padding 3 位', () => {
  assert.equal(buildPdfFileName('sess-001', 5), 'sess-001-synthesis-005.html');
});

test('buildPdfFileName: idx=1 padding', () => {
  assert.equal(buildPdfFileName('s1', 1), 's1-synthesis-001.html');
});

test('buildPdfFileName: 特殊字符 → underscore', () => {
  // 末位 ! 替换为 _,然后拼接 -synthesis.html
  assert.equal(buildPdfFileName('a/b c@d!'), 'a_b_c_d_-synthesis.html');
});

test('buildPdfFileName: 保留 - 和 _', () => {
  assert.equal(buildPdfFileName('sess-001_abc'), 'sess-001_abc-synthesis.html');
});

test('buildPdfFileName: null sessionId → "unknown"', () => {
  assert.equal(buildPdfFileName(null), 'unknown-synthesis.html');
});

test('buildPdfFileName: idx=null → 单文件', () => {
  assert.equal(buildPdfFileName('s1', null), 's1-synthesis.html');
});

// ---------- 集成 ----------
test('集成: buildPdfBundle + formatPdfHtml end-to-end', () => {
  const md = '---\ntitle: Final\n---\n# Heading\n\n**bold** text';
  const b = buildPdfBundle({
    meta: { session_id: 'end2end', goal: 'integration' },
    syntheses: [{ idx: 1, raw: md }],
    generatedAt: '2026-09-17T00:00:00Z',
  });
  const html = formatPdfHtml(b);
  assert.match(html, /<h1/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /end2end/);
  assert.match(html, /integration/);
  assert.match(html, /Final/);
});

test('集成: stripFrontmatter 数字字面量 → 字符串', () => {
  const r = stripFrontmatter('---\ncount: 42\nratio: 0.5\n---\nx');
  // 浅解析不强制类型,保留 string
  assert.equal(r.frontmatter.count, '42');
  assert.equal(r.frontmatter.ratio, '0.5');
});
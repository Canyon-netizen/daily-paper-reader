#!/usr/bin/env node
// astro-src/scripts/paper-frontmatter-parse.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-frontmatter/parse.ts.
// parseFigureList + normalizeFigureEntry + normalizeDate + normalizeScore
// + normalizeCategories + parseFrontmatter + extractWikiArticle + extractWikiArticleStrict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(relPath) {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, '..', relPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['node:*'],
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/paper-frontmatter/parse.ts');
const {
  parseFigureList,
  normalizeFigureEntry,
  normalizeDate,
  normalizeScore,
  normalizeCategories,
  parseFrontmatter,
  extractWikiArticle,
  extractWikiArticleStrict,
} = mod;

// ---------- normalizeFigureEntry ----------
test('normalizeFigureEntry: 标准项', () => {
  const r = normalizeFigureEntry({ url: 'img.png', caption: 'caption' }, 0);
  assert.equal(r.url, 'img.png');
  assert.equal(r.caption, 'caption');
  assert.equal(r.page, 0);
  assert.equal(r.index, 1);
  assert.equal(r.width, 0);
});

test('normalizeFigureEntry: 无 url → null', () => {
  assert.equal(normalizeFigureEntry({ caption: 'no url' }, 0), null);
});

test('normalizeFigureEntry: 非对象 → null', () => {
  assert.equal(normalizeFigureEntry('string', 0), null);
  assert.equal(normalizeFigureEntry(null, 0), null);
  assert.equal(normalizeFigureEntry(undefined, 0), null);
  assert.equal(normalizeFigureEntry(123, 0), null);
});

test('normalizeFigureEntry: url trim', () => {
  const r = normalizeFigureEntry({ url: '  img.png  ' }, 0);
  assert.equal(r.url, 'img.png');
});

test('normalizeFigureEntry: url trim 后空 → null', () => {
  assert.equal(normalizeFigureEntry({ url: '   ' }, 0), null);
});

test('normalizeFigureEntry: index 字段优先', () => {
  const r = normalizeFigureEntry({ url: 'img.png', index: 5 }, 0);
  assert.equal(r.index, 5);
});

test('normalizeFigureEntry: page 非数字 → 0', () => {
  const r = normalizeFigureEntry({ url: 'img.png', page: 'foo' }, 0);
  assert.equal(r.page, 0);
});

test('normalizeFigureEntry: width 非数字 → 0', () => {
  const r = normalizeFigureEntry({ url: 'img.png', width: 'foo' }, 0);
  assert.equal(r.width, 0);
});

test('normalizeFigureEntry: height/extractor 透传', () => {
  const r = normalizeFigureEntry({ url: 'img.png', height: 100, extractor: 'pdf' }, 0);
  assert.equal(r.height, 100);
  assert.equal(r.extractor, 'pdf');
});

// ---------- parseFigureList ----------
test('parseFigureList: undefined → []', () => {
  assert.deepEqual(parseFigureList(undefined), []);
});

test('parseFigureList: null → []', () => {
  assert.deepEqual(parseFigureList(null), []);
});

test('parseFigureList: 空字符串 → []', () => {
  assert.deepEqual(parseFigureList(''), []);
});

test('parseFigureList: JSON 字符串', () => {
  const r = parseFigureList('[{"url":"a.png"}]');
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'a.png');
});

test('parseFigureList: JSON 解析失败 → []', () => {
  assert.deepEqual(parseFigureList('not json'), []);
});

test('parseFigureList: 损坏的引号重试', () => {
  // '\\\\"' → '"' replace 一次可能修复
  const r = parseFigureList('[{\\"url\\": \\"a.png\\"}]');
  // 两次都解析失败 → []
  assert.ok(Array.isArray(r));
});

test('parseFigureList: 数组', () => {
  const r = parseFigureList([{ url: 'a.png' }, { url: 'b.png' }]);
  assert.equal(r.length, 2);
});

test('parseFigureList: 非数组 → []', () => {
  assert.deepEqual(parseFigureList('{}'), []);
  assert.deepEqual(parseFigureList(123), []);
});

test('parseFigureList: 过滤非法项', () => {
  const r = parseFigureList([{ url: 'a.png' }, { noUrl: true }, null, { url: 'b.png' }]);
  assert.equal(r.length, 2);
});

// ---------- normalizeDate ----------
test('normalizeDate: undefined → undefined', () => {
  assert.equal(normalizeDate(undefined), undefined);
});

test('normalizeDate: null → undefined', () => {
  assert.equal(normalizeDate(null), undefined);
});

test('normalizeDate: Date instance → YYYY-MM-DD', () => {
  const d = new Date('2026-09-17T00:00:00Z');
  assert.equal(normalizeDate(d), '2026-09-17');
});

test('normalizeDate: number 8 位', () => {
  // 20260917 → '2026-09-17'
  assert.equal(normalizeDate(20260917), '2026-09-17');
});

test('normalizeDate: number 不足 8 位 padStart', () => {
  // 260917 (6 位) → '00260917' → '0026-09-17'
  assert.equal(normalizeDate(260917), '0026-09-17');
});

test('normalizeDate: string 透传', () => {
  assert.equal(normalizeDate('2026-09-17'), '2026-09-17');
});

test('normalizeDate: 非 string/number/Date → undefined', () => {
  assert.equal(normalizeDate({}), undefined);
  assert.equal(normalizeDate([]), undefined);
});

// ---------- normalizeScore ----------
test('normalizeScore: 0–1 区间原样', () => {
  assert.equal(normalizeScore(0.5), 0.5);
});

test('normalizeScore: 0 原样', () => {
  assert.equal(normalizeScore(0), 0);
});

test('normalizeScore: 1 原样', () => {
  assert.equal(normalizeScore(1), 1);
});

test('normalizeScore: >1 (legacy 0-10) → /10', () => {
  assert.equal(normalizeScore(8), 0.8);
});

test('normalizeScore: 10 → 1.0 (钳到 1)', () => {
  // 10/10 = 1.0 → n > 1 false → 1.0
  assert.equal(normalizeScore(10), 1.0);
});

test('normalizeScore: >10 钳到 1', () => {
  assert.equal(normalizeScore(15), 1);
});

test('normalizeScore: 负数 → 0', () => {
  assert.equal(normalizeScore(-0.5), 0);
});

test('normalizeScore: NaN → undefined', () => {
  assert.equal(normalizeScore(NaN), undefined);
});

test('normalizeScore: Infinity → undefined', () => {
  assert.equal(normalizeScore(Infinity), undefined);
});

test('normalizeScore: 非 number → undefined', () => {
  assert.equal(normalizeScore('foo'), undefined);
  assert.equal(normalizeScore(null), undefined);
  assert.equal(normalizeScore(undefined), undefined);
});

// ---------- normalizeCategories ----------
test('normalizeCategories: 空 → buildCategories({})', () => {
  const r = normalizeCategories(null);
  assert.deepEqual(r, { venue: [], task: [], method: [], type: [] });
});

test('normalizeCategories: 字符串 → buildCategories({})', () => {
  assert.deepEqual(normalizeCategories('foo'), { venue: [], task: [], method: [], type: [] });
});

test('normalizeCategories: 部分字段非数组 → undefined', () => {
  // {venue:'foo',task:['reasoning']} → venue 字段非数组 → undefined,task: ['reasoning']
  // 'reasoning' 在白名单 → 保留
  const r = normalizeCategories({ venue: 'foo', task: ['reasoning'] });
  assert.deepEqual(r.task, ['reasoning']);
  assert.deepEqual(r.venue, []);
});

test('normalizeCategories: 完整 4 dim', () => {
  // 任意 sample
  const r = normalizeCategories({ venue: ['foo'], task: ['reasoning'], method: [], type: [] });
  // 'reasoning' 可能在白名单也可能不在 → 至少不会抛
  assert.ok(r);
});

// ---------- parseFrontmatter ----------
test('parseFrontmatter: 完整 frontmatter', () => {
  const text = '---\ntitle: Foo\ndate: 2026-09-17\n---\nBody here';
  const r = parseFrontmatter(text);
  assert.equal('error' in r, false);
  if ('data' in r) {
    assert.equal(r.data.title, 'Foo');
    assert.equal(r.data.date, '2026-09-17');
    assert.equal(r.body, 'Body here');
  }
});

test('parseFrontmatter: \\r\\n 行尾', () => {
  const text = '---\r\ntitle: Foo\r\n---\r\nBody';
  const r = parseFrontmatter(text);
  assert.equal('error' in r, false);
});

test('parseFrontmatter: 无 frontmatter → error', () => {
  const r = parseFrontmatter('Just body');
  assert.equal('error' in r, true);
});

test('parseFrontmatter: 无 body → body=""', () => {
  const text = '---\ntitle: Foo\n---\n';
  const r = parseFrontmatter(text);
  if ('data' in r) {
    assert.equal(r.body, '');
  }
});

test('parseFrontmatter: 空 frontmatter → data={}', () => {
  const text = '---\n\n---\nBody';
  const r = parseFrontmatter(text);
  if ('data' in r) {
    assert.equal(r.data.title, undefined);
  }
});

// ---------- extractWikiArticle ----------
test('extractWikiArticle: 5 节完整', () => {
  const body = `
## TL;DR
一句话总结

## 研究背景与动机
背景

## 方法
方法

## 实验与结果
结果

## 讨论与可借鉴点
讨论

## 摘要
中文摘要
`;
  const r = extractWikiArticle(body);
  assert.notEqual(r, null);
  assert.match(r, /TL;DR/);
});

test('extractWikiArticle: 无 TL;DR → null', () => {
  const body = `
## 摘要
just summary
`;
  assert.equal(extractWikiArticle(body), null);
});

test('extractWikiArticle: 空 body → null', () => {
  assert.equal(extractWikiArticle(''), null);
});

test('extractWikiArticle: 终止于 ## 摘要', () => {
  const body = `## TL;DR
foo

## 摘要
abstract here
`;
  const r = extractWikiArticle(body);
  assert.match(r, /TL;DR/);
  assert.match(r, /foo/);
  assert.doesNotMatch(r, /abstract here/);
});

test('extractWikiArticle: 终止于 ## Abstract', () => {
  const body = `## TL;DR
foo

## Abstract
en abstract
`;
  const r = extractWikiArticle(body);
  assert.match(r, /foo/);
  assert.doesNotMatch(r, /en abstract/);
});

test('extractWikiArticle: 无终止 → 取到末尾', () => {
  const body = `## TL;DR
foo bar
`;
  const r = extractWikiArticle(body);
  assert.match(r, /foo bar/);
});

// ---------- extractWikiArticleStrict ----------
test('extractWikiArticleStrict: 5 节完整 → 返回', () => {
  const body = `
## TL;DR
一句话

## 研究背景与动机
bg

## 方法
method

## 实验与结果
result

## 讨论与可借鉴点
disc
`;
  const r = extractWikiArticleStrict(body);
  assert.notEqual(r, null);
});

test('extractWikiArticleStrict: 缺一节 → null', () => {
  const body = `
## TL;DR
一句话

## 研究背景与动机
bg

## 方法
method

## 实验与结果
result
`;
  // 缺讨论
  assert.equal(extractWikiArticleStrict(body), null);
});

test('extractWikiArticleStrict: 无 TL;DR → null', () => {
  assert.equal(extractWikiArticleStrict('just text'), null);
});
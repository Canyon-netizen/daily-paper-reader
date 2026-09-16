#!/usr/bin/env node
// astro-src/scripts/paper-frontmatter-parse.test.mjs
//
// Tests for R7 polish: astro-src/lib/paper-frontmatter/parse.ts pure helpers.
// 不能直接 esbuild load — parseFrontmatter 引 js-yaml + concepts-index(链上
// 又有 js-yaml 不可 externalize in data URL),且本文件只测纯函数。inline 算法,源做参考。

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- inline helpers (源 lib/paper-frontmatter/parse.ts) ----------------

// normalizeDate
function normalizeDate(v) {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const s = String(v).padStart(8, '0');
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(4 + 2, 4 + 4)}`;
  }
  if (typeof v === 'string') return v;
  return undefined;
}

// normalizeFigureEntry
function normalizeFigureEntry(item, fallbackIndex) {
  if (!item || typeof item !== 'object') return null;
  const obj = item;
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!url) return null;
  return {
    url,
    caption: typeof obj.caption === 'string' ? obj.caption : '',
    page: typeof obj.page === 'number' ? obj.page : 0,
    index: typeof obj.index === 'number' ? obj.index : fallbackIndex + 1,
    width: typeof obj.width === 'number' ? obj.width : 0,
    height: typeof obj.height === 'number' ? obj.height : 0,
    extractor: typeof obj.extractor === 'string' ? obj.extractor : '',
  };
}

// parseFigureList
function parseFigureList(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      try {
        arr = JSON.parse(s.replace(/\\"/g, '"'));
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((item, i) => normalizeFigureEntry(item, i)).filter((e) => e !== null);
}

// normalizeScore
function normalizeScore(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < 0) return 0;
  const n = v > 1 ? v / 10 : v;
  return n > 1 ? 1 : n;
}

// buildCategories (简化版,lib/taxonomies)
const TAXONOMY = {
  venue: ['NeurIPS', 'ICML', 'ICLR', 'CVPR', 'ACL', 'EMNLP', 'AAAI'],
  task: ['classification', 'regression', 'generation'],
  method: ['transformer', 'cnn', 'rnn'],
  type: ['benchmark', 'survey'],
};
function buildCategories(raw) {
  const out = { venue: [], task: [], method: [], type: [] };
  for (const dim of ['venue', 'task', 'method', 'type']) {
    if (Array.isArray(raw[dim])) {
      for (const v of raw[dim]) {
        if (typeof v === 'string' && TAXONOMY[dim].includes(v)) out[dim].push(v);
      }
    }
  }
  return out;
}

// normalizeCategories
function normalizeCategories(raw) {
  if (!raw || typeof raw !== 'object') return buildCategories({});
  const obj = raw;
  return buildCategories({
    venue: Array.isArray(obj.venue) ? obj.venue : undefined,
    task: Array.isArray(obj.task) ? obj.task : undefined,
    method: Array.isArray(obj.method) ? obj.method : undefined,
    type: Array.isArray(obj.type) ? obj.type : undefined,
  });
}

// extractWikiArticle
function extractWikiArticle(body) {
  if (!body) return null;
  const startRe = /^## TL;DR\s*$/m;
  const startMatch = startRe.exec(body);
  if (!startMatch) return null;
  const endRe = /^## (摘要|Abstract)\s*$/m;
  const endMatch = endRe.exec(body.slice(startMatch.index + 1));
  const end = endMatch ? startMatch.index + 1 + endMatch.index : body.length;
  return body.slice(startMatch.index, end).trim();
}

const REQUIRED_WIKI_HEADINGS = [
  '## TL;DR',
  '## 研究背景与动机',
  '## 方法',
  '## 实验与结果',
  '## 讨论与可借鉴点',
];

function extractWikiArticleStrict(body) {
  const wiki = extractWikiArticle(body);
  if (!wiki) return null;
  return REQUIRED_WIKI_HEADINGS.every((h) => wiki.includes(h)) ? wiki : null;
}

// ---------- normalizeFigureEntry ----------
test('normalizeFigureEntry: 缺 url → null', () => {
  assert.equal(normalizeFigureEntry({}, 0), null);
  assert.equal(normalizeFigureEntry({ caption: 'foo' }, 0), null);
});

test('normalizeFigureEntry: 缺项 → null', () => {
  assert.equal(normalizeFigureEntry(null, 0), null);
  assert.equal(normalizeFigureEntry(undefined, 0), null);
  assert.equal(normalizeFigureEntry('string', 0), null);
  assert.equal(normalizeFigureEntry(42, 0), null);
});

test('normalizeFigureEntry: 完整字段', () => {
  const e = normalizeFigureEntry({
    url: 'fig1.png', caption: 'Fig 1', page: 2, index: 5,
    width: 800, height: 600, extractor: 'pdftoppm',
  }, 0);
  assert.equal(e.url, 'fig1.png');
  assert.equal(e.caption, 'Fig 1');
  assert.equal(e.page, 2);
  assert.equal(e.index, 5);
  assert.equal(e.width, 800);
  assert.equal(e.height, 600);
  assert.equal(e.extractor, 'pdftoppm');
});

test('normalizeFigureEntry: 缺 caption 默认 ""', () => {
  assert.equal(normalizeFigureEntry({ url: 'fig.png' }, 0).caption, '');
});

test('normalizeFigureEntry: 缺 page 默认 0', () => {
  assert.equal(normalizeFigureEntry({ url: 'fig.png' }, 0).page, 0);
});

test('normalizeFigureEntry: 缺 index 用 fallbackIndex+1', () => {
  assert.equal(normalizeFigureEntry({ url: 'a.png' }, 0).index, 1);
  assert.equal(normalizeFigureEntry({ url: 'b.png' }, 5).index, 6);
});

test('normalizeFigureEntry: url 周围空白 trim', () => {
  assert.equal(normalizeFigureEntry({ url: '  fig.png  ' }, 0).url, 'fig.png');
});

test('normalizeFigureEntry: width/height 缺省 0', () => {
  const e = normalizeFigureEntry({ url: 'fig.png' }, 0);
  assert.equal(e.width, 0);
  assert.equal(e.height, 0);
});

// ---------- parseFigureList ----------
test('parseFigureList: 空输入 → []', () => {
  assert.deepEqual(parseFigureList(null), []);
  assert.deepEqual(parseFigureList(undefined), []);
  assert.deepEqual(parseFigureList(''), []);
  assert.deepEqual(parseFigureList('   '), []);
});

test('parseFigureList: 数组直接通过', () => {
  const r = parseFigureList([{ url: 'a.png' }, { url: 'b.png' }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].url, 'a.png');
});

test('parseFigureList: JSON 字符串解析', () => {
  const r = parseFigureList('[{"url": "a.png"}, {"url": "b.png"}]');
  assert.equal(r.length, 2);
});

test('parseFigureList: JSON 解析失败 → []', () => {
  assert.deepEqual(parseFigureList('not json {'), []);
});

test('parseFigureList: 数组中非法 entry 被过滤', () => {
  const r = parseFigureList([{ url: 'a.png' }, {}, { caption: 'no url' }, { url: 'b.png' }]);
  assert.equal(r.length, 2);
});

test('parseFigureList: 非数组字符串解析结果 → []', () => {
  assert.deepEqual(parseFigureList('"hello"'), []);
});

test('parseFigureList: 非字符串非数组 → []', () => {
  assert.deepEqual(parseFigureList(42), []);
  assert.deepEqual(parseFigureList({}), []);
});

// ---------- normalizeDate ----------
test('normalizeDate: undefined / null → undefined', () => {
  assert.equal(normalizeDate(undefined), undefined);
  assert.equal(normalizeDate(null), undefined);
});

test('normalizeDate: 字符串原样返回', () => {
  assert.equal(normalizeDate('2025-01-15'), '2025-01-15');
});

test('normalizeDate: Date 对象 → YYYY-MM-DD', () => {
  const d = new Date('2025-01-15T10:30:00Z');
  assert.equal(normalizeDate(d), '2025-01-15');
});

test('normalizeDate: 数字 8 位 → YYYY-MM-DD (padStart)', () => {
  assert.equal(normalizeDate(20250115), '2025-01-15');
});

test('normalizeDate: 数字 < 8 位 → padStart', () => {
  // 123 → '00000123' → '0000-01-23'
  assert.equal(normalizeDate(123), '0000-01-23');
});

test('normalizeDate: 非数字/字符串/Date → undefined', () => {
  assert.equal(normalizeDate({}), undefined);
  assert.equal(normalizeDate([]), undefined);
  assert.equal(normalizeDate(true), undefined);
});

// ---------- normalizeScore ----------
test('normalizeScore: 非 number → undefined', () => {
  assert.equal(normalizeScore('0.5'), undefined);
  assert.equal(normalizeScore(null), undefined);
  assert.equal(normalizeScore(undefined), undefined);
});

test('normalizeScore: NaN → undefined', () => {
  assert.equal(normalizeScore(NaN), undefined);
});

test('normalizeScore: Infinity → undefined', () => {
  assert.equal(normalizeScore(Infinity), undefined);
});

test('normalizeScore: 负数 → 0', () => {
  assert.equal(normalizeScore(-1), 0);
});

test('normalizeScore: 0-1 区间 → 原样', () => {
  assert.equal(normalizeScore(0), 0);
  assert.equal(normalizeScore(0.5), 0.5);
  assert.equal(normalizeScore(1), 1);
});

test('normalizeScore: > 1 视为 0-10 刻度,除以 10', () => {
  assert.equal(normalizeScore(8.0), 0.8);
  assert.equal(normalizeScore(5), 0.5);
});

test('normalizeScore: > 10 钳到 1', () => {
  assert.equal(normalizeScore(15), 1);
  assert.equal(normalizeScore(100), 1);
});

test('normalizeScore: 边界 1.0', () => {
  // 1.0 正好,不被视为 > 1 → 原样
  assert.equal(normalizeScore(1.0), 1.0);
});

// ---------- normalizeCategories ----------
test('normalizeCategories: null/undefined → 空 4-dim', () => {
  assert.deepEqual(normalizeCategories(null), { venue: [], task: [], method: [], type: [] });
  assert.deepEqual(normalizeCategories(undefined), { venue: [], task: [], method: [], type: [] });
});

test('normalizeCategories: 非对象 → 空 4-dim', () => {
  assert.deepEqual(normalizeCategories('foo'), { venue: [], task: [], method: [], type: [] });
});

test('normalizeCategories: 白名单内保留', () => {
  const r = normalizeCategories({ venue: ['NeurIPS'], task: ['classification'] });
  assert.deepEqual(r.venue, ['NeurIPS']);
  assert.deepEqual(r.task, ['classification']);
});

test('normalizeCategories: 白名单外丢弃', () => {
  const r = normalizeCategories({ venue: ['NeurIPS', 'MadeUp'] });
  assert.deepEqual(r.venue, ['NeurIPS']);
});

test('normalizeCategories: 非数组字段被忽略', () => {
  const r = normalizeCategories({ venue: 'NeurIPS', task: 42 });
  assert.deepEqual(r.venue, []);
  assert.deepEqual(r.task, []);
});

// ---------- extractWikiArticle / Strict ----------
test('extractWikiArticle: 无 ## TL;DR → null', () => {
  assert.equal(extractWikiArticle(''), null);
  assert.equal(extractWikiArticle('# Hello\n\nBody'), null);
});

test('extractWikiArticle: 单 ## TL;DR (无终止) → 到末尾', () => {
  const body = '## TL;DR\n一些内容';
  const r = extractWikiArticle(body);
  assert.ok(r.includes('## TL;DR'));
  assert.ok(r.includes('一些内容'));
});

test('extractWikiArticle: 含 ## 摘要 → 终止', () => {
  const body = '## TL;DR\nwiki content\n\n## 摘要\n正式摘要';
  const r = extractWikiArticle(body);
  assert.ok(r.includes('wiki content'));
  assert.ok(!r.includes('正式摘要'));
});

test('extractWikiArticle: 含 ## Abstract → 终止', () => {
  const body = '## TL;DR\nwiki\n\n## Abstract\nabs';
  const r = extractWikiArticle(body);
  assert.ok(r.includes('wiki'));
  assert.ok(!r.includes('abs'));
});

test('extractWikiArticleStrict: 5 节齐全 → 返回 wiki', () => {
  const body = [
    '## TL;DR',
    'TL;DR 内容',
    '## 研究背景与动机',
    '背景',
    '## 方法',
    '方法',
    '## 实验与结果',
    '实验',
    '## 讨论与可借鉴点',
    '讨论',
    '## 摘要',
    '正文',
  ].join('\n');
  const r = extractWikiArticleStrict(body);
  assert.ok(r);
  assert.ok(r.includes('讨论'));
});

test('extractWikiArticleStrict: 缺一节 → null', () => {
  const body = [
    '## TL;DR',
    'TL;DR 内容',
    '## 研究背景与动机',
    '背景',
    // 缺 方法 / 实验与结果 / 讨论与可借鉴点
    '## 摘要',
  ].join('\n');
  assert.equal(extractWikiArticleStrict(body), null);
});

test('extractWikiArticleStrict: 无 TL;DR → null', () => {
  assert.equal(extractWikiArticleStrict('只有正文'), null);
});

test('extractWikiArticle: 空前缀 body → null', () => {
  assert.equal(extractWikiArticle(null), null);
});
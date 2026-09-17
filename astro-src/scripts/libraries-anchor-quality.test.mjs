#!/usr/bin/env node
// astro-src/scripts/libraries-anchor-quality.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/anchor-quality.ts.
// scoreAnchorPaper (citations/recency/milestone) + rankAnchorPapers。

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
    platform: 'neutral',
    write: false,
    target: 'es2022',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

const mod = await loadTs('lib/libraries/anchor-quality.ts');
const { scoreAnchorPaper, rankAnchorPapers } = mod;

const mkPaper = (overrides) => ({
  arxivId: '1',
  ...overrides,
});

// ---------- 缺失 paper ----------
test('scoreAnchorPaper: 缺失 → score=0 + 3 reasons', () => {
  const map = new Map();
  const r = scoreAnchorPaper('missing', map);
  assert.equal(r.score, 0);
  assert.equal(r.reasons.length, 3);
  assert.match(r.reasons.join('|'), /No citation data/);
  assert.match(r.reasons.join('|'), /No date data/);
  assert.match(r.reasons.join('|'), /Not a milestone/);
});

// ---------- citations 分层 ----------
test('scoreAnchorPaper: citations=100+ → 0.4', () => {
  const map = new Map([['1', mkPaper({ arxivId: '1', citations: 200 })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0.4);
  assert.match(r.reasons.join('|'), /High citations/);
});

test('scoreAnchorPaper: citations=50 → 0.35', () => {
  const map = new Map([['1', mkPaper({ citations: 50 })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0.35);
  assert.match(r.reasons.join('|'), /Good citations/);
});

test('scoreAnchorPaper: citations=10 → ~0.3', () => {
  const map = new Map([['1', mkPaper({ citations: 10 })]]);
  const r = scoreAnchorPaper('1', map);
  // 0.3 - (10-10)*0.01 = 0.3
  assert.equal(r.score, 0.3);
});

test('scoreAnchorPaper: citations=30 → 线性 0.1', () => {
  // 0.3 - (30-10)*0.01 = 0.3 - 0.2 = 0.1
  const map = new Map([['1', mkPaper({ citations: 30 })]]);
  const r = scoreAnchorPaper('1', map);
  assert.ok(Math.abs(r.score - 0.1) < 0.001);
});

test('scoreAnchorPaper: citations=0 → 0', () => {
  const map = new Map([['1', mkPaper({ citations: 0 })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0);
});

test('scoreAnchorPaper: citations=5 → 0.1 (5 * 0.02)', () => {
  const map = new Map([['1', mkPaper({ citations: 5 })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0.1);
});

// ---------- recency 分层 ----------
test('scoreAnchorPaper: 半年内 → 0.3', () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 天前
  const map = new Map([['1', mkPaper({ date: recent.toISOString() })]]);
  const r = scoreAnchorPaper('1', map);
  assert.match(r.reasons.join('|'), /Recent \(<6 months\)/);
});

test('scoreAnchorPaper: 1 年内 → 0.2', () => {
  const now = new Date();
  const date = new Date(now.getTime() - 300 * 24 * 60 * 60 * 1000); // 300 天前
  const map = new Map([['1', mkPaper({ date: date.toISOString() })]]);
  const r = scoreAnchorPaper('1', map);
  assert.match(r.reasons.join('|'), /Recent \(6-12 months\)/);
});

test('scoreAnchorPaper: 2 年内 → 0.1', () => {
  const now = new Date();
  // 18 个月前,绝对落在 1-2 年区间(避免 TZ 浮点抖动)
  const date = new Date(now.getTime() - 540 * 24 * 60 * 60 * 1000);
  const map = new Map([['1', mkPaper({ date: date.toISOString() })]]);
  const r = scoreAnchorPaper('1', map);
  assert.match(r.reasons.join('|'), /Moderate age/);
});

test('scoreAnchorPaper: >2 年 → 0', () => {
  const date = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000);
  const map = new Map([['1', mkPaper({ date: date.toISOString() })]]);
  const r = scoreAnchorPaper('1', map);
  assert.match(r.reasons.join('|'), /Older paper/);
  // 不加分
  // 注意: citations / milestone 也可能给分,但 date 部分不给
});

// ---------- milestone ----------
test('scoreAnchorPaper: milestone=true → 0.3', () => {
  const map = new Map([['1', mkPaper({ milestone: true })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0.3);
  assert.match(r.reasons.join('|'), /Milestone/);
});

test('scoreAnchorPaper: milestone=false → 0', () => {
  const map = new Map([['1', mkPaper({ milestone: false })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0);
});

// ---------- 总分 (叠加) ---
test('scoreAnchorPaper: 满分 → 1.0', () => {
  const map = new Map([['1', mkPaper({
    citations: 200, // 0.4
    date: new Date().toISOString(), // 0.3
    milestone: true, // 0.3
  })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 1.0);
});

test('scoreAnchorPaper: 全部为 0 → 0', () => {
  const map = new Map([['1', mkPaper({
    citations: 0,
    date: undefined,
    milestone: false,
  })]]);
  const r = scoreAnchorPaper('1', map);
  assert.equal(r.score, 0);
});

// ---------- 钳制 ---
test('scoreAnchorPaper: 钳制到 0..1 (即使加了超过)', () => {
  // 实现保证: 即使三层都给分 → 上限 1.0
  const map = new Map([['1', mkPaper({
    citations: 200,
    date: new Date().toISOString(),
    milestone: true,
  })]]);
  const r = scoreAnchorPaper('1', map);
  assert.ok(r.score >= 0 && r.score <= 1);
});

// ---------- reasons 长度 ---
test('scoreAnchorPaper: reasons 总在 3 个', () => {
  const cases = [
    { citations: 0 },
    { date: '2020-01-01' },
    { milestone: true },
    { citations: 100, date: '2020-01-01', milestone: true },
  ];
  for (const c of cases) {
    const map = new Map([['1', mkPaper(c)]]);
    const r = scoreAnchorPaper('1', map);
    assert.equal(r.reasons.length, 3);
  }
});

// ---------- rankAnchorPapers ----------
test('rankAnchorPapers: 排序 desc', () => {
  const now = new Date();
  const map = new Map([
    ['a', { arxivId: 'a', citations: 0, milestone: false }],
    ['b', { arxivId: 'b', citations: 100, milestone: false }],
    ['c', { arxivId: 'c', citations: 100, milestone: true }],
  ]);
  const r = rankAnchorPapers(['a', 'b', 'c'], map);
  // 实现用 { id, ...score } 返回,字段名是 id 不是 arxivId
  assert.equal(r[0].id, 'c');
  assert.equal(r[1].id, 'b');
  assert.equal(r[2].id, 'a');
  assert.ok(r[0].score >= r[1].score);
  assert.ok(r[1].score >= r[2].score);
});

test('rankAnchorPapers: 空数组 → 空', () => {
  const r = rankAnchorPapers([], new Map());
  assert.deepEqual(r, []);
});

test('rankAnchorPapers: 含 score 字段', () => {
  const r = rankAnchorPapers(['1'], new Map());
  assert.equal(typeof r[0].score, 'number');
});
#!/usr/bin/env node
// astro-src/scripts/anchor-quality.test.mjs
//
// Tests for R7 polish: astro-src/lib/libraries/anchor-quality.ts.

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

function nowMinusYears(years) {
  return new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString();
}

test('scoreAnchorPaper: 未知 paper → 0 + reasons 全标缺', () => {
  const r = scoreAnchorPaper('xxx', new Map());
  assert.equal(r.score, 0);
  assert.ok(r.reasons.includes('No citation data'));
  assert.ok(r.reasons.includes('No date data'));
  assert.ok(r.reasons.includes('Not a milestone'));
});

test('scoreAnchorPaper: 100+ citations → 0.4', () => {
  const map = new Map([['p1', { arxivId: 'p1', citations: 150 }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.4); // 没有 recency 和 milestone
  assert.ok(r.reasons.includes('High citations (100+)'));
});

test('scoreAnchorPaper: 50-99 citations → 0.35', () => {
  const map = new Map([['p1', { arxivId: 'p1', citations: 60 }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.35);
});

test('scoreAnchorPaper: 10-50 citations 线性内插', () => {
  const map = new Map([['p1', { arxivId: 'p1', citations: 30 }]]);
  const r = scoreAnchorPaper('p1', map);
  // 0.3 - (30-10)*0.01 = 0.1
  assert.ok(Math.abs(r.score - 0.1) < 1e-9);
});

test('scoreAnchorPaper: 0-10 citations 线性 0.02/cit', () => {
  const map = new Map([['p1', { arxivId: 'p1', citations: 5 }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.1); // 5 * 0.02
});

test('scoreAnchorPaper: recency <6 个月 → +0.3', () => {
  const map = new Map([['p1', { arxivId: 'p1', date: nowMinusYears(0.3) }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.3);
  assert.ok(r.reasons.includes('Recent (<6 months)'));
});

test('scoreAnchorPaper: recency 6-12 个月 → +0.2', () => {
  const map = new Map([['p1', { arxivId: 'p1', date: nowMinusYears(0.8) }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.2);
});

test('scoreAnchorPaper: recency 1-2 年 → +0.1', () => {
  const map = new Map([['p1', { arxivId: 'p1', date: nowMinusYears(1.5) }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.1);
});

test('scoreAnchorPaper: recency >2 年 → +0', () => {
  const map = new Map([['p1', { arxivId: 'p1', date: nowMinusYears(3) }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0);
  assert.ok(r.reasons.includes('Older paper (>2 years)'));
});

test('scoreAnchorPaper: milestone=true → +0.3', () => {
  const map = new Map([['p1', { arxivId: 'p1', milestone: true }]]);
  const r = scoreAnchorPaper('p1', map);
  assert.equal(r.score, 0.3);
  assert.ok(r.reasons.includes('Milestone paper'));
});

test('scoreAnchorPaper: 综合高分数(citations+recency+milestone)', () => {
  const map = new Map([
    ['p1', { arxivId: 'p1', citations: 200, date: nowMinusYears(0.2), milestone: true }],
  ]);
  const r = scoreAnchorPaper('p1', map);
  // 0.4 + 0.3 + 0.3 = 1.0
  assert.equal(r.score, 1.0);
});

test('scoreAnchorPaper: 夹紧到 [0,1](score 不会超 1)', () => {
  // 即使各项相加 = 1.0,clamp 后还是 1.0
  const map = new Map([
    ['p1', { arxivId: 'p1', citations: 200, date: nowMinusYears(0.1), milestone: true }],
  ]);
  const r = scoreAnchorPaper('p1', map);
  assert.ok(r.score <= 1.0);
});

test('rankAnchorPapers: 按 score desc 排序', () => {
  const map = new Map([
    ['high', { arxivId: 'high', citations: 200, milestone: true }],
    ['low', { arxivId: 'low', citations: 1 }],
    ['mid', { arxivId: 'mid', citations: 50 }],
  ]);
  const r = rankAnchorPapers(['low', 'mid', 'high'], map);
  assert.equal(r[0].id, 'high');
  assert.equal(r[0].score, 0.7); // 0.35 + 0.3
  assert.equal(r[1].id, 'mid');
  assert.equal(r[2].id, 'low');
});

test('rankAnchorPapers: 空数组 → 空', () => {
  const r = rankAnchorPapers([], new Map());
  assert.deepEqual(r, []);
});

test('rankAnchorPapers: 未知 arxivId → score=0 排在最后', () => {
  const map = new Map([['known', { arxivId: 'known', citations: 50 }]]);
  const r = rankAnchorPapers(['unknown', 'known'], map);
  assert.equal(r[0].id, 'known');
  assert.equal(r[1].id, 'unknown');
  assert.equal(r[1].score, 0);
});

test('rankAnchorPapers: 返回 {arxivId, score} 字段', () => {
  const map = new Map([['p1', { arxivId: 'p1', citations: 50 }]]);
  const r = rankAnchorPapers(['p1'], map);
  assert.equal(r[0].id, 'p1');
  assert.equal(typeof r[0].score, 'number');
});
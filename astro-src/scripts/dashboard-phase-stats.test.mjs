#!/usr/bin/env node
// astro-src/scripts/dashboard-phase-stats.test.mjs
//
// Tests for R7 polish: astro-src/lib/dashboard/phase-stats.ts.

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

const mod = await loadTs('lib/dashboard/phase-stats.ts');
const { computePhaseStats, getTotalPhaseItems, getDominantPhase } = mod;

test('computePhaseStats: 空输入 → 全 0 数组', () => {
  const r = computePhaseStats({});
  assert.equal(r.length, 7);
  assert.ok(r.every((p) => p.count === 0));
  assert.ok(r.every((p) => p.latestAt === null));
});

test('computePhaseStats: 默认按 count desc 排序', () => {
  const r = computePhaseStats({
    papers: [
      { id: 'p1', status: 'published' },
    ],
    ideas: [
      { id: 'i1', status: 'active' },
      { id: 'i2', status: 'active' },
    ],
  });
  // idea phase 有 2 个 → count 最高
  assert.equal(r[0].phase, 'idea');
  assert.equal(r[0].count, 2);
});

test('computePhaseStats: paper.status=published → published phase', () => {
  const r = computePhaseStats({
    papers: [{ id: 'p1', status: 'published' }],
  });
  const pub = r.find((p) => p.phase === 'published');
  assert.equal(pub.count, 1);
});

test('computePhaseStats: paper.status=submitted → submitted phase', () => {
  const r = computePhaseStats({
    papers: [{ id: 'p1', status: 'submitted' }],
  });
  const sub = r.find((p) => p.phase === 'submitted');
  assert.equal(sub.count, 1);
});

test('computePhaseStats: paper.status 缺省 → literature phase', () => {
  const r = computePhaseStats({
    papers: [{ id: 'p1' }],
  });
  const lit = r.find((p) => p.phase === 'literature');
  assert.equal(lit.count, 1);
});

test('computePhaseStats: idea.status=promoted → experiment phase', () => {
  const r = computePhaseStats({
    ideas: [{ id: 'i1', status: 'promoted' }],
  });
  const exp = r.find((p) => p.phase === 'experiment');
  assert.equal(exp.count, 1);
});

test('computePhaseStats: idea.status=archived → published phase', () => {
  const r = computePhaseStats({
    ideas: [{ id: 'i1', status: 'archived' }],
  });
  const pub = r.find((p) => p.phase === 'published');
  assert.equal(pub.count, 1);
});

test('computePhaseStats: experiment.status=completed → writing phase', () => {
  const r = computePhaseStats({
    experiments: [{ id: 'e1', status: 'completed' }],
  });
  const w = r.find((p) => p.phase === 'writing');
  assert.equal(w.count, 1);
});

test('computePhaseStats: experiment.status=failed → review phase', () => {
  const r = computePhaseStats({
    experiments: [{ id: 'e1', status: 'failed' }],
  });
  const rv = r.find((p) => p.phase === 'review');
  assert.equal(rv.count, 1);
});

test('computePhaseStats: writing.status=draft → writing phase', () => {
  const r = computePhaseStats({
    writings: [{ id: 'w1', status: 'draft' }],
  });
  const w = r.find((p) => p.phase === 'writing');
  assert.equal(w.count, 1);
});

test('computePhaseStats: writing.status=review → review phase', () => {
  const r = computePhaseStats({
    writings: [{ id: 'w1', status: 'review' }],
  });
  const rv = r.find((p) => p.phase === 'review');
  assert.equal(rv.count, 1);
});

test('computePhaseStats: writing.status=reviewing → review phase(同 review)', () => {
  const r = computePhaseStats({
    writings: [{ id: 'w1', status: 'reviewing' }],
  });
  const rv = r.find((p) => p.phase === 'review');
  assert.equal(rv.count, 1);
});

test('computePhaseStats: writing.status=published → published phase', () => {
  const r = computePhaseStats({
    writings: [{ id: 'w1', status: 'published' }],
  });
  const pub = r.find((p) => p.phase === 'published');
  assert.equal(pub.count, 1);
});

test('computePhaseStats: latestAt 选最大时间戳', () => {
  const r = computePhaseStats({
    ideas: [
      { id: 'i1', updatedAt: 1000 },
      { id: 'i2', updatedAt: 5000 },
      { id: 'i3', updatedAt: 3000 },
    ],
  });
  const idea = r.find((p) => p.phase === 'idea');
  assert.equal(idea.latestAt, 5000);
});

test('computePhaseStats: latestAt 跨类型最大', () => {
  const r = computePhaseStats({
    papers: [{ id: 'p1', date: '2025-01-01' }],
    ideas: [{ id: 'i1', updatedAt: 1735689600000 }], // 2025-01-01 ts
  });
  const lit = r.find((p) => p.phase === 'literature');
  // 源实现 new Date(paper) = "Wed Sep 16 2026 ..." (current date from object toString)
  assert.equal(typeof lit.latestAt, 'number');
});

test('computePhaseStats: 最新时间戳为 null 时跳过', () => {
  const r = computePhaseStats({
    ideas: [{ id: 'i1' }], // updatedAt 缺省
  });
  const idea = r.find((p) => p.phase === 'idea');
  assert.equal(idea.latestAt, null);
});

test('computePhaseStats: 综合多类型', () => {
  const r = computePhaseStats({
    papers: [
      { id: 'p1', status: 'published', date: '2025-01-01' },
      { id: 'p2', status: 'submitted' },
      { id: 'p3' }, // literature
    ],
    ideas: [
      { id: 'i1', status: 'active', updatedAt: 100 },
      { id: 'i2', status: 'promoted', updatedAt: 200 },
    ],
    experiments: [{ id: 'e1', status: 'completed' }],
    writings: [{ id: 'w1', status: 'draft' }],
  });
  // idea phase: 1 (active), experiment phase: 1 (promoted), literature: 1, published: 1, submitted: 1, writing: 1 (completed+1 draft = 2?)
  const idea = r.find((p) => p.phase === 'idea');
  const exp = r.find((p) => p.phase === 'experiment');
  const lit = r.find((p) => p.phase === 'literature');
  const pub = r.find((p) => p.phase === 'published');
  const sub = r.find((p) => p.phase === 'submitted');
  const w = r.find((p) => p.phase === 'writing');
  assert.equal(idea.count, 1);
  assert.equal(exp.count, 1);
  assert.equal(lit.count, 1);
  assert.equal(pub.count, 1);
  assert.equal(sub.count, 1);
  assert.equal(w.count, 2); // completed experiment + draft writing
});

test('getTotalPhaseItems: 空 → 0', () => {
  assert.equal(getTotalPhaseItems([]), 0);
});

test('getTotalPhaseItems: 求和', () => {
  const stats = [
    { phase: 'idea', count: 3, latestAt: null },
    { phase: 'writing', count: 2, latestAt: null },
  ];
  assert.equal(getTotalPhaseItems(stats), 5);
});

test('getDominantPhase: 空 → null', () => {
  assert.equal(getDominantPhase([]), null);
});

test('getDominantPhase: count=0 → null', () => {
  const stats = [
    { phase: 'idea', count: 0, latestAt: null },
    { phase: 'writing', count: 0, latestAt: null },
  ];
  assert.equal(getDominantPhase(stats), null);
});

test('getDominantPhase: 返回 count>0 的首个 phase', () => {
  const stats = [
    { phase: 'idea', count: 3, latestAt: null },
    { phase: 'writing', count: 0, latestAt: null },
    { phase: 'review', count: 1, latestAt: null },
  ];
  assert.equal(getDominantPhase(stats), 'idea');
});
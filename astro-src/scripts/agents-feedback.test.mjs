#!/usr/bin/env node
// astro-src/scripts/agents-feedback.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/feedback.ts.
// recordFeedback / getFeedbackFor / adoptionRateByType /
// feedbackScoreByProposalId / tallyVotesByProposalId / summarizeFeedback /
// loadFeedbackFromStorage / saveFeedbackToStorage + isValidFeedback validation。

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

// localStorage + window mocks
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const mod = await loadTs('lib/agents/feedback.ts');
const {
  PROPOSAL_FEEDBACK_KEY,
  recordFeedback,
  getFeedbackFor,
  adoptionRateByType,
  feedbackScoreByProposalId,
  tallyVotesByProposalId,
  summarizeFeedback,
  loadFeedbackFromStorage,
  saveFeedbackToStorage,
} = mod;

const mkFb = (overrides = {}) => ({
  proposalId: 'p1',
  type: 'add_paper',
  vote: 'up',
  createdAt: 1000,
  ...overrides,
});

const resetStorage = () => store.clear();

// ---------- PROPOSAL_FEEDBACK_KEY ---
test('key: 默认 = dpr_proposal_feedback_v1', () => {
  assert.equal(PROPOSAL_FEEDBACK_KEY, 'dpr_proposal_feedback_v1');
});

// ---------- recordFeedback ---
test('record: 加新 feedback', () => {
  const r = recordFeedback(mkFb({ proposalId: 'p1' }));
  assert.equal(r.length, 1);
});

test('record: 同 proposalId 覆盖 (不新增)', () => {
  const r = recordFeedback(mkFb({ proposalId: 'p1', vote: 'up' }), [
    mkFb({ proposalId: 'p1', vote: 'down' }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].vote, 'up');
});

test('record: 不同 proposalId 保留', () => {
  const r = recordFeedback(mkFb({ proposalId: 'p2' }), [mkFb({ proposalId: 'p1' })]);
  assert.equal(r.length, 2);
});

test('record: 返回新数组', () => {
  const orig = [mkFb({ proposalId: 'p1' })];
  const r = recordFeedback(mkFb({ proposalId: 'p2' }), orig);
  assert.notEqual(r, orig);
});

test('record: 不修改原数组', () => {
  const orig = [mkFb({ proposalId: 'p1' })];
  recordFeedback(mkFb({ proposalId: 'p2' }), orig);
  assert.equal(orig.length, 1);
});

// ---------- getFeedbackFor ---
test('getFor: 找到 latest', () => {
  const r = getFeedbackFor('p1', [
    mkFb({ proposalId: 'p1', createdAt: 100, vote: 'up' }),
    mkFb({ proposalId: 'p1', createdAt: 200, vote: 'down' }),
  ]);
  assert.equal(r.vote, 'down'); // 200 更大
});

test('getFor: 缺 → null', () => {
  assert.equal(getFeedbackFor('px', [mkFb({ proposalId: 'p1' })]), null);
});

test('getFor: 空数组 → null', () => {
  assert.equal(getFeedbackFor('p1', []), null);
});

// ---------- adoptionRateByType ---
test('adoption: up/(up+down)', () => {
  const r = adoptionRateByType([
    mkFb({ type: 'add_paper', vote: 'up' }),
    mkFb({ type: 'add_paper', vote: 'up' }),
    mkFb({ type: 'add_paper', vote: 'down' }),
  ]);
  assert.equal(r.add_paper, 2 / 3);
});

test('adoption: skip 不计入分母', () => {
  const r = adoptionRateByType([
    mkFb({ type: 'add_paper', vote: 'up' }),
    mkFb({ type: 'add_paper', vote: 'skip' }),
  ]);
  // skip 不算 → 1/(1+0) = 1.0
  assert.equal(r.add_paper, 1.0);
});

test('adoption: 全 skip → undefined', () => {
  const r = adoptionRateByType([
    mkFb({ type: 'add_paper', vote: 'skip' }),
  ]);
  assert.equal(r.add_paper, undefined);
});

test('adoption: 多 type', () => {
  const r = adoptionRateByType([
    mkFb({ type: 'add_paper', vote: 'up' }),
    mkFb({ type: 'cite_paper', vote: 'down' }),
  ]);
  assert.equal(r.add_paper, 1.0);
  assert.equal(r.cite_paper, 0);
});

// ---------- feedbackScoreByProposalId ---
test('scoreById: up → 0.9', () => {
  const r = feedbackScoreByProposalId([mkFb({ proposalId: 'p1', vote: 'up' })]);
  assert.equal(r.p1, 0.9);
});

test('scoreById: down → 0.1', () => {
  const r = feedbackScoreByProposalId([mkFb({ proposalId: 'p1', vote: 'down' })]);
  assert.equal(r.p1, 0.1);
});

test('scoreById: skip → 0.5', () => {
  const r = feedbackScoreByProposalId([mkFb({ proposalId: 'p1', vote: 'skip' })]);
  assert.equal(r.p1, 0.5);
});

test('scoreById: 后写覆盖前写', () => {
  const r = feedbackScoreByProposalId([
    mkFb({ proposalId: 'p1', vote: 'up' }),
    mkFb({ proposalId: 'p1', vote: 'down' }),
  ]);
  assert.equal(r.p1, 0.1);
});

// ---------- tallyVotesByProposalId ---
test('tally: 计数各 vote', () => {
  const r = tallyVotesByProposalId([
    mkFb({ proposalId: 'p1', vote: 'up' }),
    mkFb({ proposalId: 'p1', vote: 'up' }),
    mkFb({ proposalId: 'p1', vote: 'down' }),
    mkFb({ proposalId: 'p1', vote: 'skip' }),
  ]);
  assert.deepEqual(r.p1, { up: 2, down: 1, skip: 1 });
});

test('tally: 无 vote → 0/0/0', () => {
  const r = tallyVotesByProposalId([mkFb({ proposalId: 'p1', vote: 'skip' })]);
  assert.deepEqual(r.p1, { up: 0, down: 0, skip: 1 });
});

test('tally: 空 → {}', () => {
  assert.deepEqual(tallyVotesByProposalId([]), {});
});

// ---------- summarizeFeedback ---
test('summary: 计数', () => {
  const r = summarizeFeedback([
    mkFb({ vote: 'up' }),
    mkFb({ vote: 'up' }),
    mkFb({ vote: 'down' }),
    mkFb({ vote: 'skip' }),
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.up, 2);
  assert.equal(r.down, 1);
  assert.equal(r.skip, 1);
  assert.equal(r.approvalRate, 2 / 3);
});

test('summary: 全 skip → approvalRate undefined', () => {
  const r = summarizeFeedback([mkFb({ vote: 'skip' })]);
  assert.equal(r.approvalRate, undefined);
});

test('summary: 空', () => {
  const r = summarizeFeedback([]);
  assert.equal(r.total, 0);
  assert.equal(r.approvalRate, undefined);
});

// ---------- loadFeedbackFromStorage / saveFeedbackToStorage ---
test('storage: save → load 往返', () => {
  resetStorage();
  const fbs = [mkFb({ proposalId: 'p1' }), mkFb({ proposalId: 'p2' })];
  saveFeedbackToStorage(fbs);
  const r = loadFeedbackFromStorage();
  assert.equal(r.length, 2);
});

test('storage: 空 → []', () => {
  resetStorage();
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

test('storage: 损坏 JSON → []', () => {
  resetStorage();
  store.set(PROPOSAL_FEEDBACK_KEY, 'not-json{');
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

test('storage: 非数组 → []', () => {
  resetStorage();
  store.set(PROPOSAL_FEEDBACK_KEY, JSON.stringify({ not: 'array' }));
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

test('storage: 数组但元素无效 → 过滤', () => {
  resetStorage();
  const bad = [{ invalid: true }];
  store.set(PROPOSAL_FEEDBACK_KEY, JSON.stringify(bad));
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

// ---------- 集成 ---
test('集成: record → adoption → summary', () => {
  let fbs = [];
  fbs = recordFeedback(mkFb({ proposalId: 'p1', type: 'add_paper', vote: 'up' }), fbs);
  fbs = recordFeedback(mkFb({ proposalId: 'p2', type: 'add_paper', vote: 'down' }), fbs);
  fbs = recordFeedback(mkFb({ proposalId: 'p3', type: 'cite_paper', vote: 'up' }), fbs);
  const adoption = adoptionRateByType(fbs);
  assert.equal(adoption.add_paper, 0.5);
  assert.equal(adoption.cite_paper, 1.0);
  const summary = summarizeFeedback(fbs);
  assert.equal(summary.total, 3);
  assert.equal(summary.up, 2);
  assert.equal(summary.down, 1);
});

test('集成: storage save → load → adoption', () => {
  resetStorage();
  saveFeedbackToStorage([
    mkFb({ proposalId: 'p1', type: 'add_paper', vote: 'up' }),
    mkFb({ proposalId: 'p2', type: 'add_paper', vote: 'up' }),
    mkFb({ proposalId: 'p3', type: 'add_paper', vote: 'down' }),
  ]);
  const fbs = loadFeedbackFromStorage();
  const adoption = adoptionRateByType(fbs);
  assert.equal(adoption.add_paper, 2 / 3);
});
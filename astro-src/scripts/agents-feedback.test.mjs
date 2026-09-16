#!/usr/bin/env node
// astro-src/scripts/agents-feedback.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/feedback.ts pure helpers.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.window = globalThis;

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
    external: ['../user-libraries/types', '../../user-libraries/types'],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

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

const fb = (overrides) => ({
  proposalId: 'p1',
  type: 'add_paper',
  vote: 'up',
  createdAt: 1000,
  ...overrides,
});

// ---------- PROPOSAL_FEEDBACK_KEY ----------
test('PROPOSAL_FEEDBACK_KEY: 期望值', () => {
  assert.equal(PROPOSAL_FEEDBACK_KEY, 'dpr_proposal_feedback_v1');
});

// ---------- recordFeedback ----------
test('recordFeedback: 新增', () => {
  const r = recordFeedback(fb());
  assert.equal(r.length, 1);
  assert.equal(r[0].proposalId, 'p1');
});

test('recordFeedback: 同 proposalId 覆盖(去旧加新)', () => {
  const r1 = recordFeedback(fb({ vote: 'up', createdAt: 1 }));
  const r2 = recordFeedback(fb({ vote: 'down', createdAt: 2 }), r1);
  assert.equal(r2.length, 1);
  assert.equal(r2[0].vote, 'down');
});

test('recordFeedback: 不修改输入数组', () => {
  const orig = [fb({ proposalId: 'p1' })];
  const before = JSON.parse(JSON.stringify(orig));
  recordFeedback(fb({ proposalId: 'p2' }), orig);
  assert.deepEqual(orig, before);
});

test('recordFeedback: 默认 existing=[]', () => {
  const r = recordFeedback(fb());
  assert.equal(r.length, 1);
});

// ---------- getFeedbackFor ----------
test('getFeedbackFor: 找不到 → null', () => {
  assert.equal(getFeedbackFor('p1', []), null);
  assert.equal(getFeedbackFor('p1', [fb({ proposalId: 'p2' })]), null);
});

test('getFeedbackFor: 单条 → 返回', () => {
  const r = getFeedbackFor('p1', [fb()]);
  assert.equal(r.proposalId, 'p1');
});

test('getFeedbackFor: 多条 → 返回最新', () => {
  const arr = [
    fb({ createdAt: 100 }),
    fb({ createdAt: 200, vote: 'down' }),
    fb({ createdAt: 50 }),
  ];
  const r = getFeedbackFor('p1', arr);
  assert.equal(r.vote, 'down');
});

// ---------- adoptionRateByType ----------
test('adoptionRateByType: 空 → {}', () => {
  assert.deepEqual(adoptionRateByType([]), {});
});

test('adoptionRateByType: 5/10 → 0.5', () => {
  const arr = [
    ...Array.from({ length: 5 }, () => fb({ type: 'add_paper', vote: 'up' })),
    ...Array.from({ length: 5 }, () => fb({ type: 'add_paper', vote: 'down' })),
  ];
  assert.equal(adoptionRateByType(arr).add_paper, 0.5);
});

test('adoptionRateByType: 全部 up → 1.0', () => {
  const arr = Array.from({ length: 3 }, () => fb({ type: 'add_paper', vote: 'up' }));
  assert.equal(adoptionRateByType(arr).add_paper, 1);
});

test('adoptionRateByType: 全部 down → 0.0', () => {
  const arr = Array.from({ length: 3 }, () => fb({ type: 'add_paper', vote: 'down' }));
  assert.equal(adoptionRateByType(arr).add_paper, 0);
});

test('adoptionRateByType: skip 不计入分母', () => {
  // 5 up + 5 down + 5 skip → 0.5 (skip 不算)
  const arr = [
    ...Array.from({ length: 5 }, () => fb({ type: 'add_paper', vote: 'up' })),
    ...Array.from({ length: 5 }, () => fb({ type: 'add_paper', vote: 'down' })),
    ...Array.from({ length: 5 }, () => fb({ type: 'add_paper', vote: 'skip' })),
  ];
  assert.equal(adoptionRateByType(arr).add_paper, 0.5);
});

test('adoptionRateByType: 全部 skip → undefined (不返回键)', () => {
  const arr = Array.from({ length: 3 }, () => fb({ type: 'add_paper', vote: 'skip' }));
  assert.equal(adoptionRateByType(arr).add_paper, undefined);
});

test('adoptionRateByType: 多 type', () => {
  const arr = [
    fb({ type: 'add_paper', vote: 'up' }),
    fb({ type: 'add_paper', vote: 'down' }),
    fb({ type: 'create_draft', vote: 'up' }),
    fb({ type: 'create_draft', vote: 'up' }),
  ];
  const r = adoptionRateByType(arr);
  assert.equal(r.add_paper, 0.5);
  assert.equal(r.create_draft, 1);
});

// ---------- feedbackScoreByProposalId ----------
test('feedbackScoreByProposalId: up → 0.9', () => {
  const r = feedbackScoreByProposalId([fb({ vote: 'up' })]);
  assert.equal(r.p1, 0.9);
});

test('feedbackScoreByProposalId: down → 0.1', () => {
  const r = feedbackScoreByProposalId([fb({ vote: 'down' })]);
  assert.equal(r.p1, 0.1);
});

test('feedbackScoreByProposalId: skip → 0.5', () => {
  const r = feedbackScoreByProposalId([fb({ vote: 'skip' })]);
  assert.equal(r.p1, 0.5);
});

test('feedbackScoreByProposalId: 后写覆盖前写', () => {
  const r = feedbackScoreByProposalId([
    fb({ vote: 'up', createdAt: 1 }),
    fb({ vote: 'down', createdAt: 2 }),
  ]);
  // 后写覆盖:down → 0.1
  assert.equal(r.p1, 0.1);
});

test('feedbackScoreByProposalId: 空 → {}', () => {
  assert.deepEqual(feedbackScoreByProposalId([]), {});
});

// ---------- tallyVotesByProposalId ----------
test('tallyVotesByProposalId: 空 → {}', () => {
  assert.deepEqual(tallyVotesByProposalId([]), {});
});

test('tallyVotesByProposalId: 多投票累加', () => {
  const arr = [
    fb({ proposalId: 'p1', vote: 'up' }),
    fb({ proposalId: 'p1', vote: 'up' }),
    fb({ proposalId: 'p1', vote: 'down' }),
    fb({ proposalId: 'p1', vote: 'skip' }),
  ];
  assert.deepEqual(tallyVotesByProposalId(arr), { p1: { up: 2, down: 1, skip: 1 } });
});

test('tallyVotesByProposalId: 多 proposalId 独立', () => {
  const arr = [
    fb({ proposalId: 'p1', vote: 'up' }),
    fb({ proposalId: 'p2', vote: 'down' }),
  ];
  const r = tallyVotesByProposalId(arr);
  assert.deepEqual(r.p1, { up: 1, down: 0, skip: 0 });
  assert.deepEqual(r.p2, { up: 0, down: 1, skip: 0 });
});

// ---------- summarizeFeedback ----------
test('summarizeFeedback: 空', () => {
  assert.deepEqual(summarizeFeedback([]), {
    total: 0, up: 0, down: 0, skip: 0,
  });
});

test('summarizeFeedback: 计数 + approvalRate', () => {
  const arr = [
    fb({ vote: 'up' }),
    fb({ vote: 'up' }),
    fb({ vote: 'down' }),
    fb({ vote: 'skip' }),
  ];
  const r = summarizeFeedback(arr);
  assert.equal(r.total, 4);
  assert.equal(r.up, 2);
  assert.equal(r.down, 1);
  assert.equal(r.skip, 1);
  // up / (up + down) = 2/3
  assert.equal(r.approvalRate, 2 / 3);
});

test('summarizeFeedback: 全 skip → approvalRate undefined', () => {
  const r = summarizeFeedback([fb({ vote: 'skip' })]);
  assert.equal(r.approvalRate, undefined);
});

test('summarizeFeedback: 全 up → 1.0', () => {
  const r = summarizeFeedback([fb({ vote: 'up' }), fb({ vote: 'up' })]);
  assert.equal(r.approvalRate, 1);
});

// ---------- storage ----------
test('saveFeedbackToStorage + loadFeedbackFromStorage: round-trip', () => {
  store.clear();
  const arr = [fb({ proposalId: 'p1' }), fb({ proposalId: 'p2', vote: 'down' })];
  saveFeedbackToStorage(arr);
  const r = loadFeedbackFromStorage();
  assert.equal(r.length, 2);
});

test('loadFeedbackFromStorage: 无 → []', () => {
  store.clear();
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

test('loadFeedbackFromStorage: 损坏 JSON → []', () => {
  store.set(PROPOSAL_FEEDBACK_KEY, '{not json');
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

test('loadFeedbackFromStorage: 非数组 → []', () => {
  store.set(PROPOSAL_FEEDBACK_KEY, '{"foo":"bar"}');
  assert.deepEqual(loadFeedbackFromStorage(), []);
});

test('loadFeedbackFromStorage: 过滤非法记录', () => {
  store.set(PROPOSAL_FEEDBACK_KEY, JSON.stringify([
    { proposalId: 'p1', type: 'add_paper', vote: 'up', createdAt: 1 }, // 合法
    { proposalId: 123, type: 'add_paper', vote: 'up', createdAt: 1 }, // proposalId 非 string
    { proposalId: 'p2', type: 'add_paper', vote: 'invalid', createdAt: 1 }, // vote 非法
    { proposalId: 'p3', type: 'add_paper', vote: 'up', createdAt: 'abc' }, // createdAt 非 number
  ]));
  const r = loadFeedbackFromStorage();
  assert.equal(r.length, 1);
  assert.equal(r[0].proposalId, 'p1');
});
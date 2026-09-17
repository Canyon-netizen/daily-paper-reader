#!/usr/bin/env node
// astro-src/scripts/agents-gate.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/gate.ts.
// GATE_THRESHOLDS (3 个 preset) +
// decideProposal (单 critique → decision) +
// gateProposals (批量) +
// partitionByDecision +
// isCatastrophicRisk +
// applySafetyOverride。

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

const mod = await loadTs('lib/agents/gate.ts');
const {
  GATE_THRESHOLDS,
  decideProposal,
  gateProposals,
  partitionByDecision,
  isCatastrophicRisk,
  applySafetyOverride,
} = mod;

const mkCritique = (overrides = {}) => ({
  proposal_id: 'p1',
  scores: { overall: 8 },
  total: 8,
  elo: 1300,
  ...overrides,
});

const mkProposal = (overrides = {}) => ({
  id: 'p1', round: 1,
  type: 'add_paper',
  title: 'T', rationale: 'r',
  evidence: { paperIds: [], quotes: [] },
  target: {},
  estimated_effort: 'low',
  risk: '',
  created_at: 0,
  ...overrides,
});

// ---------- GATE_THRESHOLDS ---
test('thresholds: 3 个 preset', () => {
  assert.ok(GATE_THRESHOLDS.conservative);
  assert.ok(GATE_THRESHOLDS.balanced);
  assert.ok(GATE_THRESHOLDS.aggressive);
});

test('thresholds: conservative > balanced > aggressive (promoted.minScore)', () => {
  assert.ok(GATE_THRESHOLDS.conservative.promoted.minScore > GATE_THRESHOLDS.balanced.promoted.minScore);
  assert.ok(GATE_THRESHOLDS.balanced.promoted.minScore > GATE_THRESHOLDS.aggressive.promoted.minScore);
});

// ---------- decideProposal: balanced ---
test('decide: score=8 + elo=1300 → promoted (balanced)', () => {
  const r = decideProposal(mkCritique({ total: 8, elo: 1300 }), 'balanced');
  assert.equal(r.decision, 'promoted');
});

test('decide: score=8.5 + elo=1280 → promoted (边界)', () => {
  const r = decideProposal(mkCritique({ total: 8.5, elo: 1280 }), 'balanced');
  assert.equal(r.decision, 'promoted');
});

test('decide: score=8 + elo=1279 → candidate (elo 不够)', () => {
  const r = decideProposal(mkCritique({ total: 8, elo: 1279 }), 'balanced');
  assert.equal(r.decision, 'candidate');
});

test('decide: score=7 + elo=1300 → candidate (score 不够 promoted)', () => {
  const r = decideProposal(mkCritique({ total: 7, elo: 1300 }), 'balanced');
  assert.equal(r.decision, 'candidate');
});

test('decide: score=6 + elo=1232 → candidate (边界)', () => {
  const r = decideProposal(mkCritique({ total: 6, elo: 1232 }), 'balanced');
  assert.equal(r.decision, 'candidate');
});

test('decide: score=6 + elo=1231 → sketch (elo 不够 candidate)', () => {
  const r = decideProposal(mkCritique({ total: 6, elo: 1231 }), 'balanced');
  assert.equal(r.decision, 'sketch');
});

test('decide: score=4 + elo=1100 → sketch', () => {
  const r = decideProposal(mkCritique({ total: 4, elo: 1100 }), 'balanced');
  assert.equal(r.decision, 'sketch');
});

test('decide: score=3.9 + elo=1100 → rejected', () => {
  const r = decideProposal(mkCritique({ total: 3.9, elo: 1100 }), 'balanced');
  assert.equal(r.decision, 'rejected');
});

// ---------- decidePreset: conservative vs aggressive ---
test('decide: conservative 阈值更严', () => {
  // balanced 给 promoted,conservative 给 candidate
  const bal = decideProposal(mkCritique({ total: 8, elo: 1280 }), 'balanced');
  const cons = decideProposal(mkCritique({ total: 8, elo: 1280 }), 'conservative');
  assert.equal(bal.decision, 'promoted');
  assert.equal(cons.decision, 'candidate'); // 8 < 8.5 conservative minScore
});

test('decide: aggressive 阈值更松', () => {
  // aggressive: promoted minScore=7
  const r = decideProposal(mkCritique({ total: 7, elo: 1232 }), 'aggressive');
  assert.equal(r.decision, 'promoted');
});

// ---------- gateProposals: 批量 ---
test('gate: 批量决策', () => {
  const proposals = [mkProposal({ id: 'p1' }), mkProposal({ id: 'p2' }), mkProposal({ id: 'p3' })];
  const critiques = [
    mkCritique({ proposal_id: 'p1', total: 9, elo: 1300 }), // promoted
    mkCritique({ proposal_id: 'p2', total: 5, elo: 1100 }), // sketch
    mkCritique({ proposal_id: 'p3', total: 3, elo: 1100 }), // rejected
  ];
  const r = gateProposals(proposals, critiques);
  assert.equal(r.length, 3);
  assert.equal(r[0].decision, 'promoted');
  assert.equal(r[1].decision, 'sketch');
  assert.equal(r[2].decision, 'rejected');
});

test('gate: 无 critique → sketch (兜底)', () => {
  const r = gateProposals([mkProposal({ id: 'p1' })], []);
  assert.equal(r[0].decision, 'sketch');
  assert.match(r[0].reasons[0], /no critique/);
});

test('gate: 部分 proposal 缺 critique', () => {
  const r = gateProposals(
    [mkProposal({ id: 'p1' }), mkProposal({ id: 'p2' })],
    [mkCritique({ proposal_id: 'p1', total: 9, elo: 1300 })],
  );
  assert.equal(r[0].decision, 'promoted');
  assert.equal(r[1].decision, 'sketch'); // 兜底
});

test('gate: 空 → []', () => {
  assert.deepEqual(gateProposals([], []), []);
});

test('gate: proposal_id 透传', () => {
  const r = gateProposals([mkProposal({ id: 'xyz' })], []);
  assert.equal(r[0].proposal_id, 'xyz');
});

// ---------- partitionByDecision ---
test('partition: 按 decision 分桶', () => {
  const v = [
    { proposal_id: 'p1', decision: 'promoted', reasons: [] },
    { proposal_id: 'p2', decision: 'candidate', reasons: [] },
    { proposal_id: 'p3', decision: 'sketch', reasons: [] },
    { proposal_id: 'p4', decision: 'rejected', reasons: [] },
    { proposal_id: 'p5', decision: 'promoted', reasons: [] },
  ];
  const r = partitionByDecision(v);
  assert.deepEqual(r.promoted, ['p1', 'p5']);
  assert.deepEqual(r.candidate, ['p2']);
  assert.deepEqual(r.sketch, ['p3']);
  assert.deepEqual(r.rejected, ['p4']);
});

test('partition: 空 → 4 个空数组', () => {
  const r = partitionByDecision([]);
  assert.deepEqual(r.promoted, []);
  assert.deepEqual(r.candidate, []);
  assert.deepEqual(r.sketch, []);
  assert.deepEqual(r.rejected, []);
});

// ---------- isCatastrophicRisk ---
test('risk: "不可逆" → catastrophic', () => {
  assert.equal(isCatastrophicRisk(mkProposal({ risk: '操作不可逆' })), true);
});

test('risk: "catastrophic" → catastrophic', () => {
  assert.equal(isCatastrophicRisk(mkProposal({ risk: 'catastrophic loss' })), true);
});

test('risk: "数据丢失" → catastrophic', () => {
  assert.equal(isCatastrophicRisk(mkProposal({ risk: '可能导致数据丢失' })), true);
});

test('risk: "生产环境破坏" → catastrophic', () => {
  assert.equal(isCatastrophicRisk(mkProposal({ risk: '生产环境破坏风险' })), true);
});

test('risk: 普通风险 → false', () => {
  assert.equal(isCatastrophicRisk(mkProposal({ risk: 'minor bug' })), false);
});

test('risk: 空 → false', () => {
  assert.equal(isCatastrophicRisk(mkProposal({ risk: '' })), false);
});

// ---------- applySafetyOverride ---
test('safety: promoted + catastrophic → demoted candidate', () => {
  const v = { proposal_id: 'p1', decision: 'promoted', reasons: ['orig'] };
  const p = mkProposal({ risk: '不可逆' });
  const r = applySafetyOverride(v, p);
  assert.equal(r.decision, 'candidate');
  assert.ok(r.reasons.some((r) => /SAFETY/.test(r)));
});

test('safety: promoted + safe risk → unchanged', () => {
  const v = { proposal_id: 'p1', decision: 'promoted', reasons: ['orig'] };
  const p = mkProposal({ risk: 'minor' });
  const r = applySafetyOverride(v, p);
  assert.equal(r.decision, 'promoted');
});

test('safety: candidate + catastrophic → unchanged (不是 promoted)', () => {
  const v = { proposal_id: 'p1', decision: 'candidate', reasons: [] };
  const p = mkProposal({ risk: '不可逆' });
  const r = applySafetyOverride(v, p);
  assert.equal(r.decision, 'candidate');
});

test('safety: sketch + catastrophic → unchanged', () => {
  const v = { proposal_id: 'p1', decision: 'sketch', reasons: [] };
  const p = mkProposal({ risk: '不可逆' });
  const r = applySafetyOverride(v, p);
  assert.equal(r.decision, 'sketch');
});

test('safety: reasons 追加而非替换', () => {
  const v = { proposal_id: 'p1', decision: 'promoted', reasons: ['original reason'] };
  const p = mkProposal({ risk: '不可逆' });
  const r = applySafetyOverride(v, p);
  assert.equal(r.reasons[0], 'original reason');
  assert.ok(r.reasons.length >= 2);
});

// ---------- 集成 ---
test('集成: gate → partition', () => {
  const proposals = [
    mkProposal({ id: 'p1' }),
    mkProposal({ id: 'p2' }),
    mkProposal({ id: 'p3' }),
  ];
  const critiques = [
    mkCritique({ proposal_id: 'p1', total: 9, elo: 1300 }), // promoted
    mkCritique({ proposal_id: 'p2', total: 7, elo: 1240 }), // candidate
    mkCritique({ proposal_id: 'p3', total: 2, elo: 1100 }), // rejected
  ];
  const verdicts = gateProposals(proposals, critiques);
  const buckets = partitionByDecision(verdicts);
  assert.deepEqual(buckets.promoted, ['p1']);
  assert.deepEqual(buckets.candidate, ['p2']);
  assert.deepEqual(buckets.rejected, ['p3']);
});

test('集成: gate → applySafetyOverride 拦截 catastrophic', () => {
  const proposals = [mkProposal({ id: 'p1', risk: '操作不可逆,数据丢失' })];
  const critiques = [mkCritique({ proposal_id: 'p1', total: 9, elo: 1300 })];
  const verdicts = gateProposals(proposals, critiques);
  // 原始 promoted → safety demote → candidate
  const safe = verdicts.map((v) => applySafetyOverride(v, proposals.find((p) => p.id === v.proposal_id)));
  assert.equal(safe[0].decision, 'candidate');
});
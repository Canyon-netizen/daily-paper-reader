#!/usr/bin/env node
// astro-src/scripts/agents-gate.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/gate.ts (decideProposal / gateProposals /
// partitionByDecision / isCatastrophicRisk / applySafetyOverride).

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
    external: ['./types', '../types', '../../types'],
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

function mkCritique(total, elo, id = 'p1') {
  return { proposal_id: id, total, elo };
}

test('decideProposal: score >= 8 AND elo >= 1280 → promoted', () => {
  const v = decideProposal(mkCritique(9, 1300));
  assert.equal(v.decision, 'promoted');
});

test('decideProposal: score=6, elo=1240 → candidate', () => {
  const v = decideProposal(mkCritique(6, 1240));
  assert.equal(v.decision, 'candidate');
});

test('decideProposal: score=4 → sketch (无论 elo)', () => {
  const v = decideProposal(mkCritique(4, 1500));
  assert.equal(v.decision, 'sketch');
});

test('decideProposal: score < 4 → rejected', () => {
  const v = decideProposal(mkCritique(3, 1500));
  assert.equal(v.decision, 'rejected');
});

test('decideProposal: promoted 边界 (score=8, elo=1280) → promoted', () => {
  assert.equal(decideProposal(mkCritique(8, 1280)).decision, 'promoted');
});

test('decideProposal: promoted 边界下 (score=8, elo=1279) → candidate (elo 不够)', () => {
  assert.equal(decideProposal(mkCritique(8, 1279)).decision, 'candidate');
});

test('decideProposal: conservative preset 更严', () => {
  // score=8 → balanced=promoted, conservative=?
  // conservative.promoted.minScore=8.5 → score=8 < 8.5
  // conservative.candidate.minScore=7.0 → 8 >= 7, 但 elo min 1250 → 1300 ok → candidate
  const v = decideProposal(mkCritique(8, 1300), 'conservative');
  assert.equal(v.decision, 'candidate');
});

test('decideProposal: aggressive preset 更宽', () => {
  // aggressive.promoted.minScore=7, elo min 1232
  // score=7.5, elo=1240 → promoted
  const v = decideProposal(mkCritique(7.5, 1240), 'aggressive');
  assert.equal(v.decision, 'promoted');
});

test('decideProposal: reasons 数组至少 1 条', () => {
  const v = decideProposal(mkCritique(5, 1200));
  assert.ok(v.reasons.length > 0);
});

test('decideProposal: proposal_id 透传', () => {
  const v = decideProposal(mkCritique(5, 1200, 'p-xyz'));
  assert.equal(v.proposal_id, 'p-xyz');
});

test('gateProposals: 空 proposals → 空 verdicts', () => {
  assert.deepEqual(gateProposals([], []), []);
});

test('gateProposals: 匹配 critique 时决策正确', () => {
  const proposals = [{ id: 'p1' }, { id: 'p2' }];
  const critiques = [mkCritique(9, 1300, 'p1'), mkCritique(3, 1200, 'p2')];
  const v = gateProposals(proposals, critiques);
  assert.equal(v.length, 2);
  assert.equal(v[0].decision, 'promoted');
  assert.equal(v[1].decision, 'rejected');
});

test('gateProposals: 缺 critique → sketch (兜底)', () => {
  const proposals = [{ id: 'p1' }];
  const v = gateProposals(proposals, []);
  assert.equal(v[0].decision, 'sketch');
  assert.ok(v[0].reasons.some((r) => r.includes('no critique')));
});

test('partitionByDecision: 按 decision 分桶', () => {
  const verdicts = [
    { proposal_id: 'p1', decision: 'promoted', reasons: [] },
    { proposal_id: 'p2', decision: 'promoted', reasons: [] },
    { proposal_id: 'p3', decision: 'candidate', reasons: [] },
    { proposal_id: 'p4', decision: 'sketch', reasons: [] },
  ];
  const r = partitionByDecision(verdicts);
  assert.deepEqual(r.promoted, ['p1', 'p2']);
  assert.deepEqual(r.candidate, ['p3']);
  assert.deepEqual(r.sketch, ['p4']);
  assert.deepEqual(r.rejected, []);
});

test('partitionByDecision: 空 → 4 个空数组', () => {
  const r = partitionByDecision([]);
  assert.deepEqual(r, { promoted: [], candidate: [], sketch: [], rejected: [] });
});

test('isCatastrophicRisk: "不可逆" → true', () => {
  assert.equal(isCatastrophicRisk({ risk: '这个操作不可逆' }), true);
});

test('isCatastrophicRisk: "数据丢失" → true', () => {
  assert.equal(isCatastrophicRisk({ risk: '可能导致数据丢失' }), true);
});

test('isCatastrophicRisk: "生产环境破坏" → true', () => {
  assert.equal(isCatastrophicRisk({ risk: '生产环境破坏风险' }), true);
});

test('isCatastrophicRisk: "catastrophic" (英) → true', () => {
  assert.equal(isCatastrophicRisk({ risk: 'Catastrophic failure mode' }), true);
});

test('isCatastrophicRisk: 普通风险 → false', () => {
  assert.equal(isCatastrophicRisk({ risk: '可恢复的边界情况' }), false);
});

test('applySafetyOverride: promoted + catastrophic → demote to candidate', () => {
  const verdict = { proposal_id: 'p1', decision: 'promoted', reasons: ['high score'] };
  const proposal = { id: 'p1', risk: '不可逆操作' };
  const out = applySafetyOverride(verdict, proposal);
  assert.equal(out.decision, 'candidate');
  assert.ok(out.reasons.some((r) => r.includes('SAFETY')));
});

test('applySafetyOverride: promoted + safe → 保持 promoted', () => {
  const verdict = { proposal_id: 'p1', decision: 'promoted', reasons: ['high'] };
  const out = applySafetyOverride(verdict, { id: 'p1', risk: 'low' });
  assert.equal(out.decision, 'promoted');
});

test('applySafetyOverride: rejected + catastrophic → 保持 rejected', () => {
  const verdict = { proposal_id: 'p1', decision: 'rejected', reasons: [] };
  const out = applySafetyOverride(verdict, { id: 'p1', risk: '不可逆' });
  assert.equal(out.decision, 'rejected');
});

test('GATE_THRESHOLDS: 三种 preset 都在', () => {
  assert.ok(GATE_THRESHOLDS.conservative);
  assert.ok(GATE_THRESHOLDS.balanced);
  assert.ok(GATE_THRESHOLDS.aggressive);
});

test('GATE_THRESHOLDS: balanced promoted.minScore = 8', () => {
  assert.equal(GATE_THRESHOLDS.balanced.promoted.minScore, 8);
});

#!/usr/bin/env node
// astro-src/scripts/agents-types.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/types.ts pure factories + parseProposalType.

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

const mod = await loadTs('lib/agents/types.ts');
const {
  PROPOSAL_TYPE_LABELS,
  parseProposalType,
  makeEmptyProposal,
  makeEmptyCritique,
  makeRoundRecord,
} = mod;

// ---------- PROPOSAL_TYPE_LABELS ----------
test('PROPOSAL_TYPE_LABELS: 8 种 type', () => {
  assert.equal(Object.keys(PROPOSAL_TYPE_LABELS).length, 8);
});

test('PROPOSAL_TYPE_LABELS: add_paper', () => {
  assert.equal(PROPOSAL_TYPE_LABELS.add_paper.label, '加入论文');
});

test('PROPOSAL_TYPE_LABELS: 每条都有 label + icon', () => {
  for (const t of Object.keys(PROPOSAL_TYPE_LABELS)) {
    const v = PROPOSAL_TYPE_LABELS[t];
    assert.ok(typeof v.label === 'string' && v.label.length > 0);
    assert.ok(typeof v.icon === 'string' && v.icon.length > 0);
  }
});

// ---------- parseProposalType ----------
test('parseProposalType: 合法 "add_paper"', () => {
  assert.equal(parseProposalType('add_paper'), 'add_paper');
});

test('parseProposalType: 8 个合法 type', () => {
  for (const t of ['add_paper', 'create_draft', 'experiment_plan', 'literature_review', 'rebuttal', 'expand_draft', 'cite_paper', 'archive_paper']) {
    assert.equal(parseProposalType(t), t);
  }
});

test('parseProposalType: 非法 → null', () => {
  assert.equal(parseProposalType('foo'), null);
  assert.equal(parseProposalType(''), null);
});

test('parseProposalType: 非字符串 → null', () => {
  assert.equal(parseProposalType(123), null);
  assert.equal(parseProposalType(null), null);
  assert.equal(parseProposalType(undefined), null);
  assert.equal(parseProposalType({}), null);
});

// ---------- makeEmptyProposal ----------
test('makeEmptyProposal: 默认字段', () => {
  const r = makeEmptyProposal(1);
  assert.equal(r.round, 1);
  assert.equal(r.id, '');
  assert.equal(r.type, 'add_paper');
  assert.equal(r.title, '');
  assert.equal(r.rationale, '');
  assert.deepEqual(r.evidence, { paperIds: [], quotes: [] });
  assert.deepEqual(r.target, {});
  assert.equal(r.estimated_effort, 'medium');
  assert.equal(r.risk, '');
  assert.equal(typeof r.created_at, 'number');
});

test('makeEmptyProposal: round 字段', () => {
  assert.equal(makeEmptyProposal(5).round, 5);
});

// ---------- makeEmptyCritique ----------
test('makeEmptyCritique: 默认 0 分', () => {
  const r = makeEmptyCritique('p1');
  assert.equal(r.proposal_id, 'p1');
  assert.equal(r.scores.methodologist, 0);
  assert.equal(r.scores.engineer, 0);
  assert.equal(r.scores.skeptic, 0);
  assert.equal(r.scores.citation_validity, 0);
  assert.equal(r.scores.methodology, 0);
  assert.equal(r.scores.reproducibility, 0);
  assert.equal(r.scores.novelty, 0);
  assert.equal(r.scores.overall, 0);
  assert.equal(r.total, 0);
  assert.equal(r.elo, 1200);
  assert.equal(r.matches, 0);
  assert.equal(r.wins, 0);
});

test('makeEmptyCritique: persona_attribution 三 persona', () => {
  const r = makeEmptyCritique('p1');
  assert.deepEqual(Object.keys(r.persona_attribution).sort(), ['engineer', 'methodologist', 'skeptic']);
});

test('makeEmptyCritique: dimension_notes = {}', () => {
  const r = makeEmptyCritique('p1');
  assert.deepEqual(r.dimension_notes, {});
});

// ---------- makeRoundRecord ----------
test('makeRoundRecord: 必填字段', () => {
  const r = makeRoundRecord({ round: 1, project_id: 'p1' });
  assert.equal(r.schema_version, 1);
  assert.equal(r.round, 1);
  assert.equal(r.project_id, 'p1');
  assert.equal(r.finished_at, 0);
  assert.deepEqual(r.designer.proposals, []);
  assert.deepEqual(r.feedback.critiques, []);
  assert.deepEqual(r.modifier.applied, []);
});

test('makeRoundRecord: gate 4 buckets 空', () => {
  const r = makeRoundRecord({ round: 1, project_id: 'p1' });
  assert.deepEqual(r.gate, {
    verdicts: [], promoted: [], candidate: [], sketch: [], rejected: [],
  });
});

test('makeRoundRecord: session_id 默认 = project_id', () => {
  const r = makeRoundRecord({ round: 1, project_id: 'p1' });
  assert.equal(r.meta.session_id, 'p1');
});

test('makeRoundRecord: 自定义 session_id', () => {
  const r = makeRoundRecord({ round: 1, project_id: 'p1', session_id: 's1' });
  assert.equal(r.meta.session_id, 's1');
});

test('makeRoundRecord: dry_run 默认 false', () => {
  const r = makeRoundRecord({ round: 1, project_id: 'p1' });
  assert.equal(r.meta.dry_run, false);
});

test('makeRoundRecord: dry_run=true', () => {
  const r = makeRoundRecord({ round: 1, project_id: 'p1', dry_run: true });
  assert.equal(r.meta.dry_run, true);
});
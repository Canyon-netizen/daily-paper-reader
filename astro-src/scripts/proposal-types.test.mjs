#!/usr/bin/env node
// astro-src/scripts/proposal-types.test.mjs
//
// Tests for R7 F.1.1 — 8 proposal types + label map + parser.

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

const mod = await loadTs('lib/agents/types.ts');
const { PROPOSAL_TYPE_LABELS, parseProposalType } = mod;

// ----- 8 types present -----

test('PROPOSAL_TYPE_LABELS: covers all 8 proposal types', () => {
  const expected = [
    'add_paper', 'create_draft', 'experiment_plan', 'literature_review',
    'rebuttal', 'expand_draft', 'cite_paper', 'archive_paper',
  ];
  for (const t of expected) {
    assert.ok(PROPOSAL_TYPE_LABELS[t], `missing label for ${t}`);
    assert.equal(typeof PROPOSAL_TYPE_LABELS[t].label, 'string');
    assert.equal(typeof PROPOSAL_TYPE_LABELS[t].icon, 'string');
    assert.ok(PROPOSAL_TYPE_LABELS[t].label.length > 0);
    assert.ok(PROPOSAL_TYPE_LABELS[t].icon.length > 0);
  }
});

test('PROPOSAL_TYPE_LABELS: exactly 8 entries (no more, no less)', () => {
  assert.equal(Object.keys(PROPOSAL_TYPE_LABELS).length, 8);
});

test('PROPOSAL_TYPE_LABELS: original 5 types keep their old labels', () => {
  assert.equal(PROPOSAL_TYPE_LABELS.add_paper.label, '加入论文');
  assert.equal(PROPOSAL_TYPE_LABELS.create_draft.label, '创建草稿');
  assert.equal(PROPOSAL_TYPE_LABELS.experiment_plan.label, '设计实验');
  assert.equal(PROPOSAL_TYPE_LABELS.literature_review.label, '写综述');
  assert.equal(PROPOSAL_TYPE_LABELS.rebuttal.label, '反驳');
});

test('PROPOSAL_TYPE_LABELS: new 3 types have distinct labels', () => {
  const newTypes = ['expand_draft', 'cite_paper', 'archive_paper'];
  const labels = newTypes.map((t) => PROPOSAL_TYPE_LABELS[t].label);
  // 互不相同
  assert.equal(new Set(labels).size, 3);
});

// ----- parseProposalType -----

test('parseProposalType: valid type returns it', () => {
  assert.equal(parseProposalType('add_paper'), 'add_paper');
  assert.equal(parseProposalType('cite_paper'), 'cite_paper');
  assert.equal(parseProposalType('archive_paper'), 'archive_paper');
});

test('parseProposalType: invalid / non-string returns null', () => {
  assert.equal(parseProposalType('not_a_type'), null);
  assert.equal(parseProposalType(123), null);
  assert.equal(parseProposalType(null), null);
  assert.equal(parseProposalType(undefined), null);
  assert.equal(parseProposalType({}), null);
});
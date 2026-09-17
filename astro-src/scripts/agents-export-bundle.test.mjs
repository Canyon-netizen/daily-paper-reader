#!/usr/bin/env node
// astro-src/scripts/agents-export-bundle.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/export-bundle.mjs.
// buildExportBundle (meta + rounds + syntheses + digest → bundle) +
// formatExportMarkdown (bundle → markdown)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMjs(relPath) {
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

const mod = await loadMjs('lib/agents/export-bundle.mjs');
const { buildExportBundle, formatExportMarkdown } = mod;

const mkRound = (overrides = {}) => ({
  round: 1,
  started_at: 1000,
  finished_at: 2000,
  designer: {
    proposals: [
      { id: 'p1', title: 'P1', type: 'add_paper', rationale: 'r', estimated_effort: 'low', risk: 'low' },
    ],
    model: 'gpt-4',
  },
  feedback: {
    critiques: [{ proposal_id: 'p1', total: 8, elo: 1300, matches: 1, wins: 1 }],
    judge_calls: 3, total_tokens: 500,
  },
  gate: { promoted: ['p1'], candidate: [], sketch: [], rejected: [] },
  modifier: { applied: [{ kind: 'add_paper_to_stage', proposal_id: 'p1' }], skipped: [] },
  ...overrides,
});

// ---------- buildExportBundle ---
test('build: 最小 (空)', () => {
  const b = buildExportBundle({});
  assert.equal(b.sessionId, '(unknown)');
  assert.equal(b.generatedAt.length > 0, true);
  assert.deepEqual(b.rounds, []);
  assert.deepEqual(b.syntheses, []);
  assert.equal(b.digest, null);
  assert.equal(b.stats.rounds, 0);
  assert.equal(b.stats.proposals, 0);
  assert.equal(b.stats.applied, 0);
  assert.equal(b.stats.hasDigest, false);
});

test('build: meta 透传', () => {
  const b = buildExportBundle({
    meta: { session_id: 's1', goal: 'study transformers' },
  });
  assert.equal(b.sessionId, 's1');
  assert.equal(b.meta.session_id, 's1');
});

test('build: rounds stats', () => {
  const b = buildExportBundle({
    rounds: [
      mkRound(),
      mkRound({ round: 2 }),
    ],
  });
  assert.equal(b.stats.rounds, 2);
  // 每个 round 1 proposal,1 applied
  assert.equal(b.stats.proposals, 2);
  assert.equal(b.stats.applied, 2);
});

test('build: syntheses stats', () => {
  const b = buildExportBundle({
    syntheses: [{ idx: 1, raw: 'a' }, { idx: 2, raw: 'b' }],
  });
  assert.equal(b.stats.syntheses, 2);
});

test('build: digest → hasDigest=true', () => {
  const b = buildExportBundle({ digest: 'long text...' });
  assert.equal(b.stats.hasDigest, true);
});

test('build: 空 digest → hasDigest=false', () => {
  const b = buildExportBundle({ digest: '' });
  assert.equal(b.stats.hasDigest, false);
});

test('build: digest=null → hasDigest=false', () => {
  const b = buildExportBundle({ digest: null });
  assert.equal(b.stats.hasDigest, false);
});

test('build: 缺 rounds 字段 → 0', () => {
  const b = buildExportBundle({ meta: { session_id: 'X' } });
  assert.equal(b.stats.rounds, 0);
});

test('build: round 缺 designer.proposals → 不抛', () => {
  const b = buildExportBundle({ rounds: [{ round: 1 }] });
  assert.equal(b.stats.proposals, 0);
});

test('build: 生成 generatedAt 是 ISO 串', () => {
  const b = buildExportBundle({});
  assert.match(b.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('build: round 字段精简', () => {
  const b = buildExportBundle({ rounds: [mkRound()] });
  // round 应该保留 designer/feedback/gate/modifier
  assert.ok(b.rounds[0].designer);
  assert.ok(b.rounds[0].feedback);
});

// ---------- formatExportMarkdown ---
test('format: null → "Export bundle ... empty"', () => {
  const r = formatExportMarkdown(null);
  assert.match(r, /Export bundle/);
  assert.match(r, /empty/);
});

test('format: 含 stats section', () => {
  const b = buildExportBundle({
    meta: { session_id: 's1' },
    rounds: [mkRound()],
  });
  const r = formatExportMarkdown(b);
  assert.match(r, /Stats/);
  assert.match(r, /rounds.*1/);
  assert.match(r, /proposals.*1/);
});

test('format: 含 meta', () => {
  const b = buildExportBundle({
    meta: { session_id: 's1', goal: 'study x', preset: 'balanced' },
  });
  const r = formatExportMarkdown(b);
  assert.match(r, /session_id.*s1/);
  assert.match(r, /goal.*study x/);
  assert.match(r, /preset.*balanced/);
});

test('format: 含 rounds', () => {
  const b = buildExportBundle({ rounds: [mkRound()] });
  const r = formatExportMarkdown(b);
  assert.match(r, /Rounds.*1/);
  assert.match(r, /Round 1/);
});

test('format: 含 proposals 列表', () => {
  const b = buildExportBundle({ rounds: [mkRound()] });
  const r = formatExportMarkdown(b);
  assert.match(r, /Proposals/);
  assert.match(r, /P1.*add_paper/);
});

test('format: 含 critiques', () => {
  const b = buildExportBundle({ rounds: [mkRound()] });
  const r = formatExportMarkdown(b);
  assert.match(r, /Critiques/);
  assert.match(r, /p1.*total=8/);
});

test('format: 含 promoted', () => {
  const b = buildExportBundle({ rounds: [mkRound()] });
  const r = formatExportMarkdown(b);
  assert.match(r, /promoted.*p1/);
});

test('format: 含 modifier applied', () => {
  const b = buildExportBundle({ rounds: [mkRound()] });
  const r = formatExportMarkdown(b);
  assert.match(r, /Modifier applied/);
  assert.match(r, /add_paper_to_stage/);
});

test('format: 含 syntheses', () => {
  const b = buildExportBundle({
    syntheses: [{ idx: 1, raw: 'synthesis content' }],
  });
  const r = formatExportMarkdown(b);
  assert.match(r, /Syntheses.*1/);
  assert.match(r, /synthesis content/);
});

test('format: 含 digest', () => {
  const b = buildExportBundle({ digest: 'summary text here' });
  const r = formatExportMarkdown(b);
  assert.match(r, /Digest/);
  assert.match(r, /summary text here/);
});

test('format: footer', () => {
  const r = formatExportMarkdown(buildExportBundle({}));
  assert.match(r, /Exported by DPR/);
});

test('format: goal 缺 → "(none)"', () => {
  const b = buildExportBundle({ meta: { session_id: 'x' } });
  const r = formatExportMarkdown(b);
  assert.match(r, /\(none\)/);
});

test('format: 缺 created_at → 不渲染该行', () => {
  const b = buildExportBundle({ meta: { session_id: 'x' } });
  const r = formatExportMarkdown(b);
  assert.ok(!r.includes('created_at'));
});

// ---------- 集成 ---
test('集成: end-to-end', () => {
  const b = buildExportBundle({
    meta: { session_id: 's1', goal: 'integration', preset: 'balanced' },
    rounds: [mkRound()],
    syntheses: [{ idx: 1, raw: 'syn' }],
    digest: 'digest text',
  });
  const r = formatExportMarkdown(b);
  assert.match(r, /integration/);
  assert.match(r, /balanced/);
  assert.match(r, /digest text/);
  assert.match(r, /syn/);
});

test('集成: 空 bundle → "empty" 兜底', () => {
  const b = buildExportBundle({});
  const r = formatExportMarkdown(b);
  // 没有 meta,rounds,syntheses,digest
  assert.ok(!r.includes('🎯 Meta'));
  assert.ok(!r.includes('🔄 Rounds'));
  assert.ok(!r.includes('📝 Syntheses'));
});
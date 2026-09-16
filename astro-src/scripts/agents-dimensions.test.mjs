#!/usr/bin/env node
// astro-src/scripts/agents-dimensions.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/dimensions.ts (4 dimension scorers).

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

const mod = await loadTs('lib/agents/dimensions.ts');
const {
  scoreCitationValidity,
  scoreMethodology,
  scoreReproducibility,
  scoreNovelty,
  buildCritiqueScores,
  scoreAllDimensions,
  DIMENSION_NAMES,
} = mod;

// ---------- scoreCitationValidity ----------
test('scoreCitationValidity: 空 paperIds → score 0', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: [] } });
  // total = 1 (fallback), passing = 0 → 0
  assert.equal(r.score, 0);
  assert.deepEqual(r.valid, []);
  assert.deepEqual(r.invalid, []);
});

test('scoreCitationValidity: 合法 ID', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['2310.12345', '2401.0001'] } });
  // 2 valid, 0 invalid → score = 10
  assert.equal(r.score, 10);
  assert.equal(r.valid.length, 2);
});

test('scoreCitationValidity: 非法格式 → invalid', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['bad-id', '2310.12345'] } });
  assert.equal(r.score, 5); // 1/2 * 10
  assert.equal(r.invalid[0], 'bad-id');
  assert.equal(r.valid.length, 1);
});

test('scoreCitationValidity: knownPaperIds 缺失 → missing', () => {
  const r = scoreCitationValidity(
    { evidence: { paperIds: ['2310.12345'] } },
    new Set(['2310.99999']),
  );
  assert.deepEqual(r.missing, ['2310.12345']);
  assert.deepEqual(r.valid, []);
});

test('scoreCitationValidity: knownPaperIds 空 → 全 valid', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['2310.12345'] } }, new Set());
  assert.equal(r.valid.length, 1);
});

test('scoreCitationValidity: vN 版本号 → 视为合法,canonical 去 v', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['2310.12345v2'] } });
  assert.equal(r.invalid.length, 0);
});

test('scoreCitationValidity: 重复 → duplicates', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['2310.12345', '2310.12345'] } });
  assert.equal(r.duplicates.length, 1);
  // 第二次被推入 duplicates,不在 valid
  assert.equal(r.valid.length, 1);
});

test('scoreCitationValidity: 重复 + 已知 → 第二次归 duplicates', () => {
  const r = scoreCitationValidity(
    { evidence: { paperIds: ['2310.12345', '2310.12345'] } },
    new Set(['2310.12345']),
  );
  // 第一次进 valid,第二次 canonical 已 seen → duplicates
  assert.equal(r.valid.length, 1);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.missing.length, 0);
});

// ---------- scoreMethodology ----------
test('scoreMethodology: 全 5 类关键词命中 → score 10', () => {
  const r = scoreMethodology({
    rationale: '可证伪 hypothesis with baseline, ablation, metric accuracy, sample size split, seed. p-value.',
    risk: '',
  });
  assert.equal(r.score, 10);
  assert.equal(r.issues.length, 0);
});

test('scoreMethodology: 全无关键词 → score 0', () => {
  const r = scoreMethodology({ rationale: '...', risk: '' });
  assert.equal(r.score, 0);
  // 5 issues, 5 suggestions
  assert.equal(r.issues.length, 5);
  assert.equal(r.suggestions.length, 5);
});

test('scoreMethodology: 中文 假设 + 评估', () => {
  const r = scoreMethodology({
    rationale: '我们提出假设:模型在 X 上更好。评估方法采用 accuracy。',
    risk: '',
  });
  // 命中 hypothesis + metric = 2/5 = 4
  assert.equal(r.score, 4);
});

test('scoreMethodology: 大小写不敏感 (lowercase)', () => {
  const r = scoreMethodology({
    rationale: 'HYPOTHESIS baseline METRIC sample seed p-value.',
    risk: '',
  });
  assert.equal(r.score, 10);
});

test('scoreMethodology: issues/suggestions 配对', () => {
  const r = scoreMethodology({ rationale: '', risk: '' });
  assert.equal(r.issues.length, r.suggestions.length);
});

// ---------- scoreReproducibility ----------
test('scoreReproducibility: 全命中 → score 10', () => {
  const r = scoreReproducibility({
    rationale: 'github.com/x. dataset public. GPU 8. seed = 42. recipe readme.',
    evidence: {},
    target: {},
  });
  assert.equal(r.score, 10);
});

test('scoreReproducibility: 全无 → score 0', () => {
  const r = scoreReproducibility({ rationale: '', evidence: {}, target: {} });
  assert.equal(r.score, 0);
});

test('scoreReproducibility: code_available', () => {
  const r = scoreReproducibility({
    rationale: 'github.com/foo', evidence: {}, target: {},
  });
  assert.equal(r.flags.code_available, true);
});

test('scoreReproducibility: seeds_disclosed', () => {
  const r = scoreReproducibility({
    rationale: 'random seed 42', evidence: {}, target: {},
  });
  assert.equal(r.flags.seeds_disclosed, true);
});

test('scoreReproducibility: 大小写不敏感', () => {
  const r = scoreReproducibility({
    rationale: 'GITHUB.COM', evidence: {}, target: {},
  });
  assert.equal(r.flags.code_available, true);
});

// ---------- scoreNovelty ----------
test('scoreNovelty: 0 引用 + 短 rationale → 极低', () => {
  const r = scoreNovelty({ rationale: 'short', evidence: { paperIds: [] } });
  // base 10 - 4 (no ref) - 3 (rationale<50) = 3
  assert.equal(r.score, 3);
  assert.equal(r.risks.length, 2);
});

test('scoreNovelty: 中等引用 + 长 rationale → 10', () => {
  const r = scoreNovelty({
    rationale: 'x'.repeat(200),
    evidence: { paperIds: ['2310.12345', '2310.12346'] },
  });
  assert.equal(r.score, 10);
});

test('scoreNovelty: 引用 > 15 → -2', () => {
  const r = scoreNovelty({
    rationale: 'x'.repeat(200),
    evidence: { paperIds: Array.from({ length: 20 }, (_, i) => '2310.1234' + i) },
  });
  assert.equal(r.score, 8);
});

test('scoreNovelty: 引用 > 8 → -1', () => {
  const r = scoreNovelty({
    rationale: 'x'.repeat(200),
    evidence: { paperIds: Array.from({ length: 10 }, (_, i) => '2310.1234' + i) },
  });
  assert.equal(r.score, 9);
});

test('scoreNovelty: rationale < 50 → -3', () => {
  const r = scoreNovelty({
    rationale: 'short',
    evidence: { paperIds: ['2310.12345'] },
  });
  assert.equal(r.score, 10 - 3);
});

test('scoreNovelty: rationale < 150 → -1', () => {
  const r = scoreNovelty({
    rationale: 'x'.repeat(100),
    evidence: { paperIds: ['2310.12345'] },
  });
  assert.equal(r.score, 10 - 1);
});

test('scoreNovelty: 0 引用时 differentiation 是"literature review"', () => {
  const r = scoreNovelty({ rationale: 'x'.repeat(200), evidence: { paperIds: [] } });
  assert.match(r.differentiation, /literature review/);
});

test('scoreNovelty: 非 0 引用 differentiation', () => {
  const r = scoreNovelty({
    rationale: 'x'.repeat(200),
    evidence: { paperIds: ['2310.12345', '2310.12346'] },
  });
  assert.match(r.differentiation, /2 篇前人工作/);
});

test('scoreNovelty: score clamp [0, 10]', () => {
  // 0 引用 + 短 rationale → 3 (>= 0)
  const r1 = scoreNovelty({ rationale: '', evidence: { paperIds: [] } });
  assert.ok(r1.score >= 0);
});

// ---------- buildCritiqueScores ----------
test('buildCritiqueScores: overall 等权平均', () => {
  const r = buildCritiqueScores(
    { methodologist: 8, engineer: 7, skeptic: 6 },
    { citation_validity: 10, methodology: 8, reproducibility: 6, novelty: 4 },
  );
  // (10+8+6+4)/4 = 7
  assert.equal(r.overall, 7);
});

test('buildCritiqueScores: 完整字段', () => {
  const r = buildCritiqueScores(
    { methodologist: 8, engineer: 7, skeptic: 6 },
    { citation_validity: 10, methodology: 8, reproducibility: 6, novelty: 4 },
  );
  assert.equal(r.methodologist, 8);
  assert.equal(r.engineer, 7);
  assert.equal(r.skeptic, 6);
  assert.equal(r.citation_validity, 10);
  assert.equal(r.methodology, 8);
  assert.equal(r.reproducibility, 6);
  assert.equal(r.novelty, 4);
});

// ---------- scoreAllDimensions ----------
test('scoreAllDimensions: 4 个维度都返回', () => {
  const r = scoreAllDimensions({
    rationale: 'hypothesis baseline', risk: '',
    evidence: { paperIds: ['2310.12345'] }, target: {},
  });
  assert.ok(r.citation);
  assert.ok(r.methodology);
  assert.ok(r.reproducibility);
  assert.ok(r.novelty);
});

test('scoreAllDimensions: knownPaperIds 透传到 citation', () => {
  const r = scoreAllDimensions({
    rationale: '', risk: '',
    evidence: { paperIds: ['2310.12345'] }, target: {},
  }, new Set(['2310.99999']));
  // knownPaperIds 不包含 → missing
  assert.equal(r.citation.missing.length, 1);
});

// ---------- DIMENSION_NAMES ----------
test('DIMENSION_NAMES: 4 个常量名', () => {
  assert.deepEqual([...DIMENSION_NAMES], ['citation_validity', 'methodology', 'reproducibility', 'novelty']);
});
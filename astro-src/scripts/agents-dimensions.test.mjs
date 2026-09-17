#!/usr/bin/env node
// astro-src/scripts/agents-dimensions.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/dimensions.ts.
// CITATION_VALIDATION_PROMPT / METHODOLOGY_CHECK_PROMPT /
// REPRODUCIBILITY_PROMPT / NOVELTY_CHECK_PROMPT / DIMENSION_NAMES +
// scoreCitationValidity / scoreMethodology / scoreReproducibility /
// scoreNovelty + buildCritiqueScores + scoreAllDimensions。

import { test } from 'node:test';
import assertLib from 'node:assert/strict';
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

const mod = await loadTs('lib/agents/dimensions.ts');
const {
  CITATION_VALIDATION_PROMPT,
  METHODOLOGY_CHECK_PROMPT,
  REPRODUCIBILITY_PROMPT,
  NOVELTY_CHECK_PROMPT,
  DIMENSION_NAMES,
  scoreCitationValidity,
  scoreMethodology,
  scoreReproducibility,
  scoreNovelty,
  buildCritiqueScores,
  scoreAllDimensions,
} = mod;

const mkProposal = (overrides = {}) => ({
  rationale: '',
  risk: '',
  evidence: { paperIds: [], quotes: [] },
  target: {},
  ...overrides,
});

// ---------- prompts ---
test('prompts: 4 个 prompt 都非空', () => {
  for (const p of [CITATION_VALIDATION_PROMPT, METHODOLOGY_CHECK_PROMPT, REPRODUCIBILITY_PROMPT, NOVELTY_CHECK_PROMPT]) {
    assertLib.ok(typeof p === 'string');
    assertLib.ok(p.length > 50);
  }
});

test('DIMENSION_NAMES: 4 个', () => {
  assertLib.deepEqual(DIMENSION_NAMES, ['citation_validity', 'methodology', 'reproducibility', 'novelty']);
});

// ---------- scoreCitationValidity ---
test('citation: 合法 id → valid', () => {
  const r = scoreCitationValidity(mkProposal({ evidence: { paperIds: ['2310.12345'] } }));
  assertLib.equal(r.valid.length, 1);
  assertLib.equal(r.invalid.length, 0);
});

test('citation: 非法 id → invalid', () => {
  const r = scoreCitationValidity(mkProposal({ evidence: { paperIds: ['bad-id', 'also bad'] } }));
  assertLib.equal(r.invalid.length, 2);
  assertLib.equal(r.valid.length, 0);
});

test('citation: 已知库 → missing 检查', () => {
  const known = new Set(['2310.12345']);
  const r = scoreCitationValidity(
    mkProposal({ evidence: { paperIds: ['2310.12345', '2401.00001'] } }),
    known,
  );
  assertLib.equal(r.valid.length, 1);
  assertLib.deepEqual(r.missing, ['2401.00001']);
});

test('citation: 空库 → 无 missing', () => {
  const r = scoreCitationValidity(mkProposal({ evidence: { paperIds: ['2310.12345'] } }));
  assertLib.deepEqual(r.missing, []);
});

test('citation: 重复 → duplicates', () => {
  const r = scoreCitationValidity(mkProposal({ evidence: { paperIds: ['2310.12345', '2310.12345'] } }));
  assertLib.equal(r.duplicates.length, 1);
});

test('citation: 重复 + 库 → 第一次算 valid', () => {
  const known = new Set(['2310.12345']);
  const r = scoreCitationValidity(mkProposal({ evidence: { paperIds: ['2310.12345', '2310.12345'] } }), known);
  // 第一次 valid,第二次 duplicates
  assertLib.equal(r.valid.length, 1);
  assertLib.equal(r.duplicates.length, 1);
});

test('citation: 混合', () => {
  const r = scoreCitationValidity(mkProposal({
    evidence: { paperIds: ['2310.12345', 'bad', '2310.12345'] },
  }));
  assertLib.equal(r.valid.length, 1);
  assertLib.equal(r.invalid.length, 1);
  assertLib.equal(r.duplicates.length, 1);
});

test('citation: 空 paperIds → score=0', () => {
  const r = scoreCitationValidity(mkProposal());
  assertLib.equal(r.score, 0);
});

test('citation: score = passing/total * 10', () => {
  // 3 个合法 + 1 invalid → 3/4 * 10 = 7.5
  const r = scoreCitationValidity(mkProposal({
    evidence: { paperIds: ['2310.12345', '2310.12346', '2310.12347', 'bad'] },
  }));
  assertLib.equal(r.score, 7.5);
});

// ---------- scoreMethodology ---
test('methodology: 全关键词 → score=10', () => {
  const r = scoreMethodology({
    rationale: '假设是 ... baseline ... metric accuracy ... 样本 N=100 ... p<0.05 显著性',
    risk: '',
  });
  assertLib.equal(r.score, 10);
});

test('methodology: 空 → score=0', () => {
  const r = scoreMethodology({ rationale: '', risk: '' });
  assertLib.equal(r.score, 0);
  assertLib.ok(r.issues.length > 0);
});

test('methodology: 部分关键词 → 比例分', () => {
  // 仅 baseline + metric (2/5 = 0.4 → 4.0)
  const r = scoreMethodology({
    rationale: '使用 baseline 对照,metric 用 accuracy',
    risk: '',
  });
  assertLib.equal(r.score, 4.0);
});

test('methodology: issues 反映缺哪个维度', () => {
  const r = scoreMethodology({ rationale: '', risk: '' });
  assertLib.ok(r.issues.some((i) => /假设/.test(i)));
  assertLib.ok(r.issues.some((i) => /baseline/.test(i)));
  assertLib.ok(r.issues.some((i) => /指标/.test(i)));
});

test('methodology: suggestions 与 issues 对应', () => {
  const r = scoreMethodology({ rationale: '', risk: '' });
  assertLib.equal(r.issues.length, r.suggestions.length);
});

// ---------- scoreReproducibility ---
test('reproducibility: 全 flag → score=10', () => {
  const r = scoreReproducibility({
    rationale: 'github.com/repo + 公开数据集 + GPU 8 + seed=42 + recipe 完整',
    evidence: {}, target: {},
  });
  assertLib.equal(r.score, 10);
});

test('reproducibility: 空 → score=0', () => {
  const r = scoreReproducibility({ rationale: '', evidence: {}, target: {} });
  assertLib.equal(r.score, 0);
});

test('reproducibility: flags 是 5 个 bool', () => {
  const r = scoreReproducibility({ rationale: 'github.com', evidence: {}, target: {} });
  assertLib.equal(typeof r.flags.code_available, 'boolean');
  assertLib.equal(typeof r.flags.data_available, 'boolean');
  assertLib.equal(typeof r.flags.resources_documented, 'boolean');
  assertLib.equal(typeof r.flags.seeds_disclosed, 'boolean');
  assertLib.equal(typeof r.flags.self_contained, 'boolean');
});

test('reproducibility: 比例分', () => {
  // 仅 code_available=true,1/5*10=2
  const r = scoreReproducibility({ rationale: 'github.com/x', evidence: {}, target: {} });
  assertLib.equal(r.score, 2);
});

test('reproducibility: 2 flags → 4 分', () => {
  // github + 公开数据集 → 2 flags = 4 分
  const r = scoreReproducibility({
    rationale: 'github.com/x 使用公开数据集',
    evidence: {}, target: {},
  });
  assertLib.equal(r.score, 4);
});

// ---------- scoreNovelty ---
test('novelty: refCount=0 → score -4', () => {
  const r = scoreNovelty({ rationale: 'a'.repeat(100), evidence: { paperIds: [] } });
  // base 10 - 4 (refCount=0) - 1 (rationale 50..150) = 5
  // 实际:refCount=0 → -4;rationale=100 → -1 → 5
  assertLib.equal(r.score, 5);
});

test('novelty: refCount=0 + 长 rationale → score=6', () => {
  const r = scoreNovelty({ rationale: 'a'.repeat(200), evidence: { paperIds: [] } });
  // base 10 - 4 = 6
  assertLib.equal(r.score, 6);
});

test('novelty: refCount=5 + 长 rationale → score=10', () => {
  const r = scoreNovelty({
    rationale: 'a'.repeat(200),
    evidence: { paperIds: ['1', '2', '3', '4', '5'] },
  });
  // base 10,无 penalty → 10
  assertLib.equal(r.score, 10);
});

test('novelty: refCount>8 → -1', () => {
  const r = scoreNovelty({
    rationale: 'a'.repeat(200),
    evidence: { paperIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] },
  });
  // base 10 - 1 = 9
  assertLib.equal(r.score, 9);
});

test('novelty: refCount>15 → -2', () => {
  const r = scoreNovelty({
    rationale: 'a'.repeat(200),
    evidence: { paperIds: Array.from({ length: 16 }, (_, i) => `${i}`) },
  });
  // base 10 - 2 = 8
  assertLib.equal(r.score, 8);
});

test('novelty: rationale < 50 → -3', () => {
  const r = scoreNovelty({
    rationale: 'short',
    evidence: { paperIds: ['1'] },
  });
  // 10 - 3 = 7
  assertLib.equal(r.score, 7);
});

test('novelty: rationale 50..150 → -1', () => {
  const r = scoreNovelty({
    rationale: 'a'.repeat(100),
    evidence: { paperIds: ['1'] },
  });
  // 10 - 1 = 9
  assertLib.equal(r.score, 9);
});

test('novelty: 钳制 >= 0', () => {
  // refCount=0 + rationale<50 → 10-4-3 = 3
  const r = scoreNovelty({
    rationale: 'short',
    evidence: { paperIds: [] },
  });
  assertLib.equal(r.score, 3);
});

test('novelty: risks 反映问题', () => {
  const r = scoreNovelty({
    rationale: 'short',
    evidence: { paperIds: [] },
  });
  assertLib.ok(r.risks.length >= 1);
});

test('novelty: differentiation 文案', () => {
  const r = scoreNovelty({
    rationale: 'a'.repeat(100),
    evidence: { paperIds: ['1', '2', '3'] },
  });
  assertLib.match(r.differentiation, /3 篇前人/);
});

// ---------- buildCritiqueScores ---
test('buildScores: 等权 overall', () => {
  const r = buildCritiqueScores(
    { methodologist: 7, engineer: 8, skeptic: 6 },
    { citation_validity: 8, methodology: 6, reproducibility: 10, novelty: 4 },
  );
  // dims avg = (8+6+10+4)/4 = 7
  assertLib.equal(r.overall, 7);
  assertLib.equal(r.methodologist, 7);
  assertLib.equal(r.citation_validity, 8);
});

test('buildScores: overall 等于 dims 平均', () => {
  const r = buildCritiqueScores(
    { methodologist: 0, engineer: 0, skeptic: 0 },
    { citation_validity: 10, methodology: 10, reproducibility: 10, novelty: 10 },
  );
  assertLib.equal(r.overall, 10);
});

// ---------- scoreAllDimensions ---
test('scoreAll: 4 维度都返回', () => {
  const r = scoreAllDimensions(mkProposal());
  assertLib.ok(r.citation);
  assertLib.ok(r.methodology);
  assertLib.ok(r.reproducibility);
  assertLib.ok(r.novelty);
});

test('scoreAll: 含已知库 → citation 用', () => {
  const known = new Set(['2310.12345']);
  const r = scoreAllDimensions(
    mkProposal({ evidence: { paperIds: ['2310.12345'] } }),
    known,
  );
  assertLib.equal(r.citation.valid.length, 1);
});

// ---------- 集成 ---
test('集成: 4 dim 分数 → buildCritiqueScores', () => {
  const r = scoreAllDimensions(mkProposal({
    rationale: '假设 ... baseline ... metric ... 样本 ... 显著性',
    evidence: { paperIds: ['2310.12345'] },
  }));
  const scores = buildCritiqueScores(
    { methodologist: 7, engineer: 7, skeptic: 7 },
    {
      citation_validity: r.citation.score,
      methodology: r.methodology.score,
      reproducibility: r.reproducibility.score,
      novelty: r.novelty.score,
    },
  );
  assertLib.equal(scores.overall, (r.citation.score + r.methodology.score + r.reproducibility.score + r.novelty.score) / 4);
});
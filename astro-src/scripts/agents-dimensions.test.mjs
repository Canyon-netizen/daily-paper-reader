#!/usr/bin/env node
// astro-src/scripts/agents-dimensions.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/dimensions.ts.

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

const mod = await loadTs('lib/agents/dimensions.ts');
const {
  scoreCitationValidity,
  scoreMethodology,
  scoreReproducibility,
  scoreNovelty,
  buildCritiqueScores,
  scoreAllDimensions,
  DIMENSION_NAMES,
  CITATION_VALIDATION_PROMPT,
  METHODOLOGY_CHECK_PROMPT,
  REPRODUCIBILITY_PROMPT,
  NOVELTY_CHECK_PROMPT,
} = mod;

const baseProposal = {
  rationale: 'A sufficiently long rationale that explains the experimental design and the novelty of the approach in sufficient detail.',
  risk: 'Risk: moderate complexity in implementation; possible issues with hyperparameter tuning.',
  evidence: { paperIds: ['2401.00001', '2401.00002', '2401.00003'], quotes: [] },
  target: { arxivIds: ['2401.00001'], stageId: 's1' },
};

test('DIMENSION_NAMES: 4 个 dimension', () => {
  assert.equal(DIMENSION_NAMES.length, 4);
  assert.ok(DIMENSION_NAMES.includes('citation_validity'));
  assert.ok(DIMENSION_NAMES.includes('methodology'));
  assert.ok(DIMENSION_NAMES.includes('reproducibility'));
  assert.ok(DIMENSION_NAMES.includes('novelty'));
});

test('PROMPT 常量: 4 个 prompt 都是非空字符串', () => {
  for (const p of [CITATION_VALIDATION_PROMPT, METHODOLOGY_CHECK_PROMPT, REPRODUCIBILITY_PROMPT, NOVELTY_CHECK_PROMPT]) {
    assert.ok(typeof p === 'string');
    assert.ok(p.length > 20);
  }
});

test('scoreCitationValidity: 已知 arxiv IDs → 全部 valid', () => {
  const known = new Set(['2401.00001', '2401.00002', '2401.00003']);
  const r = scoreCitationValidity({ evidence: { paperIds: ['2401.00001', '2401.00002'] } }, known);
  assert.equal(r.score, 10); // 2 valid / 2 total * 10
  assert.deepEqual(r.valid, ['2401.00001', '2401.00002']);
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(r.missing, []);
});

test('scoreCitationValidity: 未知 arxiv IDs → missing', () => {
  const known = new Set(['2401.00001']);
  const r = scoreCitationValidity({ evidence: { paperIds: ['2401.00001', '9999.99999'] } }, known);
  // 9999.99999 不在 known → missing,formatRe 通过
  assert.equal(r.valid.length, 1);
  assert.equal(r.missing.length, 1);
  assert.equal(r.invalid.length, 0);
});

test('scoreCitationValidity: 空 paperIds → score=1', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: [] } });
  // 没有引用 → total=0||1=1, passing=0, score=0
  assert.equal(r.score, 0);
  assert.deepEqual(r.valid, []);
});

test('scoreCitationValidity: 缺 evidence → score=0(兜底)', () => {
  const r = scoreCitationValidity({ evidence: undefined });
  assert.equal(r.score, 0);
});

test('scoreCitationValidity: 格式不合法 → invalid', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['xxx', '2401.00001'] } });
  assert.equal(r.invalid.length, 1);
  assert.equal(r.invalid[0], 'xxx');
  assert.equal(r.valid.length, 1);
});

test('scoreCitationValidity: duplicates 检测', () => {
  // 2 个 paperIds 重复 → valid=[first], duplicates=[second], passing=2, total=2, score=10
  const r = scoreCitationValidity({ evidence: { paperIds: ['2401.00001', '2401.00001'] } });
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.valid.length, 1);
  assert.equal(r.score, 10);
});

test('scoreMethodology: 5 关键词齐全 → 满分 10', () => {
  const r = scoreMethodology({
    rationale: '假设 hypothesis falsifiable 用 baseline 消融 ablation 对照,metric accuracy 评估,样本 sample size N=100 split seed,统计 p-value <0.05 显著性 std',
    risk: 'low risk',
  });
  assert.equal(r.score, 10);
});

test('scoreMethodology: 短 rationale 无关键词 → 低分', () => {
  const r = scoreMethodology({ rationale: 'short', risk: '' });
  // 0 hits / 5 checks → 0
  assert.equal(r.score, 0);
});

test('scoreMethodology: 含 baseline + ablation → 1 个 check 命中', () => {
  // '/baseline|消融|ablation|对照/' 是单 check,baseline + ablation 都属同一 check → 1 hit
  const r = scoreMethodology({
    rationale: 'baseline comparison with proper ablation study',
  });
  assert.equal(r.score, 2); // 1/5 * 10
});

test('scoreReproducibility: 5 个 flag 检测', () => {
  const r = scoreReproducibility({
    rationale: 'github.com/x code available dataset public gpu 8 seed=42 recipe',
  });
  assert.ok(typeof r.flags.code_available === 'boolean');
  assert.ok(typeof r.flags.data_available === 'boolean');
  assert.equal(typeof r.flags.resources_documented, 'boolean');
  assert.equal(typeof r.flags.seeds_disclosed, 'boolean');
  assert.equal(typeof r.flags.self_contained, 'boolean');
});

test('scoreReproducibility: 命中关键词 → flag=true', () => {
  const r = scoreReproducibility({
    rationale: 'github.com/mycode dataset 公开 gpu 8 seed=42',
  });
  assert.equal(r.flags.code_available, true);
});

test('scoreReproducibility: score = hits/5 * 10', () => {
  const r = scoreReproducibility({ rationale: 'no keywords here' });
  assert.ok(r.score >= 0 && r.score <= 10);
});

test('scoreNovelty: 高 refCount 减分', () => {
  const r = scoreNovelty({
    evidence: { paperIds: Array.from({ length: 20 }, (_, i) => 'p' + i) },
    rationale: 'a'.repeat(200),
  });
  // refCount=20 > 15 → -2
  assert.equal(r.score, 8);
});

test('scoreNovelty: 0 refCount 减分', () => {
  const r = scoreNovelty({ evidence: { paperIds: [] }, rationale: 'a'.repeat(200) });
  // refCount=0 → -4
  assert.equal(r.score, 6);
});

test('scoreNovelty: 短 rationale 减分', () => {
  const r = scoreNovelty({ evidence: { paperIds: ['p1'] }, rationale: 'short' });
  // 短 rationale < 50 → -3, refCount=1(无变化)
  assert.equal(r.score, 7);
});

test('scoreNovelty: 0 refCount + 短 rationale', () => {
  const r = scoreNovelty({ evidence: { paperIds: [] }, rationale: 'short' });
  // -4 (0 ref) -3 (短 rationale) = 3
  assert.equal(r.score, 3);
});

test('scoreNovelty: differentiation 含 "缺少" 当 0 refCount', () => {
  const r = scoreNovelty({ evidence: { paperIds: [] }, rationale: 'x' });
  assert.ok(r.differentiation.includes('缺少'));
});

test('scoreNovelty: risks 列出 refCount=0 / rationale<50 的风险', () => {
  const r = scoreNovelty({ evidence: { paperIds: [] }, rationale: 'short' });
  assert.ok(r.risks.length >= 2);
});

test('scoreNovelty: score 夹紧到 [0,10]', () => {
  // 用极端输入
  const r = scoreNovelty({ evidence: { paperIds: [] }, rationale: '' });
  assert.ok(r.score >= 0 && r.score <= 10);
});

test('buildCritiqueScores: overall = 4 dim 平均', () => {
  const r = buildCritiqueScores(
    { methodologist: 8, engineer: 7, skeptic: 9 },
    { citation_validity: 6, methodology: 8, reproducibility: 10, novelty: 8 }
  );
  // (6+8+10+8)/4 = 8
  assert.equal(r.overall, 8);
});

test('buildCritiqueScores: 保留 7 个字段', () => {
  const r = buildCritiqueScores(
    { methodologist: 5, engineer: 5, skeptic: 5 },
    { citation_validity: 5, methodology: 5, reproducibility: 5, novelty: 5 }
  );
  assert.equal(typeof r.methodologist, 'number');
  assert.equal(typeof r.engineer, 'number');
  assert.equal(typeof r.skeptic, 'number');
  assert.equal(typeof r.citation_validity, 'number');
  assert.equal(typeof r.methodology, 'number');
  assert.equal(typeof r.reproducibility, 'number');
  assert.equal(typeof r.novelty, 'number');
  assert.equal(r.overall, 5);
});

test('scoreAllDimensions: 4 个维度一起跑', () => {
  const r = scoreAllDimensions(baseProposal, new Set(['p1', 'p2', 'p3']));
  assert.ok(r.citation);
  assert.ok(r.methodology);
  assert.ok(r.reproducibility);
  assert.ok(r.novelty);
  assert.equal(typeof r.citation.score, 'number');
  assert.equal(typeof r.methodology.score, 'number');
  assert.equal(typeof r.reproducibility.score, 'number');
  assert.equal(typeof r.novelty.score, 'number');
});

test('scoreAllDimensions: 不传 knownPaperIds 兜底(空 Set → 全 valid → 满分)', () => {
  const r = scoreAllDimensions(baseProposal);
  // knownPaperIds 为空 Set → if (knownPaperIds.size > 0 && ...) 不触发 → 所有 valid
  assert.equal(r.citation.score, 10);
});
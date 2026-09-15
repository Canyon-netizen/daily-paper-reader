#!/usr/bin/env node
// astro-src/scripts/dimensions.test.mjs
//
// Tests for R7 F.2.1–F.2.4 feedback 4 个客观维度启发式打分。

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

function makeP(overrides = {}) {
  return {
    rationale: '',
    risk: '',
    evidence: { paperIds: [] },
    target: {},
    ...overrides,
  };
}

// ----- F.2.1: citation validity -----

test('citation: 格式合法 + 在库内 → valid', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['1706.03762'] } }, new Set(['1706.03762']));
  assert.equal(r.invalid.length, 0);
  assert.equal(r.missing.length, 0);
  assert.ok(r.valid.includes('1706.03762'));
  assert.equal(r.score, 10);
});

test('citation: 格式不合法 → invalid', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['nope', '1706.03762'] } });
  assert.equal(r.invalid.length, 1);
  assert.equal(r.invalid[0], 'nope');
});

test('citation: 格式合法但不在库 → missing', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['1706.03762'] } }, new Set(['9999.99999']));
  assert.equal(r.missing.length, 1);
});

test('citation: 空库 → 全部 valid(没 knownPaperIds 当全部已知)', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['1706.03762'] } });
  assert.equal(r.missing.length, 0);
  assert.equal(r.valid.length, 1);
});

test('citation: 检测重复(同 canonical 多版本)', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['1706.03762', '1706.03762v2'] } });
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0], '1706.03762v2');
});

test('citation: 混合 validity → 部分分数', () => {
  const r = scoreCitationValidity({ evidence: { paperIds: ['1706.03762', 'bad', '1706.03763'] } }, new Set(['1706.03762', '1706.03763']));
  // 2 valid, 1 invalid → 2/3 * 10
  assert.equal(Math.round(r.score * 1000) / 1000, Math.round(20 / 3 * 1000) / 1000);
});

// ----- F.2.2: methodology -----

test('methodology: 全 keyword → 满分', () => {
  const r = scoreMethodology({ rationale: '假设: ... baseline + ablation + accuracy + N=100 + p<0.05' });
  assert.equal(r.score, 10);
});

test('methodology: 无 keyword → 0 分', () => {
  const r = scoreMethodology({ rationale: '' });
  assert.equal(r.score, 0);
});

test('methodology: 部分 keyword → 中等分 + 提 issue', () => {
  const r = scoreMethodology({ rationale: '假设: ... baseline' });
  assert.ok(r.score > 0 && r.score < 10);
  assert.ok(r.issues.some((i) => i.includes('指标') || i.includes('样本量')));
});

test('methodology: issue + suggestion 都填了', () => {
  const r = scoreMethodology({ rationale: 'hypothesis x' });
  assert.ok(r.issues.length > 0);
  assert.ok(r.suggestions.length > 0);
});

// ----- F.2.3: reproducibility -----

test('reproducibility: 全 false → 0 分', () => {
  const r = scoreReproducibility({ rationale: '' });
  assert.equal(r.score, 0);
  assert.equal(r.flags.code_available, false);
});

test('reproducibility: github 提到 → code_available true', () => {
  const r = scoreReproducibility({ rationale: '代码在 github.com/foo/bar 开源' });
  assert.equal(r.flags.code_available, true);
  assert.ok(r.score > 0);
});

test('reproducibility: GPU + seed → resources + seeds', () => {
  const r = scoreReproducibility({ rationale: '使用 GPU A100 显存 80GB,seed=42' });
  assert.equal(r.flags.resources_documented, true);
  assert.equal(r.flags.seeds_disclosed, true);
});

// ----- F.2.4: novelty -----

test('novelty: 0 引用 + 长 rationale → 较低分', () => {
  const r = scoreNovelty({ rationale: 'x'.repeat(200), evidence: { paperIds: [] } });
  assert.ok(r.score >= 6); // 长 rationale 兜底
});

test('novelty: 引用 10+ 篇 + 长 rationale → 满分', () => {
  const refs = Array.from({ length: 10 }, (_, i) => `1706.${String(i).padStart(5, '0')}`);
  const r = scoreNovelty({ rationale: 'x'.repeat(300), evidence: { paperIds: refs } });
  // 10 篇不触发 >15,-2,但 rationale 长 → 不再减
  assert.equal(r.score, 9);
});

test('novelty: 0 引用 + 短 rationale → 低分 + risk', () => {
  const r = scoreNovelty({ rationale: 'short', evidence: { paperIds: [] } });
  assert.ok(r.score < 7);
  assert.ok(r.risks.length > 0);
});

// ----- buildCritiqueScores -----

test('buildCritiqueScores: overall 等权平均 4 维度', () => {
  const s = buildCritiqueScores(
    { methodologist: 8, engineer: 7, skeptic: 6 },
    { citation_validity: 10, methodology: 8, reproducibility: 6, novelty: 4 },
  );
  assert.equal(s.overall, 7); // (10+8+6+4)/4
  assert.equal(s.methodologist, 8);
  assert.equal(s.novelty, 4);
});

test('buildCritiqueScores: 保留 persona + 4 维度', () => {
  const s = buildCritiqueScores(
    { methodologist: 5, engineer: 5, skeptic: 5 },
    { citation_validity: 5, methodology: 5, reproducibility: 5, novelty: 5 },
  );
  assert.equal(s.overall, 5);
  assert.equal(s.methodologist, 5);
});

// ----- scoreAllDimensions -----

test('scoreAllDimensions: 4 个维度都跑出结果', () => {
  const out = scoreAllDimensions(makeP({ rationale: 'hypothesis x', evidence: { paperIds: ['1706.03762'] } }));
  assert.equal(typeof out.citation.score, 'number');
  assert.equal(typeof out.methodology.score, 'number');
  assert.equal(typeof out.reproducibility.score, 'number');
  assert.equal(typeof out.novelty.score, 'number');
});

// ----- DIMENSION_NAMES -----

test('DIMENSION_NAMES: 4 个固定维度', () => {
  assert.deepEqual([...DIMENSION_NAMES], ['citation_validity', 'methodology', 'reproducibility', 'novelty']);
});
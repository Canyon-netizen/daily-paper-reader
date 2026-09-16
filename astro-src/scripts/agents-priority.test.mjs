#!/usr/bin/env node
// astro-src/scripts/agents-priority.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/priority.ts scoreProposalPriority.

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

const mod = await loadTs('lib/agents/priority.ts');
const { scoreProposalPriority } = mod;

test('scoreProposalPriority: 默认权重', () => {
  // 全 0.5 → 0.5 * 0.5 + 0.5 * 0.3 + 0.5 * 0.2 = 0.5
  const r = scoreProposalPriority({ id: '1' });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 全部 1.0 → 1.0', () => {
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 1, confidence: 1, evidenceSize: 1,
  });
  assert.equal(r, 1.0);
});

test('scoreProposalPriority: 全部 0 → 0', () => {
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 0, confidence: 0, evidenceSize: 0,
  });
  assert.equal(r, 0);
});

test('scoreProposalPriority: 权重和不等于 1 → 抛错', () => {
  assert.throws(() => scoreProposalPriority({ id: '1' }, {
    feedbackWeight: 0.5, confidenceWeight: 0.5, evidenceWeight: 0.5,
  }), /Weights must sum to 1/);
});

test('scoreProposalPriority: 权重和 1.001 → 抛错', () => {
  assert.throws(() => scoreProposalPriority({ id: '1' }, {
    feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.201,
  }));
});

test('scoreProposalPriority: 权重和 0.999 → 通过 (|1-0.999|=0.001 不 > 0.001)', () => {
  // source: Math.abs(totalWeight - 1) > 0.001 → 0.001 不严格大于 → 不抛
  const r = scoreProposalPriority({ id: '1' }, {
    feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.199,
  });
  assert.equal(typeof r, 'number');
});

test('scoreProposalPriority: 权重和 1.0 → pass (边界)', () => {
  const r = scoreProposalPriority({ id: '1' }, {
    feedbackWeight: 0.5, confidenceWeight: 0.3, evidenceWeight: 0.2,
  });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 超出范围值被 clamp', () => {
  // feedback 2 → 钳到 1
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 2, confidence: 1, evidenceSize: 1,
  });
  // 1*0.5 + 1*0.3 + 1*0.2 = 1
  assert.equal(r, 1);
});

test('scoreProposalPriority: 负值被 clamp 到 0', () => {
  const r = scoreProposalPriority({
    id: '1', feedbackScore: -1, confidence: 0, evidenceSize: 0,
  });
  assert.equal(r, 0);
});

test('scoreProposalPriority: undefined metric → 0.5 兜底', () => {
  // 仅 feedback = 1,其他 undefined
  const r = scoreProposalPriority({ id: '1', feedbackScore: 1 });
  // 1*0.5 + 0.5*0.3 + 0.5*0.2 = 0.5 + 0.15 + 0.1 = 0.75
  assert.equal(r, 0.75);
});

test('scoreProposalPriority: null metric → 0.5 兜底', () => {
  const r = scoreProposalPriority({ id: '1', feedbackScore: null });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 0 权重可配置', () => {
  // feedbackWeight=0 → 不计 feedback
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 0, confidence: 1, evidenceSize: 0,
  }, { feedbackWeight: 0, confidenceWeight: 0.5, evidenceWeight: 0.5 });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 自定义非默认权重分配', () => {
  // 全部 feedback = 0.6
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 0.6, confidence: 0.6, evidenceSize: 0.6,
  }, { feedbackWeight: 0.7, confidenceWeight: 0.2, evidenceWeight: 0.1 });
  // = 0.6 * 0.7 + 0.6 * 0.2 + 0.6 * 0.1 = 0.6 (浮点)
  assert.ok(Math.abs(r - 0.6) < 1e-9);
});

test('scoreProposalPriority: 浮点 0.5 反馈', () => {
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 0.5, confidence: 0.5, evidenceSize: 0.5,
  });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 浮点精度允许', () => {
  // 0.1+0.2+0.7 = 1.0 → pass
  const r = scoreProposalPriority({ id: '1' }, {
    feedbackWeight: 0.1, confidenceWeight: 0.2, evidenceWeight: 0.7,
  });
  assert.equal(r, 0.5);
});

test('scoreProposalPriority: 超出 [0,1] 总分钳位', () => {
  // 权重和 1 但 evidenceSize = 2 → 钳到 1 → 总分 1.0
  const r = scoreProposalPriority({
    id: '1', feedbackScore: 2, confidence: 2, evidenceSize: 2,
  });
  assert.equal(r, 1);
});

test('scoreProposalPriority: 仅 evidence 主导', () => {
  // evidence=1,其他兜底 0.5
  const r = scoreProposalPriority({ id: '1', evidenceSize: 1 });
  // 0.5 * 0.5 + 0.5 * 0.3 + 1 * 0.2 = 0.25 + 0.15 + 0.2 = 0.6 (浮点)
  assert.ok(Math.abs(r - 0.6) < 1e-9);
});
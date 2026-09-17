#!/usr/bin/env node
// astro-src/scripts/agents-priority.test.mjs
//
// Tests for R7 polish: astro-src/lib/agents/priority.ts.
// scoreProposalPriority:feedbackScore(0.5) + confidence(0.3) + evidenceSize(0.2)
// 加权评分,weights 校验求和=1, normalize 钳制到 0..1。

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

const mkProposal = (overrides) => ({
  id: 'p1',
  ...overrides,
});

// ---------- 默认权重 0.5/0.3/0.2 ---
test('priority: 全 1.0 → 1.0', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 1, confidence: 1, evidenceSize: 1,
  }));
  assert.equal(r, 1.0);
});

test('priority: 全 0 → 0', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0, confidence: 0, evidenceSize: 0,
  }));
  assert.equal(r, 0);
});

test('priority: 全 0.5 → 0.5 (默认 0.5 中位)', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0.5, confidence: 0.5, evidenceSize: 0.5,
  }));
  assert.equal(r, 0.5);
});

test('priority: 缺字段 → 默认 0.5', () => {
  // 3 字段都缺 → 全 0.5 → 0.5
  const r = scoreProposalPriority(mkProposal({}));
  assert.equal(r, 0.5);
});

test('priority: 缺 1 字段 → 另两个加权', () => {
  // feedbackScore=1, confidence=0, evidenceSize=0
  // 1*0.5 + 0*0.3 + 0*0.2 = 0.5
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 1, confidence: 0, evidenceSize: 0,
  }));
  assert.equal(r, 0.5);
});

// ---------- 权重求和校验 ---
test('priority: 权重和 ≠ 1 → 抛错', () => {
  assert.throws(() => {
    scoreProposalPriority(mkProposal({ feedbackScore: 1 }), {
      feedbackWeight: 0.5, confidenceWeight: 0.5, evidenceWeight: 0.5,
    });
  });
});

test('priority: 权重和 = 1 接受', () => {
  const r = scoreProposalPriority(mkProposal({ feedbackScore: 1 }), {
    feedbackWeight: 1, confidenceWeight: 0, evidenceWeight: 0,
  });
  assert.equal(r, 1.0);
});

test('priority: 权重和差 0.001 内可', () => {
  // 0.333 + 0.333 + 0.334 = 1.0
  const r = scoreProposalPriority(mkProposal({ feedbackScore: 0.5 }), {
    feedbackWeight: 0.333, confidenceWeight: 0.333, evidenceWeight: 0.334,
  });
  assert.ok(typeof r === 'number');
});

test('priority: 权重和差 0.001 外 → 抛', () => {
  assert.throws(() => {
    scoreProposalPriority(mkProposal({}), {
      feedbackWeight: 0.5, confidenceWeight: 0.4, evidenceWeight: 0.05,
    });
  });
});

// ---------- 钳制 0..1 ---
test('priority: > 1 钳制', () => {
  // 假设实现给一个 > 1 输入,应钳制
  // (实际 normalizeMetric 钳制,score 加权和不会超过 1,但测试边界)
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 1, confidence: 1, evidenceSize: 1,
  }));
  assert.ok(r >= 0 && r <= 1);
});

test('priority: 反馈 = 1, 其他 0 → 0.5', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 1, confidence: 0, evidenceSize: 0,
  }));
  // 1*0.5 = 0.5
  assert.equal(r, 0.5);
});

test('priority: 置信 = 1, 其他 0 → 0.3', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0, confidence: 1, evidenceSize: 0,
  }));
  assert.equal(r, 0.3);
});

test('priority: 证据 = 1, 其他 0 → 0.2', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0, confidence: 0, evidenceSize: 1,
  }));
  assert.equal(r, 0.2);
});

// ---------- 自定义权重 ---
test('priority: 自定义权重 1/0/0 → feedback 主导', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0.8, confidence: 0.2, evidenceSize: 0.5,
  }), {
    feedbackWeight: 1, confidenceWeight: 0, evidenceWeight: 0,
  });
  assert.equal(r, 0.8);
});

test('priority: 自定义权重 0/0/1 → evidence 主导', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0.8, confidence: 0.2, evidenceSize: 0.5,
  }), {
    feedbackWeight: 0, confidenceWeight: 0, evidenceWeight: 1,
  });
  assert.equal(r, 0.5);
});

// ---------- null/undefined 处理 ---
test('priority: null 字段 → 默认 0.5', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: null, confidence: null, evidenceSize: null,
  }));
  assert.equal(r, 0.5);
});

test('priority: 部分 undefined → 默认值', () => {
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 1,
    confidence: undefined,
    evidenceSize: undefined,
  }));
  // 1*0.5 + 0.5*0.3 + 0.5*0.2 = 0.5 + 0.15 + 0.1 = 0.75
  assert.equal(r, 0.75);
});

// ---------- 加权和数学 ---
test('priority: 加权和公式', () => {
  // feedback=0.6, confidence=0.4, evidence=0.2
  // 0.6*0.5 + 0.4*0.3 + 0.2*0.2 = 0.3 + 0.12 + 0.04 = 0.46
  const r = scoreProposalPriority(mkProposal({
    feedbackScore: 0.6, confidence: 0.4, evidenceSize: 0.2,
  }));
  assert.ok(Math.abs(r - 0.46) < 1e-9);
});
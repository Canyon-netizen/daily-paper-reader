#!/usr/bin/env node
// astro-src/scripts/concept-extract.test.mjs
//
// Tests for R7 G.1.1 3-stage concept extraction.

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

const mod = await loadTs('lib/concepts/extract.ts');
const {
  renderStage1Prompt,
  renderStage2Prompt,
  renderStage3Prompt,
  mergeConcepts,
  STAGE1_TITLE_PROMPT,
  STAGE2_ABSTRACT_PROMPT,
  STAGE3_CROSSLINK_PROMPT,
} = mod;

// ----- 三个 prompt 模板 -----

test('STAGE1_TITLE_PROMPT: 占位符 {title} + 输出 JSON 指引', () => {
  assert.match(STAGE1_TITLE_PROMPT, /\{title\}/);
  assert.match(STAGE1_TITLE_PROMPT, /JSON/);
  assert.match(STAGE1_TITLE_PROMPT, /3-5/);
});

test('STAGE2_ABSTRACT_PROMPT: {abstract} + parentSlug', () => {
  assert.match(STAGE2_ABSTRACT_PROMPT, /\{abstract\}/);
  assert.match(STAGE2_ABSTRACT_PROMPT, /parentSlug/);
  assert.match(STAGE2_ABSTRACT_PROMPT, /8-12/);
});

test('STAGE3_CROSSLINK_PROMPT: cross-link 关系类型', () => {
  assert.match(STAGE3_CROSSLINK_PROMPT, /parent_of/);
  assert.match(STAGE3_CROSSLINK_PROMPT, /related_to/);
  assert.match(STAGE3_CROSSLINK_PROMPT, /uses/);
  assert.match(STAGE3_CROSSLINK_PROMPT, /evaluated_on/);
});

// ----- render functions -----

test('renderStage1Prompt: 注入 title 到模板', () => {
  const p = renderStage1Prompt('Attention Is All You Need');
  assert.match(p, /Attention Is All You Need/);
  assert.ok(!p.includes('{title}'));
});

test('renderStage1Prompt: 转义 { } 防止误解析', () => {
  const p = renderStage1Prompt('Test {curly} title');
  assert.ok(!p.includes('{curly}'));  // 已被 escape 掉
});

test('renderStage2Prompt: 注入 abstract', () => {
  const p = renderStage2Prompt('This paper proposes...');
  assert.match(p, /This paper proposes\.\.\./);
});

test('renderStage3Prompt: 列出所有 concept', () => {
  const p = renderStage3Prompt([
    { slug: 'transformer', label: 'Transformer', sourceStage: 1, confidence: 0.9 },
    { slug: 'self-attention', label: 'Self-Attention', parent: 'transformer', sourceStage: 2, confidence: 0.8 },
  ]);
  assert.match(p, /transformer/);
  assert.match(p, /self-attention/);
  assert.match(p, /Transformer/);
});

// ----- mergeConcepts -----

test('mergeConcepts: 合并 stage1 + stage2', () => {
  const r = mergeConcepts(
    [{ slug: 'transformer', label: 'Transformer', sourceStage: 1, confidence: 0.9 }],
    [{ slug: 'self-attention', label: 'Self-Attention', parent: 'transformer', sourceStage: 2, confidence: 0.8 }],
  );
  assert.equal(r.length, 2);
  const sa = r.find((c) => c.slug === 'self-attention');
  assert.equal(sa.parent, 'transformer');
});

test('mergeConcepts: 跨 stage 同 slug 合并 + 保留 max confidence', () => {
  const r = mergeConcepts(
    [{ slug: 'rl', label: 'RL', sourceStage: 1, confidence: 0.5 }],
    [{ slug: 'rl', label: 'Reinforcement Learning', sourceStage: 2, confidence: 0.9 }],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, 0.9);
  // label 优先用 stage2 的(label 更具体)
  assert.equal(r[0].label, 'Reinforcement Learning');
});

test('mergeConcepts: stage3 link 覆盖 parent', () => {
  const r = mergeConcepts(
    [],
    [
      { slug: 'transformer', label: 'Transformer', sourceStage: 2, confidence: 0.8 },
      { slug: 'self-attention', label: 'Self-Attention', sourceStage: 2, confidence: 0.8 },
    ],
    [{ from: 'transformer', to: 'self-attention', type: 'parent_of', weight: 1 }],
  );
  const sa = r.find((c) => c.slug === 'self-attention');
  assert.equal(sa.parent, 'transformer');
  // confidence 微调
  assert.equal(Math.round(sa.confidence * 10000) / 10000, 0.85);
});

test('mergeConcepts: 排序 parent 先,然后 slug', () => {
  const r = mergeConcepts(
    [
      { slug: 'nlp', label: 'NLP', sourceStage: 1, confidence: 0.9 },
      { slug: 'cv', label: 'CV', sourceStage: 1, confidence: 0.9 },
    ],
    [
      { slug: 'classification', label: 'Classification', parent: 'nlp', sourceStage: 2, confidence: 0.8 },
      { slug: 'detection', label: 'Detection', parent: 'cv', sourceStage: 2, confidence: 0.8 },
    ],
  );
  // 无 parent 的先(按 slug 排序,c < n,所以 cv 在 nlp 前面)
  // 有 parent 的按 parent 字段排
  const noParent = r.filter((c) => !c.parent).map((c) => c.slug);
  assert.deepEqual(noParent.sort(), ['cv', 'nlp']);
  const withParent = r.filter((c) => c.parent).map((c) => c.slug);
  assert.deepEqual(withParent.sort(), ['classification', 'detection']);
  // nlp 一定在 classification 之前(因为 classification.parent = nlp)
  assert.ok(r.findIndex((c) => c.slug === 'nlp') < r.findIndex((c) => c.slug === 'classification'));
});

test('mergeConcepts: 空输入返回空数组', () => {
  assert.deepEqual(mergeConcepts([], [], []), []);
});

test('mergeConcepts: 忽略非 parent_of 的 stage3 link', () => {
  const r = mergeConcepts(
    [],
    [{ slug: 'transformer', label: 'T', sourceStage: 2, confidence: 0.5 }],
    [{ from: 'transformer', to: 'attention', type: 'uses', weight: 1 }],
  );
  const t = r.find((c) => c.slug === 'transformer');
  assert.equal(t.parent, undefined);
});
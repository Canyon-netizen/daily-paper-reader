#!/usr/bin/env node
// astro-src/scripts/smart-template.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/smart-template.ts.
// 测试 SMART_HYPOTHESIS_MARKDOWN 常量 + renderSmartHypothesisTemplate。
// applySmartHypothesisTemplate 因为依赖 DOM,不在此测试。

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

const mod = await loadTs('lib/experiments/smart-template.ts');
const { SMART_HYPOTHESIS_MARKDOWN, renderSmartHypothesisTemplate } = mod;

test('SMART_HYPOTHESIS_MARKDOWN: 非空字符串', () => {
  assert.ok(typeof SMART_HYPOTHESIS_MARKDOWN === 'string');
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.length > 100);
});

test('SMART_HYPOTHESIS_MARKDOWN: 5 个 SMART 章节标题', () => {
  const text = SMART_HYPOTHESIS_MARKDOWN;
  assert.ok(text.includes('Specific'));
  assert.ok(text.includes('Measurable'));
  assert.ok(text.includes('Achievable'));
  assert.ok(text.includes('Relevant'));
  assert.ok(text.includes('Time-bound'));
});

test('SMART_HYPOTHESIS_MARKDOWN: Hypothesis Statement 总结行', () => {
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.includes('## Hypothesis Statement'));
});

test('SMART_HYPOTHESIS_MARKDOWN: 占位用 [方括号]', () => {
  const text = SMART_HYPOTHESIS_MARKDOWN;
  // 应有多个 [xxx] 占位
  const matches = text.match(/\[[^\]]+\]/g) || [];
  assert.ok(matches.length >= 5);
});

test('renderSmartHypothesisTemplate: 返回 SMART 模板', () => {
  const t = renderSmartHypothesisTemplate();
  assert.equal(t, SMART_HYPOTHESIS_MARKDOWN);
});

test('renderSmartHypothesisTemplate: 每次返回新字符串(不可变?)', () => {
  const a = renderSmartHypothesisTemplate();
  const b = renderSmartHypothesisTemplate();
  // 源实现是 `return SMART_HYPOTHESIS_MARKDOWN` — 应当 ===
  assert.equal(a, b);
});

test('SMART_HYPOTHESIS_MARKDOWN: 含 Markdown 二级标题 ##', () => {
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.includes('## '));
});
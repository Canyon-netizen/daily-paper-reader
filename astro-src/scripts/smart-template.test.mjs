#!/usr/bin/env node
// astro-src/scripts/smart-template.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/smart-template.ts.
// 只测纯函数;applySmartHypothesisTemplate 需要 DOM,跳过。

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

test('SMART_HYPOTHESIS_MARKDOWN: 含 5 个 SMART 章节标题', () => {
  const m = SMART_HYPOTHESIS_MARKDOWN;
  assert.ok(m.includes('### Specific'));
  assert.ok(m.includes('### Measurable'));
  assert.ok(m.includes('### Achievable'));
  assert.ok(m.includes('### Relevant'));
  assert.ok(m.includes('### Time-bound'));
});

test('SMART_HYPOTHESIS_MARKDOWN: 含 Hypothesis Statement', () => {
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.includes('## Hypothesis Statement'));
});

test('SMART_HYPOTHESIS_MARKDOWN: 含占位符 [方括号]', () => {
  // 至少 5 个 [..]
  const count = (SMART_HYPOTHESIS_MARKDOWN.match(/\[[^\]]*\]/g) || []).length;
  assert.ok(count >= 5, `expected >= 5 placeholders, got ${count}`);
});

test('SMART_HYPOTHESIS_MARKDOWN: 含自变量/因变量/评估指标', () => {
  const m = SMART_HYPOTHESIS_MARKDOWN;
  assert.ok(m.includes('自变量'));
  assert.ok(m.includes('因变量'));
  assert.ok(m.includes('评估指标'));
});

test('SMART_HYPOTHESIS_MARKDOWN: 含里程碑 M1/M2/M3', () => {
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.includes('M1'));
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.includes('M2'));
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.includes('M3'));
});

test('SMART_HYPOTHESIS_MARKDOWN: 顶部 SMART Hypothesis 主标题', () => {
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.startsWith('## SMART Hypothesis'));
});

test('renderSmartHypothesisTemplate: 返回 SMART_HYPOTHESIS_MARKDOWN 引用', () => {
  const r = renderSmartHypothesisTemplate();
  assert.equal(r, SMART_HYPOTHESIS_MARKDOWN);
});

test('renderSmartHypothesisTemplate: 每次调用返回非空字符串', () => {
  for (let i = 0; i < 3; i++) {
    const r = renderSmartHypothesisTemplate();
    assert.ok(typeof r === 'string');
    assert.ok(r.length > 100);
  }
});

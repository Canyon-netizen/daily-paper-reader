#!/usr/bin/env node
// astro-src/scripts/experiments-smart-template.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/smart-template.ts.
// SMART_HYPOTHESIS_MARKDOWN (string) + renderSmartHypothesisTemplate +
// applySmartHypothesisTemplate (DOM-element input)。

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
const {
  SMART_HYPOTHESIS_MARKDOWN,
  renderSmartHypothesisTemplate,
  applySmartHypothesisTemplate,
} = mod;

// ---------- SMART_HYPOTHESIS_MARKDOWN (string literal) ----------
test('SMART_HYPOTHESIS_MARKDOWN: 含 SMART 5 段', () => {
  const m = SMART_HYPOTHESIS_MARKDOWN;
  assert.match(m, /### Specific/);
  assert.match(m, /### Measurable/);
  assert.match(m, /### Achievable/);
  assert.match(m, /### Relevant/);
  assert.match(m, /### Time-bound/);
});

test('SMART_HYPOTHESIS_MARKDOWN: 含 Hypothesis Statement 总结行', () => {
  assert.match(SMART_HYPOTHESIS_MARKDOWN, /## Hypothesis Statement/);
});

test('SMART_HYPOTHESIS_MARKDOWN: 自变量/因变量', () => {
  assert.match(SMART_HYPOTHESIS_MARKDOWN, /自变量/);
  assert.match(SMART_HYPOTHESIS_MARKDOWN, /因变量/);
});

test('SMART_HYPOTHESIS_MARKDOWN: 占位符用 [方括号]', () => {
  // 检查至少 5 个 [..] 占位符
  const matches = SMART_HYPOTHESIS_MARKDOWN.match(/\[[^\]]+\]/g) || [];
  assert.ok(matches.length >= 5);
});

test('SMART_HYPOTHESIS_MARKDOWN: 至少 1 行 [用一句话陈述可证伪的假设]', () => {
  assert.match(SMART_HYPOTHESIS_MARKDOWN, /可证伪的假设/);
});

// ---------- renderSmartHypothesisTemplate ----------
test('renderSmartHypothesisTemplate: 返回字符串', () => {
  assert.equal(typeof renderSmartHypothesisTemplate(), 'string');
});

test('renderSmartHypothesisTemplate: 与 SMART_HYPOTHESIS_MARKDOWN 同内容', () => {
  assert.equal(renderSmartHypothesisTemplate(), SMART_HYPOTHESIS_MARKDOWN);
});

test('renderSmartHypothesisTemplate: 非空', () => {
  assert.ok(renderSmartHypothesisTemplate().length > 100);
});

test('renderSmartHypothesisTemplate: 含换行', () => {
  assert.match(renderSmartHypothesisTemplate(), /\n/);
});

test('renderSmartHypothesisTemplate: 多次调用返回相同字符串', () => {
  assert.equal(renderSmartHypothesisTemplate(), renderSmartHypothesisTemplate());
});

// ---------- applySmartHypothesisTemplate: null / undefined ---
test('applySmartHypothesisTemplate: null → ok=false', () => {
  const r = applySmartHypothesisTemplate(null);
  assert.equal(r.applied, false);
  assert.match(r.reason, /no target/);
});

test('applySmartHypothesisTemplate: undefined → ok=false', () => {
  const r = applySmartHypothesisTemplate(undefined);
  assert.equal(r.applied, false);
});

test('applySmartHypothesisTemplate: 没有 hypothesis field → ok=false', () => {
  // 传入空对象(没有 querySelector 也没有 hypothesis 字段)
  const r = applySmartHypothesisTemplate({});
  assert.equal(r.applied, false);
  assert.match(r.reason, /no hypothesis/);
});

// ---------- applySmartHypothesisTemplate: fieldMap 形态 ---
test('applySmartHypothesisTemplate: fieldMap 含 hypothesis → 填充', () => {
  const hypEl = { value: '' };
  const r = applySmartHypothesisTemplate({ hypothesis: hypEl });
  assert.equal(r.applied, true);
  assert.match(hypEl.value, /SMART/);
});

test('applySmartHypothesisTemplate: hypothesisZh 同步填充', () => {
  const hypEl = { value: '' };
  const hypZhEl = { value: '' };
  const r = applySmartHypothesisTemplate({ hypothesis: hypEl, hypothesisZh: hypZhEl }, { alsoFillZh: true });
  assert.equal(r.applied, true);
  assert.match(hypZhEl.value, /中文/);
});

test('applySmartHypothesisTemplate: hypothesisZh 不传 → 不填', () => {
  const hypEl = { value: '' };
  const hypZhEl = { value: '' };
  applySmartHypothesisTemplate({ hypothesis: hypEl, hypothesisZh: hypZhEl });
  assert.equal(hypZhEl.value, ''); // 没动
});

test('applySmartHypothesisTemplate: hypothesis 已有值 → 不覆盖', () => {
  const hypEl = { value: 'already written' };
  applySmartHypothesisTemplate({ hypothesis: hypEl });
  assert.equal(hypEl.value, 'already written');
});

test('applySmartHypothesisTemplate: hypothesisZh 已有值 → 不覆盖', () => {
  const hypEl = { value: '' };
  const hypZhEl = { value: 'user zh text' };
  applySmartHypothesisTemplate({ hypothesis: hypEl, hypothesisZh: hypZhEl }, { alsoFillZh: true });
  assert.equal(hypZhEl.value, 'user zh text');
});

test('applySmartHypothesisTemplate: hypothesis=null, hypothesisZh 字段 → ok=true', () => {
  const hypZhEl = { value: '' };
  const r = applySmartHypothesisTemplate({ hypothesis: null, hypothesisZh: hypZhEl }, { alsoFillZh: true });
  assert.equal(r.applied, true);
  assert.match(hypZhEl.value, /中文/);
});

// ---------- form 形态:用 mock DOMElement querySelector ---
test('applySmartHypothesisTemplate: form 形态 - querySelector 返回 null → ok=false', () => {
  const fakeForm = {
    querySelector: () => null,
  };
  const r = applySmartHypothesisTemplate(fakeForm);
  assert.equal(r.applied, false);
});

test('applySmartHypothesisTemplate: form 形态 - 找到 #exp-hypothesis → 填充', () => {
  const hypEl = { value: '' };
  const fakeForm = {
    querySelector: (sel) => {
      if (sel === '#exp-hypothesis, [name="hypothesis"]') return hypEl;
      if (sel === '#exp-hypothesis-zh, [name="hypothesisZh"]') return null;
      return null;
    },
  };
  const r = applySmartHypothesisTemplate(fakeForm);
  assert.equal(r.applied, true);
  assert.match(hypEl.value, /SMART/);
});

test('applySmartHypothesisTemplate: form 形态 - both fields 填充', () => {
  const hypEl = { value: '' };
  const hypZhEl = { value: '' };
  const fakeForm = {
    querySelector: (sel) => {
      if (sel === '#exp-hypothesis, [name="hypothesis"]') return hypEl;
      if (sel === '#exp-hypothesis-zh, [name="hypothesisZh"]') return hypZhEl;
      return null;
    },
  };
  const r = applySmartHypothesisTemplate(fakeForm, { alsoFillZh: true });
  assert.equal(r.applied, true);
  assert.match(hypZhEl.value, /中文/);
});

test('applySmartHypothesisTemplate: form 形态 - hypothesis 已有 → 不覆盖', () => {
  const hypEl = { value: 'manual content' };
  const fakeForm = {
    querySelector: () => hypEl,
  };
  applySmartHypothesisTemplate(fakeForm);
  assert.equal(hypEl.value, 'manual content');
});

// ---------- 集成 ---
test('rendered 模板是合法 markdown:含 ## 和 ### 标题', () => {
  const m = renderSmartHypothesisTemplate();
  assert.match(m, /^## /m);
  const h3Count = (m.match(/^### /gm) || []).length;
  assert.ok(h3Count >= 5);
});

test('rendered 模板含 Achievable 段落提及数据来源/算力/风险', () => {
  const m = renderSmartHypothesisTemplate();
  const achievable = m.split('### Achievable')[1].split('###')[0];
  assert.match(achievable, /数据来源/);
  assert.match(achievable, /算力/);
  assert.match(achievable, /风险/);
});
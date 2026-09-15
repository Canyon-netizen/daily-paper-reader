#!/usr/bin/env node
// astro-src/scripts/smart-template.test.mjs
//
// Tests for R7 E.2.1 SMART hypothesis template helper.

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
const { SMART_HYPOTHESIS_MARKDOWN, renderSmartHypothesisTemplate, applySmartHypothesisTemplate } = mod;

// ----- 模板 shape -----

test('SMART_HYPOTHESIS_MARKDOWN: contains the 5 SMART letters', () => {
  for (const k of ['Specific', 'Measurable', 'Achievable', 'Relevant', 'Time-bound']) {
    assert.match(SMART_HYPOTHESIS_MARKDOWN, new RegExp(`###\\s+${k}`));
  }
});

test('SMART_HYPOTHESIS_MARKDOWN: ends with a Hypothesis Statement section', () => {
  assert.match(SMART_HYPOTHESIS_MARKDOWN, /##\s+Hypothesis Statement\s*\n/);
  // 最后一行不应是空行
  assert.ok(SMART_HYPOTHESIS_MARKDOWN.trimEnd().endsWith(']'));
});

test('SMART_HYPOTHESIS_MARKDOWN: has bracketed placeholders for user to fill', () => {
  const placeholders = SMART_HYPOTHESIS_MARKDOWN.match(/\[[^\[\]]+\]/g) || [];
  // 至少 10 个占位符
  assert.ok(placeholders.length >= 10, `expected ≥10 placeholders, got ${placeholders.length}`);
});

test('renderSmartHypothesisTemplate: returns same constant', () => {
  assert.equal(renderSmartHypothesisTemplate(), SMART_HYPOTHESIS_MARKDOWN);
});

// ----- applySmartHypothesisTemplate -----

test('applySmartHypothesisTemplate: with fieldMap fills hypothesis', () => {
  const hypothesis = { value: '' };
  const r = applySmartHypothesisTemplate({ hypothesis });
  assert.equal(r.applied, true);
  assert.match(hypothesis.value, /## SMART Hypothesis/);
  assert.match(hypothesis.value, /Hypothesis Statement/);
});

test('applySmartHypothesisTemplate: respects existing hypothesis (does not overwrite)', () => {
  const hypothesis = { value: '我自己的假设内容' };
  applySmartHypothesisTemplate({ hypothesis });
  assert.equal(hypothesis.value, '我自己的假设内容');
});

test('applySmartHypothesisTemplate: with alsoFillZh writes both fields', () => {
  const hypothesis = { value: '' };
  const hypothesisZh = { value: '' };
  const r = applySmartHypothesisTemplate({ hypothesis, hypothesisZh }, { alsoFillZh: true });
  assert.equal(r.applied, true);
  assert.match(hypothesis.value, /## SMART Hypothesis/);
  assert.match(hypothesisZh.value, /实验假设/);
});

test('applySmartHypothesisTemplate: null target returns ok=false', () => {
  const r = applySmartHypothesisTemplate(null);
  assert.equal(r.applied, false);
  assert.match(r.reason, /no target/);
});

test('applySmartHypothesisTemplate: empty fieldMap returns ok=false (no field)', () => {
  const r = applySmartHypothesisTemplate({});
  assert.equal(r.applied, false);
  assert.match(r.reason, /no hypothesis field/);
});

test('applySmartHypothesisTemplate: with HTMLFormElement variant uses querySelector', () => {
  let queried = null;
  const form = {
    querySelector(sel) {
      if (sel.includes('hypothesis-zh')) {
        return null;
      }
      queried = sel;
      return { value: '' };
    },
  };
  const r = applySmartHypothesisTemplate(form);
  assert.equal(r.applied, true);
  assert.match(queried, /#exp-hypothesis|\[name=.hypothesis.\]/);
});
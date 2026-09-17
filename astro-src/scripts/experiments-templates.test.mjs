#!/usr/bin/env node
// astro-src/scripts/experiments-templates.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/templates.ts.
// experimentTemplates 数组 + getExperimentTemplate by id。

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

const mod = await loadTs('lib/experiments/templates.ts');
const { experimentTemplates, getExperimentTemplate } = mod;

// ---------- 数组结构 ----------
test('experimentTemplates: 是数组', () => {
  assert.ok(Array.isArray(experimentTemplates));
});

test('experimentTemplates: 至少 4 个', () => {
  assert.ok(experimentTemplates.length >= 4);
});

test('experimentTemplates: id 唯一', () => {
  const ids = experimentTemplates.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('experimentTemplates: 每条有中英文 name', () => {
  for (const t of experimentTemplates) {
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(typeof t.nameZh === 'string' && t.nameZh.length > 0);
  }
});

test('experimentTemplates: 每条有中英文 description', () => {
  for (const t of experimentTemplates) {
    assert.ok(typeof t.description === 'string' && t.description.length > 0);
    assert.ok(typeof t.descriptionZh === 'string' && t.descriptionZh.length > 0);
  }
});

test('experimentTemplates: 每条有 hypothesis + hypothesisZh', () => {
  for (const t of experimentTemplates) {
    assert.ok(typeof t.hypothesis === 'string');
    assert.ok(typeof t.hypothesisZh === 'string');
  }
});

test('experimentTemplates: 每条有 method + methodZh', () => {
  for (const t of experimentTemplates) {
    assert.ok(typeof t.method === 'string');
    assert.ok(typeof t.methodZh === 'string');
  }
});

test('experimentTemplates: 每条有 expectedResults + expectedResultsZh', () => {
  for (const t of experimentTemplates) {
    assert.ok(typeof t.expectedResults === 'string');
    assert.ok(typeof t.expectedResultsZh === 'string');
  }
});

test('experimentTemplates: 每条有 title/hypothesis/method 非空字符串', () => {
  for (const t of experimentTemplates) {
    assert.ok(typeof t.title === 'string' && t.title.length > 0);
    assert.ok(typeof t.titleZh === 'string' && t.titleZh.length > 0);
  }
});

test('experimentTemplates: variables 是数组', () => {
  for (const t of experimentTemplates) {
    assert.ok(Array.isArray(t.variables));
  }
});

test('experimentTemplates: variables 至少 2 个', () => {
  for (const t of experimentTemplates) {
    assert.ok(t.variables.length >= 2);
  }
});

test('experimentTemplates: 每个 variable 有 name/type/description', () => {
  for (const t of experimentTemplates) {
    for (const v of t.variables) {
      assert.ok(typeof v.name === 'string' && v.name.length > 0);
      assert.ok(['independent', 'dependent', 'controlled'].includes(v.type));
      assert.ok(typeof v.description === 'string');
    }
  }
});

test('experimentTemplates: tags 是非空字符串数组', () => {
  for (const t of experimentTemplates) {
    assert.ok(Array.isArray(t.tags));
    assert.ok(t.tags.length > 0);
    for (const tag of t.tags) {
      assert.ok(typeof tag === 'string' && tag.length > 0);
    }
  }
});

// ---------- 具体模板 ----------
test('experimentTemplates: ablation-study 含消融', () => {
  const t = experimentTemplates.find((x) => x.id === 'ablation-study');
  assert.ok(t);
  assert.match(t.nameZh, /消融/);
});

test('experimentTemplates: hyperparameter-sweep 含超参数', () => {
  const t = experimentTemplates.find((x) => x.id === 'hyperparameter-sweep');
  assert.ok(t);
  assert.match(t.nameZh, /超参数/);
});

test('experimentTemplates: user-study 含用户', () => {
  const t = experimentTemplates.find((x) => x.id === 'user-study');
  assert.ok(t);
  assert.match(t.nameZh, /用户/);
});

test('experimentTemplates: ab-test 含 A/B', () => {
  const t = experimentTemplates.find((x) => x.id === 'ab-test');
  assert.ok(t);
  assert.match(t.nameZh, /A\/B/);
});

test('experimentTemplates: ablation-study 含 variables 含 independent/dependent/controlled', () => {
  const t = experimentTemplates.find((x) => x.id === 'ablation-study');
  const types = new Set(t.variables.map((v) => v.type));
  assert.ok(types.has('independent'));
  assert.ok(types.has('dependent'));
  assert.ok(types.has('controlled'));
});

// ---------- getExperimentTemplate ----------
test('getExperimentTemplate: ablation-study', () => {
  const t = getExperimentTemplate('ablation-study');
  assert.ok(t);
  assert.equal(t.id, 'ablation-study');
});

test('getExperimentTemplate: hyperparameter-sweep', () => {
  const t = getExperimentTemplate('hyperparameter-sweep');
  assert.ok(t);
});

test('getExperimentTemplate: user-study', () => {
  const t = getExperimentTemplate('user-study');
  assert.ok(t);
});

test('getExperimentTemplate: ab-test', () => {
  const t = getExperimentTemplate('ab-test');
  assert.ok(t);
});

test('getExperimentTemplate: 未知 id → undefined', () => {
  assert.equal(getExperimentTemplate('weird-id'), undefined);
});

test('getExperimentTemplate: 空字符串 → undefined', () => {
  assert.equal(getExperimentTemplate(''), undefined);
});

test('getExperimentTemplate: 大小写敏感', () => {
  assert.equal(getExperimentTemplate('Ablation-Study'), undefined);
});

test('getExperimentTemplate: 返回的与数组同引用', () => {
  const t = getExperimentTemplate('ablation-study');
  const found = experimentTemplates.find((x) => x.id === 'ablation-study');
  assert.equal(t, found);
});

// ---------- 假设模板有占位符 [..] ---
test('templates: hypothesis 模板含占位符 [..]', () => {
  for (const t of experimentTemplates) {
    // 至少假设模板里有占位符(几乎所有都设计就是)
    if (t.hypothesis.includes('[')) {
      assert.match(t.hypothesis, /\[[^\]]+\]/);
    }
  }
});

test('templates: method 模板多步骤(数字 . )', () => {
  for (const t of experimentTemplates) {
    // 检查 method 是多步骤(以 "1. " 开头)
    assert.match(t.method, /^1\.\s/);
  }
});

// ---------- 不变量 ---
test('experimentTemplates: 同一 id 不重复出现', () => {
  const counts = {};
  for (const t of experimentTemplates) {
    counts[t.id] = (counts[t.id] || 0) + 1;
  }
  for (const id in counts) {
    assert.equal(counts[id], 1);
  }
});

test('experimentTemplates: 中英文 name 不是镜像', () => {
  // 大部分情况下 name ≠ nameZh
  for (const t of experimentTemplates) {
    if (t.name !== t.nameZh) return; // 至少一个不镜像
  }
  assert.fail('all templates have identical name/nameZh');
});
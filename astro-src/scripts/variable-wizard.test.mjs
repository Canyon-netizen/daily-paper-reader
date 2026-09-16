#!/usr/bin/env node
// astro-src/scripts/variable-wizard.test.mjs
//
// Tests for R7 polish: astro-src/lib/experiments/variable-wizard.ts.
// 测试 pure helpers:emptyVariableSet / isValidVariable / renderVariableSetMarkdown。
// collectVariablesFromWizard 因为依赖 DOM (HTMLElement),不在此测试。

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

const mod = await loadTs('lib/experiments/variable-wizard.ts');
const { emptyVariableSet, isValidVariable, renderVariableSetMarkdown } = mod;

test('emptyVariableSet: 返回 3 类空数组', () => {
  const s = emptyVariableSet();
  assert.deepEqual(s.independent, []);
  assert.deepEqual(s.dependent, []);
  assert.deepEqual(s.controlled, []);
});

test('emptyVariableSet: 每次返回新对象', () => {
  const a = emptyVariableSet();
  const b = emptyVariableSet();
  a.independent.push({ name: 'x', type: 'continuous' });
  assert.equal(b.independent.length, 0);
});

test('isValidVariable: null / undefined → false', () => {
  assert.equal(isValidVariable(null), false);
  assert.equal(isValidVariable(undefined), false);
});

test('isValidVariable: 非对象 → false', () => {
  assert.equal(isValidVariable('string'), false);
  assert.equal(isValidVariable(42), false);
  assert.equal(isValidVariable([]), false);
});

test('isValidVariable: 缺 name → false', () => {
  assert.equal(isValidVariable({ type: 'continuous' }), false);
  assert.equal(isValidVariable({ name: '', type: 'continuous' }), false);
  assert.equal(isValidVariable({ name: '   ', type: 'continuous' }), false);
});

test('isValidVariable: 缺 type → false', () => {
  assert.equal(isValidVariable({ name: 'x' }), false);
});

test('isValidVariable: type 不在枚举 → false', () => {
  assert.equal(isValidVariable({ name: 'x', type: 'unknown' }), false);
  assert.equal(isValidVariable({ name: 'x', type: '' }), false);
});

test('isValidVariable: name + 合法 type → true', () => {
  for (const t of ['continuous', 'categorical', 'ordinal', 'binary']) {
    assert.equal(isValidVariable({ name: 'x', type: t }), true);
  }
});

test('isValidVariable: 附带 unit/range/description 仍然 valid', () => {
  const v = {
    name: 'x',
    type: 'continuous',
    unit: 'kg',
    range: '0..100',
    description: 'a desc',
  };
  assert.equal(isValidVariable(v), true);
});

test('renderVariableSetMarkdown: 空集合 → ""', () => {
  const md = renderVariableSetMarkdown(emptyVariableSet());
  assert.equal(md, '');
});

test('renderVariableSetMarkdown: 含自变量', () => {
  const md = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous' }],
    dependent: [],
    controlled: [],
  });
  assert.ok(md.includes('## 自变量'));
  assert.ok(md.includes('**lr**'));
  assert.ok(md.includes('`continuous`'));
});

test('renderVariableSetMarkdown: 三类都有', () => {
  const md = renderVariableSetMarkdown({
    independent: [{ name: 'lr', type: 'continuous', unit: '' }],
    dependent: [{ name: 'acc', type: 'continuous' }],
    controlled: [{ name: 'seed', type: 'categorical' }],
  });
  assert.ok(md.includes('## 自变量'));
  assert.ok(md.includes('## 因变量'));
  assert.ok(md.includes('## 控制变量'));
  assert.ok(md.includes('lr'));
  assert.ok(md.includes('acc'));
  assert.ok(md.includes('seed'));
});

test('renderVariableSetMarkdown: 含 unit/range/description', () => {
  const md = renderVariableSetMarkdown({
    independent: [{
      name: 'lr',
      type: 'continuous',
      unit: '10^-3',
      range: '0..1',
      description: 'learning rate',
    }],
    dependent: [],
    controlled: [],
  });
  assert.ok(md.includes('10^-3'));
  assert.ok(md.includes('取值范围'));
  assert.ok(md.includes('0..1'));
  assert.ok(md.includes('learning rate'));
});

test('renderVariableSetMarkdown: 非法 variable 跳过', () => {
  const md = renderVariableSetMarkdown({
    independent: [
      { name: 'lr', type: 'continuous' }, // 合法
      { name: '', type: 'continuous' }, // 非法(空名)
      { name: 'x', type: 'invalid' }, // 非法(type)
    ],
    dependent: [],
    controlled: [],
  });
  assert.ok(md.includes('lr'));
  assert.ok(!md.includes('**x**'));
});

test('renderVariableSetMarkdown: 只有 dependent 时不渲染 independent section', () => {
  const md = renderVariableSetMarkdown({
    independent: [],
    dependent: [{ name: 'acc', type: 'continuous' }],
    controlled: [],
  });
  assert.ok(!md.includes('## 自变量'));
  assert.ok(md.includes('## 因变量'));
});